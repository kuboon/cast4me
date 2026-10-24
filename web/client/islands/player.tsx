/**
 * Player — the whole PWA, as one island.
 *
 * It plays `GET /api/queue` in order through a single `<audio>` element, swapping `src` on
 * `ended`; reusing the one element is what keeps iOS playing in the background from one episode
 * to the next. Positions are kept per episode in `localStorage`; the server only hears that an
 * episode was finished (with 👍) or skipped, which is also its cue to make the next one.
 *
 * The service worker is told which episodes are next so it can download them ahead of time, and
 * the Media Session API puts the title and the skip button on the lock screen.
 */

import { clientEntry, css, type Handle, on, ref } from "@remix-run/component";

import type { Feedback, QueueEpisode, QueueResponse } from "../lib/api.ts";
import { currentKey, load, positionKey, save } from "../lib/storage.ts";
import { routes } from "../routes.ts";
import { color, radius } from "../tokens.ts";

/** Episodes the service worker downloads ahead. */
const PRECACHE = 3;
/** How often the queue is re-read while the page is open. */
const POLL_MS = 30_000;

const isClient = typeof document !== "undefined";

const formatTime = (sec: number) => {
  if (!Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const Player = clientEntry(
  import.meta.url,
  function Player(handle: Handle) {
    let audio: HTMLAudioElement | null = null;
    let queue: QueueEpisode[] = [];
    let current: QueueEpisode | null = null;
    let pendingItems = 0;
    let generating = false;
    let loaded = false;
    let liked = false;
    let playing = false;
    let position = 0;
    let duration = NaN;
    let message: string | null = null;
    let lastSaved = 0;

    const setMessage = (text: string | null) => {
      message = text;
      handle.update();
    };

    // --- server ------------------------------------------------------------

    const fetchQueue = async () => {
      try {
        const res = await fetch(routes.api.queue.href(), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as QueueResponse;
        queue = body.episodes;
        pendingItems = body.pendingItems;
        generating = body.generating;
        loaded = true;
        if (message?.startsWith("キュー")) message = null;
      } catch (error) {
        message = `キューを取得できません: ${
          error instanceof Error ? error.message : error
        }`;
      }
      precache();
      if (!current && queue.length) select(queue[0], false);
      handle.update();
    };

    const sendPlayed = async (id: string, feedback?: Feedback) => {
      try {
        await fetch(routes.api.played.href({ id }), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(feedback ? { feedback } : {}),
        });
      } catch {
        // Offline: the episode is still dropped locally. The server sees it as unplayed until the
        // next successful notice, which only means one extra episode in reserve.
      }
    };

    const precache = () => {
      const sw = navigator.serviceWorker?.controller;
      if (!sw) return;
      const rest = queue.filter((e) => e.id !== current?.id);
      sw.postMessage({
        type: "precache",
        urls: [current, ...rest].filter((e): e is QueueEpisode => !!e)
          .slice(0, PRECACHE).map((e) => e.audioUrl),
        keep: queue.map((e) => e.audioUrl),
      });
    };

    // --- playback ----------------------------------------------------------

    const select = (episode: QueueEpisode, autoplay: boolean) => {
      current = episode;
      liked = false;
      position = Number(load(positionKey(episode.id)) ?? 0) || 0;
      duration = episode.durationSec ?? NaN;
      save(currentKey, episode.id);
      if (audio) {
        audio.src = episode.audioUrl;
        audio.load();
        if (autoplay) void play();
      }
      updateMediaSession();
      precache();
      handle.update();
    };

    const play = async () => {
      if (!audio || !current) return;
      try {
        await audio.play();
      } catch {
        // Autoplay without a gesture is refused; the play button is right there.
      }
    };

    /** Finish the current episode — played through, or skipped — and move on. */
    const finish = async (feedback?: Feedback) => {
      const done = current;
      if (!done) return;
      save(positionKey(done.id), null);
      queue = queue.filter((e) => e.id !== done.id);
      const next = queue[0];
      if (next) {
        select(next, true);
      } else {
        current = null;
        save(currentKey, null);
        audio?.removeAttribute("src");
        audio?.load();
        handle.update();
      }
      await sendPlayed(done.id, feedback);
      await fetchQueue();
    };

    const skip = () => void finish("skip");

    const seekBy = (delta: number) => {
      if (!audio) return;
      audio.currentTime = Math.max(0, audio.currentTime + delta);
    };

    const updateMediaSession = () => {
      const ms = navigator.mediaSession;
      if (!ms || typeof MediaMetadata === "undefined") return;
      ms.metadata = current
        ? new MediaMetadata({
          title: current.title,
          artist: "cast4me",
          album: current.description,
          artwork: [{
            src: "/static/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
          }],
        })
        : null;
    };

    const installMediaSession = () => {
      const ms = navigator.mediaSession;
      if (!ms) return;
      const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
        ["play", () => void play()],
        ["pause", () => audio?.pause()],
        ["nexttrack", skip],
        ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 15))],
        ["seekforward", (d) => seekBy(d.seekOffset ?? 30)],
        ["seekto", (d) => {
          if (audio && d.seekTime !== undefined) audio.currentTime = d.seekTime;
        }],
      ];
      for (const [action, fn] of handlers) {
        try {
          ms.setActionHandler(action, fn);
        } catch {
          // Not every browser knows every action.
        }
      }
    };

    // --- wiring ------------------------------------------------------------

    const bindAudio = (node: Element, signal: AbortSignal) => {
      audio = node as HTMLAudioElement;
      const el = audio;
      const listen = (type: string, fn: () => void) =>
        el.addEventListener(type, fn, { signal });

      listen("loadedmetadata", () => {
        duration = el.duration;
        if (position > 0 && position < el.duration - 1) {
          el.currentTime = position;
        }
        handle.update();
      });
      listen("timeupdate", () => {
        position = el.currentTime;
        const now = Date.now();
        if (current && now - lastSaved > 5000) {
          lastSaved = now;
          save(positionKey(current.id), String(el.currentTime));
          try {
            if (Number.isFinite(el.duration)) {
              navigator.mediaSession?.setPositionState({
                duration: el.duration,
                position: Math.min(el.currentTime, el.duration),
                playbackRate: el.playbackRate,
              });
            }
          } catch {
            // Position state is a nicety.
          }
        }
        handle.update();
      });
      listen("play", () => {
        playing = true;
        handle.update();
      });
      listen("pause", () => {
        playing = false;
        if (current) save(positionKey(current.id), String(el.currentTime));
        handle.update();
      });
      listen("ended", () => void finish(liked ? "like" : undefined));
      listen("error", () => {
        if (current) setMessage("音声を読み込めませんでした。");
      });

      if (current) {
        el.src = current.audioUrl;
        el.load();
      }
    };

    if (isClient) {
      const resumeId = load(currentKey);
      handle.queueTask(async () => {
        installMediaSession();
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.register("/sw.js").catch(() => {});
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            precache,
          );
        }
        await fetchQueue();
        const resume = resumeId && queue.find((e) => e.id === resumeId);
        if (resume && resume.id !== current?.id) select(resume, false);
      });
      const timer = setInterval(() => void fetchQueue(), POLL_MS);
      handle.signal.addEventListener("abort", () => clearInterval(timer));
    }

    // --- view --------------------------------------------------------------

    return () => {
      const upcoming = queue.filter((e) => e.id !== current?.id);
      return (
        <section mix={wrapStyle}>
          <div mix={cardStyle}>
            {current
              ? (
                <>
                  <h1 mix={titleStyle}>{current.title}</h1>
                  <p mix={descStyle}>{current.description}</p>
                  {current.sourceUrl
                    ? (
                      <p mix={sourceStyle}>
                        <a
                          href={current.sourceUrl}
                          target="_blank"
                          rel="noopener"
                        >
                          元ネタ
                        </a>
                      </p>
                    )
                    : null}
                </>
              )
              : (
                <p mix={descStyle}>
                  {!loaded
                    ? "読み込み中…"
                    : generating
                    ? "次のエピソードを生成中です…"
                    : pendingItems
                    ? "ネタはあります。生成を待っています…"
                    : "未聴のエピソードはありません。ネタを投入してください。"}
                </p>
              )}

            <audio
              preload="auto"
              mix={[audioStyle, ref(bindAudio)]}
            />

            <div mix={timeStyle} aria-live="off">
              <span>{formatTime(position)}</span>
              <input
                type="range"
                min="0"
                max={Number.isFinite(duration) ? String(duration) : "0"}
                step="1"
                value={String(Math.floor(position))}
                aria-label="再生位置"
                disabled={!current}
                mix={[
                  seekStyle,
                  on("input", (e) => {
                    if (audio) {
                      audio.currentTime = Number(
                        (e.currentTarget as HTMLInputElement).value,
                      );
                    }
                  }),
                ]}
              />
              <span>{formatTime(duration)}</span>
            </div>

            <div mix={controlsStyle}>
              <button
                type="button"
                aria-label="15秒戻る"
                disabled={!current}
                mix={[buttonStyle, on("click", () => seekBy(-15))]}
              >
                −15
              </button>
              <button
                type="button"
                aria-label={playing ? "一時停止" : "再生"}
                disabled={!current}
                mix={[
                  buttonStyle,
                  primaryStyle,
                  on("click", () => playing ? audio?.pause() : void play()),
                ]}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                aria-label="30秒進む"
                disabled={!current}
                mix={[buttonStyle, on("click", () => seekBy(30))]}
              >
                +30
              </button>
            </div>

            <div mix={controlsStyle}>
              <button
                type="button"
                aria-pressed={liked ? "true" : "false"}
                disabled={!current}
                mix={[
                  buttonStyle,
                  liked ? likedStyle : null,
                  on("click", () => {
                    liked = !liked;
                    handle.update();
                  }),
                ]}
              >
                👍 {liked ? "いいね済み" : "いいね"}
              </button>
              <button
                type="button"
                disabled={!current}
                mix={[buttonStyle, on("click", skip)]}
              >
                スキップ ⏭
              </button>
            </div>
            {message ? <p mix={messageStyle} role="status">{message}</p> : null}
          </div>

          <h2 mix={headingStyle}>
            次に再生{" "}
            <small mix={mutedStyle}>
              {generating ? "（生成中）" : ""}
              {pendingItems ? ` 待機中のネタ ${pendingItems} 件` : ""}
            </small>
          </h2>
          {upcoming.length
            ? (
              <ol mix={listStyle}>
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <strong>{e.title}</strong>
                    <br />
                    <span mix={mutedStyle}>{e.description}</span>
                  </li>
                ))}
              </ol>
            )
            : <p mix={mutedStyle}>まだありません。</p>}
        </section>
      );
    };
  },
);

