import type { ProviderMcpServerState, ProviderMcpServerStatus } from "@t3tools/contracts";

/** The fields T3 reads from an app-server `mcpServerStatus/list` entry. */
export interface CodexMcpServerStatus {
  readonly name: string;
  readonly authStatus: string;
  readonly runtimeStatus?: string | null | undefined;
  readonly toolsError?: string | null | undefined;
  readonly pluginId?: string | null | undefined;
}

const CODEX_RUNTIME_STATE: Partial<Record<string, ProviderMcpServerState>> = {
  connected: "connected",
  starting: "pending",
  notStarted: "pending",
  authenticationRequired: "needsAuth",
  failed: "failed",
  cancelled: "failed",
  disabled: "disabled",
};

/** Without a thread `runtimeStatus` is null, so auth and tool discovery decide the state. */
export function toCodexProviderMcpServerStatus(
  server: CodexMcpServerStatus,
): ProviderMcpServerStatus {
  const state =
    (server.runtimeStatus ? CODEX_RUNTIME_STATE[server.runtimeStatus] : undefined) ??
    (server.authStatus === "notLoggedIn"
      ? "needsAuth"
      : server.toolsError
        ? "failed"
        : "connected");
  return {
    name: server.name,
    state,
    ...(server.pluginId ? { scope: server.pluginId } : {}),
    ...(server.toolsError ? { detail: server.toolsError } : {}),
  };
}
