import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type {
  AntigravitySwarmMember,
  AntigravitySwarmMemberState,
  AntigravitySwarmMessage,
  AntigravitySwarmPlan,
  AntigravitySwarmSnapshot,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export type SwarmBadgeVariant = "success" | "info" | "secondary" | "error" | "warning";

export interface SwarmMemberStateMeta {
  readonly label: string;
  readonly dotClass: string;
  readonly badgeVariant: SwarmBadgeVariant;
}

export const SWARM_MEMBER_STATE_META: Readonly<
  Record<AntigravitySwarmMemberState, SwarmMemberStateMeta>
> = {
  working: {
    label: msg("Working", { $context: "swarm worker status" }),
    dotClass: "bg-success",
    badgeVariant: "success",
  },
  waiting: {
    label: msg("Waiting", { $context: "swarm worker status" }),
    dotClass: "bg-info",
    badgeVariant: "info",
  },
  killed: {
    label: msg("Killed", { $context: "swarm worker status" }),
    dotClass: "bg-muted-foreground/40",
    badgeVariant: "secondary",
  },
  error: {
    label: msg("Error", { $context: "swarm worker status" }),
    dotClass: "bg-destructive",
    badgeVariant: "error",
  },
  quota: {
    label: msg("Quota", { $context: "swarm worker status" }),
    dotClass: "bg-warning",
    badgeVariant: "warning",
  },
  stuck: {
    label: msg("Stuck", { $context: "swarm worker status" }),
    dotClass: "bg-warning",
    badgeVariant: "warning",
  },
};

export interface SwarmMemberCounts {
  readonly total: number;
  readonly working: number;
  readonly waiting: number;
  readonly killed: number;
  readonly error: number;
  readonly quota: number;
  readonly stuck: number;
  readonly attention: number;
  readonly hasActiveWork: boolean;
}

export function summarizeSwarmMembers(
  members: readonly AntigravitySwarmMember[],
): SwarmMemberCounts {
  let working = 0;
  let waiting = 0;
  let killed = 0;
  let error = 0;
  let quota = 0;
  let stuck = 0;

  for (const member of members) {
    switch (member.state) {
      case "working":
        working += 1;
        break;
      case "waiting":
        waiting += 1;
        break;
      case "killed":
        killed += 1;
        break;
      case "error":
        error += 1;
        break;
      case "quota":
        quota += 1;
        break;
      case "stuck":
        stuck += 1;
        break;
    }
  }

  return {
    total: members.length,
    working,
    waiting,
    killed,
    error,
    quota,
    stuck,
    attention: error + quota + stuck,
    hasActiveWork: working > 0,
  };
}

export function isSwarmActive(swarm: AntigravitySwarmSnapshot | null): boolean {
  return (
    swarm !== null &&
    swarm.members.some(
      (member) =>
        member.state === "working" || (member.state === "waiting" && member.unreadCount > 0),
    )
  );
}

export function swarmSummaryDotClass(counts: SwarmMemberCounts): string {
  if (counts.working > 0) return SWARM_MEMBER_STATE_META.working.dotClass;
  if (counts.error > 0) return SWARM_MEMBER_STATE_META.error.dotClass;
  if (counts.quota > 0 || counts.stuck > 0) return SWARM_MEMBER_STATE_META.quota.dotClass;
  if (counts.waiting > 0) return SWARM_MEMBER_STATE_META.waiting.dotClass;
  return SWARM_MEMBER_STATE_META.killed.dotClass;
}

export function formatSwarmMemberSummary(
  counts: SwarmMemberCounts,
  resolve: MessageResolver = m,
): string {
  const parts: string[] = [];
  if (counts.working > 0) {
    parts.push(
      resolve(
        msg("{count, plural, one {{count} working} other {{count} working}}", {
          count: counts.working,
          $context: "swarm active worker count",
        }),
      ),
    );
  }
  if (counts.waiting > 0) {
    parts.push(
      resolve(
        msg("{count, plural, one {{count} waiting} other {{count} waiting}}", {
          count: counts.waiting,
          $context: "swarm waiting worker count",
        }),
      ),
    );
  }
  if (counts.attention > 0) {
    parts.push(
      resolve(
        msg("{count, plural, one {{count} needs attention} other {{count} need attention}}", {
          count: counts.attention,
          $context: "swarm error or quota worker count",
        }),
      ),
    );
  }
  if (counts.killed > 0) {
    parts.push(
      resolve(
        msg("{count, plural, one {{count} killed} other {{count} killed}}", {
          count: counts.killed,
          $context: "swarm killed worker count",
        }),
      ),
    );
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return resolve(msg("No workers"));
}

export function isSwarmBoardSlashCommand(text: string): boolean {
  return /^\/swarm\s+board$/i.test(text.trim());
}

export interface SwarmMessageTags {
  readonly mentions: readonly string[];
  readonly isBrief: boolean;
  readonly isDone: boolean;
  readonly isStall: boolean;
}

const MENTION_PATTERN = /(^|[\s(])@([a-z0-9][a-z0-9_-]*)/gi;
const DONE_TAG_PATTERN = /(^|\s)\[done\](?=\s|$|[.,:;!?])/i;
const STALL_TAG_PATTERN = /(^|\s)\[stall\](?=\s|$|[.,:;!?])/i;

export function parseSwarmMessageTags(
  message: Pick<AntigravitySwarmMessage, "text" | "kind" | "isControl">,
): SwarmMessageTags {
  const seen = new Set<string>();
  const mentions: string[] = [];
  MENTION_PATTERN.lastIndex = 0;
  for (const match of message.text.matchAll(MENTION_PATTERN)) {
    const handle = match[2];
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(handle);
  }

  return {
    mentions,
    isBrief: message.kind === "brief",
    isDone: DONE_TAG_PATTERN.test(message.text),
    isStall: STALL_TAG_PATTERN.test(message.text),
  };
}

export interface SwarmMessageFilter {
  readonly channel: string | null;
  readonly agent: string | null;
  readonly includeControl?: boolean;
}

export function filterSwarmMessages(
  messages: readonly AntigravitySwarmMessage[],
  filter: SwarmMessageFilter,
): AntigravitySwarmMessage[] {
  const includeControl = filter.includeControl ?? true;
  return messages.filter((message) => {
    if (!includeControl && message.isControl) return false;
    if (filter.channel !== null && message.channel !== filter.channel) return false;
    if (filter.agent !== null && message.agent !== filter.agent) return false;
    return true;
  });
}

export interface SwarmChannelSummary {
  readonly name: string;
  readonly topic: string | null;
  readonly archived: boolean;
  readonly messageCount: number;
}

export function collectSwarmBoardChannels(
  snapshot: Pick<AntigravitySwarmSnapshot, "channels" | "messages">,
): SwarmChannelSummary[] {
  const countsByChannel = new Map<string, number>();
  for (const message of snapshot.messages) {
    countsByChannel.set(message.channel, (countsByChannel.get(message.channel) ?? 0) + 1);
  }

  const byName = new Map<string, SwarmChannelSummary>();
  for (const channel of snapshot.channels) {
    byName.set(channel.name, {
      name: channel.name,
      topic: channel.topic,
      archived: channel.archived,
      messageCount: countsByChannel.get(channel.name) ?? 0,
    });
  }
  for (const [name, messageCount] of countsByChannel) {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        topic: null,
        archived: false,
        messageCount,
      });
    }
  }

  return [...byName.values()].toSorted((left, right) => {
    if (left.name === "main" && right.name !== "main") return -1;
    if (right.name === "main" && left.name !== "main") return 1;
    return left.name.localeCompare(right.name);
  });
}

