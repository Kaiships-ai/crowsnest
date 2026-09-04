import { Skeleton } from "@/components/ui/skeleton";

/** One calm loading rhythm shared by the Hook, Style and Script stages (board:
 *  remix polish — "unify the abrupt generating states into one calm loading
 *  rhythm"). Each stage passes its own row count/height and an honest indeterminate
 *  label; the caller keeps the GroundedIn line rendered ABOVE this, so what fed the
 *  run stays visible the whole time it runs. tw-animate-css drives the Skeleton
 *  pulse and already honours prefers-reduced-motion, so no motion guard is needed. */
export function GeneratingSkeleton({
  label,
  count,
  rowClassName,
  layout = "stack",
}: {
  label: string;
  count: number;
  rowClassName: string;
  layout?: "stack" | "grid";
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-2xs tracking-wide text-faint uppercase">{label}</p>
      <div className={layout === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex flex-col gap-3"}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className={`${rowClassName} w-full rounded-none`} />
        ))}
      </div>
    </div>
  );
}
