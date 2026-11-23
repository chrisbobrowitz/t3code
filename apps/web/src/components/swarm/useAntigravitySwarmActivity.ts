import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type {
  AntigravitySwarmSnapshot,
  EnvironmentId,
  OrchestrationV2GetAntigravitySwarmResult,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { isSwarmActive, swarmTurnActivitySignature } from "./swarmPresentation.logic";

/**
 * Tracks Antigravity swarm state without idle polling: reads once on Antigravity
 * threads, refreshes on swarm timeline activity or turn transitions, and mounts
 * the 2.5s poller only while working members > 0.
 */
export function useAntigravitySwarmActivity(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly turnItems: ThreadStructure["turnItems"];
  readonly isWorking: boolean;
}): AntigravitySwarmSnapshot | null {
  const { enabled, environmentId, threadId, turnItems, isWorking } = input;
  const queryTarget =
    enabled && threadId !== null
      ? {
          environmentId,
          input: { threadId },
        }
      : null;

  const baseQuery = useEnvironmentQuery<OrchestrationV2GetAntigravitySwarmResult, unknown>(
    queryTarget === null ? null : orchestrationEnvironment.antigravitySwarm(queryTarget),
  );
  const baseSwarm = baseQuery.data?.swarm ?? null;
  const baseSwarmActive = isSwarmActive(baseSwarm);

  const liveQuery = useEnvironmentQuery<OrchestrationV2GetAntigravitySwarmResult, unknown>(
    queryTarget !== null && baseSwarmActive
      ? orchestrationEnvironment.antigravitySwarmLive(queryTarget)
      : null,
  );
  const liveSwarm = liveQuery.data?.swarm ?? null;

  const activitySignature = enabled ? swarmTurnActivitySignature(turnItems) : null;
  const previousSignatureRef = useRef<string | null>(activitySignature);
  const previousWorkingRef = useRef<boolean>(isWorking);
  const previousThreadKeyRef = useRef<string | null>(
    queryTarget ? `${environmentId}:${threadId}` : null,
  );
  const refreshBase = baseQuery.refresh;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the non-polling swarm query only when swarm timeline activity changes or an Antigravity turn transitions
  useEffect(() => {
    const threadKey = queryTarget ? `${environmentId}:${threadId}` : null;
    if (threadKey !== previousThreadKeyRef.current) {
      previousThreadKeyRef.current = threadKey;
      previousSignatureRef.current = activitySignature;
      previousWorkingRef.current = isWorking;
      return;
    }
    const signatureChanged = activitySignature !== previousSignatureRef.current;
    const workingChanged = isWorking !== previousWorkingRef.current;
    previousSignatureRef.current = activitySignature;
    previousWorkingRef.current = isWorking;

    if (queryTarget === null) return;
    if ((signatureChanged && activitySignature !== null) || workingChanged) {
      refreshBase();
    }
  }, [activitySignature, environmentId, isWorking, queryTarget, refreshBase, threadId]);

  // When live polling observes all workers settled, refresh the base query once so live polling unmounts.
  const liveSettled = baseSwarmActive && liveQuery.isSuccess && !isSwarmActive(liveSwarm);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs the settled snapshot back to the non-polling base query so the 2.5s live poller unmounts immediately
  useEffect(() => {
    if (liveSettled) {
      refreshBase();
    }
  }, [liveSettled, refreshBase]);

  return baseSwarmActive ? (liveSwarm ?? baseSwarm) : baseSwarm;
}
