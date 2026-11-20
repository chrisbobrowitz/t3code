import { AuthProvidersManageScope } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderMcpServerState,
  ProviderMcpServerStatus,
} from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const STATE_BADGE: Record<
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
function sortMcpServers(
  servers: ReadonlyArray<ProviderMcpServerStatus>,
): ReadonlyArray<ProviderMcpServerStatus> {
  return [...servers].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name),
  );
}

export function ProviderMcpServersSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const gt = useGT();
  const messages = useMessages();
  const canCheck = useEnvironmentScope(props.environmentId, AuthProvidersManageScope);
  // A check can start the provider and every MCP server it loads, so it waits for a click.
  const [requested, setRequested] = useState(false);
  const query = useEnvironmentQuery(
    requested
      ? serverEnvironment.providerMcpStatus({
          environmentId: props.environmentId,
          input: { instanceId: props.instanceId },
        })
      : null,
    messages,
  );
  const result = query.data;

  return (
    <SettingsSection title={gt("MCP servers")}>
      <SettingsRow
        title={gt("MCP servers")}
        description={gt(
          "User-level servers this provider loads, and whether each needs you to sign in. Projects can add more.",
        )}
        control={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCheck || query.isPending}
            onClick={() => (requested ? query.refresh() : setRequested(true))}
          >
            {query.isPending
              ? gt("Checking")
              : requested
                ? gt("Check again")
                : gt("Check", { $context: "button that checks MCP server status" })}
          </Button>
        }
      >
        {query.error ? (
          <p className="px-3 pb-3 text-xs text-destructive-foreground sm:px-4">{query.error}</p>
        ) : result === null ? null : !result.supported ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
            {gt("This provider does not report its MCP servers.")}
          </p>
        ) : result.servers.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
            {gt("This provider loads no MCP servers.")}
          </p>
        ) : (
          <ul className="grid gap-1.5 px-3 pb-3 sm:px-4" data-mcp-servers>
            {sortMcpServers(result.servers).map((server) => {
              const badge = STATE_BADGE[server.state];
              return (
                <li
                  key={`${server.scope ?? ""}:${server.name}`}
                  className="flex min-w-0 items-start gap-2 text-sm"
                >
                  <Badge variant={badge.variant} size="sm">
                    {messages(badge.label)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{server.name}</span>
                    {server.scope ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">{server.scope}</span>
                    ) : null}
                    {server.detail ? (
                      <p className="text-xs break-words text-muted-foreground">{server.detail}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
