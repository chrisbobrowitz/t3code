import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import { toProviderMcpServerStatuses } from "./mcpStatus.ts";

describe("toProviderMcpServerStatuses", () => {
  // Fails if T3's own per-thread servers leak into the list, or a registration need reads as failed.
  it("drops t3-code servers and maps OpenCode 1.x and 2.x states", () => {
    NodeAssert.deepEqual(
      toProviderMcpServerStatuses([
        ["t3-code", { status: "connected" }],
        ["t3-code-thread-1", { status: "connected" }],
        ["jira", { status: "connected" }],
        ["vice", { status: "needs_auth", error: "Sign in required" }],
        ["slack", { status: "needs_client_registration", error: "Register a client" }],
        ["bigquery", { status: "disabled" }],
        ["drawio", { status: "failed", error: "timeout" }],
        ["new", { status: "pending" }],
      ]),
      [
        { name: "jira", state: "connected" },
        { name: "vice", state: "needsAuth", detail: "Sign in required" },
        { name: "slack", state: "needsAuth", detail: "Register a client" },
        { name: "bigquery", state: "disabled" },
        { name: "drawio", state: "failed", detail: "timeout" },
        { name: "new", state: "pending" },
      ],
    );
  });
});
