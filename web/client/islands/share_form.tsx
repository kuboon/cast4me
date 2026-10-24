/**
 * ShareForm — ネタ投入, by hand or from the share sheet.
 *
 * The manifest's Web Share Target opens `/share?title=&text=&url=` (a GET, so the shared page
 * lands here rather than at the API, which needs a token the share sheet cannot add). This form
 * fills itself from those parameters and, when a token is saved on the device, sends them to
 * `POST /api/items` straight away.
 *
 * Fields are filled imperatively from `ref` rather than through `value`: they are edited by hand,
 * and a bound `value` would fight the keystrokes.
 */

import { clientEntry, css, type Handle, on, ref } from "@remix-run/component";

import { load, save, tokenKey } from "../lib/storage.ts";
import { routes } from "../routes.ts";
import { color, radius } from "../tokens.ts";

type Field = "token" | "url" | "title" | "text";

export const ShareForm = clientEntry(
  import.meta.url,
  function ShareForm(handle: Handle) {
    const fields: Partial<
      Record<Field, HTMLInputElement | HTMLTextAreaElement>
    > = {};
    let sending = false;
    let result: { ok: boolean; text: string } | null = null;
    let fromShare = false;

    const initial = (name: Field): string => {
      if (typeof location === "undefined") return "";
      if (name === "token") return load(tokenKey) ?? "";
      return new URLSearchParams(location.search).get(name) ?? "";
    };

    const bind = (name: Field) => (node: Element) => {
      const el = node as HTMLInputElement | HTMLTextAreaElement;
      fields[name] = el;
      el.value = initial(name);
    };

    const value = (name: Field) => fields[name]?.value.trim() ?? "";

    const submit = async () => {
      const token = value("token");
      if (!token) {
        result = { ok: false, text: "トークンを入力してください。" };
        handle.update();
        return;
      }
      save(tokenKey, token);
      sending = true;
      result = null;
      handle.update();
      try {
        const res = await fetch(routes.api.items.href(), {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            url: value("url") || undefined,
            title: value("title") || undefined,
            text: value("text") || undefined,
          }),
        });
        const body = await res.json().catch(() => ({})) as {
          message?: string;
          duplicate?: boolean;
        };
        result = res.ok
          ? {
            ok: true,
            text: body.duplicate
              ? "このURLは投入済みです。"
              : "投入しました。順番が来たらエピソードになります。",
          }
          : {
            ok: false,
            text: `失敗しました (${res.status}): ${body.message ?? ""}`,
          };
        if (res.ok) {
          for (const name of ["url", "title", "text"] as const) {
            const el = fields[name];
            if (el) el.value = "";
          }
          if (fromShare) history.replaceState(null, "", location.pathname);
        }
      } catch (error) {
        result = {
          ok: false,
          text: `送信できませんでした: ${
            error instanceof Error ? error.message : error
          }`,
        };
      } finally {
        sending = false;
        handle.update();
      }
    };

    if (typeof location !== "undefined") {
      const params = new URLSearchParams(location.search);
      fromShare = ["url", "text", "title"].some((k) => params.get(k));
      // Opened from the share sheet with a token on file: send it without asking.
      if (fromShare && load(tokenKey)) handle.queueTask(() => void submit());
    }

    return () => (
      <form
        mix={[
          formStyle,
          on("submit", (e) => {
            e.preventDefault();
            void submit();
          }),
        ]}
      >
        <label mix={labelStyle}>
          URL
          <input
            type="url"
            name="url"
            placeholder="https://…"
            mix={[inputStyle, ref(bind("url"))]}
          />
        </label>
        <label mix={labelStyle}>
          タイトル（任意）
          <input
            type="text"
            name="title"
            mix={[inputStyle, ref(bind("title"))]}
          />
        </label>
        <label mix={labelStyle}>
          テキスト / メモ / テーマ
          <textarea
            name="text"
            rows={5}
            placeholder="話してほしいこと、記事への一言、学びたいテーマなど"
            mix={[inputStyle, ref(bind("text"))]}
          />
        </label>
        <label mix={labelStyle}>
          投入トークン（この端末に保存されます）
          <input
            type="password"
            name="token"
            autocomplete="current-password"
            mix={[inputStyle, ref(bind("token"))]}
          />
        </label>
        <button type="submit" disabled={sending} mix={buttonStyle}>
          {sending ? "送信中…" : "投入する"}
        </button>
        {result
          ? (
            <p role="status" mix={result.ok ? okStyle : errorStyle}>
              {result.text}{" "}
              {result.ok ? <a href={routes.home.href()}>プレイヤーへ</a> : null}
            </p>
          )
          : null}
      </form>
    );
  },
);

const formStyle = css({ display: "grid", gap: "1rem" });

const labelStyle = css({
  display: "grid",
  gap: "0.35rem",
  fontSize: "0.9rem",
  color: color.muted,
});

const inputStyle = css({
  font: "inherit",
  fontSize: "1rem",
  color: color.fg,
  background: color.bg,
  padding: "0.6rem 0.75rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  width: "100%",
});

const buttonStyle = css({
  font: "inherit",
  minHeight: "2.75rem",
  cursor: "pointer",
  border: "none",
  borderRadius: "999px",
  background: color.accent,
  color: color.onAccent,
  fontWeight: 600,
  "&:disabled": { opacity: 0.5 },
});

const okStyle = css({ margin: 0 });
const errorStyle = css({ margin: 0, color: color.accent });
