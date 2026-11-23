import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type {
  AntigravitySwarmMember,
  AntigravitySwarmMessage,
  AntigravitySwarmPlan,
  AntigravitySwarmSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectSwarmBoardAgents,
  collectSwarmBoardChannels,
  filterSwarmMessages,
  formatSwarmMemberSummary,
  groupSwarmPlanWorkstreams,
  isSwarmActive,
  isSwarmBoardSlashCommand,
  parseSwarmMessageTags,
  summarizeSwarmMembers,
  swarmSummaryDotClass,
  swarmTurnActivitySignature,
  SWARM_MEMBER_STATE_META,
} from "./swarmPresentation.logic";

function member(
  overrides: Partial<AntigravitySwarmMember> & Pick<AntigravitySwarmMember, "name">,
): AntigravitySwarmMember {
  return {
    role: "worker",
    state: "waiting",
    model: "gemini-3.1-pro",
    workspaceMode: "inherit",
    addedBy: "coordinator",
    channels: ["main"],
    lastReadSeq: 0,
    lastPostSeq: null,
    lastPostTime: null,
    unreadCount: 0,
    statusDetail: null,
    ...overrides,
  };
}

function message(
  overrides: Partial<AntigravitySwarmMessage> & Pick<AntigravitySwarmMessage, "seq" | "agent">,
): AntigravitySwarmMessage {
  return {
    text: "status update",
    time: "2026-11-23T15:00:00Z",
    kind: null,
    channel: "main",
    isControl: false,
    ...overrides,
  };
}

describe("isSwarmBoardSlashCommand", () => {
  it("matches exact /swarm board with flexible casing and whitespace", () => {
    expect(isSwarmBoardSlashCommand("/swarm board")).toBe(true);
    expect(isSwarmBoardSlashCommand("  /SWARM   BOARD  ")).toBe(true);
    expect(isSwarmBoardSlashCommand("/Swarm\tboard\n")).toBe(true);
  });

  it("does not match other /swarm prompts or trailing arguments", () => {
    expect(isSwarmBoardSlashCommand("/swarm")).toBe(false);
    expect(isSwarmBoardSlashCommand("/swarm implement feature")).toBe(false);
    expect(isSwarmBoardSlashCommand("/swarm board extra")).toBe(false);
    expect(isSwarmBoardSlashCommand("open /swarm board")).toBe(false);
  });
});

describe("summarizeSwarmMembers and formatting", () => {
  it("counts every member state and computes attention and active flags", () => {
    const members = [
      member({ name: "coordinator", role: "coordinator", state: "waiting" }),
      member({ name: "server-impl", state: "working" }),
      member({ name: "web-impl", state: "working" }),
      member({ name: "scout", state: "killed" }),
      member({ name: "flaky", state: "error", statusDetail: "timed out" }),
      member({ name: "heavy", state: "quota", statusDetail: "rate limited" }),
      member({ name: "idle-loop", state: "stuck" }),
    ];

    const counts = summarizeSwarmMembers(members);
    expect(counts).toEqual({
      total: 7,
      working: 2,
      waiting: 1,
      killed: 1,
      error: 1,
      quota: 1,
      stuck: 1,
      attention: 3,
      hasActiveWork: true,
    });
    expect(swarmSummaryDotClass(counts)).toBe(SWARM_MEMBER_STATE_META.working.dotClass);
    expect(formatSwarmMemberSummary(counts)).toBe(
      "2 working · 1 waiting · 3 need attention · 1 killed",
    );
  });

  it("handles empty rosters and inactive swarms", () => {
    const empty = summarizeSwarmMembers([]);
    expect(empty.hasActiveWork).toBe(false);
    expect(formatSwarmMemberSummary(empty)).toBe("No workers");
    expect(isSwarmActive(null)).toBe(false);

    const inactiveSnapshot: AntigravitySwarmSnapshot = {
      swarmId: "swarm-1" as AntigravitySwarmSnapshot["swarmId"],
      backend: "local",
      title: "Done",
      createdAt: null,
      headSeq: 1,
      totalMessages: 1,
      messagesTruncated: false,
      members: [member({ name: "coordinator", state: "waiting", unreadCount: 0 })],
      channels: [],
      messages: [],
      plan: null,
    };
    expect(isSwarmActive(inactiveSnapshot)).toBe(false);

    const handoffSnapshot: AntigravitySwarmSnapshot = {
      ...inactiveSnapshot,
      members: [member({ name: "web-impl", state: "waiting", unreadCount: 1 })],
    };
    expect(isSwarmActive(handoffSnapshot)).toBe(true);
  });
});

describe("parseSwarmMessageTags", () => {
  it("extracts deduped @mentions and recognizes brief, [done], and [stall] tags", () => {
    const tags = parseSwarmMessageTags({
      text: "@coordinator [done] Finished UI. Ping @web-impl and @Coordinator (@all).",
      kind: "brief",
      isControl: false,
    });
    expect(tags).toEqual({
      mentions: ["coordinator", "web-impl", "all"],
      isBrief: true,
      isDone: true,
      isStall: false,
    });

    const stall = parseSwarmMessageTags({
      text: "@server-impl [stall] Waiting on build lock.",
      kind: null,
      isControl: false,
    });
    expect(stall).toEqual({
      mentions: ["server-impl"],
      isBrief: false,
      isDone: false,
      isStall: true,
    });
  });

  it("ignores email addresses as @mentions", () => {
    const tags = parseSwarmMessageTags({
      text: "Contact user@example.com for details.",
      kind: null,
      isControl: false,
    });
    expect(tags.mentions).toEqual([]);
  });
});

