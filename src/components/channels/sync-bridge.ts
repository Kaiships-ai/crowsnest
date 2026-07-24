/**
 * The ONLY file in this codebase allowed to reference phase-2A modules (Global
 * Constraints, phase2b plan). Until phase-2A's sync engine lands, every function here
 * is a typed stub that always fails with the same explanatory error, so the UI wired
 * against it (Add-channel dialog, row/header Sync-now buttons, sidebar refresh) is
 * fully built and testable now, and integration is a body-swap of this one file —
 * nothing else in phase 2B needs to change.
 */

export type BridgeResult = { ok: true } | { ok: false; error: string };

const NOT_WIRED = "Sync engine lands with phase 2A — button wired at integration";

export async function bridgeAddChannel(handle: string, platform: string): Promise<BridgeResult> {
  void handle;
  void platform;
  return { ok: false, error: NOT_WIRED };
}

export async function bridgeSyncChannel(channelId: string): Promise<BridgeResult> {
  void channelId;
  return { ok: false, error: NOT_WIRED };
}

export async function bridgeSyncAll(): Promise<BridgeResult> {
  return { ok: false, error: NOT_WIRED };
}

export async function bridgeImportReel(url: string): Promise<BridgeResult> {
  void url;
  return { ok: false, error: NOT_WIRED };
}
