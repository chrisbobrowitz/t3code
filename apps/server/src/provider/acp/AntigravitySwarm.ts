// @effect-diagnostics nodeBuiltinImport:off -- O_NOFOLLOW reads prevent symlink swaps on swarm files.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import type {
  AntigravitySwarmChannel,
  AntigravitySwarmMember,
  AntigravitySwarmMemberState,
  AntigravitySwarmMessage,
  AntigravitySwarmPlan,
  AntigravitySwarmSnapshot,
  OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import {
  type AntigravityTranscriptLine,
  decodeAntigravityTranscriptLine,
  parseAntigravityTranscriptSteps,
  readAntigravityTranscriptTail,
} from "./AntigravityChildWork.ts";
import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_BOARD_BYTES = 4 * 1024 * 1024;
const MAX_BOARD_CACHE_ENTRIES = 16;
const ROSTER_RETRY_DELAY_MS = 25;
const DEFAULT_MAX_MESSAGES = 200;
const HARD_MAX_MESSAGES = 500;
const MAX_MESSAGE_TEXT_CHARS = 8_000;
const MEMBER_STATE_TRANSCRIPT_TAIL_BYTES = 32 * 1024;
const WORKER_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const STATUS_DETAIL_CAP = 240;
const ERROR_STATUS_STALE_MS = 60_000;
const STUCK_IDLE_MS = 10 * 60_000;
const QUOTA_ERROR_PATTERN = /RESOURCE_EXHAUSTED|quota|\b429\b|exhausted your capacity|rate.?limit/i;
const ALL_CHANNEL_ROLES = new Set(["coordinator", "narrator", "monitor"]);
const CHANNEL_MENTION_PATTERN = /(?:^|[^\w-])@#([A-Za-z0-9_-]+)/g;
const MEMBER_MENTION_PATTERN = /(?:^|[^\w-])@([A-Za-z0-9_-]+)/g;

const SwarmAnchor = Schema.Struct({
  version: Schema.optional(Schema.Number),
  backend: Schema.Literals(["local", "spanner"]),
  swarm_id: Schema.String,
  db: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeSwarmAnchor = Schema.decodeUnknownOption(Schema.fromJsonString(SwarmAnchor));

const RawSwarmMember = Schema.Struct({
  conversation_id: Schema.optional(Schema.NullOr(Schema.String)),
  role: Schema.optional(Schema.NullOr(Schema.String)),
  added_by: Schema.optional(Schema.NullOr(Schema.String)),
  desired_state: Schema.optional(Schema.NullOr(Schema.String)),
  phase: Schema.optional(Schema.NullOr(Schema.String)),
  desired_model: Schema.optional(Schema.NullOr(Schema.String)),
  applied_model: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  workspace_mode: Schema.optional(Schema.NullOr(Schema.String)),
  workspace: Schema.optional(Schema.NullOr(Schema.String)),
  channels: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  wake_mode: Schema.optional(Schema.NullOr(Schema.String)),
  wait_since: Schema.optional(Schema.NullOr(Schema.Number)),
  last_read_seq: Schema.optional(Schema.NullOr(Schema.Number)),
  last_nudged_seq: Schema.optional(Schema.NullOr(Schema.Number)),
  last_park_blocked_seq: Schema.optional(Schema.NullOr(Schema.Number)),
  killed: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
type RawSwarmMember = Schema.Schema.Type<typeof RawSwarmMember>;
const decodeRawSwarmMember = Schema.decodeUnknownOption(RawSwarmMember);

const RawSwarmChannel = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
  created_by: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
type RawSwarmChannel = Schema.Schema.Type<typeof RawSwarmChannel>;
const decodeRawSwarmChannel = Schema.decodeUnknownOption(RawSwarmChannel);

const RawBoardMessage = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  agent: Schema.String,
  text: Schema.optional(Schema.NullOr(Schema.String)),
  time: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.NullOr(Schema.String)),
  request_id: Schema.optional(Schema.NullOr(Schema.String)),
  channel: Schema.optional(Schema.NullOr(Schema.String)),
  control: Schema.optional(Schema.NullOr(Schema.Unknown)),
});
const decodeBoardMessage = Schema.decodeUnknownOption(Schema.fromJsonString(RawBoardMessage));

const RawSwarmPlan = Schema.Struct({
  goal: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        title: Schema.optional(Schema.NullOr(Schema.String)),
        line: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  tasks: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  threads: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.NullOr(Schema.String)),
          title: Schema.optional(Schema.NullOr(Schema.String)),
          goal: Schema.optional(Schema.NullOr(Schema.String)),
          tasks: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
        }),
      ),
    ),
  ),
});
const decodeSwarmPlan = Schema.decodeUnknownOption(Schema.fromJsonString(RawSwarmPlan));

