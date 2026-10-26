import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

import { GATE_LEVELS } from "@/server/db/schema";
import { draftGatedCall, recordAgentAction, type GateLevel } from "@/server/services/agent-journal";

/**
 * read: no write. free: a local write outside the plan. gate1: changes the plan.
 * gate2: touches people outside (publish, DM, comment reply, discount, ChatbotX flow,
 * website deploy); the call is stored as a pending draft and the tool never runs.
 */
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

function callerOf(server: McpServer, extra: Extra): string {
  const userAgent = extra.requestInfo?.headers["user-agent"];
  return server.server.getClientVersion()?.name ?? (typeof userAgent === "string" ? userAgent : "unknown");
}

function drafted(tool: string, draftId: string): CallToolResult {
  const value = { status: "pending_approval", draftId, tool, message: `${tool} touches people outside, so it waits for Kai's approval in Lead Studio. Nothing was sent.` };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

/** The only way to register a tool: the name must have a level, and every non-read call is journaled. */
export function gatedRegistrar<L extends Record<string, GateLevel>>(server: McpServer, levels: L) {
  return <S extends ZodRawShapeCompat>(name: Extract<keyof L, string>, config: { title: string; description: string; inputSchema: S }, handler: Handler<S>): void => {
    const level = levelOf(levels, name);
    const gated: Handler<S> = async (args, extra) => {
      if (level === "read") return handler(args, extra);
      const caller = callerOf(server, extra);
      if (level === "gate2") return drafted(name, draftGatedCall(caller, name, args));
      try {
        const res = await handler(args, extra);
        recordAgentAction({ caller, tool: name, input: args, result: res.isError ? "error" : "ok", gate: level });
        return res;
      } catch (err) {
        recordAgentAction({ caller, tool: name, input: args, result: "error", gate: level });
        throw err;
      }
    };
    // SAFETY: ToolCallback<S> is a conditional type TypeScript cannot resolve for a generic S; for a raw shape it is exactly Handler<S>.
    server.registerTool(name, config, gated as ToolCallback<S>);
  };
}
