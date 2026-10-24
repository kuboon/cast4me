/**
 * The document shell.
 *
 * A component like any other: a setup function that returns a render function, placed as
 * `<Layout title={…}>…</Layout>`. What turns it into a response is `context.render`, from the
 * `render({ assets })` middleware in `server/app.tsx` — `renderToStream`, which keeps the runtime's
 * document swap working on soft navigations.
 *
 * The shell's CSS is right here as `css(...)` mixins; the renderer writes the ones a page used into
 * `<head>`. The one linked stylesheet, `static/app.css`, holds the tokens and the
 * `@layer base, rmx, app` order, so it has to come first in `<head>`.
 *
 * It also carries what makes the site an installable PWA: the manifest (which declares the Web
 * Share Target) and the iOS home-screen metas. The status bar style is left at its default on
 * purpose — `black-translucent` draws a blurred band over the page on iOS 26.
 */

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { routes } from "./routes.ts";
import { color, contentWidth } from "./tokens.ts";

export const SITE_NAME = "cast4me";

/** What every page hands the shell. */
export interface LayoutProps {
  title: string;
  description?: string;
  /**
   * The client runtime, for a page that places an island — resolved by the server, because where
   * the bundler put it is a thing only the server knows. Required, and `null` for a page with no
   * islands: forgetting it renders a page whose islands silently never hydrate.
   */
  script: ClientRuntime | null;
  children: RemixNode;
}

/** Where the client runtime lives, and what it pulls in behind it. */
export interface ClientRuntime {
  src: string;
  /** The chunks it imports, for `<link rel="modulepreload">`. */
  preloads: readonly string[];
}

/**
 * What every page module exports: a component, plus what the shell needs to frame it.
 *
 * `hydrate` is required rather than optional: an omitted flag is indistinguishable from a page that
 * genuinely ships nothing, and the page still renders.
 */
export interface PageModule<Props = Record<string, never>> {
  default: (handle: Handle<Props>) => () => RemixNode;
  title: string;
  description?: string;
  /** Whether the page places a client entry, so the shell boots the runtime for it. */
  hydrate: boolean;
}

export function Layout(handle: Handle<LayoutProps>) {
  return () => {
    const props = handle.props;
    return (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <title>{props.title}</title>
          {props.description
            ? <meta name="description" content={props.description} />
            : null}
          <link rel="stylesheet" href="/static/app.css" />
          <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
          <link rel="manifest" href={routes.manifest.href()} />
          <link rel="apple-touch-icon" href="/static/favicon.svg" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
          <meta name="theme-color" content="#c2410c" />
          <link
            rel="alternate"
            type="application/rss+xml"
            title={SITE_NAME}
            href={routes.feed.href()}
          />
          {(props.script?.preloads ?? []).map((href) => (
            <link key={href} rel="modulepreload" href={href} />
          ))}
        </head>
        <body>
          <header mix={[bandStyle, headerStyle]}>
            <a mix={brandStyle} href={routes.home.href()}>{SITE_NAME}</a>
            <nav mix={navStyle}>
              {
                /*
                Document navigations: the player owns the one `<audio>` element, and a soft
                navigation away would tear it down mid-episode just the same — this way at least
                the browser's back button brings the page back whole.
              */
              }
              <a href={routes.home.href()} data-rmx-document="">プレイヤー</a>
              <a href={routes.share.href()} data-rmx-document="">ネタ投入</a>
              <a href={routes.feed.href()} data-rmx-document="">RSS</a>
            </nav>
          </header>
          <main mix={[bandStyle, mainStyle]}>{props.children}</main>
          {props.script
            ? <script type="module" src={props.script.src}></script>
            : null}
        </body>
      </html>
    );
  };
}

// --- styles -----------------------------------------------------------------

const bandStyle = css({
  width: "100%",
  maxWidth: contentWidth,
  marginInline: "auto",
  paddingInline: "1rem",
});

const headerStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  paddingBlock: "0.9rem",
  borderBottom: `1px solid ${color.border}`,
});

const brandStyle = css({
  fontWeight: 700,
  fontSize: "1.1rem",
  textDecoration: "none",
  color: color.fg,
});

const navStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  fontSize: "0.95rem",
});

const mainStyle = css({ paddingBlock: "1.5rem 3rem" });
