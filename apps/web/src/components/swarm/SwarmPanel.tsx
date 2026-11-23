import type {
  AntigravitySwarmMember,
  AntigravitySwarmSnapshot,
  EnvironmentId,
  OrchestrationV2GetAntigravitySwarmResult,
  OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowLeftIcon,
  InfoIcon,
  NetworkIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { NativeChildStep } from "../chat/NativeChildWorkDialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  collectSwarmBoardAgents,
  collectSwarmBoardChannels,
  filterSwarmMessages,
  groupSwarmPlanWorkstreams,
  isSwarmActive,
  parseSwarmMessageTags,
  summarizeSwarmMembers,
  SWARM_MEMBER_STATE_META,
} from "./swarmPresentation.logic";

type SwarmView = "overview" | "board" | "workers";

const RECENT_BOARD_SUMMARY_LIMIT = 5;

export interface SwarmPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly visible: boolean;
}

export function SwarmPanel(props: SwarmPanelProps) {
  const gt = useGT();
  const messages = useMessages();
  const [activeView, setActiveView] = useState<SwarmView>("overview");
  const [selectedWorkerName, setSelectedWorkerName] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  const queryTarget = {
    environmentId: props.environmentId,
    input: { threadId: props.threadId },
  };
  const baseQuery = useEnvironmentQuery<OrchestrationV2GetAntigravitySwarmResult, unknown>(
    props.visible ? orchestrationEnvironment.antigravitySwarm(queryTarget) : null,
    messages,
  );
  const baseSwarm = baseQuery.data?.swarm ?? null;
  const baseSwarmActive = isSwarmActive(baseSwarm);

  // Live 2.5s polling mounts only while the tab is visible and the swarm is active.
  const liveQuery = useEnvironmentQuery<OrchestrationV2GetAntigravitySwarmResult, unknown>(
    props.visible && baseSwarmActive
      ? orchestrationEnvironment.antigravitySwarmLive(queryTarget)
      : null,
    messages,
  );
  const liveSwarm = liveQuery.data?.swarm ?? null;
  const refreshBase = baseQuery.refresh;

  const previousVisibleRef = useRef(props.visible);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the cached base snapshot when the user switches back to the Swarm tab
  useEffect(() => {
    const becameVisible = props.visible && !previousVisibleRef.current;
    previousVisibleRef.current = props.visible;
    if (becameVisible) {
      refreshBase();
    }
  }, [props.visible, refreshBase]);

  const liveSettled =
    props.visible && baseSwarmActive && liveQuery.isSuccess && !isSwarmActive(liveSwarm);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs the settled snapshot into the base query so the 2.5s poller unmounts immediately
  useEffect(() => {
    if (liveSettled) {
      refreshBase();
    }
  }, [liveSettled, refreshBase]);

  const data = baseSwarmActive ? (liveQuery.data ?? baseQuery.data) : baseQuery.data;
  const swarm = data?.swarm ?? null;
  const error = baseSwarmActive ? (liveQuery.error ?? baseQuery.error) : baseQuery.error;
  const isPending = baseSwarmActive ? liveQuery.isPending : baseQuery.isPending;
  const refreshAll = () => {
    baseQuery.refresh();
    if (baseSwarmActive) {
      liveQuery.refresh();
    }
  };

  if (error !== null && swarm === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>
            <T>Unable to load swarm</T>
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="xs" variant="outline" disabled={isPending} onClick={refreshAll}>
              <T>Retry</T>
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          <T>Loading swarm…</T>
        </p>
      </div>
    );
  }

  if (swarm === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Empty size="compact">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyTitle>
              <T>No active swarm</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Start a swarm on an Antigravity thread by sending{" "}
                <code className="font-mono text-xs text-foreground">
                  <Var>{"/swarm <task>"}</Var>
                </code>{" "}
                in the composer.
              </T>
            </EmptyDescription>
          </EmptyHeader>
          <Button size="xs" variant="outline" disabled={isPending} onClick={refreshAll}>
            <RefreshCwIcon />
            <T>Refresh</T>
          </Button>
        </Empty>
      </div>
    );
  }

  if (selectedWorkerName !== null) {
    const selectedMember =
      swarm.members.find((member) => member.name === selectedWorkerName) ?? null;
    return (
      <SwarmWorkerTranscriptView
        environmentId={props.environmentId}
        threadId={props.threadId}
        visible={props.visible}
        workerName={selectedWorkerName}
        member={selectedMember}
        onBack={() => setSelectedWorkerName(null)}
      />
    );
  }

  const counts = summarizeSwarmMembers(swarm.members);
  const title = swarm.title?.trim() || gt("Swarm");
  const channels = collectSwarmBoardChannels(swarm);
  const agents = collectSwarmBoardAgents(swarm);
  const effectiveChannelFilter =
    channelFilter !== null && channels.some((channel) => channel.name === channelFilter)
      ? channelFilter
      : null;
  const effectiveAgentFilter =
    agentFilter !== null && agents.includes(agentFilter) ? agentFilter : null;
  const refreshLabel = gt("Refresh swarm");

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-swarm-panel>
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</h2>
              {swarm.backend === "spanner" ? (
                <Badge size="sm" variant="info">
                  spanner
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <StatusCountPill
                dotClass={SWARM_MEMBER_STATE_META.working.dotClass}
                label={gt("{count, plural, one {{count} working} other {{count} working}}", {
                  count: counts.working,
                  $context: "swarm active worker count",
                })}
              />
              <StatusCountPill
                dotClass={SWARM_MEMBER_STATE_META.waiting.dotClass}
                label={gt("{count, plural, one {{count} waiting} other {{count} waiting}}", {
                  count: counts.waiting,
                  $context: "swarm waiting worker count",
                })}
              />
              <StatusCountPill
                dotClass={SWARM_MEMBER_STATE_META.killed.dotClass}
                label={gt("{count, plural, one {{count} killed} other {{count} killed}}", {
                  count: counts.killed,
                  $context: "swarm killed worker count",
                })}
              />
              {counts.attention > 0 ? (
                <Badge size="sm" variant={counts.error > 0 ? "error" : "warning"}>
                  <TriangleAlertIcon />
                  {gt("{count, plural, one {{count} warning} other {{count} warnings}}", {
                    count: counts.attention,
                    $context: "swarm error or quota warning count",
                  })}
                </Badge>
              ) : null}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={refreshLabel}
                  disabled={isPending}
                  onClick={refreshAll}
                >
                  <RefreshCwIcon />
                </Button>
              }
            />
            <TooltipPopup>{refreshLabel}</TooltipPopup>
          </Tooltip>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <ToggleGroup
            size="segmented"
            variant="segmented"
            value={[activeView]}
            onValueChange={(next) => {
              const selected = next[0];
              if (selected === "overview" || selected === "board" || selected === "workers") {
                setActiveView(selected);
              }
            }}
          >
            <Toggle value="overview">
              <T context="swarm panel tab">Overview</T>
            </Toggle>
            <Toggle value="board">
              <T context="swarm panel tab">
                Board (<Var>{swarm.totalMessages}</Var>)
              </T>
            </Toggle>
            <Toggle value="workers">
              <T context="swarm panel tab">
                Workers (<Var>{swarm.members.length}</Var>)
              </T>
            </Toggle>
          </ToggleGroup>
        </div>
      </div>

      {error !== null ? (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="flex min-w-0 flex-col gap-4 p-4">
          {swarm.backend === "spanner" ? (
            <Alert variant="info">
              <InfoIcon />
              <AlertTitle>
                <T>Remote swarm backend</T>
              </AlertTitle>
              <AlertDescription>
                <T>
                  This swarm uses the remote Spanner backend, so local board messages and worker
                  transcripts are not stored on disk here.
                </T>
              </AlertDescription>
            </Alert>
          ) : null}

          {activeView === "overview" ? (
            <SwarmOverviewSection
              swarm={swarm}
              onSelectWorker={setSelectedWorkerName}
              onOpenBoard={() => setActiveView("board")}
            />
          ) : activeView === "board" ? (
            <SwarmBoardSection
              swarm={swarm}
              channels={channels}
              agents={agents}
              channelFilter={effectiveChannelFilter}
              agentFilter={effectiveAgentFilter}
              onChannelFilterChange={setChannelFilter}
              onAgentFilterChange={setAgentFilter}
              onSelectWorker={setSelectedWorkerName}
            />
          ) : (
            <SwarmWorkersSection members={swarm.members} onSelectWorker={setSelectedWorkerName} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StatusCountPill(props: { readonly dotClass: string; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", props.dotClass)} />
      <span>{props.label}</span>
    </span>
  );
}

function WorkerChip(props: {
  readonly member: AntigravitySwarmMember;
  readonly onSelect: (workerName: string) => void;
}) {
  const messages = useMessages();
  const meta = SWARM_MEMBER_STATE_META[props.member.state];
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.member.name)}
      aria-label={`${props.member.name} (${messages(meta.label)})`}
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1 text-left text-xs transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)} />
      <span className="truncate font-medium text-foreground">{props.member.name}</span>
      {props.member.model ? (
        <span className="truncate font-mono text-2xs text-muted-foreground">
          {props.member.model}
        </span>
      ) : null}
    </button>
  );
}

