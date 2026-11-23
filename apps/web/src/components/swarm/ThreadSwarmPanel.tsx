import type {
  AntigravitySwarmSnapshot,
  EnvironmentId,
  OrchestrationV2GetAntigravitySwarmResult,
  ThreadId,
} from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery, useEnvironmentQueryRefresh } from "../../state/query";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  formatSwarmMemberSummary,
  summarizeSwarmMembers,
  swarmSummaryDotClass,
} from "./swarmPresentation.logic";

interface ThreadSwarmPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Shared snapshot from ChatView's live swarm activity hook when mounted there. */
  readonly swarm?: AntigravitySwarmSnapshot | null | undefined;
  readonly onOpenSwarm?: (() => void) | undefined;
}

/** Compact swarm summary for an Antigravity thread's details card; hidden when no swarm exists. */
export function ThreadSwarmPanel(props: ThreadSwarmPanelProps) {
  const gt = useGT();
  const messages = useMessages();
  const baseAtom = orchestrationEnvironment.antigravitySwarm({
    environmentId: props.environmentId,
    input: { threadId: props.threadId },
  });
  const baseQuery = useEnvironmentQuery<OrchestrationV2GetAntigravitySwarmResult, unknown>(
    props.swarm === undefined ? baseAtom : null,
    messages,
  );
  const baseRefresh = useEnvironmentQueryRefresh(baseAtom);
  const swarm = props.swarm !== undefined ? props.swarm : (baseQuery.data?.swarm ?? null);
  if (swarm === null) return null;

  const counts = summarizeSwarmMembers(swarm.members);
  const title = swarm.title?.trim() || gt("Swarm");
  const subtitle =
    swarm.backend === "spanner"
      ? gt("Remote swarm (spanner)")
      : formatSwarmMemberSummary(counts, messages);
  const refreshLabel = gt("Refresh swarm");
  const openSwarm = () => {
    if (props.onOpenSwarm) {
      props.onOpenSwarm();
      return;
    }
    useRightPanelStore
      .getState()
      .open({ environmentId: props.environmentId, threadId: props.threadId }, "swarm");
  };
  const refreshSwarm = () => {
    if (props.swarm === undefined) {
      baseQuery.refresh();
      return;
    }
    baseRefresh.refresh();
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-swarm-heading"
      title={gt("Swarm")}
      data-thread-swarm-panel
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label={refreshLabel}
                disabled={props.swarm === undefined && baseQuery.isPending}
                onClick={refreshSwarm}
              >
                <RefreshCwIcon className="size-3.5" />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>{refreshLabel}</TooltipPopup>
        </Tooltip>
      }
    >
      <div>
        <ThreadDetailsControl size="sm" variant="ghost" part="row" multiline onClick={openSwarm}>
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              swarm.backend === "spanner" ? "bg-info" : swarmSummaryDotClass(counts),
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="block truncate text-sm font-medium text-foreground/80">{title}</span>
            <span className="truncate text-2xs font-normal text-muted-foreground">{subtitle}</span>
          </span>
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </ThreadDetailsControl>
      </div>
    </ThreadDetailsSection>
  );
}
