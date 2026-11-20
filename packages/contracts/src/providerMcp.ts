import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderMcpServerState = Schema.Literals([
  "connected",
  "needsAuth",
  "failed",
  "disabled",
  "pending",
]);
export type ProviderMcpServerState = typeof ProviderMcpServerState.Type;

/** Never carries the server's config: it can hold headers and environment secrets. */
export const ProviderMcpServerStatus = Schema.Struct({
  name: Schema.String,
  state: ProviderMcpServerState,
  scope: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});
export type ProviderMcpServerStatus = typeof ProviderMcpServerStatus.Type;

export const ProviderMcpStatusInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderMcpStatusInput = typeof ProviderMcpStatusInput.Type;

export const ProviderMcpStatusResult = Schema.Union([
  Schema.Struct({
    supported: Schema.Literal(true),
    servers: Schema.Array(ProviderMcpServerStatus),
  }),
  Schema.Struct({ supported: Schema.Literal(false) }),
]);
export type ProviderMcpStatusResult = typeof ProviderMcpStatusResult.Type;