function SwarmOverviewSection(props: {
  readonly swarm: AntigravitySwarmSnapshot;
  readonly onSelectWorker: (workerName: string) => void;
  readonly onOpenBoard: () => void;
}) {
  const { swarm, onSelectWorker, onOpenBoard } = props;
  const { workstreams, ungroupedMembers } = groupSwarmPlanWorkstreams(swarm.plan, swarm.members);

  if (swarm.plan !== null) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        {swarm.plan.goalTitle || swarm.plan.goalLine ? (
          <section className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card/50 p-3">
            {swarm.plan.goalTitle ? (
              <h3 className="text-sm font-semibold text-foreground">{swarm.plan.goalTitle}</h3>
            ) : null}
            {swarm.plan.goalLine ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{swarm.plan.goalLine}</p>
            ) : null}
          </section>
        ) : null}

        {workstreams.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              <T>Workstreams</T>
            </h3>
            <div className="flex flex-col gap-2.5">
              {workstreams.map((workstream) => (
                <div
                  key={workstream.key}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <h4 className="text-sm font-medium text-foreground">{workstream.title}</h4>
                    {workstream.goal ? (
                      <p className="text-xs text-muted-foreground">{workstream.goal}</p>
                    ) : null}
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {workstream.tasks.map((task) => (
                      <li
                        key={task.name}
                        className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/30 p-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          {task.member ? (
                            <WorkerChip member={task.member} onSelect={onSelectWorker} />
                          ) : (
                            <span className="font-mono text-xs font-medium text-foreground">
                              {task.name}
                            </span>
                          )}
                        </div>
                        {task.description ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {task.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {ungroupedMembers.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              <T>Other members</T>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {ungroupedMembers.map((member) => (
                <WorkerChip key={member.name} member={member} onSelect={onSelectWorker} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const recentMessages = swarm.messages.slice(-RECENT_BOARD_SUMMARY_LIMIT).toReversed();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          <T>Roster</T>
        </h3>
        {swarm.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <T>No workers have joined this swarm yet.</T>
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {swarm.members.map((member) => (
              <WorkerChip key={member.name} member={member} onSelect={onSelectWorker} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            <T>Recent board activity</T>
          </h3>
          {swarm.totalMessages > 0 ? (
            <InlineButton onClick={onOpenBoard}>
              <T>View all</T>
            </InlineButton>
          ) : null}
        </div>
        {recentMessages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <T>No messages on the board yet.</T>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentMessages.map((entry) => (
              <SwarmBoardMessageCard
                key={entry.seq}
                seq={entry.seq}
                agent={entry.agent}
                text={entry.text}
                time={entry.time}
                kind={entry.kind}
                channel={entry.channel}
                isControl={entry.isControl}
                canOpenWorker={swarm.members.some((member) => member.name === entry.agent)}
                onSelectWorker={onSelectWorker}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SwarmBoardSection(props: {
  readonly swarm: AntigravitySwarmSnapshot;
  readonly channels: ReturnType<typeof collectSwarmBoardChannels>;
  readonly agents: readonly string[];
  readonly channelFilter: string | null;
  readonly agentFilter: string | null;
  readonly onChannelFilterChange: (channel: string | null) => void;
  readonly onAgentFilterChange: (agent: string | null) => void;
  readonly onSelectWorker: (workerName: string) => void;
}) {
  const {
    swarm,
    channels,
    agents,
    channelFilter,
    agentFilter,
    onChannelFilterChange,
    onAgentFilterChange,
    onSelectWorker,
  } = props;
  const filteredMessages = filterSwarmMessages(swarm.messages, {
    channel: channelFilter,
    agent: agentFilter,
  });
  const memberNames = new Set(swarm.members.map((member) => member.name));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {channels.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant={channelFilter === null ? "secondary" : "ghost-muted"}
            aria-pressed={channelFilter === null}
            onClick={() => onChannelFilterChange(null)}
          >
            <T context="swarm board channel filter">All channels</T>
          </Button>
          {channels.map((channel) => (
            <Button
              key={channel.name}
              size="xs"
              variant={channelFilter === channel.name ? "secondary" : "ghost-muted"}
              aria-pressed={channelFilter === channel.name}
              onClick={() =>
                onChannelFilterChange(channelFilter === channel.name ? null : channel.name)
              }
            >
              {`#${channel.name}`}
              {channel.messageCount > 0 ? ` (${channel.messageCount})` : ""}
            </Button>
          ))}
        </div>
      ) : null}

      {agents.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant={agentFilter === null ? "secondary" : "ghost-muted"}
            aria-pressed={agentFilter === null}
            onClick={() => onAgentFilterChange(null)}
          >
            <T context="swarm board agent filter">All agents</T>
          </Button>
          {agents.map((agent) => (
            <Button
              key={agent}
              size="xs"
              variant={agentFilter === agent ? "secondary" : "ghost-muted"}
              aria-pressed={agentFilter === agent}
              onClick={() => onAgentFilterChange(agentFilter === agent ? null : agent)}
            >
              {`@${agent}`}
            </Button>
          ))}
        </div>
      ) : null}

      {swarm.messagesTruncated ? (
        <Alert variant="default">
          <InfoIcon />
          <AlertDescription>
            <T>
              Showing the latest <Var>{swarm.messages.length}</Var> of{" "}
              <Var>{swarm.totalMessages}</Var> board messages.
            </T>
          </AlertDescription>
        </Alert>
      ) : null}

      {filteredMessages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {swarm.messages.length === 0 ? (
            <T>No messages on the board yet.</T>
          ) : (
            <T>No board messages match the active filters.</T>
          )}
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {filteredMessages.map((entry) => (
            <li key={entry.seq}>
              <SwarmBoardMessageCard
                seq={entry.seq}
                agent={entry.agent}
                text={entry.text}
                time={entry.time}
                kind={entry.kind}
                channel={entry.channel}
                isControl={entry.isControl}
                canOpenWorker={memberNames.has(entry.agent)}
                onSelectWorker={onSelectWorker}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SwarmBoardMessageCard(props: {
  readonly seq: number;
  readonly agent: string;
  readonly text: string;
  readonly time: string;
  readonly kind: string | null;
  readonly channel: string;
  readonly isControl: boolean;
  readonly canOpenWorker: boolean;
  readonly onSelectWorker: (workerName: string) => void;
}) {
  const { seq, agent, text, time, kind, channel, isControl, canOpenWorker, onSelectWorker } = props;
  const messages = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const tags = parseSwarmMessageTags({ text, kind, isControl });
  const formattedTime =
    formatDayAwareTimestamp(time, timestampFormat, undefined, undefined, messages) || time;

  return (
    <article className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/60 bg-card/40 p-2.5">
      <header className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-mono text-2xs text-muted-foreground">{`#${seq}`}</span>
        {canOpenWorker ? (
          <InlineButton onClick={() => onSelectWorker(agent)}>{`@${agent}`}</InlineButton>
        ) : (
          <span className="font-medium text-foreground">{`@${agent}`}</span>
        )}
        {channel !== "main" ? (
          <Badge size="sm" variant="outline">
            {`#${channel}`}
          </Badge>
        ) : null}
        {tags.isBrief ? (
          <Badge size="sm" variant="info">
            <T context="swarm board message kind">brief</T>
          </Badge>
        ) : null}
        {tags.isDone ? (
          <Badge size="sm" variant="success">
            <T context="swarm board message tag">done</T>
          </Badge>
        ) : null}
        {tags.isStall ? (
          <Badge size="sm" variant="warning">
            <T context="swarm board message tag">stall</T>
          </Badge>
        ) : null}
        {isControl ? (
          <Badge size="sm" variant="secondary">
            <T context="swarm board message kind">control</T>
          </Badge>
        ) : null}
        <span className="ms-auto shrink-0 font-mono text-2xs text-muted-foreground">
          {formattedTime}
        </span>
      </header>
      <p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
        {text}
      </p>
    </article>
  );
}

function SwarmWorkersSection(props: {
  readonly members: readonly AntigravitySwarmMember[];
  readonly onSelectWorker: (workerName: string) => void;
}) {
  const { members, onSelectWorker } = props;
  const messages = useMessages();

  if (members.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <T>No workers have joined this swarm yet.</T>
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {members.map((member) => {
        const meta = SWARM_MEMBER_STATE_META[member.state];
        const stateLabel = messages(meta.label);
        const showRole = member.role.trim().length > 0 && member.role !== member.name;
        return (
          <li key={member.name}>
            <button
              type="button"
              aria-label={`${member.name} (${stateLabel})`}
              onClick={() => onSelectWorker(member.name)}
              className="flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", meta.dotClass)} />
                  <span className="truncate text-sm font-medium text-foreground">
                    {member.name}
                  </span>
                  {showRole ? (
                    <Badge size="sm" variant="secondary">
                      {member.role}
                    </Badge>
                  ) : null}
                </span>
                <Badge size="sm" variant={meta.badgeVariant}>
                  {stateLabel}
                </Badge>
              </span>

              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {member.model ? <span className="font-mono text-2xs">{member.model}</span> : null}
                {member.workspaceMode ? (
                  <Badge size="sm" variant="outline">
                    {member.workspaceMode}
                  </Badge>
                ) : null}
                {member.unreadCount > 0 ? (
                  <Badge size="sm" variant="info">
                    <T>
                      <Var>{member.unreadCount}</Var> unread
                    </T>
                  </Badge>
                ) : null}
                {member.lastPostSeq !== null ? (
                  <span className="font-mono text-2xs">
                    <T>
                      Last post <Var>{`#${member.lastPostSeq}`}</Var>
                    </T>
                  </span>
                ) : null}
              </span>

              {member.statusDetail ? (
                <span className="block break-words text-xs text-warning-foreground">
                  {member.statusDetail}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SwarmWorkerTranscriptView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly visible: boolean;
  readonly workerName: string;
  readonly member: AntigravitySwarmMember | null;
  readonly onBack: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const shouldPoll = props.visible && props.member?.state === "working";
  const target = {
    environmentId: props.environmentId,
    input: { threadId: props.threadId, workerName: props.workerName },
  };
  const query = useEnvironmentQuery<
    OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
    unknown
  >(
    props.visible
      ? shouldPoll
        ? orchestrationEnvironment.antigravitySwarmWorkerTranscriptLive(target)
        : orchestrationEnvironment.antigravitySwarmWorkerTranscript(target)
      : null,
    messages,
  );
  const transcript = query.data;
  const resolvedState = transcript?.state ?? props.member?.state ?? null;
  const resolvedModel = transcript?.model ?? props.member?.model ?? null;
  const stateMeta = resolvedState ? SWARM_MEMBER_STATE_META[resolvedState] : null;
  const refreshLabel = gt("Refresh transcript");

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-swarm-worker-transcript>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="xs" variant="ghost" onClick={props.onBack}>
            <ArrowLeftIcon />
            <T context="verb, returns to swarm view">Back</T>
          </Button>
          <div className="flex min-w-0 items-center gap-1.5">
            {stateMeta ? (
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", stateMeta.dotClass)}
              />
            ) : null}
            <span className="truncate text-sm font-medium text-foreground">{props.workerName}</span>
            {stateMeta ? (
              <Badge size="sm" variant={stateMeta.badgeVariant}>
                {messages(stateMeta.label)}
              </Badge>
            ) : null}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={refreshLabel}
                disabled={query.isPending}
                onClick={query.refresh}
              >
                <RefreshCwIcon />
              </Button>
            }
          />
          <TooltipPopup>{refreshLabel}</TooltipPopup>
        </Tooltip>
      </div>

      {resolvedModel || props.member?.statusDetail ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground">
          {resolvedModel ? <span className="font-mono text-2xs">{resolvedModel}</span> : null}
          {props.member?.statusDetail ? (
            <span className="break-words text-warning-foreground">{props.member.statusDetail}</span>
          ) : null}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="flex min-w-0 flex-col gap-3 p-4">
          {query.error !== null ? (
            <Alert variant="error">
              <TriangleAlertIcon />
              <AlertDescription>{query.error}</AlertDescription>
            </Alert>
          ) : transcript === null ? (
            <p className="text-xs text-muted-foreground">
              <T>Loading transcript…</T>
            </p>
          ) : (
            <>
              {transcript.truncated ? (
                <p className="text-xs text-muted-foreground">
                  <T>Earlier steps are not shown.</T>
                </p>
              ) : null}
              {transcript.steps === null || transcript.steps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <T>No transcript yet.</T>
                </p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-2.5 border-s border-border/70 ps-3">
                  {transcript.steps.map((step) => (
                    <NativeChildStep key={step.index} step={step} />
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
