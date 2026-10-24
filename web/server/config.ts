/**
 * Server configuration, read from the environment once.
 *
 * `loadConfig(env)` turns a plain record into the typed {@link Config}, so tests build one without
 * touching `Deno.env`; `getConfig()` is the process's own, read at module load. Every environment
 * variable the daemon reads is listed in {@link ENV_KEYS} — and in the `dev` permission set of
 * `web/server/deno.json`, which must stay in step with it.
 */

export type ScriptProviderName = "anthropic" | "dummy";
export type TtsProviderName = "openai" | "command" | "dummy";

/** Parsed, typed configuration used across the server. */
export interface Config {
  /** Where the Deno KV file and the audio files live. */
  readonly dataDir: string;
  /** The public origin behind Cloudflare Tunnel, for absolute URLs in `feed.xml`. */
  readonly publicOrigin: string;
  /** Bearer token for `POST /api/items`. Empty means ingest is refused outright. */
  readonly ingestToken: string;
  /** Keep this many unplayed episodes ready. */
  readonly targetUnplayed: number;
  /** Rough length of one episode, in minutes. */
  readonly episodeMinutes: number;
  /** How often the refill loop runs even without a trigger. */
  readonly refillIntervalSec: number;
  /** RSS / Atom feeds to pull ネタ from. */
  readonly rssFeeds: readonly string[];
  readonly rssIntervalMin: number;
  /** Themes to fall back on when the ネタ queue runs dry. Empty means "wait for ネタ". */
  readonly fallbackThemes: readonly string[];
  readonly script: {
    readonly provider: ScriptProviderName;
    readonly anthropicModel: string;
  };
  readonly tts: {
    readonly provider: TtsProviderName;
    readonly openaiApiKey: string;
    readonly openaiModel: string;
    readonly openaiVoice: string;
    readonly openaiInstructions: string;
    /** For `command`: run with `{in}` (text file) and `{out}` (audio file) substituted. */
    readonly command: string;
    /** For `command`: the extension `{out}` gets, which also decides the content type. */
    readonly commandExt: string;
  };
}

/** Keys read from the host environment. */
export const ENV_KEYS = [
  "DATA_DIR",
  "PUBLIC_ORIGIN",
  "INGEST_TOKEN",
  "TARGET_UNPLAYED",
  "EPISODE_MINUTES",
  "REFILL_INTERVAL_SEC",
  "RSS_FEEDS",
  "RSS_INTERVAL_MIN",
  "FALLBACK_THEMES",
  "SCRIPT_PROVIDER",
  "ANTHROPIC_MODEL",
  "TTS_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "OPENAI_TTS_INSTRUCTIONS",
  "TTS_COMMAND",
  "TTS_COMMAND_EXT",
] as const;

export type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

const list = (value: string | undefined): string[] =>
  (value ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!value) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Expected one of ${allowed.join(", ")}, got "${value}"`);
}

/** Derive the typed {@link Config} from a raw env record. */
export function loadConfig(env: Env): Config {
  return {
    dataDir: env.DATA_DIR || "./data",
    publicOrigin: (env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, ""),
    ingestToken: env.INGEST_TOKEN ?? "",
    targetUnplayed: Math.floor(positive(env.TARGET_UNPLAYED, 3)),
    episodeMinutes: positive(env.EPISODE_MINUTES, 5),
    refillIntervalSec: positive(env.REFILL_INTERVAL_SEC, 300),
    rssFeeds: list(env.RSS_FEEDS),
    rssIntervalMin: positive(env.RSS_INTERVAL_MIN, 60),
    fallbackThemes: list(env.FALLBACK_THEMES),
    script: {
      provider: oneOf(env.SCRIPT_PROVIDER, ["anthropic", "dummy"], "dummy"),
      anthropicModel: env.ANTHROPIC_MODEL || "claude-opus-5-5",
    },
    tts: {
      provider: oneOf(
        env.TTS_PROVIDER,
        ["openai", "command", "dummy"],
        "dummy",
      ),
      openaiApiKey: env.OPENAI_API_KEY ?? "",
      openaiModel: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      openaiVoice: env.OPENAI_TTS_VOICE || "alloy",
      openaiInstructions: env.OPENAI_TTS_INSTRUCTIONS ||
        "落ち着いたポッドキャストのパーソナリティとして、自然な日本語で話す。",
      command: env.TTS_COMMAND ?? "",
      commandExt: env.TTS_COMMAND_EXT || "mp3",
    },
  };
}

/** Read {@link Env} from `Deno.env` — the single point of `Deno.env` access. */
export function denoEnv(): Env {
  const env: Env = {};
  for (const key of ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const config: Config = loadConfig(denoEnv());

/** The process's {@link Config}, resolved from `Deno.env` at module load. */
export function getConfig(): Config {
  return config;
}
