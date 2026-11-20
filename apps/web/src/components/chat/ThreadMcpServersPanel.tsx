import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProviderInstanceId,
  type ProviderMcpServerState,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ChevronRightIcon, PlugIcon, RefreshCwIcon } from "lucide-react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

import { cn } from "../../lib/utils";
import { useEnvironmentScope } from "../../state/session";
import {
  MCP_STATE_BADGE,
  sortMcpServers,
  useProviderMcpStatus,
} from "../settings/providerMcpStatus";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";

const STATE_DOT_CLASS: Record<ProviderMcpServerState, string> = {
  connected: "bg-emerald-500",
  needsAuth: "bg-amber-500",
  failed: "bg-destructive",
  disabled: "bg-muted-foreground/40",
  pending: "bg-sky-500",
};

interface ThreadMcpServersPanelProps {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  /** The project folder, so project-level servers show too. */
  readonly cwd: string | null;
}

/** The MCP servers the thread's provider loads in this project, checked on demand. */
export function ThreadMcpServersPanel(props: ThreadMcpServersPanelProps) {
  const gt = useGT();
  const messages = useMessages();
  const canCheck = useEnvironmentScope(props.environmentId, AuthProvidersManageScope);
  const { query, requested, check, signIn, signingIn } = useProviderMcpStatus({
    environmentId: props.environmentId,
    instanceId: props.providerInstanceId,
    cwd: props.cwd ?? undefined,
  });
  const result = query.data;
  const [collapsed, setCollapsed] = useLocalStorage(
    "t3code:thread-details-mcp-collapsed",
    false,
    Schema.Boolean,
  );
  const collapseLabel = collapsed ? gt("Show MCP servers") : gt("Hide MCP servers");
  const servers = result?.supported ? result.servers : [];
  const needsAuthCount = servers.filter((server) => server.state === "needsAuth").length;
  const failedCount = servers.filter((server) => server.state === "failed").length;
  const checkLabel = requested ? gt("Check MCP servers again") : gt("Check MCP servers");

  return (
    <ThreadDetailsSection
      headingId="thread-details-mcp-heading"
      title={gt("MCP servers")}
      data-thread-mcp-panel
      actions={
        <span className="flex items-center gap-0.5">
          {requested ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label={checkLabel}
                    disabled={!canCheck || query.isPending}
                    onClick={check}
                  >
                    {query.isPending ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <RefreshCwIcon className="size-3.5" />
                    )}
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup>{checkLabel}</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  aria-label={collapseLabel}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  {collapsed ? (
                    <ChevronRightIcon className="size-3.5" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" />
                  )}
                </ThreadDetailsControl>
              }
            />
            <TooltipPopup>{collapseLabel}</TooltipPopup>
          </Tooltip>
        </span>
      }
    >
      <div>
        {collapsed ? (
          <button
            type="button"
            className="w-full px-2.5 py-1 text-left text-2xs text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(false)}
          >
            {!requested || result === null
              ? collapseLabel
              : servers.length === 0
                ? gt("No MCP servers")
                : needsAuthCount + failedCount === 0
                  ? gt(
                      "{count, plural, =1 {1 server, all connected} other {{count} servers, all connected}}",
                      {
                        count: servers.length,
                      },
                    )
                  : [
                      needsAuthCount > 0
                        ? gt("{count, plural, =1 {1 needs sign-in} other {{count} need sign-in}}", {
                            count: needsAuthCount,
                          })
                        : null,
                      failedCount > 0
                        ? gt("{count, plural, =1 {1 failed} other {{count} failed}}", {
                            count: failedCount,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
          </button>
        ) : !requested ? (
          <ThreadDetailsControl
            size="sm"
            variant="ghost"
            part="row"
            disabled={!canCheck}
            onClick={check}
          >
            <PlugIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={cn("ml-0.5", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              <T>Check MCP servers</T>
            </span>
          </ThreadDetailsControl>
        ) : query.error ? (
          <p className="px-2.5 py-1.5 text-xs text-destructive-foreground">{query.error}</p>
        ) : result === null ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            <T>Checking MCP servers…</T>
          </p>
        ) : !result.supported ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            {gt("This provider does not report its MCP servers.")}
          </p>
        ) : result.servers.length === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            {gt("This provider loads no MCP servers.")}
          </p>
        ) : (
          <ul className="m-0 max-h-[13.5rem] list-none overflow-y-auto p-0">
            {sortMcpServers(result.servers).map((server) => {
              const canSignIn = server.state === "needsAuth" && canCheck;
              const status = [messages(MCP_STATE_BADGE[server.state].label), server.scope]
                .filter(Boolean)
                .join(" · ");
              const body = (
                <>
                  {signingIn === server.name ? (
                    <Spinner className="size-2 shrink-0" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", STATE_DOT_CLASS[server.state])}
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="block truncate text-sm font-medium text-foreground/80">
                      {server.name}
                    </span>
                    <span className="truncate text-2xs font-normal text-muted-foreground">
                      {status}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={`${server.scope ?? ""}:${server.name}`} className="flex rounded-lg">
                  <Tooltip>
                    <TooltipTrigger
                      delay={200}
                      render={
                        canSignIn ? (
                          <ThreadDetailsControl
                            size="sm"
                            variant="ghost"
                            part="row"
                            multiline
                            disabled={signingIn !== null}
                            onClick={() => void signIn(server.name)}
                          />
                        ) : (
                          <div
                            className={cn(
                              "flex w-full min-w-0 items-center rounded-lg py-1.5",
                              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
                            )}
                          />
                        )
                      }
                    >
                      {body}
                    </TooltipTrigger>
                    <TooltipPopup side="left">
                      <p className="font-medium">{server.name}</p>
                      <p className="text-muted-foreground">
                        {canSignIn ? gt("Click to sign in") : status}
                      </p>
                      {server.detail ? (
                        <p className="max-w-xs break-words text-muted-foreground">
                          {server.detail}
                        </p>
                      ) : null}
                    </TooltipPopup>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ThreadDetailsSection>
  );
}
