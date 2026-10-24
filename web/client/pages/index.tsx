/**
 * `/` — the player.
 */

import { Player } from "../islands/player.tsx";

export const title = "cast4me";
export const description = "自分専用のエンドレスポッドキャスト";
export const hydrate = true;

export default function Home() {
  return () => <Player />;
}
