import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import * as AntigravitySwarmQuery from "./AntigravitySwarmQuery.ts";
import type { ProjectionRecords } from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const instanceId = ProviderInstanceId.make("antigravity");
const codexInstanceId = ProviderInstanceId.make("codex");
const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const antigravityDriver = ProviderDriverKind.make("antigravity");
const codexDriver = ProviderDriverKind.make("codex");
const claudeDriver = ProviderDriverKind.make("claudeAgent");
const threadId = ThreadId.make("thread-swarm");
const projectId = ProjectId.make("project-swarm");
const NOW = DateTime.makeUnsafe("2026-11-23T21:00:00.000Z");
const SESSION_OLD = "11111111-1111-4111-8111-111111111111";
const SESSION_NEW = "22222222-2222-4222-8222-222222222222";
const SESSION_RETRY = "55555555-5555-4555-8555-555555555555";
const WORKER_ID = "33333333-3333-4333-8333-333333333333";

type SwarmQueryRecords = ProjectionRecords<"runs" | "attempts" | "providerThreads">;

const baseThread: OrchestrationV2AppThread = {
  id: threadId,
  projectId,
  title: "Swarm Thread",
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model: "gemini-4-neon" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const makeRun = (input: {
  readonly id: string;
  readonly ordinal: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerThreadId: string | null;
  readonly activeAttemptId: string | null;
}): OrchestrationV2Run => ({
  id: RunId.make(input.id),
  threadId,
  ordinal: input.ordinal,
  providerInstanceId: input.providerInstanceId,
  modelSelection: { instanceId: input.providerInstanceId, model: "gemini-4-neon" },
  providerThreadId:
    input.providerThreadId === null ? null : ProviderThreadId.make(input.providerThreadId),
  userMessageId: MessageId.make(`msg-${input.id}`),
  rootNodeId: NodeId.make(`node-${input.id}`),
  activeAttemptId: input.activeAttemptId === null ? null : RunAttemptId.make(input.activeAttemptId),
  status: "completed",
  requestedAt: NOW,
  startedAt: NOW,
  completedAt: NOW,
  checkpointId: null,
  contextHandoffId: null,
});

const makeAttempt = (input: {
  readonly id: string;
  readonly runId: string;
  readonly attemptOrdinal: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerThreadId: string;
  readonly nativeThreadId?: string;
}): OrchestrationV2RunAttempt => ({
  id: RunAttemptId.make(input.id),
  runId: RunId.make(input.runId),
  attemptOrdinal: input.attemptOrdinal,
  rootNodeId: NodeId.make(`node-${input.runId}`),
  providerInstanceId: input.providerInstanceId,
  providerThreadId: ProviderThreadId.make(input.providerThreadId),
  providerTurnId: null,
  reason: input.attemptOrdinal > 1 ? "retry" : "initial",
  status: "completed",
  startedAt: NOW,
  completedAt: NOW,
  ...(input.nativeThreadId === undefined ? {} : { nativeThreadId: input.nativeThreadId }),
});

const makeProviderThread = (input: {
  readonly id: string;
  readonly driver: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly nativeId: string;
  readonly firstRunOrdinal: number | null;
  readonly lastRunOrdinal: number | null;
}): OrchestrationV2ProviderThread => ({
  id: ProviderThreadId.make(input.id),
  driver: input.driver,
  providerInstanceId: input.providerInstanceId,
  providerSessionId: null,
  appThreadId: threadId,
  ownerNodeId: null,
  nativeThreadRef: { driver: input.driver, nativeId: input.nativeId, strength: "strong" },
  nativeConversationHeadRef: null,
  status: "idle",
  firstRunOrdinal: input.firstRunOrdinal,
  lastRunOrdinal: input.lastRunOrdinal,
  handoffIds: [],
  forkedFrom: null,
  pendingBackgroundTasks: [],
  contextUsage: null,
  nativeMetadata: null,
  goal: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const writeSwarmFixture = (profile: string, sessionId: string, title: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const swarmDir = path.join(
      profile,
      "antigravity-acp",
      "brain",
      sessionId,
      ".system_generated",
      "swarm",
    );
    yield* fs.makeDirectory(swarmDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(swarmDir, "swarm.json"),
      JSON.stringify({ version: 1, backend: "local", swarm_id: sessionId }),
    );
    yield* fs.writeFileString(
      path.join(swarmDir, "members.json"),
      JSON.stringify({
        title,
        members: {
          coordinator: {
            conversation_id: sessionId,
            role: "coordinator",
            model: "gemini-4-neon",
            wake_mode: "mentions",
            last_read_seq: 1,
            killed: false,
          },
          worker: {
            conversation_id: WORKER_ID,
            role: "worker",
            model: "gemini-4-hydrogen",
            wake_mode: "working",
            last_read_seq: 0,
            killed: false,
          },
        },
      }),
    );
    yield* fs.writeFileString(
      path.join(swarmDir, "board.jsonl"),
      `${JSON.stringify({ seq: 1, agent: "coordinator", text: "@worker go", time: "2026-11-23 15:00:00" })}\n`,
    );
    const workerLog = path.join(
      profile,
      "antigravity-acp",
      "brain",
      WORKER_ID,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    yield* fs.makeDirectory(path.dirname(workerLog), { recursive: true });
    yield* fs.writeFileString(
      workerLog,
      `${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "Finished." })}\n`,
    );
  });

const runQuery = <A, E>(
  records: SwarmQueryRecords,
  use: (query: AntigravitySwarmQuery.AntigravitySwarmQuery["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const query = yield* AntigravitySwarmQuery.AntigravitySwarmQuery;
    return yield* use(query);
  }).pipe(
    Effect.provide(
      AntigravitySwarmQuery.layer.pipe(
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadRecords: (() =>
              Effect.succeed(
                records,
              )) as unknown as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
          }),
        ),
      ),
    ),
  );

it.layer(
  Layer.mergeAll(
    NodeServices.layer,
    NodeCrypto.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "antigravity-swarm-query-" }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
)("AntigravitySwarmQuery", (it) => {
  it.effect(
    "resolves the latest Antigravity run and active retry attempt and reads swarm and worker transcript",
    () =>
      Effect.gen(function* () {
        const { stateDir } = yield* ServerConfig.ServerConfig;
        const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
        yield* writeSwarmFixture(profile, SESSION_OLD, "Old Swarm");
        yield* writeSwarmFixture(profile, SESSION_NEW, "Latest Swarm");
        yield* writeSwarmFixture(profile, SESSION_RETRY, "Retry Attempt Swarm");

        const records: SwarmQueryRecords = {
          thread: baseThread,
          runs: [
            makeRun({
              id: "run-1",
              ordinal: 1,
              providerInstanceId: instanceId,
              providerThreadId: "pt-agy",
              activeAttemptId: "att-1",
            }),
            makeRun({
              id: "run-2",
              ordinal: 2,
              providerInstanceId: instanceId,
              providerThreadId: "pt-agy",
              activeAttemptId: "att-2-retry",
            }),
            makeRun({
              id: "run-3",
              ordinal: 3,
              providerInstanceId: codexInstanceId,
              providerThreadId: "pt-codex",
              activeAttemptId: "att-3",
            }),
          ],
          attempts: [
            makeAttempt({
              id: "att-1",
              runId: "run-1",
              attemptOrdinal: 1,
              providerInstanceId: instanceId,
              providerThreadId: "pt-agy",
              nativeThreadId: SESSION_OLD,
            }),
            makeAttempt({
              id: "att-2",
              runId: "run-2",
              attemptOrdinal: 1,
              providerInstanceId: instanceId,
              providerThreadId: "pt-agy",
              nativeThreadId: SESSION_NEW,
            }),
            makeAttempt({
              id: "att-2-retry",
              runId: "run-2",
              attemptOrdinal: 2,
              providerInstanceId: instanceId,
              providerThreadId: "pt-agy",
              nativeThreadId: SESSION_RETRY,
            }),
            makeAttempt({
              id: "att-3",
              runId: "run-3",
              attemptOrdinal: 1,
              providerInstanceId: codexInstanceId,
              providerThreadId: "pt-codex",
              nativeThreadId: "codex-session",
            }),
          ],
          providerThreads: [
            makeProviderThread({
              id: "pt-agy",
              driver: antigravityDriver,
              providerInstanceId: instanceId,
              nativeId: SESSION_OLD,
              firstRunOrdinal: 1,
              lastRunOrdinal: 2,
            }),
            makeProviderThread({
              id: "pt-codex",
              driver: codexDriver,
              providerInstanceId: codexInstanceId,
              nativeId: "codex-session",
              firstRunOrdinal: 3,
              lastRunOrdinal: 3,
            }),
          ],
        };

        const swarmResult = yield* runQuery(records, (query) =>
          query.getAntigravitySwarm({ threadId }),
        );
        expect(swarmResult.swarm).toMatchObject({
          swarmId: SESSION_RETRY,
          title: "Retry Attempt Swarm",
          backend: "local",
        });

        const workerResult = yield* runQuery(records, (query) =>
          query.getAntigravitySwarmWorkerTranscript({ threadId, workerName: "worker" }),
        );
        expect(workerResult).toMatchObject({
          workerName: "worker",
          model: "gemini-4-hydrogen",
          state: "waiting",
          truncated: false,
        });
        expect(workerResult.steps?.map((step) => step.text)).toEqual(["Finished."]);
      }),
  );

  it.effect("falls back to Antigravity providerThreads when no runs exist", () =>
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
      yield* writeSwarmFixture(profile, SESSION_NEW, "ProviderThread Fallback");

      const result = yield* runQuery(
        {
          thread: baseThread,
          runs: [],
          attempts: [],
          providerThreads: [
            makeProviderThread({
              id: "pt-agy",
              driver: antigravityDriver,
              providerInstanceId: instanceId,
              nativeId: SESSION_NEW,
              firstRunOrdinal: null,
              lastRunOrdinal: null,
            }),
          ],
        },
        (query) => query.getAntigravitySwarm({ threadId }),
      );
      expect(result.swarm?.title).toBe("ProviderThread Fallback");
    }),
  );

  it.effect("returns empty results for non-Antigravity threads and sessions without a swarm", () =>
    Effect.gen(function* () {
      const nonAgy: SwarmQueryRecords = {
        thread: baseThread,
        runs: [],
        attempts: [],
        providerThreads: [
          makeProviderThread({
            id: "pt-claude",
            driver: claudeDriver,
            providerInstanceId: claudeInstanceId,
            nativeId: SESSION_NEW,
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
          }),
        ],
      };

      expect(yield* runQuery(nonAgy, (query) => query.getAntigravitySwarm({ threadId }))).toEqual({
        swarm: null,
      });

      expect(
        yield* runQuery(nonAgy, (query) =>
          query.getAntigravitySwarmWorkerTranscript({ threadId, workerName: "worker" }),
        ),
      ).toEqual({
        workerName: "worker",
        model: null,
        state: null,
        steps: null,
        truncated: false,
      });

      const agyWithoutSwarm: SwarmQueryRecords = {
        thread: baseThread,
        runs: [],
        attempts: [],
        providerThreads: [
          makeProviderThread({
            id: "pt-agy",
            driver: antigravityDriver,
            providerInstanceId: instanceId,
            nativeId: "44444444-4444-4444-8444-444444444444",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
          }),
        ],
      };
      expect(
        yield* runQuery(agyWithoutSwarm, (query) => query.getAntigravitySwarm({ threadId })),
      ).toEqual({ swarm: null });
    }),
  );
});
