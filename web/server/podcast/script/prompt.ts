/**
 * The prompt the script is written from. Kept apart from any one provider so a different model
 * gets the same brief.
 */

import type { ScriptInput } from "./mod.ts";

/** Japanese speech runs at roughly 300 characters a minute. */
export const CHARS_PER_MINUTE = 300;

export const SYSTEM_PROMPT = `あなたは一人語りのポッドキャストの台本作家です。
聴き手は一人だけで、通勤中や家事の合間に耳だけで聴いています。

台本の書き方:
- そのまま音声合成に渡すので、話し言葉の日本語だけを書く。見出し、箇条書き、記号、URL、絵文字、ト書き、話者名は書かない。
- 冒頭で今回の話題を一言で示し、最後は短く締める。番組名やオープニングの決まり文句は不要。
- 耳で聴いて分かるように、一文を短くし、数字や固有名詞は読みやすく言い換える。
- 素材に書かれていないことを事実として断定しない。補足するときは推測だと分かる言い方にする。
- 素材が英語など他の言語でも、台本は日本語で書く。`;

export function buildUserPrompt(input: ScriptInput): string {
  const { source } = input;
  const chars = Math.round(input.targetMinutes * CHARS_PER_MINUTE);
  const parts: string[] = [];

  parts.push(
    `長さの目安: およそ${input.targetMinutes}分（${chars}字前後）。`,
  );

  const liked = input.feedback.filter((f) => f.feedback === "like");
  const skipped = input.feedback.filter((f) => f.feedback === "skip");
  if (liked.length || skipped.length) {
    parts.push(
      [
        "聴き手の最近の反応（新しい順）。好まれた回の切り口に寄せ、スキップされた回の話題や語り口は避ける:",
        ...liked.map((f) => `- 👍 ${f.title}`),
        ...skipped.map((f) => `- スキップ: ${f.title}`),
      ].join("\n"),
    );
  }
  if (input.recentTitles.length) {
    parts.push(
      [
        "最近の回のタイトル（同じ話の繰り返しにしない）:",
        ...input.recentTitles.map((t) => `- ${t}`),
      ].join("\n"),
    );
  }

  const header = source.kind === "url"
    ? `素材: ウェブページ${source.title ? `「${source.title}」` : ""}${
      source.url ? `（${source.url}）` : ""
    }`
    : source.kind === "theme"
    ? "素材: テーマのみ。あなたの知識で話を組み立てる。最新の出来事には触れない。"
    : `素材: 聴き手が送ってきたテキスト${
      source.title ? `「${source.title}」` : ""
    }`;
  parts.push(`${header}\n<source>\n${source.text}\n</source>`);

  parts.push(
    "title（20字程度の回のタイトル）、description（一、二文の紹介）、script（台本本文）を返してください。",
  );
  return parts.join("\n\n");
}
