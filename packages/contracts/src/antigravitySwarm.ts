import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationV2NativeChildStep } from "./orchestrationV2.ts";

export const ANTIGRAVITY_SWARM_WS_METHODS = {
  getSwarm: "orchestration.getAntigravitySwarm",
  getSwarmWorkerTranscript: "orchestration.getAntigravitySwarmWorkerTranscript",
} as const;

export const AntigravitySwarmBackend = Schema.Literals(["local", "spanner"]);
export type AntigravitySwarmBackend = typeof AntigravitySwarmBackend.Type;

export const AntigravitySwarmMemberState = Schema.Literals([
  "working",
  "waiting",
  "killed",
  "error",
  "quota",
  "stuck",
]);
export type AntigravitySwarmMemberState = typeof AntigravitySwarmMemberState.Type;

export const AntigravitySwarmMember = Schema.Struct({
  name: TrimmedNonEmptyString,
  role: Schema.String,
  state: AntigravitySwarmMemberState,
  model: Schema.NullOr(Schema.String),
  workspaceMode: Schema.NullOr(Schema.String),
  addedBy: Schema.NullOr(Schema.String),
  channels: Schema.Array(Schema.String),
  lastReadSeq: NonNegativeInt,
  lastPostSeq: Schema.NullOr(PositiveInt),
  lastPostTime: Schema.NullOr(Schema.String),
  unreadCount: NonNegativeInt,
  statusDetail: Schema.NullOr(Schema.String),
});
export type AntigravitySwarmMember = typeof AntigravitySwarmMember.Type;

export const AntigravitySwarmChannel = Schema.Struct({
  name: TrimmedNonEmptyString,
  topic: Schema.NullOr(Schema.String),
  createdBy: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
});
export type AntigravitySwarmChannel = typeof AntigravitySwarmChannel.Type;

export const AntigravitySwarmMessage = Schema.Struct({
  seq: PositiveInt,
  agent: Schema.String,
  text: Schema.String,
  time: Schema.String,
  kind: Schema.NullOr(Schema.String),
  channel: Schema.String,
  isControl: Schema.Boolean,
});
export type AntigravitySwarmMessage = typeof AntigravitySwarmMessage.Type;

export const AntigravitySwarmPlanThread = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  title: Schema.String,
  goal: Schema.NullOr(Schema.String),
  tasks: Schema.Array(Schema.String),
});
export type AntigravitySwarmPlanThread = typeof AntigravitySwarmPlanThread.Type;

export const AntigravitySwarmPlan = Schema.Struct({
  goalTitle: Schema.NullOr(Schema.String),
  goalLine: Schema.NullOr(Schema.String),
  tasks: Schema.Record(Schema.String, Schema.String),
  threads: Schema.Array(AntigravitySwarmPlanThread),
});
export type AntigravitySwarmPlan = typeof AntigravitySwarmPlan.Type;

export const AntigravitySwarmSnapshot = Schema.Struct({
  swarmId: TrimmedNonEmptyString,
  backend: AntigravitySwarmBackend,
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
  headSeq: NonNegativeInt,
  totalMessages: NonNegativeInt,
  messagesTruncated: Schema.Boolean,
  members: Schema.Array(AntigravitySwarmMember),
  channels: Schema.Array(AntigravitySwarmChannel),
  messages: Schema.Array(AntigravitySwarmMessage),
  plan: Schema.NullOr(AntigravitySwarmPlan),
});
export type AntigravitySwarmSnapshot = typeof AntigravitySwarmSnapshot.Type;

export const OrchestrationV2GetAntigravitySwarmInput = Schema.Struct({
  threadId: ThreadId,
  maxMessages: Schema.optional(PositiveInt),
});
export type OrchestrationV2GetAntigravitySwarmInput =
  typeof OrchestrationV2GetAntigravitySwarmInput.Type;

export const OrchestrationV2GetAntigravitySwarmResult = Schema.Struct({
  swarm: Schema.NullOr(AntigravitySwarmSnapshot),
});
export type OrchestrationV2GetAntigravitySwarmResult =
  typeof OrchestrationV2GetAntigravitySwarmResult.Type;

export class OrchestrationV2GetAntigravitySwarmError extends Schema.TaggedError<OrchestrationV2GetAntigravitySwarmError>()(
  "OrchestrationV2GetAntigravitySwarmError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Failed to read Antigravity swarm state.";
  }
}

export const OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput = Schema.Struct({
  threadId: ThreadId,
  workerName: TrimmedNonEmptyString,
});
export type OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput =
  typeof OrchestrationV2GetAntigravitySwarmWorkerTranscriptInput.Type;

export const OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult = Schema.Struct({
  workerName: Schema.String,
  model: Schema.NullOr(Schema.String),
  state: Schema.NullOr(AntigravitySwarmMemberState),
  steps: Schema.NullOr(Schema.Array(OrchestrationV2NativeChildStep)),
  truncated: Schema.Boolean,
});
export type OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult =
  typeof OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult.Type;

export class OrchestrationV2GetAntigravitySwarmWorkerTranscriptError extends Schema.TaggedError<OrchestrationV2GetAntigravitySwarmWorkerTranscriptError>()(
  "OrchestrationV2GetAntigravitySwarmWorkerTranscriptError",
  {
    threadId: ThreadId,
    workerName: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Failed to read Antigravity swarm worker transcript.";
  }
}
