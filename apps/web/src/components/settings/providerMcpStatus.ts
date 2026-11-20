import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderMcpServerState,
  ProviderMcpServerStatus,
} from "@t3tools/contracts";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { msg, useMessages } from "gt-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { m } from "../../i18n/messages";
import { readLocalApi } from "../../localApi";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

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
  const signIn = useMcpSignIn(target, query.refresh);
  return { query, requested: isRequested, check, ...signIn };
}

/**
 * Starts sign-in, opens the provider's authorization page, and checks again when the user comes
 * back to the window, by which time the browser has usually finished the redirect.
 */
function useMcpSignIn(
  target: {
    readonly environmentId: EnvironmentId;
    readonly instanceId: ProviderInstanceId;
    readonly cwd?: string | undefined;
  },
  refresh: () => void,
) {
  const login = useAtomCommand(serverEnvironment.providerMcpLogin, { reportFailure: false });
  // The server being signed in to, held until the user returns, so a second click cannot
  // start a parallel attempt while the provider still waits for the first redirect.
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const awaitReturn = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Drops the window focus listener of an attempt when the panel unmounts.
  useEffect(() => () => awaitReturn.current?.abort(), []);
  const signIn = async (server: string) => {
    awaitReturn.current?.abort();
    setSigningIn(server);
    const result = await login({
      environmentId: target.environmentId,
      input: {
        instanceId: target.instanceId,
        server,
        ...(target.cwd === undefined ? {} : { cwd: target.cwd }),
      },
    });
    if (result._tag === "Failure") {
      setSigningIn(null);
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Could not sign in to {server}", { server })),
          description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? "",
        }),
      );
      return;
    }
    const url = result.value.authorizationUrl;
    if (url === null) {
      setSigningIn(null);
      return refresh();
    }
    const open = () => {
      const api = readLocalApi();
      if (api) void api.shell.openExternal(url);
      else window.open(url, "_blank", "noopener");
    };
    open();
    // A browser can block the tab opened after the request; the toast button is a fresh click.
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: m(msg("Finish signing in to {server} in your browser", { server })),
        description: m(msg("T3 Code checks again when you come back.")),
        actionProps: {
          children: m(msg("Open sign-in page")),
          onClick: open,
        },
      }),
    );
    const controller = new AbortController();
    awaitReturn.current = controller;
    window.addEventListener(
      "focus",
      () => {
        controller.abort();
        toastManager.close(toastId);
        setSigningIn(null);
        refresh();
      },
      { signal: controller.signal },
    );
  };
  return { signIn, signingIn };
}
