/**
 * The browser modules, compiled as one graph.
 *
 * Every entrypoint below goes into a single `Deno.bundle({ codeSplitting: true })` call, which is
 * the point: a module two of them import — the Remix component runtime, the routes — is
 * emitted once, into a chunk both import, so it is one module at runtime rather than two copies.
 *
 * The islands are globbed rather than listed: an island is a file in a directory, and that is the
 * decision. `@remix-kbn/assets-deno` expands the pattern at startup, sorted, and fails on a
 * pattern that matches nothing.
 *
 * Every path here is under `client/`: this is the server compiling the browser's half of the app.
 */

import { createAssetServer } from "@remix-kbn/assets-deno";

/** The directory every entrypoint below, and every `clientEntry()` id, is resolved against. */
const clientDir = new URL("../client/", import.meta.url);

/** Where the chunks are served, and where `entryUrl()` resolves against. */
export const assetsPath = "/assets";

export const assets = await createAssetServer({
  rootDir: decodeURIComponent(clientDir.pathname),
  entrypoints: [
    // The client runtime. Every page loads this one; the islands ride in the chunks it shares
    // with them.
    "hydration.ts",
    // Every island, by where it is rather than by name.
    "islands/*.tsx",
  ],
  basePath: assetsPath,
  mode: "bundle",
  bundle: { sourcemap: "none" },
});