interface ParsedSwarmRoster {
  readonly title: string | null;
  readonly members: Readonly<Record<string, RawSwarmMember>>;
  readonly channels: Readonly<Record<string, RawSwarmChannel>>;
}

interface ParsedBoardState {
  readonly mtimeMs: number;
  readonly size: number;
  readonly byteCap: number;
  readonly headSeq: number;
  readonly truncated: boolean;
  readonly messages: ReadonlyArray<AntigravitySwarmMessage>;
  readonly lastPostByAgent: ReadonlyMap<string, { readonly seq: number; readonly time: string }>;
}

const boardParseCache = new Map<string, ParsedBoardState>();

export interface AntigravitySwarmMemberStateInput {
  readonly killed?: boolean | null | undefined;
  readonly desiredState?: string | null | undefined;
  readonly phase?: string | null | undefined;
  readonly wakeMode?: string | null | undefined;
  readonly transcriptLines?: ReadonlyArray<AntigravityTranscriptLine> | undefined;
  readonly hasTrailingIncompleteLine?: boolean | undefined;
  readonly transcriptMtimeMs?: number | undefined;
  readonly nowMs: number;
}

export interface DerivedAntigravitySwarmMemberState {
  readonly state: AntigravitySwarmMemberState;
  readonly statusDetail: string | null;
}

function capBounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "");
  return `${prefix}…`;
}

function formatStatusDetail(raw: string | undefined): string | null {
  const normalized = raw?.replace(/\s+/g, " ").trim();
  return normalized ? capBounded(normalized, STATUS_DETAIL_CAP) : null;
}

function wakeModeFallbackState(wakeMode: string | null | undefined): AntigravitySwarmMemberState {
  return wakeMode === "mentions" || wakeMode === "anything" ? "waiting" : "working";
}

/**
 * Derives a swarm member's live state from roster flags and its recent transcript steps,
 * matching agy's swarm_board status rules without trusting wake_mode when a planner step exists.
 */
