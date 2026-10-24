/**
 * Script generation with Claude, through the Anthropic SDK.
 *
 * Structured output (`output_config.format`) returns the title, description and script as one
 * JSON object. Streaming keeps a long script clear of HTTP timeouts. The API key comes from
 * `ANTHROPIC_API_KEY`, which the SDK reads itself.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { Script, ScriptGenerator, ScriptInput } from "./mod.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    script: { type: "string" },
  },
  required: ["title", "description", "script"],
  additionalProperties: false,
} as const;

export class AnthropicScriptGenerator implements ScriptGenerator {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(opts: { model: string; client?: Anthropic }) {
    this.#client = opts.client ?? new Anthropic();
    this.#model = opts.model;
  }

  async generate(input: ScriptInput): Promise<Script> {
    const stream = this.#client.beta.messages.stream({
      model: this.#model,
      max_tokens: 64000,
      // A declined request is re-run on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new Error(
        `Script request was declined (${
          message.stop_details?.category ?? "unknown"
        })`,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("Script was cut off at max_tokens");
    }
    const text = message.content
      .flatMap((b) => b.type === "text" ? [b.text] : [])
      .join("");
    const parsed = JSON.parse(text) as Script;
    if (!parsed.script?.trim()) throw new Error("Empty script");
    return {
      title: parsed.title.trim() || "無題",
      description: parsed.description.trim(),
      script: parsed.script.trim(),
    };
  }
}
