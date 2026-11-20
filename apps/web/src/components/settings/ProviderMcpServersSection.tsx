import { AuthProvidersManageScope } from "@t3tools/contracts";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";

import { useEnvironmentScope } from "../../state/session";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { MCP_STATE_BADGE, sortMcpServers, useProviderMcpStatus } from "./providerMcpStatus";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function ProviderMcpServersSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const gt = useGT();
  const messages = useMessages();
  const canCheck = useEnvironmentScope(props.environmentId, AuthProvidersManageScope);
  const { query, requested, check, signIn, signingIn } = useProviderMcpStatus(props);
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
            onClick={check}
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
              const badge = MCP_STATE_BADGE[server.state];
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
                  {server.state === "needsAuth" ? (
                    <Button
                      type="button"
                      size="compact"
                      variant="outline"
                      disabled={!canCheck || signingIn !== null}
                      onClick={() => void signIn(server.name)}
                    >
                      {signingIn === server.name ? gt("Signing in") : gt("Sign in")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
