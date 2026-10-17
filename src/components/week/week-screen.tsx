"use client";

import { useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PublishDialog } from "@/components/mine/publish-dialog";
import { cn } from "@/lib/utils";
import {
  approvePlanVersionAction,
  publishNowAction,
  schedulePlannedPostAction,
  undoPlanVersionAction,
  updatePlannedPostAction,
} from "@/server/actions/planned-post-actions";
import type { PlannedPostRow } from "@/server/queries/planned-posts";
import {
  STEPS,
  canMove,
  dayLabel,
  moveReel,
  nextAction,
  reelStatus,
  splitWeek,
  stepsDone,
  type DraftVersion,
  type FunnelCell,
  type StatusTone,
} from "./week-model";

export interface WeekScreenProps {
  today: string;
  weekKey: string;
  liveVersion: number | null;
  draft: DraftVersion | null;
  reels: PlannedPostRow[];
  funnel: Record<string, FunnelCell[]>;
  metrics: { source: string; metric: string }[];
  graphConfigured: boolean;
  bucketConfigured: boolean;
  dryRun: boolean;
}

const TONE: Record<StatusTone, string> = {
  "": "text-muted-foreground",
  gate: "text-foreground font-medium",
  done: "text-success",
  error: "text-destructive",
};

const ASK_PROMPT = (weekKey: string) =>
  `Dùng MCP crowsnest. Đọc crowsnest_plans và crowsnest_funnel cho tuần ${weekKey}.\nViết plan tuần sau, 2 reel mỗi ngày, rồi gửi bằng crowsnest_propose_plan (period "week"). Đừng đổi reel đã đăng.`;

function Seg({ done }: { done: number }) {
  return (
    <span className="flex min-w-0 gap-[3px]" aria-label={`${done}/5 bước`}>
      {STEPS.map((s, i) => (
        <i key={s} className={cn("h-1 flex-1 rounded-sm", i < done ? (done === 5 ? "bg-success" : "bg-foreground") : "bg-foreground/10")} />
      ))}
    </span>
  );
}

