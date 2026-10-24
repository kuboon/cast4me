import { assertEquals, assertStringIncludes } from "@std/assert";

import { parseRange } from "../controllers/episodes.ts";
import { parseItem } from "../controllers/ingest.ts";
import { htmlTitle, htmlToText } from "./html.ts";
import { parseFeed } from "./rss.ts";
import { buildUserPrompt } from "./script/prompt.ts";
import { splitForTts } from "./tts/mod.ts";

Deno.test("parseRange", () => {
  assertEquals(parseRange(null, 100), null);
  assertEquals(parseRange("bytes=0-", 100), [0, 99]);
  assertEquals(parseRange("bytes=10-19", 100), [10, 19]);
  assertEquals(parseRange("bytes=90-200", 100), [90, 99]);
  assertEquals(parseRange("bytes=-10", 100), [90, 99]);
  assertEquals(parseRange("bytes=100-", 100), "invalid");
  assertEquals(parseRange("bytes=0-1,5-6", 100), null);
});

Deno.test("parseFeed reads RSS and Atom", () => {
  assertEquals(
    parseFeed(
      `<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://a.example/1</link></item></channel></rss>`,
    ),
    [{ url: "https://a.example/1", title: "A & B", summary: undefined }],
  );
  assertEquals(
    parseFeed(
      `<feed><entry><title>X</title><link rel="alternate" href="https://b.example/x"/><summary>S</summary></entry></feed>`,
    ),
    [{ url: "https://b.example/x", title: "X", summary: "S" }],
  );
});

Deno.test("htmlToText keeps the article and drops scripts", () => {
  const html =
    `<html><head><title>T &amp; U</title><script>x()</script></head><body><header>H</header><main><h1>見出し</h1><p>一段落目</p><p>二段落目&nbsp;です</p></main></body></html>`;
  assertEquals(htmlTitle(html), "T & U");
  assertEquals(htmlToText(html), "見出し\n一段落目\n二段落目 です");
});

Deno.test("splitForTts keeps sentences whole", () => {
  const text = "一文目です。二文目です。三文目はとても長いです。";
  const parts = splitForTts(text, 12);
  assertEquals(parts.join(""), text);
  for (const p of parts) assertEquals(p.length <= 12, true);
  assertEquals(parts[0], "一文目です。二文目です。");
});

Deno.test("parseItem: JSON kinds", async () => {
  const req = (body: unknown) =>
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assertEquals(await parseItem(req({ theme: "宇宙" })), {
    kind: "theme",
    origin: "api",
    text: "宇宙",
    title: undefined,
  });
  assertEquals(await parseItem(req({})), "Send one of url, text or theme");
  assertEquals(
    await parseItem(req({ url: "ftp://x" })),
    "url must be http(s)",
  );
});

Deno.test("prompt carries feedback and length", () => {
  const prompt = buildUserPrompt({
    source: { kind: "text", text: "素材" },
    feedback: [{ title: "好き", feedback: "like" }, {
      title: "嫌い",
      feedback: "skip",
    }],
    recentTitles: ["前回"],
    targetMinutes: 5,
  });
  assertStringIncludes(prompt, "1500字");
  assertStringIncludes(prompt, "👍 好き");
  assertStringIncludes(prompt, "スキップ: 嫌い");
  assertStringIncludes(prompt, "- 前回");
  assertStringIncludes(prompt, "<source>\n素材\n</source>");
});