export function deriveAntigravitySwarmMemberState(
  input: AntigravitySwarmMemberStateInput,
): DerivedAntigravitySwarmMemberState {
  if (input.killed === true || input.desiredState === "KILLED" || input.phase === "KILLED") {
    return { state: "killed", statusDetail: null };
  }

  const idleMs =
    input.transcriptMtimeMs !== undefined ? Math.max(0, input.nowMs - input.transcriptMtimeMs) : 0;

  if (input.hasTrailingIncompleteLine === true) {
    return {
      state: input.transcriptMtimeMs !== undefined && idleMs >= STUCK_IDLE_MS ? "stuck" : "working",
      statusDetail: null,
    };
  }

  const lines = input.transcriptLines;
  if (lines === undefined || lines.length === 0) {
    return {
      state: wakeModeFallbackState(input.wakeMode),
      statusDetail: null,
    };
  }

  const newest = lines[lines.length - 1]!;

  const isImmediateError = newest.type === "ERROR_MESSAGE";
  const isStaleErrorStatus =
    newest.status === "ERROR" &&
    input.transcriptMtimeMs !== undefined &&
    idleMs >= ERROR_STATUS_STALE_MS;
  if (isImmediateError || isStaleErrorStatus) {
    // Only ERROR_MESSAGE carries user-facing text in content; tool steps put command output there.
    const rawDetail =
      newest.type === "ERROR_MESSAGE" ? (newest.error ?? newest.content) : newest.error;
    const isQuota = rawDetail !== undefined && QUOTA_ERROR_PATTERN.test(rawDetail);
    return {
      state: isQuota ? "quota" : "error",
      statusDetail: formatStatusDetail(rawDetail),
    };
  }

  if (
    newest.type === "PLANNER_RESPONSE" &&
    (newest.tool_calls === undefined || newest.tool_calls.length === 0)
  ) {
    return { state: "waiting", statusDetail: null };
  }

  let lastPlannerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.type === "PLANNER_RESPONSE") {
      lastPlannerIdx = i;
      break;
    }
  }
  if (lastPlannerIdx === -1) {
    if (wakeModeFallbackState(input.wakeMode) === "waiting") {
      return { state: "waiting", statusDetail: null };
    }
  } else {
    const planner = lines[lastPlannerIdx]!;
    const afterPlanner = lines.slice(lastPlannerIdx + 1);
    const toolCalls = planner.tool_calls ?? [];
    if (
      afterPlanner.every((step) => step.type === "GENERIC") &&
      afterPlanner.length >= toolCalls.length
    ) {
      const waitCallIdx = toolCalls.findIndex((call) => call.name === "swarm_wait");
      if (waitCallIdx >= 0) {
        const waitStep =
          afterPlanner.find((step) => step.step_index === planner.step_index + 1 + waitCallIdx) ??
          afterPlanner[waitCallIdx];
        if (waitStep?.status === "DONE") {
          return { state: "waiting", statusDetail: null };
        }
      }
    }
  }

  if (input.transcriptMtimeMs !== undefined && idleMs >= STUCK_IDLE_MS) {
    return { state: "stuck", statusDetail: null };
  }

  return { state: "working", statusDetail: null };
}

function parseTranscriptTailLines(contents: string): {
  readonly lines: ReadonlyArray<AntigravityTranscriptLine>;
  readonly hasTrailingIncompleteLine: boolean;
} {
  const rawLines = contents.split("\n");
  let lastNonEmptyIndex = -1;
  for (let i = rawLines.length - 1; i >= 0; i -= 1) {
    if (rawLines[i]!.trim() !== "") {
      lastNonEmptyIndex = i;
      break;
    }
  }
  const lines: Array<AntigravityTranscriptLine> = [];
  let hasTrailingIncompleteLine = false;
  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i]!;
    if (!rawLine.trim()) continue;
    const decoded = decodeAntigravityTranscriptLine(rawLine);
    if (Option.isSome(decoded)) {
      lines.push(decoded.value);
    } else if (i === lastNonEmptyIndex) {
      hasTrailingIncompleteLine = true;
    }
  }
  return { lines, hasTrailingIncompleteLine };
}

function parseRosterJson(raw: string): ParsedSwarmRoster | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Predicate.isObject(parsed)) return undefined;

  const title =
    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null;
  const members: Record<string, RawSwarmMember> = {};
  if (Predicate.isObject(parsed.members)) {
    for (const [name, entry] of Object.entries(parsed.members)) {
      const decoded = decodeRawSwarmMember(entry);
      if (Option.isSome(decoded)) {
        members[name] = decoded.value;
      }
    }
  }
  const channels: Record<string, RawSwarmChannel> = {};
  if (Predicate.isObject(parsed.channels)) {
    for (const [name, entry] of Object.entries(parsed.channels)) {
      const decoded = decodeRawSwarmChannel(entry);
      if (Option.isSome(decoded)) {
        channels[name] = decoded.value;
      }
    }
  }
  return { title, members, channels };
}

