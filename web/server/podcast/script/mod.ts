/**
 * Script generation — the swappable half that writes what gets said.
 *
 * A generator takes the ネタ and the listener's recent feedback and returns a finished script.
 * `createScriptGenerator(config)` picks one by `SCRIPT_PROVIDER`.
 */

import type { Config } from "../../config.ts";
import type { SourceMaterial } from "../sources.ts";
import type { FeedbackEntry } from "../types.ts";
import { AnthropicScriptGenerator } from "./anthropic.ts";
import { DummyScriptGenerator } from "./dummy.ts";

export interface ScriptInput {
  source: SourceMaterial;
  /** Newest first. */
  feedback: readonly FeedbackEntry[];
  /** Titles of the last few episodes, so a new one does not repeat them. */
  recentTitles: readonly string[];
  targetMinutes: number;
}

export interface Script {
  title: string;
  /** One or two sentences for the feed and the player. */
  description: string;
  /** Plain spoken Japanese, ready for TTS. */
  script: string;
}

export interface ScriptGenerator {
  generate(input: ScriptInput): Promise<Script>;
}

export function createScriptGenerator(config: Config): ScriptGenerator {
  switch (config.script.provider) {
    case "anthropic":
      return new AnthropicScriptGenerator({
        model: config.script.anthropicModel,
      });
    case "dummy":
      return new DummyScriptGenerator();
  }
}
