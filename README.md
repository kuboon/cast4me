# cast4me

自分専用のエンドレスポッドキャスト。ネタ（URL / テキスト /
テーマ）を投げておくと、 デーモンが台本を書いて音声にし、常に「未聴が N
本ある」状態を保つ。再生は PWA （または普通のポッドキャストアプリで
`feed.xml`）。

- 1 プロセス（`deno serve`）で API・PWA・補充デーモンを全部動かす
- 自宅マシンで動かし、Cloudflare Tunnel で公開する前提
- 状態は Deno KV（`DATA_DIR/cast4me.kv`）、音声は `DATA_DIR/audio/` に保存

## 動かす

```bash
# API キー無しで一周させる（台本はネタの読み上げ、音声はトーン）
INGEST_TOKEN=dev FALLBACK_THEMES="宇宙の話,料理の話" deno task dev
# → http://localhost:8000/

# ネタ投入
curl -X POST localhost:8000/api/items \
  -H 'authorization: Bearer dev' -H 'content-type: application/json' \
  -d '{"url":"https://example.com/article"}'
```

本番（Claude で台本、OpenAI で音声合成）:

```bash
export DATA_DIR=$HOME/cast4me-data
export PUBLIC_ORIGIN=https://cast.example.com
export INGEST_TOKEN=$(openssl rand -hex 24)
export SCRIPT_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-...
export TTS_PROVIDER=openai OPENAI_API_KEY=sk-...
deno task serve
cloudflared tunnel --url http://localhost:8000   # もしくは named tunnel
```

## API

| 区分     | エンドポイント                  | 備考                                                                                                           |
| -------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 制限付き | `POST /api/items`               | `Authorization: Bearer $INGEST_TOKEN`。JSON `{url?, text?, theme?, title?}` かフォーム（`title`/`text`/`url`） |
| public   | `GET /feed.xml`                 | Podcast RSS（enclosure 付き）                                                                                  |
| public   | `GET /audio/<id>[.<ext>]`       | 音声本体。`Range` 対応                                                                                         |
| public   | `GET /api/queue`                | 未聴エピソード一覧（古い順）、待機中ネタ数、生成中か                                                           |
| public   | `PUT /api/episodes/<id>/played` | 再生完了通知。body `{"feedback":"like"}` / `{"feedback":"skip"}` / `{}`                                        |

`/api/*` の unsafe メソッドは `cop()` でクロスオリジンのブラウザからは拒否される
（curl・iOS ショートカットは通る）。

## 環境変数

| 変数                                    | 既定                          | 説明                                                                                                                                    |
| --------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                              | `./data`（`web/server` 基準） | KV と音声の置き場                                                                                                                       |
| `PUBLIC_ORIGIN`                         | リクエストから推定            | `feed.xml` の絶対 URL 用。Tunnel 越しなら設定推奨                                                                                       |
| `INGEST_TOKEN`                          | なし                          | `POST /api/items` の Bearer トークン。未設定だと投入は全部 503                                                                          |
| `TARGET_UNPLAYED`                       | `3`                           | 未聴を何本キープするか（N）                                                                                                             |
| `EPISODE_MINUTES`                       | `5`                           | 1 エピソードの目安の長さ                                                                                                                |
| `REFILL_INTERVAL_SEC`                   | `300`                         | 補充ループの周期（ネタ投入・再生完了でも即時に走る）                                                                                    |
| `RSS_FEEDS`                             | なし                          | カンマ区切り。新着 5 件ずつネタとして取り込む                                                                                           |
| `RSS_INTERVAL_MIN`                      | `60`                          | RSS 取り込み周期                                                                                                                        |
| `FALLBACK_THEMES`                       | なし                          | ネタ切れ時に順番に使うテーマ（カンマ区切り）。未設定ならネタ待ち                                                                        |
| `SCRIPT_PROVIDER`                       | `dummy`                       | `anthropic` / `dummy`                                                                                                                   |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-opus-5-5`         | 台本生成（Claude）                                                                                                                      |
| `TTS_PROVIDER`                          | `dummy`                       | `openai` / `command` / `dummy`                                                                                                          |
| `OPENAI_API_KEY`                        | —                             | `openai` 用                                                                                                                             |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-4o-mini-tts` / `alloy`   |                                                                                                                                         |
| `OPENAI_TTS_INSTRUCTIONS`               | 落ち着いた日本語の語り        | 話し方の指示                                                                                                                            |
| `TTS_COMMAND` / `TTS_COMMAND_EXT`       | — / `mp3`                     | `command` 用。`{in}`（台本テキスト）と `{out}`（出力音声）を置換して実行。例: `say -v Kyoko -f {in} -o {out} --data-format=aac` + `m4a` |

## PWA

- `/` がプレイヤー。単一の `<audio>` を使い回し、`ended` で次の `src`
  に差し替える
- Service Worker が次の 3 本を事前キャッシュ（Range
  もキャッシュから返す）。再生済みはキャッシュから消す
- Media Session でロック画面にタイトル・スキップ（次へ）・シーク
- 再生位置は端末の `localStorage`。サーバへは再生完了と 👍 / スキップだけ
- 👍 は再生中に押しておくと、再生完了時に `like` として送られる。スキップは即
  `skip`
- `/share` が手動投入フォーム兼 Web Share Target
  の受け口。トークンは端末に保存し、 共有シートから来たら自動で
  `POST /api/items` する

開発のルールは [CLAUDE.md](./CLAUDE.md)。
