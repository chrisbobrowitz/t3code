import {
  OrchestrationV2GetAntigravitySwarmError,
  type OrchestrationV2GetAntigravitySwarmInput,
  type OrchestrationV2GetAntigravitySwarmResult,
  OrchestrationV2GetAntigravitySwarmWorkerTranscriptError,
  type OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput,
  type OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  readAntigravitySwarm,
  readAntigravitySwarmWorkerTranscript,
} from "../provider/acp/AntigravitySwarm.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** Reads native Antigravity swarm state and worker transcripts for a thread on demand. */
export class AntigravitySwarmQuery extends Context.Service<
  AntigravitySwarmQuery,
  {
    readonly getAntigravitySwarm: (
      input: OrchestrationV2GetAntigravitySwarmInput,
    ) => Effect.Effect<
      OrchestrationV2GetAntigravitySwarmResult,
      OrchestrationV2GetAntigravitySwarmError
    >;
    readonly getAntigravitySwarmWorkerTranscript: (
      input: OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput,
    ) => Effect.Effect<
      OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
      OrchestrationV2GetAntigravitySwarmWorkerTranscriptError
    >;
  }
>()("t3/orchestration-v2/AntigravitySwarmQuery") {}

const NO_SWARM: OrchestrationV2GetAntigravitySwarmResult = { swarm: null };

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const digest = yield* Digest.Digest;
  const path = yield* Path.Path;

  // Shares the enclosing query method's span rather than creating a redundant child span.
  const resolveLatestAntigravitySession = Effect.fnUntraced(function* (threadId: ThreadId) {
    const { runs, attempts, providerThreads } = yield* threads.getThreadRecords(threadId, [
      "runs",
      "attempts",
      "providerThreads",
    ]);
    const antigravityProviderThreads = providerThreads.filter(
      (providerThread) => providerThread.driver === "antigravity",
    );
    if (antigravityProviderThreads.length === 0) return null;

    const providerThreadById = new Map(
      antigravityProviderThreads.map((providerThread) => [providerThread.id, providerThread]),
    );
    const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
    const attemptsByRunId = new Map<string, Array<(typeof attempts)[number]>>();
    for (const attempt of attempts) {
      const list = attemptsByRunId.get(attempt.runId);
      if (list === undefined) {
        attemptsByRunId.set(attempt.runId, [attempt]);
      } else {
        list.push(attempt);
      }
    }

    const runsDescending = [...runs].toSorted((left, right) => right.ordinal - left.ordinal);
    for (const run of runsDescending) {
      const providerThread =
        run.providerThreadId === null ? undefined : providerThreadById.get(run.providerThreadId);
      const runAttempts = (attemptsByRunId.get(run.id) ?? []).toSorted(
        (left, right) => right.attemptOrdinal - left.attemptOrdinal,
      );
      const activeAttempt =
        run.activeAttemptId === null ? undefined : attemptById.get(run.activeAttemptId);
      const matchedAttempt =
        activeAttempt !== undefined && providerThreadById.has(activeAttempt.providerThreadId)
          ? activeAttempt
          : runAttempts.find((attempt) => providerThreadById.has(attempt.providerThreadId));
      const matchedProviderThread =
        providerThread ??
        (matchedAttempt === undefined
          ? undefined
          : providerThreadById.get(matchedAttempt.providerThreadId));
      if (matchedProviderThread === undefined) continue;

      const rootSessionId =
        matchedAttempt?.nativeThreadId?.trim() ||
        runAttempts
          .find(
            (attempt) =>
              providerThreadById.has(attempt.providerThreadId) &&
              Boolean(attempt.nativeThreadId?.trim()),
          )
          ?.nativeThreadId?.trim() ||
        matchedProviderThread.nativeThreadRef?.nativeId?.trim();
      if (rootSessionId) {
        return {
          providerInstanceId: matchedProviderThread.providerInstanceId,
          rootSessionId,
        };
      }
    }

    const providerThreadsDescending = [...antigravityProviderThreads].toSorted(
      (left, right) =>
        (right.lastRunOrdinal ?? right.firstRunOrdinal ?? 0) -
        (left.lastRunOrdinal ?? left.firstRunOrdinal ?? 0),
    );
    for (const providerThread of providerThreadsDescending) {
      const rootSessionId = providerThread.nativeThreadRef?.nativeId?.trim();
      if (rootSessionId) {
        return {
          providerInstanceId: providerThread.providerInstanceId,
          rootSessionId,
        };
      }
    }

    return null;
  });

  const getAntigravitySwarm = Effect.fn("AntigravitySwarmQuery.getAntigravitySwarm")(
    function* (input: OrchestrationV2GetAntigravitySwarmInput) {
      const session = yield* resolveLatestAntigravitySession(input.threadId);
      if (session === null) return NO_SWARM;
      const directories = yield* resolveAntigravityInstanceDirectories(
        stateDir,
        session.providerInstanceId,
      ).pipe(Effect.provideService(Digest.Digest, digest), Effect.provideService(Path.Path, path));
      const swarm = yield* readAntigravitySwarm({
        profileDirectory: directories.profile,
        rootSessionId: session.rootSessionId,
        ...(input.maxMessages === undefined ? {} : { maxMessages: input.maxMessages }),
      });
      return { swarm };
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetAntigravitySwarmError({ threadId: input.threadId, cause }),
        ),
      ),
  );

  const getAntigravitySwarmWorkerTranscript = Effect.fn(
    "AntigravitySwarmQuery.getAntigravitySwarmWorkerTranscript",
  )(
    function* (input: OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput) {
      const session = yield* resolveLatestAntigravitySession(input.threadId);
      if (session === null) {
        return {
          workerName: input.workerName,
          model: null,
          state: null,
          steps: null,
          truncated: false,
        };
      }
      const directories = yield* resolveAntigravityInstanceDirectories(
        stateDir,
        session.providerInstanceId,
      ).pipe(Effect.provideService(Digest.Digest, digest), Effect.provideService(Path.Path, path));
      return yield* readAntigravitySwarmWorkerTranscript({
        profileDirectory: directories.profile,
        rootSessionId: session.rootSessionId,
        workerName: input.workerName,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetAntigravitySwarmWorkerTranscriptError({
              threadId: input.threadId,
              workerName: input.workerName,
              cause,
            }),
        ),
      ),
  );

  return AntigravitySwarmQuery.of({
    getAntigravitySwarm,
    getAntigravitySwarmWorkerTranscript,
  });
});

export const layer = Layer.effect(AntigravitySwarmQuery, make);
