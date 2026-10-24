/**
 * `POST /api/items` — ネタ投入. The one restricted endpoint.
 *
 * Takes JSON (`{ url?, text?, theme?, title? }`) from curl and iOS Shortcuts, or a form with the
 * Web Share Target's field names (`title`, `text`, `url`). A shared page often arrives with its
 * URL inside `text` and no `url`, so a URL found there is used as one.
 */

import type { Podcast } from "../podcast/mod.ts";
import type { NewItem } from "../podcast/store.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Constant-time comparison, so the token cannot be guessed a byte at a time. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export function authorize(request: Request, token: string): Response | null {
  if (!token) {
    return json({ message: "INGEST_TOKEN is not configured" }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const given = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!given || !sameToken(given, token)) {
    return json({ message: "Unauthorized" }, 401);
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"'）」]+/;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Read the body into a {@link NewItem}, or an error message. */
export async function parseItem(request: Request): Promise<NewItem | string> {
  const type = request.headers.get("content-type") ?? "";
  let fields: Record<string, unknown>;
  try {
    if (type.includes("application/json")) {
      fields = (await request.json()) ?? {};
    } else if (
      type.includes("form-urlencoded") || type.includes("multipart/form-data")
    ) {
      fields = Object.fromEntries(await request.formData());
    } else {
      fields = { text: await request.text() };
    }
  } catch {
    return "Could not parse the request body";
  }

  const title = str(fields.title);
  let url = str(fields.url);
  let text = str(fields.text);
  const theme = str(fields.theme);

  if (!url && text) {
    const found = text.match(URL_RE)?.[0];
    if (found) {
      url = found;
      text = str(text.replace(found, "")) ?? undefined;
    }
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return "url must be http(s)";
    } catch {
      return "url is not a valid URL";
    }
    return { kind: "url", origin: "api", url, text, title };
  }
  if (text) return { kind: "text", origin: "api", text, title };
  if (theme) return { kind: "theme", origin: "api", text: theme, title };
  return "Send one of url, text or theme";
}

export function ingestAction(podcast: Podcast) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    const denied = authorize(request, podcast.config.ingestToken);
    if (denied) return denied;
    const input = await parseItem(request);
    if (typeof input === "string") return json({ message: input }, 400);
    const item = await podcast.store.addItem(input);
    if (!item) return json({ duplicate: true, message: "Already queued" });
    void podcast.daemon.refill().catch((e) => console.error(e));
    return json({ id: item.id, kind: item.kind }, 201);
  };
}
