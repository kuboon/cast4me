/**
 * The app, wired by hand: `client/routes.ts` says which URLs exist, and this maps each to what
 * answers it. Everything that answers needs the podcast — its store and its daemon — so the router
 * is built around one, by {@link createApp}. `router.tsx` builds the real one for `deno serve`;
 * the tests build one over an in-memory store.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { cop } from "@remix-run/cop-middleware";
import { render } from "@remix-run/render-middleware";
import { createFileTree } from "@remix-kbn/ssg/site";

import { assets, assetsPath } from "./assets.ts";
import { Layout, type PageModule, SITE_NAME } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";
import * as Home from "../client/pages/index.tsx";
import * as Share from "../client/pages/share.tsx";
import type { ClientRuntime } from "../client/layout.tsx";
import type { Podcast } from "./podcast/mod.ts";
import { ingestAction } from "./controllers/ingest.ts";
import {
  audioAction,
  feedAction,
  playedAction,
  queueAction,
} from "./controllers/episodes.ts";

const entry = await assets.getScriptEntry("hydration.ts");

/** The `<script type="module">` a hydrating page loads, and the chunks to preload behind it. */
const clientRuntime: ClientRuntime = {
  src: entry.href,
  preloads: entry.preloads,
};

/** The files under `client/static/`, served verbatim at their own names. */
const staticFiles = await createFileTree({
  rootDir: `${import.meta.dirname}/../client/static`,
  basePath: "/static",
  cacheControl: "public, max-age=3600",
});

/**
 * The service worker, from `client/sw.js` — a route of its own because a worker's scope is the
 * directory it is served from, and it has to cover `/audio/*`.
 */
const serviceWorker = await Deno.readTextFile(
  new URL("../client/sw.js", import.meta.url),
);

/**
 * The web app manifest. `share_target` is what puts cast4me in the share sheet; it is a GET to
 * `/share` because the API wants a token the share sheet cannot add — see `islands/share_form.tsx`.
 */
const manifest = {
  name: SITE_NAME,
  short_name: SITE_NAME,
  description: "自分専用のエンドレスポッドキャスト",
  lang: "ja",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#c2410c",
  icons: [{
    src: "/static/favicon.svg",
    sizes: "any",
    type: "image/svg+xml",
    purpose: "any",
  }],
  share_target: {
    action: "/share",
    method: "GET",
    params: { title: "title", text: "text", url: "url" },
  },
};

function makeRouter() {
  // `cop()` rejects unsafe cross-origin requests from browsers (by `Sec-Fetch-Site` / `Origin`),
  // so another site cannot mark episodes played. curl and iOS Shortcuts send neither header and
  // pass; `POST /api/items` is behind its token anyway.
  return createRouter({ middleware: [cop(), render({ assets })] });
}

/** The request context those middlewares produce — `context.render`, in practice. */
export type AppContext = RouterContext<ReturnType<typeof makeRouter>>;

declare module "@remix-run/fetch-router" {
  interface RouterTypes {
    context: AppContext;
  }
}

function pageAction(page: PageModule) {
  const Page = page.default;
  return (context: AppContext): Response =>
    context.render(
      <Layout
        title={page.title}
        description={page.description}
        script={page.hydrate ? clientRuntime : null}
      >
        <Page />
      </Layout>,
    );
}

export function createApp(podcast: Podcast) {
  const router = makeRouter();

  const top = createController(routes, {
    actions: {
      home: pageAction(Home),
      share: pageAction(Share),
      feed: feedAction(podcast),
      audio: audioAction(podcast),
      manifest: () =>
        Response.json(manifest, {
          headers: { "content-type": "application/manifest+json" },
        }),
    },
  });

  const api = createController(routes.api, {
    actions: {
      items: ingestAction(podcast),
      queue: queueAction(podcast),
      played: playedAction(podcast),
    },
  });

  router.map(routes, top);
  router.map(routes.api, api);
  router.get("/static/*path", ({ request }) => staticFiles.fetch(request));
  router.get(`${assetsPath}/*path`, ({ request }) => assets.fetch(request));
  router.get("/sw.js", () =>
    new Response(serviceWorker, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "service-worker-allowed": "/",
      },
    }));

  return router;
}
