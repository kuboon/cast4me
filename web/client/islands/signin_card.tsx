/**
 * SignInCard — a @remix-run/component `clientEntry` for the /my page.
 *
 * Shows the DPoP session status, thumbprint, and a sign-out button. Signing in
 * is initiated from the navbar (NavAuth); when signed out this card just points
 * the user there.
 *
 * As a clientEntry, the server emits a hydration marker that survives soft
 * navigation, and the page's `run()` (../hydration.ts) picks it up and
 * hydrates in place.
 *
 * Setup runs on both server and client. Browser-only work (DPoP key gen via
 * IndexedDB, IdP probing) is gated on `typeof document !== "undefined"`.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { sessionStore } from "../session.ts";
import { actionStyle, alertStyle, cardStyle } from "../theme.ts";

export interface SignInCardProps {
  idpOrigin: string;
  [key: string]: SerializableValue;
}

type Variant = "info" | "success" | "error" | "";

export const SignInCard = clientEntry(
  import.meta.url,
  function SignInCard(handle: Handle<SignInCardProps>) {
    let signoutBusy = false;
    // Transient message for a user action (sign-out); otherwise the status is
    // derived from the shared session state in render.
    let actionStatus: { message: string; variant: Variant } | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const onSignoutClick = async () => {
      signoutBusy = true;
      actionStatus = null;
      handle.update();
      try {
        await sessionStore.signOut();
        actionStatus = {
          message: "サインアウトしました。",
          variant: "success",
        };
      } catch (error) {
        actionStatus = {
          message: `サインアウトに失敗: ${(error as Error).message}`,
          variant: "error",
        };
      } finally {
        signoutBusy = false;
        handle.update();
      }
    };

    return () => {
      const ready = sessionStore.ready;
      const signedIn = sessionStore.userId !== null;

      let status: string;
      let statusVariant: Variant;
      if (actionStatus) {
        status = actionStatus.message;
        statusVariant = actionStatus.variant;
      } else if (!ready) {
        status = "セッションを確認しています…";
        statusVariant = "info";
      } else if (signedIn) {
        status = "セッションを取得しました。";
        statusVariant = "success";
      } else {
        status = "";
        statusVariant = "";
      }

      const userInfo = signedIn
        ? `サインイン中: ${sessionStore.userId}`
        : ready
        ? "サインインしていません。"
        : "…";
      const thumbprint = sessionStore.thumbprint || "…";

      return (
        <section mix={cardStyle}>
          <h2>状態</h2>
          <div role="alert" data-kind={statusVariant} mix={alertStyle}>
            <span>{status}</span>
          </div>
          <p>{userInfo}</p>
          <p>
            このブラウザの DPoP thumbprint: <code>{thumbprint}</code>
          </p>
          {ready && !signedIn
            ? (
              <p>
                サインインするには、ナビバー右上の「Sign
                In」ボタンを使用してください。
              </p>
            )
            : null}
          <div>
            {ready && signedIn
              ? (
                <button
                  type="button"
                  disabled={signoutBusy}
                  mix={[actionStyle, on("click", onSignoutClick)]}
                >
                  サインアウト
                </button>
              )
              : null}
          </div>
        </section>
      );
    };
  },
);
