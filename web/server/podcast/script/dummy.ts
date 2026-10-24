/**
 * A generator that needs no API: it reads the ネタ back. For development and tests.
 */

import type { Script, ScriptGenerator, ScriptInput } from "./mod.ts";

export class DummyScriptGenerator implements ScriptGenerator {
  generate(input: ScriptInput): Promise<Script> {
    const { source } = input;
    const title = source.title ||
      (source.kind === "theme" ? source.text : source.text.slice(0, 20)) ||
      "テスト回";
    const body = source.text.slice(0, 400);
    return Promise.resolve({
      title,
      description: `${title} についてのテスト用エピソード。`,
      script:
        `今回は「${title}」の話です。${body}　以上、テスト用の台本でした。`,
    });
  }
}
