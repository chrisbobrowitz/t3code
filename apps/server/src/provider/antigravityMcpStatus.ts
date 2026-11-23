import type { ProviderMcpServerState, ProviderMcpServerStatus } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const MAX_MCP_CONFIG_BYTES = 1_000_000n;
const CONNECTED_DETAIL = "Configured in mcp_config.json. Antigravity does not report live status.";
const PENDING_DETAIL = "Configured in mcp_config.json. Loads when an Antigravity session starts.";

const AntigravityMcpConfigFile = Schema.Struct({
  mcpServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeMcpConfig = Schema.decodeUnknownEffect(fromLenientJson(AntigravityMcpConfigFile));

function isSafeCacheName(path: Path.Path, cacheRoot: string, name: string): boolean {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return false;
  }
  const root = path.resolve(cacheRoot);
  const candidate = path.resolve(root, name);
  return candidate.startsWith(`${root}${path.sep}`);
}

/** Reads `mcp_config.json` (JSONC) without exposing command, URL, header, or env fields. */
export const readAntigravityMcpStatus = Effect.fn("readAntigravityMcpStatus")(function* (input: {
  readonly profileDirectory: string;
  readonly userHome?: string;
}): Effect.fn.Return<
  ReadonlyArray<ProviderMcpServerStatus>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readConfigText = (filePath: string) =>
    fs.stat(filePath).pipe(
      Effect.flatMap((info) =>
        info.type === "File" && info.size <= MAX_MCP_CONFIG_BYTES
          ? fs.readFileString(filePath)
          : Effect.undefined,
      ),
      Effect.orElseSucceed((): string | undefined => undefined),
    );

  const profileConfigPath = path.join(input.profileDirectory, "config", "mcp_config.json");
  let raw = yield* readConfigText(profileConfigPath);
  // Before the first launch links ~/.gemini/config/mcp_config.json (or while agy holds a 0-byte
  // placeholder), fall back to the user config so Settings shows configured servers immediately.
  if ((raw === undefined || raw.length === 0) && input.userHome !== undefined) {
    raw = yield* readConfigText(path.join(input.userHome, ".gemini", "config", "mcp_config.json"));
  }
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }

  const parsed = yield* decodeMcpConfig(raw).pipe(Effect.orElseSucceed(() => undefined));
  const mcpServers = parsed?.mcpServers;
  if (mcpServers === undefined) {
    return [];
  }

  const cacheRoot = path.join(input.profileDirectory, "antigravity-acp", "mcp");
  const servers: Array<ProviderMcpServerStatus> = [];

  for (const [name, entry] of Object.entries(mcpServers)) {
    if (name.trim().length === 0 || !Predicate.isObject(entry) || Array.isArray(entry)) {
      continue;
    }
    const disabled = entry.disabled === true;
    let state: ProviderMcpServerState;
    let detail: string | undefined;
    if (disabled) {
      state = "disabled";
    } else {
      const hasToolCache = isSafeCacheName(path, cacheRoot, name)
        ? yield* fs.stat(path.join(cacheRoot, name)).pipe(
            Effect.map((info) => info.type === "Directory"),
            Effect.orElseSucceed(() => false),
          )
        : false;
      state = hasToolCache ? "connected" : "pending";
      detail = hasToolCache ? CONNECTED_DETAIL : PENDING_DETAIL;
    }
    servers.push({
      name,
      state,
      scope: "user",
      ...(detail === undefined ? {} : { detail }),
    });
  }

  return servers;
});