export function WeekScreen(props: WeekScreenProps) {
  const { today, weekKey, liveVersion, draft, funnel, metrics } = props;
  const router = useRouter();
  const [reels, setReels] = useState(props.reels);
  const [lastProps, setLastProps] = useState(props.reels);
  if (props.reels !== lastProps) {
    setLastProps(props.reels);
    setReels(props.reels);
  }
  const [weekOpen, setWeekOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const funnelOf = (r: PlannedPostRow) => (r.keyword ? (funnel[r.keyword.toLowerCase()] ?? []) : []);
  const done = (r: PlannedPostRow) => stepsDone(r, funnelOf(r).length > 0);
  const status = (r: PlannedPostRow) => reelStatus(r, funnelOf(r).length > 0);

  const split = splitWeek(reels, today);
  const ordered = [...split.today, ...split.days.flatMap((d) => d.reels)].sort((a, b) => (a.plannedDate ?? "").localeCompare(b.plannedDate ?? ""));
  const next = nextAction(ordered, draft);
  const rest = split.days.reduce((n, d) => n + d.reels.length, 0);
  const doneN = ordered.filter((r) => done(r) === 5).length;
  const gateN = ordered.filter((r) => status(r)[1] === "gate").length;

  function open(id: string) {
    const r = reels.find((x) => x.id === id);
    if (r && r.plannedDate !== today) setWeekOpen(true);
    setOpenId(id);
  }

  async function moveTo(id: string, date: string) {
    const r = reels.find((x) => x.id === id);
    if (!r || r.plannedDate === date || !canMove(r)) return;
    const from = r.plannedDate;
    performance.mark("week-drop");
    setReels((rs) => moveReel(rs, id, date));
    requestAnimationFrame(() => performance.measure("week-drop-paint", "week-drop"));
    const res = await schedulePlannedPostAction(id, date, r.plannedTime ?? undefined);
    performance.measure("week-drop-store", "week-drop");
    if (!res.ok) {
      setReels((rs) => moveReel(rs, id, from ?? date));
      toast.error(res.error);
      return;
    }
    toast.success(`Đã chuyển sang ${dayLabel(date)}`, {
      action: {
        label: <span data-testid="week-move-undo">Hoàn tác</span>,
        onClick: async () => {
          if (!from) return;
          setReels((rs) => moveReel(rs, id, from));
          const back = await schedulePlannedPostAction(id, from, r.plannedTime ?? undefined);
          if (!back.ok) toast.error(back.error);
        },
      },
    });
  }

  function dropZone(date: string) {
    return {
      "data-drop-day": date,
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOverDay(date);
      },
      onDragLeave: () => setOverDay((d) => (d === date ? null : d)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOverDay(null);
        const id = e.dataTransfer.getData("text/plain");
        if (id) void moveTo(id, date);
      },
    };
  }

  const dragProps = (r: PlannedPostRow) =>
    canMove(r) ? { draggable: true, onDragStart: (e: DragEvent) => e.dataTransfer.setData("text/plain", r.id) } : {};

  async function approve() {
    if (!draft) return;
    const res = await approvePlanVersionAction(draft.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    router.refresh();
    toast.success(`v${draft.version} đang chạy`, {
      action: {
        label: <span data-testid="week-approve-undo">Hoàn tác</span>,
        onClick: async () => {
          const back = await undoPlanVersionAction({ period: "week", periodKey: weekKey });
          if (!back.ok) toast.error(back.error);
          else toast.success(`Đã quay về v${back.live.version}`);
          router.refresh();
        },
      },
    });
  }

  async function ask() {
    try {
      await navigator.clipboard.writeText(ASK_PROMPT(weekKey));
      toast.success("Đã copy prompt · dán vào Claude");
    } catch {
      toast.error("Không copy được. Prompt: " + ASK_PROMPT(weekKey));
    }
  }

  const card = (r: PlannedPostRow) => {
    const [label, tone] = status(r);
    const n = done(r);
    return (
      <button
        key={r.id}
        type="button"
        {...dragProps(r)}
        onClick={() => open(r.id)}
        data-testid="week-today-card"
        data-reel-id={r.id}
        className={cn("flex min-w-0 flex-col gap-2.5 rounded-xl bg-card p-4 text-left ring-1 ring-border transition-shadow hover:ring-input", openId === r.id && "ring-foreground")}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">{r.plannedTime ?? "chưa giờ"}</span>
          <Badge variant="secondary" className={cn("max-w-full truncate", TONE[tone])}>
            {label}
          </Badge>
        </span>
        <span className="text-base font-medium tracking-tight">{r.title}</span>
        {r.note && <span className="truncate text-sm text-muted-foreground">{r.note}</span>}
        <Seg done={n} />
        <span className="font-mono text-xs text-muted-foreground">{n === 5 ? "5/5 · xong" : `Bước ${n + 1}/5 · ${STEPS[n]}`}</span>
      </button>
    );
  };

  const row = (r: PlannedPostRow) => {
    const [label, tone] = status(r);
    return (
      <button
        key={r.id}
        type="button"
        {...dragProps(r)}
        onClick={() => open(r.id)}
        data-testid="week-row"
        data-reel-id={r.id}
        className={cn(
          "grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-2.5 text-left text-sm hover:bg-muted sm:grid-cols-[44px_minmax(0,1fr)_72px_168px]",
          openId === r.id && "bg-muted"
        )}
      >
        <span className="font-mono text-xs text-muted-foreground">{r.plannedTime ?? "--:--"}</span>
        <span className="truncate">{r.title}</span>
        <span className="hidden sm:flex">
          <Seg done={done(r)} />
        </span>
        <span className={cn("max-w-[120px] truncate text-right text-xs sm:max-w-none", TONE[tone])}>{label}</span>
      </button>
    );
  };

  const selected = reels.find((r) => r.id === openId) ?? null;
  const idx = selected ? ordered.findIndex((r) => r.id === selected.id) : -1;

  return (
    <div className="flex flex-col gap-6" data-testid="week-screen">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground" data-testid="week-plan-version">
            Tuần {weekKey.slice(-2)} · {liveVersion ? `plan v${liveVersion}` : "chưa có plan"}
          </span>
        </div>
        <Button variant="outline" onClick={ask} data-testid="week-ask-claude">
          Nhờ Claude viết tuần sau
        </Button>
      </div>

      {draft && (
        <div id="week-draft" className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-card py-2.5 pr-2.5 pl-3.5 text-sm ring-1 ring-input" data-testid="week-draft-bar">
          <span>
            <b>Bản nháp v{draft.version} từ Claude</b> <span className="text-muted-foreground">· {draft.diff}</span>
          </span>
          <Button size="sm" variant="outline" onClick={approve} data-testid="week-draft-approve">
            Duyệt v{draft.version}
          </Button>
        </div>
      )}

      <section className="flex flex-col items-start gap-2">
        <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">Việc tiếp theo</span>
        {next ? (
          <Button
            data-testid="week-next-action"
            onClick={() => (next.target.kind === "draft" ? document.getElementById("week-draft")?.scrollIntoView({ block: "nearest" }) : open(next.target.id))}
          >
            {next.label}
          </Button>
        ) : (
          <span className="text-muted-foreground" data-testid="week-next-action">
            Không có gì chờ anh.
          </span>
        )}
      </section>

      <section {...dropZone(today)} data-testid="week-today" className={cn("rounded-xl", overDay === today && "ring-1 ring-ring")}>
        <div className="mb-3 flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold">Hôm nay</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {dayLabel(today)} · {split.today.length} reel
          </span>
        </div>
        {split.today.length ? (
          <div className="grid gap-3 sm:grid-cols-2">{split.today.map(card)}</div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="week-today-empty">
            Hôm nay không có reel. Kéo một reel từ Cả tuần vào đây.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <button
          type="button"
          aria-expanded={weekOpen}
          onClick={() => setWeekOpen((o) => !o)}
          data-testid="week-toggle"
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-2.5">
            <h2 className="text-[15px] font-semibold">Cả tuần</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {rest} reel nữa · {doneN}/{ordered.length} xong · {gateN} chờ anh
            </span>
          </span>
          <span aria-hidden className={cn("size-2 border-r-[1.5px] border-b-[1.5px] border-muted-foreground transition-transform", weekOpen ? "rotate-[225deg]" : "rotate-45")} />
        </button>
        {weekOpen &&
          split.days.map((d) => (
            <div key={d.date} {...dropZone(d.date)} data-testid="week-day" className={cn(overDay === d.date && "bg-muted/60")}>
              <div className="border-t border-border px-4 pt-2.5 pb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">{dayLabel(d.date)}</div>
              {d.reels.length ? d.reels.map(row) : <p className="px-4 pb-2.5 text-xs text-muted-foreground">Trống. Thả reel vào đây.</p>}
            </div>
          ))}
      </section>

      {selected && (
        <ReelDrawer
          key={selected.id}
          reel={selected}
          done={done(selected)}
          funnel={funnelOf(selected)}
          metrics={metrics}
          graphConfigured={props.graphConfigured}
          bucketConfigured={props.bucketConfigured}
          dryRun={props.dryRun}
          onClose={() => setOpenId(null)}
          onStep={(delta) => {
            const n = ordered[idx + delta];
            if (n) setOpenId(n.id);
          }}
          onSaved={(patch) => setReels((rs) => rs.map((r) => (r.id === selected.id ? { ...r, ...patch } : r)))}
        />
      )}
    </div>
  );
}

function ReelDrawer({
  reel: r,
  done,
  funnel,
  metrics,
  graphConfigured,
  bucketConfigured,
  dryRun,
  onClose,
  onStep,
  onSaved,
}: {
  reel: PlannedPostRow;
  done: number;
  funnel: FunnelCell[];
  metrics: { source: string; metric: string }[];
  graphConfigured: boolean;
  bucketConfigured: boolean;
  dryRun: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
  onSaved: (patch: Partial<PlannedPostRow>) => void;
}) {
  const router = useRouter();
  const [hook, setHook] = useState(r.note ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(false);
  const ready = r.videoAssetId !== null && Boolean(r.caption?.trim());

  async function saveHook() {
    const v = hook.trim();
    if (v === (r.note ?? "")) return;
    const res = await updatePlannedPostAction(r.id, { note: v });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onSaved({ note: v || null });
    toast.success("Đã lưu hook");
  }

  async function publish() {
    setBusy(true);
    const res = await publishNowAction(r.id);
    setBusy(false);
    setConfirm(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(dryRun ? "Đã chạy thử (dry run), chưa đăng thật" : "Đã đăng lên Instagram");
    router.refresh();
  }

  const latest = funnel.reduce<string | null>((m, f) => (m && m > f.capturedAt ? m : f.capturedAt), null);
  const mark = (i: number) => (i < done ? "✓" : i === Math.min(done, 4) ? "●" : "○");

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full gap-3 overflow-y-auto sm:max-w-[440px]"
        data-testid="week-drawer"
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          if (e.key === "ArrowDown" || e.key === "ArrowRight") onStep(1);
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") onStep(-1);
        }}
      >
        <SheetHeader>
          <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
            {r.plannedDate ? dayLabel(r.plannedDate) : "chưa ngày"} · {r.plannedTime ?? "chưa giờ"}
          </span>
          <SheetTitle>{r.title}</SheetTitle>
          <Seg done={done} />
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
          <ol className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs" data-testid="week-drawer-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={cn(i < done ? "text-success" : i === done ? "text-foreground" : "text-muted-foreground")}>
                {mark(i)} {s}
              </li>
            ))}
          </ol>

          <section className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-border" data-testid="week-drawer-profile">
            <h3 className="font-medium">Hồ sơ</h3>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">Hook</span>
              <Input
                value={hook}
                placeholder="Gõ hook"
                data-testid="week-hook-input"
                onChange={(e) => setHook(e.target.value)}
                onBlur={saveHook}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    void saveHook();
                    onClose();
                  }
                }}
              />
            </label>
            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="font-mono text-2xs uppercase leading-5 text-muted-foreground">Script</dt>
              <dd className="min-w-0 truncate">{r.scriptTitle ?? <span className="text-muted-foreground">chưa có</span>}</dd>
              <dt className="font-mono text-2xs uppercase leading-5 text-muted-foreground">Keyword</dt>
              <dd data-testid="week-drawer-keyword">{r.keyword ?? <span className="text-muted-foreground">chưa có</span>}</dd>
              <dt className="font-mono text-2xs uppercase leading-5 text-muted-foreground">Caption</dt>
              <dd className="min-w-0 truncate">{r.caption?.trim() || <span className="text-muted-foreground">chưa có</span>}</dd>
            </dl>
          </section>

          <section className="flex flex-col items-start gap-2 rounded-lg p-3 ring-1 ring-border" data-testid="week-drawer-video">
            <h3 className="font-medium">Video</h3>
            {r.videoAssetId ? <span className="text-muted-foreground">Video đã gắn.</span> : <span className="text-muted-foreground">Chưa có video.</span>}
            {r.state !== "published" && (
              <Button size="sm" variant="outline" onClick={() => setAttach(true)} data-testid="week-attach">
                Gắn video và caption
              </Button>
            )}
          </section>

          <section className="flex flex-col items-start gap-2 rounded-lg p-3 ring-1 ring-border" data-testid="week-drawer-publish">
            <h3 className="font-medium">Đăng</h3>
            {r.state === "published" ? (
              <span className="text-muted-foreground" data-testid="week-published">
                {r.dryRun ? "Đã chạy thử (dry run). Chưa đăng thật lên Instagram." : "Đã đăng. Khóa, không sửa được."}
              </span>
            ) : r.state === "publishing" ? (
              <span className="text-muted-foreground">Đang đăng.</span>
            ) : !ready ? (
              <span className="text-muted-foreground">Chờ video và caption.</span>
            ) : confirm ? (
              <div className="flex w-full flex-col gap-2 rounded-lg p-3 ring-1 ring-foreground" data-testid="week-publish-confirm">
                <b>
                  Đăng &quot;{r.title}&quot; lên Instagram{dryRun ? " (dry run)" : ""}?
                </b>
                <span className="text-muted-foreground">
                  {dryRun ? "Đang ở chế độ dry run: không có gì lên Instagram." : "Sau khi đăng không hoàn tác được."}
                </span>
                <span className="flex justify-end gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setConfirm(false)} data-testid="week-publish-cancel">
                    Huỷ
                  </Button>
                  <Button size="sm" disabled={busy} onClick={publish} data-testid="week-publish-go">
                    Đăng
                  </Button>
                </span>
              </div>
            ) : (
              <Button size="sm" onClick={() => setConfirm(true)} data-testid="week-publish">
                Duyệt đăng
              </Button>
            )}
            {r.state === "failed" && r.lastError && <span className="text-destructive">{r.lastError}</span>}
          </section>

          <section className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-border" data-testid="week-drawer-funnel">
            <h3 className="font-medium">Số 48h</h3>
            {!r.keyword ? (
              <span className="text-muted-foreground">Reel chưa có keyword, nên chưa đo được phễu.</span>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {metrics.map((m) => {
                    const cell = funnel.find((f) => f.source === m.source && f.metric === m.metric);
                    return (
                      <div key={`${m.source}.${m.metric}`} className="min-w-0 rounded-md bg-muted px-1 py-2 text-center" data-testid="week-funnel-tile" data-metric={m.metric}>
                        <b className="block font-mono text-[15px] font-medium tabular-nums">{cell ? cell.value.toLocaleString("vi-VN") : "chưa đo"}</b>
                        <span className="text-2xs text-muted-foreground">{m.metric}</span>
                      </div>
                    );
                  })}
                </div>
                <span className="font-mono text-2xs text-muted-foreground">{latest ? `đo lúc ${new Date(latest).toLocaleString("vi-VN")}` : "chưa đo lần nào"}</span>
              </>
            )}
          </section>
        </div>
      </SheetContent>
      {attach && (
        <PublishDialog
          open
          onOpenChange={(o) => !o && setAttach(false)}
          plan={r}
          graphConfigured={graphConfigured}
          bucketConfigured={bucketConfigured}
          dryRun={dryRun}
          onDone={() => {
            setAttach(false);
            router.refresh();
          }}
        />
      )}
    </Sheet>
  );
}