// --- styles -----------------------------------------------------------------

const wrapStyle = css({ display: "grid", gap: "1rem" });

const cardStyle = css({
  display: "grid",
  gap: "0.9rem",
  padding: "1.25rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.card,
});

const titleStyle = css({ fontSize: "1.4rem", margin: 0 });
const descStyle = css({ margin: 0, color: color.muted });
const sourceStyle = css({ margin: 0, fontSize: "0.9rem" });
const audioStyle = css({ display: "none" });

const timeStyle = css({
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "0.6rem",
  fontVariantNumeric: "tabular-nums",
  fontSize: "0.9rem",
  color: color.muted,
});

const seekStyle = css({ width: "100%", accentColor: color.accent });

const controlsStyle = css({
  display: "flex",
  gap: "0.6rem",
  justifyContent: "center",
  flexWrap: "wrap",
});

const buttonStyle = css({
  font: "inherit",
  minWidth: "4rem",
  minHeight: "2.75rem",
  padding: "0.4rem 1rem",
  cursor: "pointer",
  border: `1px solid ${color.border}`,
  borderRadius: "999px",
  background: color.bg,
  color: color.fg,
  "&:disabled": { opacity: 0.4, cursor: "default" },
});

const primaryStyle = css({
  minWidth: "5rem",
  fontSize: "1.3rem",
  background: color.accent,
  borderColor: color.accent,
  color: color.onAccent,
});

const likedStyle = css({ borderColor: color.accent, color: color.accent });
const messageStyle = css({ margin: 0, color: color.accent });
const headingStyle = css({ fontSize: "1.1rem", margin: "0.5rem 0 0" });
const mutedStyle = css({ color: color.muted, fontWeight: 400 });

const listStyle = css({
  margin: 0,
  paddingInlineStart: "1.4rem",
  display: "grid",
  gap: "0.6rem",
});
