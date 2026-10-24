/**
 * The few things the player keeps on this device. Wrapped because `localStorage` can be missing or
 * throw (private browsing, storage blocked), and nothing here is worth failing a page over.
 */

const PREFIX = "cast4me:";

export function load(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    // Not persisted, and that is fine.
  }
}

/** The ingest token, for `POST /api/items` from this device. */
export const tokenKey = "ingest-token";
/** The episode last playing, so a reload resumes it. */
export const currentKey = "current";
/** Playback position of one episode, in seconds. */
export const positionKey = (id: string) => `pos:${id}`;
