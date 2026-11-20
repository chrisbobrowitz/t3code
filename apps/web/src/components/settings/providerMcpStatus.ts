import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderMcpServerState,
  ProviderMcpServerStatus,
} from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";
import { useSyncExternalStore } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

export const MCP_STATE_BADGE: Record<
  ProviderMcpServerState,
  {
    readonly label: string;
    readonly variant: "success" | "warning" | "error" | "outline" | "info";
  }
> = {
  connected: { label: msg("Connected", { $context: "MCP server state" }), variant: "success" },
  needsAuth: { label: msg("Needs sign-in", { $context: "MCP server state" }), variant: "warning" },
  failed: { label: msg("Failed", { $context: "MCP server state" }), variant: "error" },
  disabled: { label: msg("Disabled", { $context: "MCP server state" }), variant: "outline" },
  pending: { label: msg("Connecting", { $context: "MCP server state" }), variant: "info" },
};

const STATE_ORDER: Record<ProviderMcpServerState, number> = {
  needsAuth: 0,
  failed: 1,
  pending: 2,
  connected: 3,
  disabled: 4,
};

/** Servers that need the user first, then by name. */
export function sortMcpServers(
  servers: ReadonlyArray<ProviderMcpServerStatus>,
): ReadonlyArray<ProviderMcpServerStatus> {
  return [...servers].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name),
  );
}

// A check can start the provider and every MCP server it loads, so it waits for a click. The
// click is remembered for the session, so the cached result shows again after navigating away.
const requested = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useProviderMcpStatus(target: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly cwd?: string | undefined;
}) {
  const key = JSON.stringify([target.environmentId, target.instanceId, target.cwd ?? null]);
  const isRequested = useSyncExternalStore(subscribe, () => requested.has(key));
  const query = useEnvironmentQuery(
    isRequested
      ? serverEnvironment.providerMcpStatus({
          environmentId: target.environmentId,
          input: {
            instanceId: target.instanceId,
            ...(target.cwd === undefined ? {} : { cwd: target.cwd }),
          },
        })
      : null,
    useMessages(),
  );
  const check = () => {
    if (isRequested) return query.refresh();
    requested.add(key);
    for (const listener of listeners) listener();
  };
  return { query, requested: isRequested, check };
}
