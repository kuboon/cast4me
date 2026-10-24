import { css, type Handle } from "@remix-run/component";

import { IDP_ORIGIN } from "../idp.ts";
import { PushCard } from "../islands/push_card.tsx";
import { SignInCard } from "../islands/signin_card.tsx";
import { cardStyle } from "../theme.ts";

export const title = "マイページ — Remix3 on Deno Template";
export const description =
  "外部 IdP (id.kbn.one) を使ったサインインとプッシュ通知のサンプル。";

/** Both cards are islands. */
export const hydrate = true;

export default function My(_handle: Handle) {
  return () => (
    <>
      <meta name="idp-origin" content={IDP_ORIGIN} />
      <h1>マイページ</h1>
      <p>
        このページは外部 IdP (id.kbn.one) を使ったサインイン UX のサンプルです。
        DPoP 鍵を生成し、IdP に thumbprint を bind してもらうことで Cookie
        レスにセッションを共有します。 サインインはナビバー右上の「Sign
        In」から行います。
      </p>

      <SignInCard idpOrigin={IDP_ORIGIN} />

      <PushCard idpOrigin={IDP_ORIGIN} />

      <section mix={cardStyle}>
        <h2>仕組み</h2>
        <ol mix={listStyle}>
          <li>
            このページが <code>thumbprint</code> を計算
          </li>
          <li>
            「サインイン」で{" "}
            <code>{IDP_ORIGIN}/authorize?dpop_jkt&amp;redirect_uri</code> へ遷移
          </li>
          <li>
            IdP がパスキー認証 → <code>POST /bind_session</code>{" "}
            でこの thumbprint に userId を紐付け
          </li>
          <li>
            戻ってきたページで <code>fetchDpop GET {IDP_ORIGIN}/session</code>
            {" "}
            が userId を返す
          </li>
        </ol>
      </section>
    </>
  );
}

const listStyle = css({
  paddingLeft: "1.1rem",
  "& li": { marginBlock: "0.4rem" },
});
