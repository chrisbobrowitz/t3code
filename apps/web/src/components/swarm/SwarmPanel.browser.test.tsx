import "~/index.css";
import {
  EnvironmentId,
  ThreadId,
  type AntigravitySwarmSnapshot,
  type OrchestrationV2GetAntigravitySwarmResult,
  type OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

type MockAtom =
  | { readonly kind: "swarm-base" }
  | { readonly kind: "swarm-live" }
  | { readonly kind: "transcript-base"; readonly workerName: string }
  | { readonly kind: "transcript-live"; readonly workerName: string };

const state = vi.hoisted(() => ({
  swarmResult: { swarm: null } as OrchestrationV2GetAntigravitySwarmResult,
  transcriptsByWorker: {} as Record<
    string,
    OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult
  >,
  requestedAtoms: [] as MockAtom[],
  refresh: vi.fn(),
}));

vi.mock(import("../../state/orchestration"), () => ({
  orchestrationEnvironment: {
    antigravitySwarm: () => ({ kind: "swarm-base" }) as MockAtom,
    antigravitySwarmLive: () => ({ kind: "swarm-live" }) as MockAtom,
    antigravitySwarmWorkerTranscript: (target: {
      readonly input: { readonly workerName: string };
    }) => ({ kind: "transcript-base", workerName: target.input.workerName }) as MockAtom,
    antigravitySwarmWorkerTranscriptLive: (target: {
      readonly input: { readonly workerName: string };
    }) => ({ kind: "transcript-live", workerName: target.input.workerName }) as MockAtom,
  } as never,
}));

vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((atom: MockAtom | null) => {
    if (atom === null) {
      return {
        data: null,
        dataUpdatedAt: 0,
        error: null,
        failure: null,
        isPending: false,
        isSuccess: false,
        refresh: state.refresh,
      };
    }
    state.requestedAtoms.push(atom);
    if (atom.kind === "swarm-base" || atom.kind === "swarm-live") {
      return {
        data: state.swarmResult,
        dataUpdatedAt: 1,
        error: null,
        failure: null,
        isPending: false,
        isSuccess: true,
        refresh: state.refresh,
      };
    }
    return {
      data: state.transcriptsByWorker[atom.workerName] ?? null,
      dataUpdatedAt: 1,
      error: null,
      failure: null,
      isPending: false,
      isSuccess: true,
      refresh: state.refresh,
    };
  }) as never,
}));

import { SwarmPanel } from "./SwarmPanel";

const ENV_ID = EnvironmentId.make("env-1");
const THREAD_ID = ThreadId.make("thread-1");

function setup(
  swarm: AntigravitySwarmSnapshot | null,
  transcriptsByWorker: Record<
    string,
    OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult
  > = {},
) {
  state.swarmResult = { swarm };
  state.transcriptsByWorker = transcriptsByWorker;
  state.requestedAtoms = [];
  state.refresh = vi.fn();
  return {
    [Symbol.dispose]() {
      state.swarmResult = { swarm: null };
      state.transcriptsByWorker = {};
      state.requestedAtoms = [];
    },
  };
}

function makeActiveSwarm(): AntigravitySwarmSnapshot {
  return {
    swarmId: "swarm-1" as AntigravitySwarmSnapshot["swarmId"],
    backend: "local",
    title: "Build Swarm UI",
    createdAt: "2026-11-23T15:00:00Z",
    headSeq: 2,
    totalMessages: 2,
    messagesTruncated: false,
    members: [
      {
        name: "web-impl" as AntigravitySwarmSnapshot["members"][number]["name"],
        role: "worker",
        state: "working",
        model: "gemini-3.1-pro",
        workspaceMode: "inherit",
        addedBy: "coordinator",
        channels: ["main", "ui"],
        lastReadSeq: 1,
        lastPostSeq: 2,
        lastPostTime: "2026-11-23T15:05:00Z",
        unreadCount: 0,
        statusDetail: null,
      },
      {
        name: "reviewer" as AntigravitySwarmSnapshot["members"][number]["name"],
        role: "worker",
        state: "waiting",
        model: "claude-opus-4",
        workspaceMode: "inherit",
        addedBy: "coordinator",
        channels: ["main"],
        lastReadSeq: 2,
        lastPostSeq: null,
        lastPostTime: null,
        unreadCount: 0,
        statusDetail: null,
      },
    ],
    channels: [
      {
        name: "main" as AntigravitySwarmSnapshot["channels"][number]["name"],
        topic: null,
        createdBy: null,
        archived: false,
      },
      {
        name: "ui" as AntigravitySwarmSnapshot["channels"][number]["name"],
        topic: "UI work",
        createdBy: "coordinator",
        archived: false,
      },
    ],
    messages: [
      {
        seq: 1,
        agent: "coordinator",
        text: "@web-impl Build the Swarm panel.",
        time: "2026-11-23T15:01:00Z",
        kind: "brief",
        channel: "main",
        isControl: false,
      },
      {
        seq: 2,
        agent: "web-impl",
        text: "@coordinator [done] Panel implemented.",
        time: "2026-11-23T15:05:00Z",
        kind: null,
        channel: "ui",
        isControl: false,
      },
    ],
    plan: {
      goalTitle: "Ship Swarm UI",
      goalLine: "Build panel, details card, and timeline indicator.",
      tasks: { "web-impl": "Build SwarmPanel" },
      threads: [
        {
          id: "ws-1",
          title: "Web UI",
          goal: "Ship React components",
          tasks: ["web-impl"],
        },
      ],
    },
  };
}

