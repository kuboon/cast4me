# cast4me

自分専用のエンドレスポッドキャスト。Remix v3 + Deno。`kuboon/deno-remix-tmpl`
から作った派生アプリで、init 済み（テンプレのデモ機能は削除済み）。

## 構成

1
プロセス（`deno serve web/server/router.tsx`）が全部を持つ。自宅マシンで動かし、
Cloudflare Tunnel で公開する。

- `web/server/router.tsx` — エントリ。`DATA_DIR` の podcast を開き、デーモンを
  起動し、`createApp()` の router を default export する。
- `web/server/app.tsx` — router の組み立て。`createApp(podcast)` で podcast
  を注入するので、テストは in-memory KV とダミーのプロバイダで組める。
- `web/server/config.ts` — env の読み取りはここだけ。`loadConfig(env)`
  は純粋関数。env を足したら `ENV_KEYS` と README の表を更新する。
- `web/server/podcast/` — ドメイン
  - `store.ts` — Deno KV。`["item", ulid]` / `["episode", ulid]` /
    `["seen", url]`（重複 URL 除け）
  - `daemon.ts` — 補充ループ（single-flight の `refill()`）と RSS 取り込み。
    失敗したネタは 3 回までリトライ
  - `sources.ts` / `html.ts` — URL 取得と本文抽出（DOM 無し、正規表現）
  - `script/` — 台本生成の差し替え口（`anthropic` / `dummy`）。プロンプトは
    `prompt.ts`。Claude は `@anthropic-ai/sdk` で structured output + streaming
  - `tts/` — 音声合成の差し替え口（`openai` / `command` / `dummy`）
  - `rss.ts` — RSS/Atom のパースと `feed.xml` の生成
- `web/server/controllers/` — `ingest.ts`（`POST /api/items`、Bearer 認証）、
  `episodes.ts`（queue / played / feed / audio。audio は Range 対応）
- `web/client/` — ブラウザに渡るもの全て。`deno.ns` 無しで型チェックされる
  - `routes.ts` — 全 URL の定義（サーバとクライアントで共有）
  - `lib/api.ts` — queue / played の JSON 型（サーバとクライアントで共有）
  - `islands/player.tsx` — プレイヤー本体（単一 `<audio>`、Media Session、 SW
    への precache 指示、位置の localStorage 保存）
  - `islands/share_form.tsx` — 手動投入フォーム兼 Web Share Target の受け口
  - `sw.js` — `/sw.js` で配信（scope を `/` にするため `static/` に置かない）。
    次の数本の音声をキャッシュし、Range をキャッシュから切り出して返す

## 決定事項（要件）

- 再生端末は 1 台。端末間の再生位置同期はしない（位置は端末の localStorage）
- ネタ投入（`POST /api/items`）だけ制限付き（`INGEST_TOKEN` の Bearer）。 他は
  public。音声 URL は ULID で推測されにくくしてある
- フィードバックは 👍 / スキップの 2 種。直近 20 件を台本生成に渡す
- 台本生成・音声合成は差し替え可能にしておく

## 開発

```bash
deno task dev    # http://localhost:8000（既定はダミーのプロバイダ）
deno task test   # テスト
deno task check  # 型チェック + lint + fmt
```

変更前後に `deno task check && deno task test` を通す。UI を触ったら実際に
サーバを立ててブラウザで再生・スキップ・自動で次へ進むことを確かめる。

## コーディング規約

- Deno ファースト（Web API 優先、Node.js API は必要最小限）
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース（例: `app_test.ts`）
- ページ/island の見た目は `@remix-run/component` の `css()` mixin と
  `web/client/tokens.ts` のトークンで書く (Tailwind / daisyUI は使わない)
- ブラウザへ渡るコードは `web/client/` に置き、`Deno.` を参照しない
- 追加した `import` は `deno.json`（ルート）にだけ書く
- 入力欄は `value` で束縛しない（打鍵と競合する）。`ref` で初期値を入れて
  送信時に読む