async function readManagedFile(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  maxBytes: number,
): Promise<string | undefined> {
  const entry = await antigravityManagedPath(profileRoot, segments, "file");
  if (entry === undefined || entry.info.size > maxBytes) return undefined;
  const handle = await NodeFSP.open(
    entry.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Reads and decodes members.json once. Returns undefined when absent or symlink-rejected;
 * throws a retryable error when the file exists on disk but fails JSON parse (torn mid-write).
 */
async function readManagedRosterOnce(
  profileRoot: string,
  rootSessionId: string,
): Promise<ParsedSwarmRoster | undefined> {
  const segments = swarmSegments(rootSessionId, "members.json");
  const raw = await readManagedFile(profileRoot, segments, MAX_JSON_BYTES);
  if (raw === undefined) return undefined;
  const parsed = parseRosterJson(raw);
  if (parsed === undefined) {
    throw new Error("Swarm members.json could not be parsed.");
  }
  return parsed;
}

const readManagedRoster = Effect.fnUntraced(function* (profileRoot: string, rootSessionId: string) {
  const attempt = Effect.tryPromise({
    try: () => readManagedRosterOnce(profileRoot, rootSessionId),
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
  return yield* attempt.pipe(
    Effect.catch(() =>
      Effect.sleep(`${ROSTER_RETRY_DELAY_MS} millis`).pipe(Effect.andThen(attempt)),
    ),
  );
});

function cacheBoardParse(path: string, parsed: ParsedBoardState): ParsedBoardState {
  boardParseCache.delete(path);
  if (boardParseCache.size >= MAX_BOARD_CACHE_ENTRIES) {
    const oldestKey = boardParseCache.keys().next().value;
    if (oldestKey !== undefined) {
      boardParseCache.delete(oldestKey);
    }
  }
  boardParseCache.set(path, parsed);
  return parsed;
}

async function readManagedBoard(
  profileRoot: string,
  rootSessionId: string,
  byteCap: number,
): Promise<ParsedBoardState | undefined> {
  const entry = await antigravityManagedPath(
    profileRoot,
    swarmSegments(rootSessionId, "board.jsonl"),
    "file",
  );
  if (entry === undefined) return undefined;
  const handle = await NodeFSP.open(
    entry.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    const cached = boardParseCache.get(entry.path);
    if (
      cached !== undefined &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.byteCap === byteCap
    ) {
      return cacheBoardParse(entry.path, cached);
    }

    const tailStart = Math.max(0, stat.size - byteCap);
    const readStart = Math.max(0, tailStart - 1);
    const buffer = Buffer.alloc(stat.size - readStart);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, readStart);
    const bytes = buffer.subarray(0, bytesRead);
    let contents = "";
    if (tailStart > 0) {
      const newline = bytes.indexOf(0x0a);
      if (newline !== -1) {
        contents = bytes.toString("utf8", newline + 1);
      }
    } else {
      contents = bytes.toString("utf8", 0);
    }

    const messages: Array<AntigravitySwarmMessage> = [];
    const lastPostByAgent = new Map<string, { readonly seq: number; readonly time: string }>();
    let headSeq = 0;
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      const decoded = decodeBoardMessage(line);
      if (Option.isNone(decoded)) continue;
      const message = decoded.value;
      if (message.seq > headSeq) headSeq = message.seq;
      const normalized: AntigravitySwarmMessage = {
        seq: message.seq,
        agent: message.agent,
        text: capBounded(message.text ?? "", MAX_MESSAGE_TEXT_CHARS),
        time: message.time ?? "",
        kind: message.kind?.trim() || null,
        channel: message.channel?.trim() || "main",
        isControl: message.control !== undefined && message.control !== null,
      };
      messages.push(normalized);
      const previous = lastPostByAgent.get(normalized.agent);
      if (previous === undefined || normalized.seq >= previous.seq) {
        lastPostByAgent.set(normalized.agent, { seq: normalized.seq, time: normalized.time });
      }
    }

    return cacheBoardParse(entry.path, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      byteCap,
      headSeq,
      truncated: tailStart > 0,
      messages,
      lastPostByAgent,
    });
  } finally {
    await handle.close();
  }
}

function swarmSegments(rootSessionId: string, fileName: string): ReadonlyArray<string> {
  return ["antigravity-acp", "brain", rootSessionId, ".system_generated", "swarm", fileName];
}

function resolveMemberModel(raw: RawSwarmMember): string | null {
  return raw.applied_model?.trim() || raw.desired_model?.trim() || raw.model?.trim() || null;
}

function isAllChannelDefaultMember(name: string, role: string): boolean {
  return (
    ALL_CHANNEL_ROLES.has(role) ||
    name === "narrator" ||
    name === "monitor" ||
    name.startsWith("monitor-")
  );
}

function resolveMemberChannels(
  raw: RawSwarmMember,
  name: string,
  role: string,
): ReadonlyArray<string> {
  if (raw.channels !== undefined && raw.channels !== null) {
    return raw.channels;
  }
  return isAllChannelDefaultMember(name, role) ? ["*"] : ["main"];
}

function messageMentionsMember(
  text: string,
  memberName: string,
  groupPrefix: string | undefined,
  visibleChannels: ReadonlySet<string>,
): boolean {
  CHANNEL_MENTION_PATTERN.lastIndex = 0;
  for (
    let match = CHANNEL_MENTION_PATTERN.exec(text);
    match !== null;
    match = CHANNEL_MENTION_PATTERN.exec(text)
  ) {
    const channel = match[1];
    if (channel !== undefined && visibleChannels.has(channel)) {
      return true;
    }
  }
  MEMBER_MENTION_PATTERN.lastIndex = 0;
  for (
    let match = MEMBER_MENTION_PATTERN.exec(text);
    match !== null;
    match = MEMBER_MENTION_PATTERN.exec(text)
  ) {
    const target = match[1];
    if (
      target === "all" ||
      target === memberName ||
      (groupPrefix !== undefined && target === groupPrefix)
    ) {
      return true;
    }
  }
  return false;
}

function memberSortRank(member: AntigravitySwarmMember): number {
  if (member.role === "coordinator" || member.name === "coordinator") return 0;
  switch (member.state) {
    case "working":
    case "error":
    case "quota":
    case "stuck":
      return 1;
    case "waiting":
      return 2;
    case "killed":
      return 3;
  }
}

function parsePlan(raw: string | undefined): AntigravitySwarmPlan | null {
  if (raw === undefined) return null;
  const decoded = decodeSwarmPlan(raw);
  if (Option.isNone(decoded)) return null;
  const plan = decoded.value;
  return {
    goalTitle: plan.goal?.title?.trim() || null,
    goalLine: plan.goal?.line?.trim() || null,
    tasks: plan.tasks ?? {},
    threads: (plan.threads ?? []).map((thread) => ({
      id: thread.id?.trim() || null,
      title: thread.title ?? "",
      goal: thread.goal?.trim() || null,
      tasks: thread.tasks ?? [],
    })),
  };
}

class AntigravitySwarmReadError extends Schema.TaggedError<AntigravitySwarmReadError>()(
  "AntigravitySwarmReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read Antigravity swarm records.";
  }
}

