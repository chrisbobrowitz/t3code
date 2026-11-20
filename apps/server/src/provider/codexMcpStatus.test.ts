import { describe, expect, it } from "vite-plus/test";

import { toCodexProviderMcpServerStatus } from "./codexMcpStatus.ts";

describe("toCodexProviderMcpServerStatus", () => {
  // Fails if a server that needs sign-in or failed discovery shows as connected without a thread.
  it.each([
    [{ name: "a", authStatus: "oAuth", runtimeStatus: null }, "connected"],
    [{ name: "a", authStatus: "notLoggedIn", runtimeStatus: null }, "needsAuth"],
    [{ name: "a", authStatus: "unsupported", toolsError: "spawn ENOENT" }, "failed"],
    [{ name: "a", authStatus: "oAuth", runtimeStatus: "authenticationRequired" }, "needsAuth"],
    [{ name: "a", authStatus: "unsupported", runtimeStatus: "disabled" }, "disabled"],
    [{ name: "a", authStatus: "unsupported", runtimeStatus: "starting" }, "pending"],
  ] as const)("%o is %s", (server, state) => {
    expect(toCodexProviderMcpServerStatus(server).state).toBe(state);
  });

  it("keeps the discovery error as detail and the plugin as scope", () => {
    expect(
      toCodexProviderMcpServerStatus({
        name: "jira",
        authStatus: "unsupported",
        toolsError: "spawn ENOENT",
        pluginId: "atlassian",
      }),
    ).toEqual({ name: "jira", state: "failed", scope: "atlassian", detail: "spawn ENOENT" });
  });
});
