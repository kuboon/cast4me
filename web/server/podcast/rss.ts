/**
 * RSS both ways: reading ネタ out of other people's feeds, and writing this podcast's own
 * `feed.xml`.
 */

import { decodeEntities, escapeXml } from "./html.ts";
import type { Episode } from "./types.ts";

export interface FeedEntry {
  title?: string;
  url: string;
  summary?: string;
}

const tag = (xml: string, name: string): string | undefined => {
  const m = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  if (!m) return undefined;
  const raw = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")
    .trim();
};

/** Entries of an RSS 2.0 or Atom document, in document order (usually newest first). */
export function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const url = tag(m[0], "link") ?? tag(m[0], "guid");
    if (url && /^https?:\/\//.test(url)) {
      out.push({
        url,
        title: tag(m[0], "title"),
        summary: tag(m[0], "description"),
      });
    }
  }
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const links = [...m[0].matchAll(/<link\b[^>]*>/gi)].map((l) => l[0]);
    const link = links.find((l) => /rel=["']alternate["']/.test(l)) ??
      links.find((l) => !/rel=/.test(l)) ?? links[0];
    const url = link?.match(/href=["']([^"']+)["']/)?.[1];
    if (url) {
      out.push({
        url: decodeEntities(url),
        title: tag(m[0], "title"),
        summary: tag(m[0], "summary") ?? tag(m[0], "content"),
      });
    }
  }
  return out;
}

export interface PodcastFeedOptions {
  origin: string;
  title: string;
  description: string;
  episodes: readonly Episode[];
}

const rfc822 = (iso: string) => new Date(iso).toUTCString();

const hms = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 3600)}:${
    String(Math.floor(s / 60) % 60).padStart(2, "0")
  }:${String(s % 60).padStart(2, "0")}`;
};

/** Where an episode's audio is served. The extension is there for podcast apps that want one. */
export function audioPath(episode: Episode): string {
  const ext = episode.audioFile.split(".").pop();
  return `/audio/${episode.id}${ext ? `.${ext}` : ""}`;
}

export function renderPodcastFeed(opts: PodcastFeedOptions): string {
  const items = opts.episodes.map((e) => {
    const url = `${opts.origin}${audioPath(e)}`;
    return `    <item>
      <title>${escapeXml(e.title)}</title>
      <description>${escapeXml(e.description)}</description>
      <guid isPermaLink="false">${e.id}</guid>
      <pubDate>${rfc822(e.createdAt)}</pubDate>
      <enclosure url="${escapeXml(url)}" length="${e.bytes}" type="${
      escapeXml(e.contentType)
    }"/>${
      e.durationSec
        ? `\n      <itunes:duration>${hms(e.durationSec)}</itunes:duration>`
        : ""
    }${e.sourceUrl ? `\n      <link>${escapeXml(e.sourceUrl)}</link>` : ""}
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(opts.origin)}/</link>
    <description>${escapeXml(opts.description)}</description>
    <language>ja</language>
    <itunes:image href="${escapeXml(opts.origin)}/static/favicon.svg"/>
    <itunes:explicit>false</itunes:explicit>
${items.join("\n")}
  </channel>
</rss>
`;
}