it("switches Overview, Board filters, Workers, and polls only working worker transcripts", async () => {
  using _fixture = setup(makeActiveSwarm(), {
    "web-impl": {
      workerName: "web-impl",
      model: "gemini-3.1-pro",
      state: "working",
      steps: [
        {
          index: 0,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          text: "Writing SwarmPanel components.",
          toolCalls: [{ name: "write_file", input: "SwarmPanel.tsx" }],
        },
      ],
      truncated: false,
    },
    reviewer: {
      workerName: "reviewer",
      model: "claude-opus-4",
      state: "waiting",
      steps: [
        {
          index: 0,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          text: "Audit finished cleanly.",
          toolCalls: [],
        },
      ],
      truncated: false,
    },
  });

  await using screen = await render(
    <SwarmPanel environmentId={ENV_ID} threadId={THREAD_ID} visible />,
  );

  // Overview renders plan goal and workstream.
  await expect.element(screen.getByText("Ship Swarm UI")).toBeVisible();
  await expect.element(screen.getByText("Build SwarmPanel")).toBeVisible();

  // Board tab filters by channel and updates aria-pressed.
  await userEvent.click(screen.getByRole("button", { name: "Board (2)" }));
  await expect.element(screen.getByText("@web-impl Build the Swarm panel.")).toBeVisible();
  const uiChannelButton = screen.getByRole("button", { name: "#ui (1)" });
  await expect.element(uiChannelButton).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(uiChannelButton);
  await expect.element(uiChannelButton).toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByText("@coordinator [done] Panel implemented.")).toBeVisible();
  await expect
    .element(screen.getByText("@web-impl Build the Swarm panel."))
    .not.toBeInTheDocument();

  // Workers tab opens working worker with live polling, then waiting worker without polling.
  await userEvent.click(screen.getByRole("button", { name: "Workers (2)" }));
  await userEvent.click(screen.getByRole("button", { name: "web-impl (Working)" }));
  await expect.element(screen.getByText("Writing SwarmPanel components.")).toBeVisible();
  expect(
    state.requestedAtoms.some(
      (atom) => atom.kind === "transcript-live" && atom.workerName === "web-impl",
    ),
  ).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "reviewer (Waiting)" }));
  await expect.element(screen.getByText("Audit finished cleanly.")).toBeVisible();
  expect(
    state.requestedAtoms.some(
      (atom) => atom.kind === "transcript-base" && atom.workerName === "reviewer",
    ),
  ).toBe(true);
  expect(
    state.requestedAtoms.some(
      (atom) => atom.kind === "transcript-live" && atom.workerName === "reviewer",
    ),
  ).toBe(false);
});

it("renders empty and spanner states without mounting the live poller", async () => {
  using _emptyFixture = setup(null);
  await using screen = await render(
    <SwarmPanel environmentId={ENV_ID} threadId={THREAD_ID} visible />,
  );

  await expect.element(screen.getByText("No active swarm")).toBeVisible();
  expect(state.requestedAtoms.some((atom) => atom.kind === "swarm-live")).toBe(false);

  state.swarmResult = {
    swarm: {
      swarmId: "swarm-remote" as AntigravitySwarmSnapshot["swarmId"],
      backend: "spanner",
      title: "Remote job",
      createdAt: null,
      headSeq: 0,
      totalMessages: 0,
      messagesTruncated: false,
      members: [],
      channels: [],
      messages: [],
      plan: null,
    },
  };
  await screen.rerender(<SwarmPanel environmentId={ENV_ID} threadId={THREAD_ID} visible />);
  await expect.element(screen.getByText("Remote swarm backend")).toBeVisible();
  expect(state.requestedAtoms.some((atom) => atom.kind === "swarm-live")).toBe(false);
});
