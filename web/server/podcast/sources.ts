/**
 * Turn a queued ネタ into the material a script is written from.
 */

import { htmlTitle, htmlToText } from "./html.ts";
import type { Item } from "./types.ts";

export interface SourceMaterial {
  kind: Item["kind"];
  title?: string;
  url?: string;
  /** The body to talk about: the page text, the note, or the theme. */
  text: string;
}

/**
 * Pages beyond this many characters are cut, with a note to the script writer saying so. A
 * five-minute episode cannot use more, and it keeps one runaway page from costing a fortune.
 */
export const MAX_SOURCE_CHARS = 60_000;

export type Fetch = typeof fetch;

export async function resolveSource(
  item: Item,
  fetchFn: Fetch = fetch,
): Promise<SourceMaterial> {
  if (item.kind !== "url" || !item.url) {
    return { kind: item.kind, title: item.title, text: item.text ?? "" };
  }

  const res = await fetchFn(item.url, {
    headers: {
      "user-agent": "cast4me/1.0 (+personal podcast generator)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GET ${item.url} → ${res.status}`);
  }
  const type = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const isHtml = /html|xml/i.test(type) || /^\s*</.test(raw);
  let text = isHtml ? htmlToText(raw) : raw.trim();
  if (text.length > MAX_SOURCE_CHARS) {
    console.warn(
      `[source] ${item.url}: ${text.length} chars, using the first ${MAX_SOURCE_CHARS}`,
    );
    text = text.slice(0, MAX_SOURCE_CHARS) +
      "\n\n（以下省略: 元記事が長いため途中まで）";
  }
  if (item.text) text = `投稿者のメモ: ${item.text}\n\n${text}`;
  return {
    kind: "url",
    url: item.url,
    title: item.title || (isHtml ? htmlTitle(raw) : undefined),
    text,
  };
}
