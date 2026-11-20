import type { ProviderMcpServerState, ProviderMcpServerStatus } from "@t3tools/contracts";

/** OpenCode 1.x and 2.x both report `{ status, error? }` per server. */
export interface OpenCodeMcpStatus {
  readonly status: string;
  readonly error?: string;
}

const OPENCODE_MCP_STATE: Record<string, ProviderMcpServerState> = {
  connected: "connected",
  pending: "pending",
  disabled: "disabled",
  failed: "failed",
  needs_auth: "needsAuth",
  needs_client_registration: "needsAuth",
};

/** Drops the per-thread `t3-code` servers T3 Code adds itself. */
export function toProviderMcpServerStatuses(
  servers: ReadonlyArray<readonly [name: string, status: OpenCodeMcpStatus]>,
): ReadonlyArray<ProviderMcpServerStatus> {
  return servers
    .filter(([name]) => !name.startsWith("t3-code"))
    .map(([name, { status, error }]) => ({
      name,
      state: OPENCODE_MCP_STATE[status] ?? "failed",
      ...(error ? { detail: error } : {}),
    }));
}
