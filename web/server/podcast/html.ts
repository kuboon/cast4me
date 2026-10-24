/**
 * Just enough HTML/XML handling for ネタ: pull the readable text and title out of a web page, and
 * escape text going into `feed.xml`. No DOM — Deno has none, and a page only has to become prose
 * for the script writer, not render.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[
        c
      ]!,
  );
}

/** The page's title: `og:title`, then `<title>`. */
export function htmlTitle(html: string): string | undefined {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i,
  );
  const raw = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = raw ? decodeEntities(raw).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

/**
 * The page's text. Prefers `<article>` / `<main>` when there is one, drops scripts, styles and
 * page chrome, and keeps paragraph breaks.
 */
export function htmlToText(html: string): string {
  let body = html.match(/<article[\s>][\s\S]*<\/article>/i)?.[0] ??
    html.match(/<main[\s>][\s\S]*<\/main>/i)?.[0] ??
    html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|aside|form|template)[\s>][\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