describe("filterSwarmMessages and board facets", () => {
  const messages = [
    message({ seq: 1, agent: "coordinator", channel: "main", kind: "brief" }),
    message({ seq: 2, agent: "web-impl", channel: "frontend" }),
    message({ seq: 3, agent: "server-impl", channel: "main", isControl: true }),
  ];

  it("filters by channel, agent, and control flag", () => {
    expect(
      filterSwarmMessages(messages, { channel: "frontend", agent: null }).map((m) => m.seq),
    ).toEqual([2]);
    expect(
      filterSwarmMessages(messages, { channel: "main", agent: "server-impl" }).map((m) => m.seq),
    ).toEqual([3]);
    expect(
      filterSwarmMessages(messages, {
        channel: null,
        agent: null,
        includeControl: false,
      }).map((m) => m.seq),
    ).toEqual([1, 2]);
  });

  it("collects channels with main first and counts messages", () => {
    const channels = collectSwarmBoardChannels({
      channels: [
        {
          name: "frontend" as AntigravitySwarmSnapshot["channels"][number]["name"],
          topic: "UI work",
          createdBy: "coordinator",
          archived: false,
        },
        {
          name: "main" as AntigravitySwarmSnapshot["channels"][number]["name"],
          topic: null,
          createdBy: null,
          archived: false,
        },
      ],
      messages,
    });
    expect(channels).toEqual([
      { name: "main", topic: null, archived: false, messageCount: 2 },
      { name: "frontend", topic: "UI work", archived: false, messageCount: 1 },
    ]);
  });

  it("collects agents ordered by roster then message order", () => {
    const agents = collectSwarmBoardAgents({
      members: [
        member({ name: "coordinator" }),
        member({ name: "server-impl" }),
        member({ name: "silent-worker" }),
      ],
      messages,
    });
    expect(agents).toEqual(["coordinator", "server-impl", "web-impl"]);
  });
});

describe("groupSwarmPlanWorkstreams", () => {
  it("groups plan threads with live member states and separates ungrouped workers", () => {
    const coordinator = member({ name: "coordinator", role: "coordinator", state: "waiting" });
    const webImpl = member({ name: "web-impl", state: "working" });
    const helper = member({ name: "helper", state: "waiting" });
    const plan: AntigravitySwarmPlan = {
      goalTitle: "Ship Swarm UI",
      goalLine: "Build server and web slices in parallel.",
      tasks: {
        "web-impl": "Implement right-panel Swarm view",
        "pending-worker": "Run final checks",
      },
      threads: [
        {
          id: "ws-ui",
          title: "Frontend",
          goal: "Ship React components",
          tasks: ["web-impl", "pending-worker"],
        },
      ],
    };

    const grouped = groupSwarmPlanWorkstreams(plan, [coordinator, webImpl, helper]);
    expect(grouped.workstreams).toEqual([
      {
        key: "ws-ui",
        id: "ws-ui",
        title: "Frontend",
        goal: "Ship React components",
        tasks: [
          {
            name: "web-impl",
            description: "Implement right-panel Swarm view",
            member: webImpl,
          },
          {
            name: "pending-worker",
            description: "Run final checks",
            member: null,
          },
        ],
      },
    ]);
    expect(grouped.ungroupedMembers).toEqual([coordinator, helper]);
  });

  it("falls back to ungrouped members when plan is null", () => {
    const workers = [member({ name: "coordinator" }), member({ name: "web-impl" })];
    expect(groupSwarmPlanWorkstreams(null, workers)).toEqual({
      workstreams: [],
      ungroupedMembers: workers,
    });
  });
});

describe("swarmTurnActivitySignature", () => {
  it("returns null when no swarm items exist and changes when swarm tools or /swarm prompts appear", () => {
    const plainItems = [
      {
        id: "item-1",
        type: "user_message",
        status: "completed",
        text: "Fix the typo",
        updatedAt: "2026-11-23T15:00:00Z",
      },
      {
        id: "item-2",
        type: "dynamic_tool",
        status: "completed",
        toolName: "read_file",
        updatedAt: "2026-11-23T15:00:01Z",
      },
    ] as unknown as ThreadStructure["turnItems"];

    expect(swarmTurnActivitySignature(plainItems)).toBeNull();

    const withSwarmCommand = [
      ...plainItems,
      {
        id: "item-3",
        type: "user_message",
        status: "completed",
        text: "/swarm build feature",
        updatedAt: "2026-11-23T15:00:02Z",
      },
    ] as unknown as ThreadStructure["turnItems"];

    const sig1 = swarmTurnActivitySignature(withSwarmCommand);
    expect(sig1).not.toBeNull();

    const withSwarmTool = [
      ...withSwarmCommand,
      {
        id: "item-4",
        type: "dynamic_tool",
        status: "running",
        toolName: "Add swarm worker",
        updatedAt: "2026-11-23T15:00:03Z",
      },
    ] as unknown as ThreadStructure["turnItems"];

    const sig2 = swarmTurnActivitySignature(withSwarmTool);
    expect(sig2).not.toBeNull();
    expect(sig2).not.toBe(sig1);

    const withUpdatedTimestampOnly = withSwarmTool.map((item, index) =>
      index === withSwarmTool.length - 1 ? { ...item, updatedAt: "2026-11-23T15:00:09Z" } : item,
    ) as unknown as ThreadStructure["turnItems"];
    expect(swarmTurnActivitySignature(withUpdatedTimestampOnly)).toBe(sig2);

    const withCompletedTool = withSwarmTool.map((item, index) =>
      index === withSwarmTool.length - 1 ? { ...item, status: "completed" } : item,
    ) as unknown as ThreadStructure["turnItems"];
    expect(swarmTurnActivitySignature(withCompletedTool)).not.toBe(sig2);
  });
});
