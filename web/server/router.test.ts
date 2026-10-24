import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with nav links and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "Remix3 on Deno Template");
  assertStringIncludes(html, "kuboon.github.io/deno-remix-tmpl");
  assertStringIncludes(html, 'href="/hydration"');
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // Soft navigation is the runtime's default now; no frame target attributes.
  assert(!html.includes("rmx-target"));
});

Deno.test("GET /hydration includes the Counter clientEntry marker", async () => {
  const res = await router.fetch(new Request("http://x/hydration"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "/assets/islands/counter");
  assertStringIncludes(html, "Counter");
  assertStringIncludes(html, 'aria-label="increment"');
});

Deno.test("GET /my embeds idp-origin meta", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "https://id.kbn.one");
});

Deno.test("GET /sw.js serves the worker with a root scope", async () => {
  const res = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "javascript");
  assertEquals(res.headers.get("service-worker-allowed"), "/");
  assertStringIncludes(await res.text(), "addEventListener");
});

Deno.test("GET /api/protected without DPoP proof is rejected", async () => {
  const res = await router.fetch(new Request("http://x/api/protected"));
  assert(
    res.status === 401 || res.status === 400,
    `expected 400 or 401, got ${res.status}`,
  );
  await res.body?.cancel();
});

Deno.test("GET /api/turso reports unconfigured without Turso env", async () => {
  // No TURSO_DATABASE_URL in the test environment — the sample degrades to a
  // 503 instead of attempting a connection.
  const res = await router.fetch(new Request("http://x/api/turso"));
  assertEquals(res.status, 503);
  const body = await res.json() as { configured?: boolean };
  assertEquals(body.configured, false);
});

Deno.test("GET /.well-known/jwks.json publishes the RP key", async () => {
  const res = await router.fetch(
    new Request("http://x/.well-known/jwks.json"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

for (
  const [path, needle] of [
    ["/blog", "Blog"],
    ["/blog/hello-remix-ssg", "Hello, remix-ssg"],
    ["/showcase", "showcase"],
    ["/spa/1", "SPA"],
  ] as const
) {
  Deno.test(`GET ${path} renders inside the shell`, async () => {
    const res = await router.fetch(new Request(`http://x${path}`));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(html, "<main");
    assertStringIncludes(html, needle);
  });
}

Deno.test("GET /fullscreen is a bare page with no shell", async () => {
  const res = await router.fetch(new Request("http://x/fullscreen"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(!html.includes("<main"));
  assertStringIncludes(html, "FullscreenGame");
});

Deno.test("GET /spa/unknown is a 404", async () => {
  const res = await router.fetch(new Request("http://x/spa/nope"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
});
