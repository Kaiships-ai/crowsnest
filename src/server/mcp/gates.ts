import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

import { GATE_LEVELS } from "@/server/db/schema";
import { errorMessage } from "@/server/lib/action-result";
import { log } from "@/server/lib/logger";
import { draftGatedCall, journalOutcome, journalPending, type GateLevel, type JournaledCall } from "@/server/services/agent-journal";

export const TOOL_LEVELS = {
  crowsnest_ig_status: "read",
  crowsnest_sync_status: "read",
  crowsnest_channels: "read",
  crowsnest_channel_stats: "read",
  crowsnest_feed: "read",
  crowsnest_video: "read",
  crowsnest_research_set: "read",
  crowsnest_outlier_pack: "read",
  crowsnest_metrics: "read",
  crowsnest_plans: "read",
  crowsnest_funnel: "read",
  crowsnest_plan_versions: "read",
  crowsnest_scripts: "read",
  crowsnest_ideas: "read",
  crowsnest_brief: "read",
  crowsnest_artifacts: "read",
  crowsnest_remix_state: "read",
  crowsnest_remix_hooks: "read",
  crowsnest_remix_variants: "read",

  crowsnest_sync_selected: "free",
  crowsnest_sync_cancel: "free",
  crowsnest_save_funnel: "free",
  crowsnest_save_analysis: "free",
  crowsnest_transcribe: "free",
  crowsnest_save_artifact: "free",
  crowsnest_remix_session: "free",
  crowsnest_remix_set_prompt: "free",
  crowsnest_remix_research: "free",
  crowsnest_remix_choose_hook: "free",
  crowsnest_remix_style: "free",
  crowsnest_remix_outline: "free",
  crowsnest_remix_save_script: "free",

  crowsnest_set_plan_fields: "gate1",
  crowsnest_attach_video: "gate1",
  crowsnest_propose_plan: "gate1",
  crowsnest_approve_plan: "gate1",
  crowsnest_undo_plan: "gate1",
  crowsnest_remix_finish: "gate1",
} as const satisfies Record<string, GateLevel>;

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type Handler<S extends ZodRawShapeCompat> = (args: ShapeOutput<S>, extra: Extra) => CallToolResult | Promise<CallToolResult>;

function levelOf(levels: Record<string, GateLevel>, name: string): GateLevel {
  const level = Object.hasOwn(levels, name) ? levels[name] : undefined;
  if (!level || !GATE_LEVELS.includes(level)) throw new Error(`MCP tool ${name} has no gate level; add it to TOOL_LEVELS in src/server/mcp/gates.ts`);
  return level;
}

function callerOf(server: McpServer, extra: Extra, agent: string | undefined): string {
  if (agent) return agent;
  const userAgent = extra.requestInfo?.headers["user-agent"];
  return server.server.getClientVersion()?.name ?? (typeof userAgent === "string" ? userAgent : "unknown");
}

function refused(value: { error: string; code: string }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: true };
}

function drafted(tool: string, draftId: string): CallToolResult {
  const value = { status: "pending_approval", draftId, tool, message: `${tool} touches people outside, so it waits for Kai's approval in Lead Studio. Nothing was sent.` };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function gatedRegistrar<L extends Record<string, GateLevel>>(server: McpServer, levels: L, agent?: string) {
  return <S extends ZodRawShapeCompat>(name: Extract<keyof L, string>, config: { title: string; description: string; inputSchema: S }, handler: Handler<S>): void => {
    const level = levelOf(levels, name);
    const gated: Handler<S> = async (args, extra) => {
      if (level === "read") return handler(args, extra);
      const caller = callerOf(server, extra, agent);
      if (level === "gate2") return drafted(name, draftGatedCall(caller, name, args));
      let call: JournaledCall;
      try {
        call = journalPending(caller, name, args, level);
      } catch (err) {
        return refused({ error: `the agent journal could not record this call, so ${name} did not run: ${errorMessage(err)}`, code: "JOURNAL_UNAVAILABLE" });
      }
      const outcome = (result: "ok" | "error") => {
        try {
          journalOutcome(call, result);
        } catch (err) {
          log.error("mcp.journal_outcome_failed", { tool: name, callId: call.callId, result, error: errorMessage(err) });
        }
      };
      let res: CallToolResult;
      try {
        res = await handler(args, extra);
      } catch (err) {
        outcome("error");
        throw err;
      }
      outcome(res.isError ? "error" : "ok");
      return res;
    };
    // SAFETY: ToolCallback<S> is a conditional type TypeScript cannot resolve for a generic S; for a raw shape it is exactly Handler<S>.
    server.registerTool(name, config, gated as ToolCallback<S>);
  };
}
