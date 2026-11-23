import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { readAntigravityMcpStatus } from "./antigravityMcpStatus.ts";

it.layer(NodeServices.layer)("readAntigravityMcpStatus", (it) => {
  it.effect("returns empty when mcp_config.json is missing, empty, or invalid", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-mcp-empty-" });
      const profileDirectory = path.join(root, "profile");
      const configPath = path.join(profileDirectory, "config", "mcp_config.json");

      expect(yield* readAntigravityMcpStatus({ profileDirectory })).toEqual([]);

      yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
      for (const contents of ["", "   \n", "{not valid json", "{}", '{"mcpServers": []}']) {
        yield* fs.writeFileString(configPath, contents);
        expect(yield* readAntigravityMcpStatus({ profileDirectory })).toEqual([]);
      }
    }),
  );

  it.effect(
    "parses JSONC, maps connected/pending/disabled states, and never leaks server config fields",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-mcp-jsonc-" });
        const profileDirectory = path.join(root, "profile");
        const configPath = path.join(profileDirectory, "config", "mcp_config.json");
        yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });
        yield* fs.makeDirectory(
          path.join(profileDirectory, "antigravity-acp", "mcp", "viasat-slack-mcp"),
          { recursive: true },
        );
        yield* fs.writeFileString(
          configPath,
          `{
            // User MCP servers with comments and trailing commas.
            "mcpServers": {
              "viasat-slack-mcp": {
                "command": "npx",
                "args": ["-y", "mcp-remote", "https://slack.mcp.viasat.io/mcp"],
                "headers": { "Authorization": "Bearer secret-header-token" },
                "env": { "SLACK_API_TOKEN": "xoxb-secret-env" },
                "disabled": false,
              },
              /* Server before its first session load. */
              "github-mcp": {
                "url": "https://api.githubcopilot.com/mcp/",
              },
              "disabled-mcp": {
                "command": "/usr/local/bin/secret-tool",
                "disabled": true,
              },
              "..": {
                "command": "should-not-match-parent-dir",
              },
              "ignored-primitive": "not-an-object",
            },
          }`,
        );

        const servers = yield* readAntigravityMcpStatus({ profileDirectory });
        expect(servers).toEqual([
          {
            name: "viasat-slack-mcp",
            state: "connected",
            scope: "user",
            detail: "Configured in mcp_config.json. Antigravity does not report live status.",
          },
          {
            name: "github-mcp",
            state: "pending",
            scope: "user",
            detail: "Configured in mcp_config.json. Loads when an Antigravity session starts.",
          },
          {
            name: "disabled-mcp",
            state: "disabled",
            scope: "user",
          },
          {
            name: "..",
            state: "pending",
            scope: "user",
            detail: "Configured in mcp_config.json. Loads when an Antigravity session starts.",
          },
        ]);

        const serialized = JSON.stringify(servers);
        for (const secret of [
          "npx",
          "mcp-remote",
          "https://slack.mcp.viasat.io/mcp",
          "secret-header-token",
          "SLACK_API_TOKEN",
          "xoxb-secret-env",
          "https://api.githubcopilot.com/mcp/",
          "/usr/local/bin/secret-tool",
        ]) {
          expect(serialized).not.toContain(secret);
        }
      }),
  );

  it.effect(
    "falls back to ~/.gemini/config/mcp_config.json only when profile config is absent or 0 bytes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-mcp-fallback-" });
        const userHome = path.join(root, "home");
        const profileDirectory = path.join(root, "profile");
        const userConfig = path.join(userHome, ".gemini", "config", "mcp_config.json");
        const profileConfig = path.join(profileDirectory, "config", "mcp_config.json");

        yield* fs.makeDirectory(path.dirname(userConfig), { recursive: true });
        yield* fs.writeFileString(
          userConfig,
          JSON.stringify({ mcpServers: { "user-mcp": { command: "node" } } }),
        );

        expect(
          (yield* readAntigravityMcpStatus({ profileDirectory, userHome })).map((s) => ({
            name: s.name,
            state: s.state,
          })),
        ).toEqual([{ name: "user-mcp", state: "pending" }]);

        // CLI 1.5.8 writes a 0-byte placeholder before any server exists.
        yield* fs.makeDirectory(path.dirname(profileConfig), { recursive: true });
        yield* fs.writeFileString(profileConfig, "");
        expect(
          (yield* readAntigravityMcpStatus({ profileDirectory, userHome })).map((s) => s.name),
        ).toEqual(["user-mcp"]);

        // A non-empty profile-owned file overrides the user config.
        yield* fs.writeFileString(profileConfig, '{"mcpServers":{}}');
        expect(yield* readAntigravityMcpStatus({ profileDirectory, userHome })).toEqual([]);
      }),
  );
});
