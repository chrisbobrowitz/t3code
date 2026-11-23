// @effect-diagnostics nodeBuiltinImport:off -- utimes sets deterministic transcript mtimes for state tests.
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  deriveAntigravitySwarmMemberState,
  readAntigravitySwarm,
  readAntigravitySwarmWorkerTranscript,
} from "./AntigravitySwarm.ts";

const ROOT = "24fbd37c-7928-4ff1-a760-73730c2de6c1";
const WORKER_A = "a1111111-1111-4111-8111-111111111111";
const WORKER_B = "b2222222-2222-4222-8222-222222222222";
const WORKER_C = "c3333333-3333-4333-8333-333333333333";
const WORKER_D = "d4444444-4444-4444-8444-444444444444";
const MONITOR = "e5555555-5555-4555-8555-555555555555";
const NOW = Date.UTC(2026, 10, 23, 22, 0, 0);

const makeSwarmHelpers = (profile: string) => {
  const writeSwarmFile = (name: string, body: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(
        profile,
        "antigravity-acp",
        "brain",
        ROOT,
        ".system_generated",
        "swarm",
        name,
      );
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, body);
      return file;
    });

  const writeTranscriptRaw = (conversationId: string, body: string, mtimeMs = NOW - 5_000) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(
        profile,
        "antigravity-acp",
        "brain",
        conversationId,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, body);
      yield* Effect.promise(() => NodeFSP.utimes(file, mtimeMs / 1000, mtimeMs / 1000));
      return file;
    });

  const writeTranscript = (
    conversationId: string,
    lines: ReadonlyArray<Record<string, unknown>>,
    mtimeMs = NOW - 5_000,
  ) =>
    writeTranscriptRaw(
      conversationId,
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      mtimeMs,
    );

  return { writeSwarmFile, writeTranscript, writeTranscriptRaw };
};

