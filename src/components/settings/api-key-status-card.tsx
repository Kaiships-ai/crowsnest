"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TestResult = { ok: true } | { ok: false; error: string };

/**
 * DESIGN.md §2.7's API Keys section, one card per key: a presence Badge (read from
 * `process.env` server-side by the caller) plus either a real "Test" button (only
 * Anthropic has a client seam to test through — `onTest`) or, for the other three
 * keys (v1: presence-only), a tooltip explaining verification happens on first real
 * use instead of a button that can't actually do anything yet.
 */
export function ApiKeyStatusCard({
  label,
  envVar,
  present,
  onTest,
  proxied = false,
  presenceOnlyHint,
}: {
  label: string;
  envVar: string;
  present: boolean;
  onTest?: () => Promise<TestResult>;
  /** True when ANTHROPIC_BASE_URL routes through a local proxy. The test only pings
   *  count_tokens, which a proxy answers locally, so a pass proves the proxy replied
   *  and not that generation works. Verified on this machine: count_tokens returns 200
   *  for a model whose /v1/messages returns 410 Gone. Saying "connection OK" without
   *  that caveat is a green light for something untested. */
  proxied?: boolean;
  presenceOnlyHint?: string;
}) {
  const [testing, setTesting] = useState(false);

  async function runTest() {
    if (!onTest) return;
    setTesting(true);
    const result = await onTest();
    setTesting(false);
    if (result.ok) {
      toast.success(
        proxied
          ? `${label}: proxy answered. That does not confirm generation works, try a stage in Remix.`
          : `${label}: connection OK`
      );
    }
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          {label}
          <Badge variant={present ? "secondary" : "outline"}>{present ? "Configured" : "Not set"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <code>{envVar}</code> in <code>.env.local</code>
        </p>
        {onTest ? (
          <Button size="sm" variant="outline" onClick={runTest} disabled={!present || testing}>
            {testing ? "Testing…" : "Test"}
          </Button>
        ) : (
          presenceOnlyHint && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" disabled focusableWhenDisabled aria-label="Verification info" />}
              >
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{presenceOnlyHint}</TooltipContent>
            </Tooltip>
          )
        )}
      </CardContent>
    </Card>
  );
}