/** Reads an Antigravity session's native swarm snapshot from its symlink-validated profile directory. */
export const readAntigravitySwarm = Effect.fn("readAntigravitySwarm")(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly maxMessages?: number | undefined;
  readonly boardByteCap?: number | undefined;
  readonly nowMs?: number | undefined;
}) {
  if (!NATIVE_ID.test(input.rootSessionId)) return null;
  const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
  const anchorContext = yield* Effect.tryPromise({
    try: async () => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      if (profileRoot === undefined) return null;

      const rawAnchor = await readManagedFile(
        profileRoot,
        swarmSegments(input.rootSessionId, "swarm.json"),
        MAX_JSON_BYTES,
      );
      if (rawAnchor === undefined) return null;
      const decodedAnchor = decodeSwarmAnchor(rawAnchor);
      if (Option.isNone(decodedAnchor)) return null;

      const anchor = decodedAnchor.value;
      const swarmId = anchor.swarm_id.trim();
      if (!swarmId) return null;
      const createdAt = anchor.created_at?.trim() || null;
      return { profileRoot, backend: anchor.backend, swarmId, createdAt };
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
  if (anchorContext === null) return null;

  const { profileRoot, backend, swarmId, createdAt } = anchorContext;
  if (backend === "spanner") {
    return {
      swarmId,
      backend: "spanner",
      title: null,
      createdAt,
      headSeq: 0,
      totalMessages: 0,
      messagesTruncated: false,
      members: [],
      channels: [],
      messages: [],
      plan: null,
    } satisfies AntigravitySwarmSnapshot;
  }

  const roster = yield* readManagedRoster(profileRoot, input.rootSessionId);
  const boardByteCap = Math.max(1, Math.floor(input.boardByteCap ?? MAX_BOARD_BYTES));

  return yield* Effect.tryPromise({
    try: async (): Promise<AntigravitySwarmSnapshot> => {
      const [board, rawPlan] = await Promise.all([
        readManagedBoard(profileRoot, input.rootSessionId, boardByteCap),
        readManagedFile(
          profileRoot,
          swarmSegments(input.rootSessionId, "plan.json"),
          MAX_JSON_BYTES,
        ),
      ]);

      const title = roster?.title ?? null;
      const parsedMessages = board?.messages ?? [];
      const headSeq = board?.headSeq ?? 0;
      const boardTruncated = board?.truncated === true;
      const lastPostByAgent = board?.lastPostByAgent ?? new Map();

      const memberEntries = Object.entries(roster?.members ?? {}).filter(([name]) =>
        Boolean(name.trim()),
      );
      const members = await Promise.all(
        memberEntries.map(async ([rawName, raw]): Promise<AntigravitySwarmMember> => {
          const name = rawName.trim();
          const role = raw.role?.trim() || "worker";
          const channels = resolveMemberChannels(raw, name, role);
          const seesAll = channels.includes("*");
          const visibleChannels = new Set(channels);
          const groupPrefix = /^(.+)-\d+$/.exec(name)?.[1];
          const lastReadSeq = Math.max(0, Math.floor(raw.last_read_seq ?? 0));
          let unreadCount = 0;
          if (boardTruncated) {
            unreadCount = Math.max(0, headSeq - lastReadSeq);
          } else {
            for (const message of parsedMessages) {
              if (message.isControl || message.seq <= lastReadSeq) continue;
              if (
                seesAll ||
                visibleChannels.has(message.channel) ||
                messageMentionsMember(message.text, name, groupPrefix, visibleChannels)
              ) {
                unreadCount += 1;
              }
            }
          }

          const isKilled =
            raw.killed === true || raw.desired_state === "KILLED" || raw.phase === "KILLED";
          const conversationId = raw.conversation_id?.trim();
          const tail =
            !isKilled && conversationId && NATIVE_ID.test(conversationId)
              ? await readAntigravityTranscriptTail(
                  profileRoot,
                  conversationId,
                  MEMBER_STATE_TRANSCRIPT_TAIL_BYTES,
                ).catch(() => undefined)
              : undefined;
          const parsedTail =
            tail === undefined ? undefined : parseTranscriptTailLines(tail.contents);
          const derived = deriveAntigravitySwarmMemberState({
            killed: raw.killed,
            desiredState: raw.desired_state,
            phase: raw.phase,
            wakeMode: raw.wake_mode,
            transcriptLines: parsedTail?.lines,
            hasTrailingIncompleteLine: parsedTail?.hasTrailingIncompleteLine,
            transcriptMtimeMs: tail?.mtimeMs,
            nowMs,
          });
          const lastPost = lastPostByAgent.get(name);
          return {
            name,
            role,
            state: derived.state,
            model: resolveMemberModel(raw),
            workspaceMode: raw.workspace_mode?.trim() || null,
            addedBy: raw.added_by?.trim() || null,
            channels: [...channels],
            lastReadSeq,
            lastPostSeq: lastPost?.seq ?? null,
            lastPostTime: lastPost?.time ?? null,
            unreadCount,
            statusDetail: derived.statusDetail,
          };
        }),
      );
      members.sort(
        (left, right) =>
          memberSortRank(left) - memberSortRank(right) || left.name.localeCompare(right.name),
      );

      const channels: Array<AntigravitySwarmChannel> = Object.entries(roster?.channels ?? {})
        .flatMap(([key, channel]) => {
          const name = (channel.name ?? key).trim();
          if (!name) return [];
          return [
            {
              name,
              topic: channel.topic?.trim() || null,
              createdBy: channel.created_by?.trim() || null,
              archived: channel.archived === true,
            },
          ];
        })
        .toSorted((left, right) => {
          if (left.name === "main" && right.name !== "main") return -1;
          if (right.name === "main" && left.name !== "main") return 1;
          return left.name.localeCompare(right.name);
        });

      const messageCap = Math.min(
        Math.max(1, Math.floor(input.maxMessages ?? DEFAULT_MAX_MESSAGES)),
        HARD_MAX_MESSAGES,
      );
      const messagesTruncated = boardTruncated || parsedMessages.length > messageCap;
      const messages =
        parsedMessages.length > messageCap ? parsedMessages.slice(-messageCap) : parsedMessages;

      return {
        swarmId,
        backend: "local",
        title,
        createdAt,
        headSeq,
        // Count of parsed messages in the bounded board window (exact total unless byte-truncated).
        totalMessages: parsedMessages.length,
        messagesTruncated,
        members,
        channels,
        messages,
        plan: parsePlan(rawPlan),
      };
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
});

/** Reads a swarm worker's bounded transcript by proving its conversation_id from members.json. */
export const readAntigravitySwarmWorkerTranscript = Effect.fn(
  "readAntigravitySwarmWorkerTranscript",
)(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly workerName: string;
  readonly nowMs?: number | undefined;
}) {
  const empty: OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult = {
    workerName: input.workerName,
    model: null,
    state: null,
    steps: null,
    truncated: false,
  };
  if (!NATIVE_ID.test(input.rootSessionId)) return empty;
  const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
  const profileRoot = yield* Effect.tryPromise({
    try: async () => {
      const resolvedRoot = await antigravityProfileRoot(input.profileDirectory);
      if (resolvedRoot === undefined) return undefined;

      const rawAnchor = await readManagedFile(
        resolvedRoot,
        swarmSegments(input.rootSessionId, "swarm.json"),
        MAX_JSON_BYTES,
      );
      if (rawAnchor === undefined) return undefined;
      const anchor = Option.getOrUndefined(decodeSwarmAnchor(rawAnchor));
      return anchor !== undefined && anchor.backend === "local" ? resolvedRoot : undefined;
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
  if (profileRoot === undefined) return empty;

  const roster = yield* readManagedRoster(profileRoot, input.rootSessionId);
  const members = roster?.members;
  if (!members || !Object.hasOwn(members, input.workerName)) return empty;
  const raw = members[input.workerName];
  if (raw === undefined) return empty;

  return yield* Effect.tryPromise({
    try: async (): Promise<OrchestrationV2GetAntigravitySwarmWorkerTranscriptResult> => {
      const model = resolveMemberModel(raw);
      const conversationId = raw.conversation_id?.trim();
      const tail =
        conversationId && NATIVE_ID.test(conversationId)
          ? await readAntigravityTranscriptTail(
              profileRoot,
              conversationId,
              WORKER_TRANSCRIPT_TAIL_BYTES,
            ).catch(() => undefined)
          : undefined;
      const parsedTail = tail === undefined ? undefined : parseTranscriptTailLines(tail.contents);

      const derived = deriveAntigravitySwarmMemberState({
        killed: raw.killed,
        desiredState: raw.desired_state,
        phase: raw.phase,
        wakeMode: raw.wake_mode,
        transcriptLines: parsedTail?.lines,
        hasTrailingIncompleteLine: parsedTail?.hasTrailingIncompleteLine,
        transcriptMtimeMs: tail?.mtimeMs,
        nowMs,
      });

      return {
        workerName: input.workerName,
        model,
        state: derived.state,
        steps: tail === undefined ? null : parseAntigravityTranscriptSteps(tail.contents),
        truncated: tail?.truncated ?? false,
      };
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
});