it("derives all swarm member states according to agy transcript and roster rules", () => {
  // Killed takes precedence over transcript activity.
  for (const flags of [
    { killed: true },
    { desiredState: "KILLED" },
    { phase: "KILLED" },
  ] as const) {
    expect(
      deriveAntigravitySwarmMemberState({
        ...flags,
        transcriptLines: [{ step_index: 1, type: "GENERIC", status: "RUNNING" }],
        transcriptMtimeMs: NOW,
        nowMs: NOW,
      }),
    ).toEqual({ state: "killed", statusDetail: null });
  }

  // Fallback to wake_mode only when no transcript exists.
  expect(deriveAntigravitySwarmMemberState({ wakeMode: "mentions", nowMs: NOW })).toEqual({
    state: "waiting",
    statusDetail: null,
  });
  expect(deriveAntigravitySwarmMemberState({ wakeMode: "anything", nowMs: NOW })).toEqual({
    state: "waiting",
    statusDetail: null,
  });
  expect(deriveAntigravitySwarmMemberState({ wakeMode: "working", nowMs: NOW })).toEqual({
    state: "working",
    statusDetail: null,
  });

  // Transcript overrides stale wake_mode (e.g. background task woke a parked member).
  expect(
    deriveAntigravitySwarmMemberState({
      wakeMode: "mentions",
      transcriptLines: [
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          tool_calls: [{ name: "run_command" }],
        },
        { step_index: 2, type: "GENERIC", status: "RUNNING" },
      ],
      transcriptMtimeMs: NOW - 10_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "working", statusDetail: null });

  // Waiting via 0 tool_calls PLANNER_RESPONSE.
  expect(
    deriveAntigravitySwarmMemberState({
      wakeMode: "working",
      transcriptLines: [
        { step_index: 2, type: "PLANNER_RESPONSE", status: "DONE", content: "All set." },
      ],
      transcriptMtimeMs: NOW - 30_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "waiting", statusDetail: null });

  // Waiting via post_message + swarm_wait with all tool calls completed as GENERIC.
  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        {
          step_index: 4,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          tool_calls: [{ name: "post_message" }, { name: "swarm_wait" }],
        },
        { step_index: 5, type: "GENERIC", status: "DONE", content: "posted #3" },
        { step_index: 6, type: "GENERIC", status: "DONE", content: "waiting" },
      ],
      transcriptMtimeMs: NOW - 30_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "waiting", statusDetail: null });

  // Still working if [swarm_wait, other] has not logged every tool result yet.
  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        {
          step_index: 4,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          tool_calls: [{ name: "swarm_wait" }, { name: "post_message" }],
        },
        { step_index: 5, type: "GENERIC", status: "DONE" },
      ],
      transcriptMtimeMs: NOW - 5_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "working", statusDetail: null });

  // Any non-GENERIC step after swarm_wait (including SYSTEM_MESSAGE or CHECKPOINT) breaks wait.
  for (const stepType of ["SYSTEM_MESSAGE", "CHECKPOINT"]) {
    expect(
      deriveAntigravitySwarmMemberState({
        transcriptLines: [
          {
            step_index: 4,
            type: "PLANNER_RESPONSE",
            status: "DONE",
            tool_calls: [{ name: "swarm_wait" }],
          },
          { step_index: 5, type: "GENERIC", status: "DONE" },
          { step_index: 6, type: stepType, content: "wake" },
        ],
        transcriptMtimeMs: NOW - 5_000,
        nowMs: NOW,
      }),
    ).toEqual({ state: "working", statusDetail: null });
  }

  // Torn trailing transcript line counts as mid-turn working even after a waiting planner step.
  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [{ step_index: 2, type: "PLANNER_RESPONSE", status: "DONE" }],
      hasTrailingIncompleteLine: true,
      transcriptMtimeMs: NOW - 5_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "working", statusDetail: null });

  // Tail with no PLANNER_RESPONSE and no error falls back to wake_mode.
  expect(
    deriveAntigravitySwarmMemberState({
      wakeMode: "mentions",
      transcriptLines: [{ step_index: 9, type: "GENERIC", status: "DONE", content: "huge output" }],
      transcriptMtimeMs: NOW - 15 * 60_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "waiting", statusDetail: null });

  // Immediate ERROR_MESSAGE classifies quota vs generic error and caps statusDetail without splitting surrogates.
  const longQuotaError = `HTTP 429 RESOURCE_EXHAUSTED: ${"x".repeat(209)}🚀 more`;
  const quotaResult = deriveAntigravitySwarmMemberState({
    transcriptLines: [{ step_index: 7, type: "ERROR_MESSAGE", error: longQuotaError }],
    transcriptMtimeMs: NOW - 1_000,
    nowMs: NOW,
  });
  expect(quotaResult.state).toBe("quota");
  expect(quotaResult.statusDetail?.length).toBeLessThanOrEqual(240);
  expect(quotaResult.statusDetail?.endsWith("…")).toBe(true);
  expect(/[\uD800-\uDBFF]…$/u.test(quotaResult.statusDetail ?? "")).toBe(false);

  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        { step_index: 7, type: "ERROR_MESSAGE", content: "model backend returned 500" },
      ],
      transcriptMtimeMs: NOW - 1_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "error", statusDetail: "model backend returned 500" });

  // status === "ERROR" on GENERIC uses step.error only (ignores command output containing "429"/"quota").
  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        { step_index: 8, type: "GENERIC", status: "ERROR", error: "transient rate limit" },
      ],
      transcriptMtimeMs: NOW - 59_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "working", statusDetail: null });

  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        {
          step_index: 8,
          type: "GENERIC",
          status: "ERROR",
          content: "curl returned HTTP 429 quota exceeded",
        },
      ],
      transcriptMtimeMs: NOW - 60_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "error", statusDetail: null });

  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [
        { step_index: 8, type: "GENERIC", status: "ERROR", error: "You exhausted your capacity." },
      ],
      transcriptMtimeMs: NOW - 60_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "quota", statusDetail: "You exhausted your capacity." });

  // Working idle >= 10 minutes becomes stuck.
  expect(
    deriveAntigravitySwarmMemberState({
      transcriptLines: [{ step_index: 9, type: "GENERIC", status: "RUNNING" }],
      transcriptMtimeMs: NOW - 10 * 60_000,
      nowMs: NOW,
    }),
  ).toEqual({ state: "stuck", statusDetail: null });
});

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "AntigravitySwarm disk reader",
  (it) => {
    it.effect(
      "reads local swarm fixtures, derives states, cross-channel mention unreads, channels, and plan",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-" });
          const { writeSwarmFile, writeTranscript } = makeSwarmHelpers(profile);

          yield* writeSwarmFile(
            "swarm.json",
            JSON.stringify({
              version: 1,
              backend: "local",
              swarm_id: ROOT,
              created_at: "2026-11-23T21:30:00Z",
            }),
          );
          yield* writeSwarmFile(
            "members.json",
            JSON.stringify({
              title: "Native Swarm Integration",
              members: {
                "worker-1": {
                  conversation_id: WORKER_A,
                  role: "worker",
                  added_by: "coordinator",
                  desired_state: "RUNNING",
                  phase: "RUNNING",
                  applied_model: "gemini-4-neon",
                  model: "gemini-4-neon",
                  workspace_mode: "share",
                  wake_mode: "mentions",
                  wait_since: 2,
                  last_read_seq: 1,
                  killed: false,
                },
                "a-working": {
                  conversation_id: WORKER_B,
                  role: "worker",
                  added_by: "coordinator",
                  desired_model: "gemini-4-hydrogen",
                  model: "legacy-model",
                  workspace_mode: "inherit",
                  channels: ["main", "backend"],
                  wake_mode: "mentions",
                  last_read_seq: 2,
                  killed: false,
                },
                "b-error": {
                  conversation_id: WORKER_C,
                  role: "worker",
                  added_by: "coordinator",
                  model: "gemini-4-neon",
                  wake_mode: "working",
                  last_read_seq: 0,
                  killed: false,
                },
                "c-killed": {
                  conversation_id: WORKER_D,
                  role: "worker",
                  added_by: "coordinator",
                  desired_state: "KILLED",
                  phase: "KILLED",
                  model: "gemini-4-neon",
                  wake_mode: "mentions",
                  last_read_seq: 0,
                  killed: true,
                },
                "monitor-1": {
                  conversation_id: MONITOR,
                  role: "worker",
                  added_by: "coordinator",
                  model: "gemini-4-hydrogen",
                  wake_mode: "mentions",
                  last_read_seq: 1,
                  killed: false,
                },
                coordinator: {
                  conversation_id: ROOT,
                  role: "coordinator",
                  model: "gemini-4-neon",
                  workspace_mode: "inherit",
                  channels: ["main"],
                  wake_mode: "mentions",
                  last_read_seq: 1,
                  killed: false,
                },
              },
              channels: {
                backend: {
                  name: "backend",
                  topic: "Server RPC work",
                  created_by: "coordinator",
                  archived: false,
                },
                main: {
                  name: "main",
                  topic: "General board",
                  created_by: "coordinator",
                  archived: false,
                },
                archive: {
                  name: "archive",
                  topic: "Old notes",
                  created_by: "coordinator",
                  archived: true,
                },
              },
            }),
          );
          yield* writeSwarmFile(
            "board.jsonl",
            [
              {
                seq: 1,
                agent: "coordinator",
                text: "@a-working build server",
                time: "2026-11-23 15:30:01",
                kind: "brief",
              },
              {
                seq: 2,
                agent: "coordinator",
                text: "created #backend",
                time: "2026-11-23 15:31:00",
                channel: "backend",
                control: { op: "create", channel: "backend", topic: "Server RPC work" },
              },
              {
                seq: 3,
                agent: "a-working",
                text: "Backend schema ready for @worker",
                time: "2026-11-23 15:32:00",
                channel: "backend",
              },
              {
                seq: 4,
                agent: "a-working",
                text: "Quiet backend note",
                time: "2026-11-23 15:32:30",
                channel: "backend",
              },
              {
                seq: 5,
                agent: "worker-1",
                text: "@coordinator [done] checked main",
                time: "2026-11-23 15:33:00",
              },
              {
                seq: 6,
                agent: "coordinator",
                text: "Attention @all on #archive",
                time: "2026-11-23 15:34:00",
                channel: "archive",
              },
              {
                seq: 7,
                agent: "coordinator",
                text: "Cross-ref @#main from archive",
                time: "2026-11-23 15:34:30",
                channel: "archive",
              },
            ]
              .map((line) => JSON.stringify(line))
              .join("\n") + "\n",
          );
          yield* writeSwarmFile(
            "plan.json",
            JSON.stringify({
              goal: { title: "Ship swarm UI", line: "Expose live board and worker transcripts" },
              tasks: { "t-1": "Reader", "t-2": "RPC wiring" },
              threads: [
                { id: "th-1", title: "Server", goal: "Read disk state", tasks: ["t-1", "t-2"] },
              ],
            }),
          );

          yield* writeTranscript(ROOT, [
            { step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "Waiting." },
          ]);
          yield* writeTranscript(WORKER_A, [
            {
              step_index: 1,
              type: "PLANNER_RESPONSE",
              status: "DONE",
              tool_calls: [{ name: "swarm_wait" }],
            },
            { step_index: 2, type: "GENERIC", status: "DONE" },
          ]);
          yield* writeTranscript(WORKER_B, [
            {
              step_index: 1,
              type: "PLANNER_RESPONSE",
              status: "DONE",
              tool_calls: [{ name: "run_command" }],
            },
            { step_index: 2, type: "GENERIC", status: "RUNNING" },
          ]);
          yield* writeTranscript(WORKER_C, [
            { step_index: 1, type: "ERROR_MESSAGE", error: "429 quota exceeded on backend" },
          ]);

          const snapshot = yield* readAntigravitySwarm({
            profileDirectory: profile,
            rootSessionId: ROOT,
            nowMs: NOW,
          });
          expect(snapshot).not.toBeNull();
          expect(snapshot).toMatchObject({
            swarmId: ROOT,
            backend: "local",
            title: "Native Swarm Integration",
            createdAt: "2026-11-23T21:30:00Z",
            headSeq: 7,
            totalMessages: 7,
            messagesTruncated: false,
          });

          expect(snapshot!.members.map((member) => [member.name, member.state])).toEqual([
            ["coordinator", "waiting"],
            ["a-working", "working"],
            ["b-error", "quota"],
            ["monitor-1", "waiting"],
            ["worker-1", "waiting"],
            ["c-killed", "killed"],
          ]);

          const byName = new Map(snapshot!.members.map((member) => [member.name, member]));
          // Coordinator explicitly narrowed to ["main"]: sees seq 5 (main), seq 6 (@all), seq 7 (@#main), NOT seq 3/4.
          expect(byName.get("coordinator")).toMatchObject({
            channels: ["main"],
            lastReadSeq: 1,
            lastPostSeq: 7,
            lastPostTime: "2026-11-23 15:34:30",
            unreadCount: 3,
            statusDetail: null,
          });
          // worker-role member named monitor-1 defaults to ["*"]: sees all 5 non-control messages > 1 (seq 3,4,5,6,7).
          expect(byName.get("monitor-1")).toMatchObject({
            channels: ["*"],
            unreadCount: 5,
          });
          // worker-1 defaults to ["main"]: sees seq 3 (@worker group prefix), seq 5 (main), seq 6 (@all), seq 7 (@#main); NOT seq 4.
          expect(byName.get("worker-1")).toMatchObject({
            channels: ["main"],
            workspaceMode: "share",
            lastPostSeq: 5,
            unreadCount: 4,
          });
          // a-working sees main + backend + @all + @#main: seq 3,4,5,6,7 > lastReadSeq 2.
          expect(byName.get("a-working")).toMatchObject({
            model: "gemini-4-hydrogen",
            channels: ["main", "backend"],
            lastPostSeq: 4,
            unreadCount: 5,
          });
          expect(byName.get("b-error")).toMatchObject({
            state: "quota",
            statusDetail: "429 quota exceeded on backend",
          });

          expect(snapshot!.channels.map((channel) => channel.name)).toEqual([
            "main",
            "archive",
            "backend",
          ]);
          expect(snapshot!.plan).toEqual({
            goalTitle: "Ship swarm UI",
            goalLine: "Expose live board and worker transcripts",
            tasks: { "t-1": "Reader", "t-2": "RPC wiring" },
            threads: [
              { id: "th-1", title: "Server", goal: "Read disk state", tasks: ["t-1", "t-2"] },
            ],
          });
        }),
    );

    it.effect(
      "handles torn board/transcript lines, partially invalid members.json, and fails on torn members.json",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-torn-" });
          const { writeSwarmFile, writeTranscriptRaw } = makeSwarmHelpers(profile);

          yield* writeSwarmFile(
            "swarm.json",
            JSON.stringify({ version: 1, backend: "local", swarm_id: ROOT }),
          );
          // One malformed member entry does not drop valid siblings.
          yield* writeSwarmFile(
            "members.json",
            JSON.stringify({
              title: "Resilient Roster",
              members: {
                valid: {
                  conversation_id: WORKER_A,
                  role: "worker",
                  model: "gemini-4-neon",
                  wake_mode: "mentions",
                  last_read_seq: 0,
                  killed: false,
                },
                corrupt: {
                  conversation_id: WORKER_B,
                  last_read_seq: "not-a-number",
                },
              },
            }),
          );
          // Torn trailing board line is ignored cleanly without dropping earlier messages.
          yield* writeSwarmFile(
            "board.jsonl",
            `${JSON.stringify({ seq: 1, agent: "valid", text: "ok", time: "2026-11-23 15:00:00" })}\n{"seq":2,"agent":"valid","text":"partial`,
          );
          // Torn trailing transcript line marks the worker mid-turn (working) rather than waiting.
          yield* writeTranscriptRaw(
            WORKER_A,
            `${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "idle" })}\n{"step_index":2,"type":"GEN`,
          );

          const snapshot = yield* readAntigravitySwarm({
            profileDirectory: profile,
            rootSessionId: ROOT,
            nowMs: NOW,
          });
          expect(snapshot?.title).toBe("Resilient Roster");
          expect(snapshot?.members.map((member) => [member.name, member.state])).toEqual([
            ["valid", "working"],
          ]);
          expect(snapshot?.messages.map((message) => message.seq)).toEqual([1]);

          // Torn members.json fails the read after retry rather than returning an empty roster.
          yield* writeSwarmFile("members.json", '{"title":"Half written');
          const exit = yield* Effect.exit(
            readAntigravitySwarm({
              profileDirectory: profile,
              rootSessionId: ROOT,
              nowMs: NOW,
            }),
          );
          expect(Exit.isFailure(exit)).toBe(true);
        }),
    );

    it.effect(
      "handles byte-capped board truncation (both tail alignment and single oversized line) and message capping",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-cap-" });
          const { writeSwarmFile } = makeSwarmHelpers(profile);

          yield* writeSwarmFile(
            "swarm.json",
            JSON.stringify({ version: 1, backend: "local", swarm_id: ROOT }),
          );
          yield* writeSwarmFile(
            "members.json",
            JSON.stringify({
              title: "",
              members: {
                coordinator: {
                  conversation_id: ROOT,
                  role: "coordinator",
                  wake_mode: "mentions",
                  last_read_seq: 2,
                  killed: false,
                },
              },
            }),
          );
          const lines = Array.from({ length: 10 }, (_, idx) =>
            JSON.stringify({
              seq: idx + 1,
              agent: "coordinator",
              text: idx === 9 ? `${"x".repeat(7_998)}🚀tail` : `msg ${idx + 1} ${"y".repeat(40)}`,
              time: "2026-11-23 15:40:00",
            }),
          );
          yield* writeSwarmFile("board.jsonl", `${lines.join("\n")}\n`);

          // Message-count cap with full board in window.
          const countCapped = yield* readAntigravitySwarm({
            profileDirectory: profile,
            rootSessionId: ROOT,
            maxMessages: 3,
            nowMs: NOW,
          });
          expect(countCapped).not.toBeNull();
          expect(countCapped!.headSeq).toBe(10);
          expect(countCapped!.totalMessages).toBe(10);
          expect(countCapped!.messagesTruncated).toBe(true);
          expect(countCapped!.messages.map((message) => message.seq)).toEqual([8, 9, 10]);
          expect(countCapped!.messages[2]!.text.length).toBeLessThanOrEqual(8_000);
          expect(countCapped!.messages[2]!.text.endsWith("…")).toBe(true);
          expect(/[\uD800-\uDBFF]…$/u.test(countCapped!.messages[2]!.text)).toBe(false);
          expect(countCapped!.members[0]!.unreadCount).toBe(8);

          // Byte-capped board (tailStart > 0): falls back to headSeq - lastReadSeq for unreadCount.
          const smallLines = Array.from({ length: 10 }, (_, idx) =>
            JSON.stringify({
              seq: idx + 1,
              agent: "coordinator",
              text: `msg ${idx + 1} ${"z".repeat(50)}`,
              time: "2026-11-23 15:40:00",
            }),
          );
          yield* writeSwarmFile("board.jsonl", `${smallLines.join("\n")}\n`);
          const byteCapped = yield* readAntigravitySwarm({
            profileDirectory: profile,
            rootSessionId: ROOT,
            boardByteCap: 350,
            nowMs: NOW,
          });
          expect(byteCapped).not.toBeNull();
          expect(byteCapped!.messagesTruncated).toBe(true);
          expect(byteCapped!.messages.length).toBeGreaterThan(0);
          expect(byteCapped!.messages.length).toBeLessThan(10);
          expect(byteCapped!.headSeq).toBe(10);
          expect(byteCapped!.members[0]!.unreadCount).toBe(8);

          // Byte-capped board where the tail contains no newline (newline === -1 branch).
          yield* writeSwarmFile(
            "board.jsonl",
            JSON.stringify({
              seq: 1,
              agent: "coordinator",
              text: "a".repeat(600),
              time: "2026-11-23 15:40:00",
            }),
          );
          const undelimited = yield* readAntigravitySwarm({
            profileDirectory: profile,
            rootSessionId: ROOT,
            boardByteCap: 100,
            nowMs: NOW,
          });
          expect(undelimited).toMatchObject({
            messagesTruncated: true,
            messages: [],
            totalMessages: 0,
          });
        }),
    );

    it.effect("handles spanner backend cleanly without requiring local board files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-spanner-" });
        const { writeSwarmFile } = makeSwarmHelpers(profile);

        yield* writeSwarmFile(
          "swarm.json",
          JSON.stringify({
            version: 1,
            backend: "spanner",
            swarm_id: ROOT,
            db: "projects/p/instances/i/databases/d",
            created_at: "2026-11-23T21:00:00Z",
          }),
        );

        const snapshot = yield* readAntigravitySwarm({
          profileDirectory: profile,
          rootSessionId: ROOT,
        });
        expect(snapshot).toEqual({
          swarmId: ROOT,
          backend: "spanner",
          title: null,
          createdAt: "2026-11-23T21:00:00Z",
          headSeq: 0,
          totalMessages: 0,
          messagesTruncated: false,
          members: [],
          channels: [],
          messages: [],
          plan: null,
        });
      }),
    );

    it.effect("rejects invalid session ids and symlinked swarm or transcript files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-sym-" });
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-out-" });
        const { writeSwarmFile, writeTranscript } = makeSwarmHelpers(profile);

        expect(
          yield* readAntigravitySwarm({ profileDirectory: profile, rootSessionId: "../escape" }),
        ).toBeNull();

        // Symlinked swarm.json returns null.
        const outsideAnchor = path.join(outside, "swarm.json");
        yield* fs.writeFileString(
          outsideAnchor,
          JSON.stringify({ version: 1, backend: "local", swarm_id: ROOT }),
        );
        const anchorPath = yield* writeSwarmFile("swarm.json", "{}");
        yield* fs.remove(anchorPath);
        yield* fs.symlink(outsideAnchor, anchorPath);
        expect(
          yield* readAntigravitySwarm({ profileDirectory: profile, rootSessionId: ROOT }),
        ).toBeNull();

        // Restore real swarm.json and members.json, symlink worker transcript outside profile.
        yield* fs.remove(anchorPath);
        yield* writeSwarmFile(
          "swarm.json",
          JSON.stringify({ version: 1, backend: "local", swarm_id: ROOT }),
        );
        yield* writeSwarmFile(
          "members.json",
          JSON.stringify({
            title: "Symlink check",
            members: {
              worker: {
                conversation_id: WORKER_A,
                role: "worker",
                model: "gemini-4-neon",
                wake_mode: "mentions",
                last_read_seq: 0,
                killed: false,
              },
            },
          }),
        );
        const outsideTranscript = path.join(outside, "transcript.jsonl");
        yield* fs.writeFileString(
          outsideTranscript,
          `${JSON.stringify({ step_index: 1, type: "ERROR_MESSAGE", error: "leaked secret" })}\n`,
        );
        const workerTranscriptPath = yield* writeTranscript(WORKER_A, []);
        yield* fs.remove(workerTranscriptPath);
        yield* fs.symlink(outsideTranscript, workerTranscriptPath);

        const snapshot = yield* readAntigravitySwarm({
          profileDirectory: profile,
          rootSessionId: ROOT,
          nowMs: NOW,
        });
        expect(snapshot?.members[0]).toMatchObject({
          name: "worker",
          state: "waiting",
          statusDetail: null,
        });

        const transcript = yield* readAntigravitySwarmWorkerTranscript({
          profileDirectory: profile,
          rootSessionId: ROOT,
          workerName: "worker",
          nowMs: NOW,
        });
        expect(transcript).toEqual({
          workerName: "worker",
          model: "gemini-4-neon",
          state: "waiting",
          steps: null,
          truncated: false,
        });
      }),
    );

    it.effect("reads proven worker transcripts and ignores unknown or prototype worker names", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-swarm-tx-" });
        const { writeSwarmFile, writeTranscript } = makeSwarmHelpers(profile);

        yield* writeSwarmFile(
          "swarm.json",
          JSON.stringify({ version: 1, backend: "local", swarm_id: ROOT }),
        );
        yield* writeSwarmFile(
          "members.json",
          JSON.stringify({
            title: "Worker Transcript",
            members: {
              "server-impl": {
                conversation_id: WORKER_A,
                role: "worker",
                applied_model: "gemini-4-neon",
                wake_mode: "working",
                last_read_seq: 0,
                killed: false,
              },
            },
          }),
        );
        yield* writeTranscript(WORKER_A, [
          {
            step_index: 1,
            type: "PLANNER_RESPONSE",
            status: "DONE",
            tool_calls: [{ name: "read_file", args: { Path: '"/repo/a.ts"' } }],
          },
          { step_index: 2, type: "GENERIC", status: "DONE", content: "file contents" },
        ]);

        const found = yield* readAntigravitySwarmWorkerTranscript({
          profileDirectory: profile,
          rootSessionId: ROOT,
          workerName: "server-impl",
          nowMs: NOW,
        });
        expect(found).toMatchObject({
          workerName: "server-impl",
          model: "gemini-4-neon",
          state: "working",
          truncated: false,
        });
        expect(found.steps?.map((step) => step.text ?? step.toolCalls[0]?.name)).toEqual([
          "read_file",
          "file contents",
        ]);

        for (const badName of ["missing", "constructor", "__proto__"]) {
          expect(
            yield* readAntigravitySwarmWorkerTranscript({
              profileDirectory: profile,
              rootSessionId: ROOT,
              workerName: badName,
            }),
          ).toEqual({
            workerName: badName,
            model: null,
            state: null,
            steps: null,
            truncated: false,
          });
        }
      }),
    );
  },
);
