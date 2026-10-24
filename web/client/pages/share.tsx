/**
 * `/share` — ネタ投入, and where the share sheet lands.
 */

import { css } from "@remix-run/component";

import { ShareForm } from "../islands/share_form.tsx";
import { color } from "../tokens.ts";

export const title = "ネタ投入 — cast4me";
export const description = "URL・テキスト・テーマを投入する";
export const hydrate = true;

export default function Share() {
  return () => (
    <>
      <h1 mix={headingStyle}>ネタ投入</h1>
      <p mix={leadStyle}>
        URL・テキスト・テーマのどれか一つで十分です。ブラウザの共有メニューから
        cast4me を選んでもここに来ます。
      </p>
      <ShareForm />
    </>
  );
}

const headingStyle = css({ fontSize: "1.5rem" });
const leadStyle = css({ color: color.muted, marginTop: 0 });