export function collectSwarmBoardAgents(
  snapshot: Pick<AntigravitySwarmSnapshot, "members" | "messages">,
): string[] {
  const messageAgents = new Set(snapshot.messages.map((message) => message.agent));
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const member of snapshot.members) {
    if (!messageAgents.has(member.name) || seen.has(member.name)) continue;
    seen.add(member.name);
    ordered.push(member.name);
  }
  for (const message of snapshot.messages) {
    if (seen.has(message.agent)) continue;
    seen.add(message.agent);
    ordered.push(message.agent);
  }
  return ordered;
}

export interface SwarmWorkstreamTaskView {
  readonly name: string;
  readonly description: string | null;
  readonly member: AntigravitySwarmMember | null;
}

export interface SwarmWorkstreamView {
  readonly key: string;
  readonly id: string | null;
  readonly title: string;
  readonly goal: string | null;
  readonly tasks: readonly SwarmWorkstreamTaskView[];
}

export interface SwarmPlanGrouping {
  readonly workstreams: readonly SwarmWorkstreamView[];
  readonly ungroupedMembers: readonly AntigravitySwarmMember[];
}

export function groupSwarmPlanWorkstreams(
  plan: AntigravitySwarmPlan | null,
  members: readonly AntigravitySwarmMember[],
): SwarmPlanGrouping {
  if (plan === null) {
    return {
      workstreams: [],
      ungroupedMembers: [...members],
    };
  }

  const membersByName = new Map(members.map((member) => [member.name, member]));
  const groupedNames = new Set<string>();

  const workstreams: SwarmWorkstreamView[] = plan.threads.map((thread, index) => {
    const tasks: SwarmWorkstreamTaskView[] = thread.tasks.map((taskName) => {
      groupedNames.add(taskName);
      return {
        name: taskName,
        description: plan.tasks[taskName] ?? null,
        member: membersByName.get(taskName) ?? null,
      };
    });
    return {
      key: thread.id ?? `${thread.title}:${index}`,
      id: thread.id,
      title: thread.title,
      goal: thread.goal,
      tasks,
    };
  });

  const ungroupedMembers = members.filter((member) => !groupedNames.has(member.name));
  return { workstreams, ungroupedMembers };
}

const SWARM_TOOL_NAME_PATTERN = /(swarm|post_message|read_board)/i;
const SWARM_USER_COMMAND_PATTERN = /^\/swarm(?:\s|$)/i;

/**
 * Lightweight signature of swarm-related timeline items on an Antigravity thread.
 * Changes only when `/swarm` or a swarm tool call is added or updated, letting the UI
 * re-check swarm state without idle polling on non-swarm threads.
 */
export function swarmTurnActivitySignature(turnItems: ThreadStructure["turnItems"]): string | null {
  let count = 0;
  let latestId = "";
  let latestStatus = "";

  for (const item of turnItems) {
    if (
      item.type === "dynamic_tool" &&
      item.toolName !== null &&
      SWARM_TOOL_NAME_PATTERN.test(item.toolName)
    ) {
      count += 1;
      latestId = item.id;
      latestStatus = item.status;
    } else if (item.type === "user_message" && SWARM_USER_COMMAND_PATTERN.test(item.text.trim())) {
      count += 1;
      latestId = item.id;
      latestStatus = item.status;
    }
  }

  return count === 0 ? null : `${count}:${latestId}:${latestStatus}`;
}
