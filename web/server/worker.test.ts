import { assert, assertEquals } from "@std/assert";
import worker from "./worker.ts";

const get = (path: string) => worker.fetch(new Request(`http://x${path}`));

Deno.test("worker serves the RP JWKS", async () => {
  const res = await get("/.well-known/jwks.json");
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

Deno.test("worker /api/turso degrades to 503 without Turso env", async () => {
  const res = await get("/api/turso");
  assertEquals(res.status, 503);
  await res.body?.cancel();
});

Deno.test("worker /api/protected rejects a request without a DPoP proof", async () => {
  const res = await get("/api/protected");
  assert(res.status === 400 || res.status === 401, `got ${res.status}`);
  await res.body?.cancel();
});

Deno.test("worker does not render pages (static assets answer those)", async () => {
  const res = await get("/hydration");
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

const post = (headers: Record<string, string>) =>
  worker.fetch(
    new Request("http://x/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
  );

Deno.test("worker rejects a cross-origin browser POST (cop)", async () => {
  const cases: Record<string, string>[] = [
    { "sec-fetch-site": "cross-site" },
    { origin: "http://evil.example" },
  ];
  for (const headers of cases) {
    const res = await post(headers);
    assertEquals(res.status, 403);
    await res.body?.cancel();
  }
});

Deno.test("worker lets a same-origin POST through to the action", async () => {
  const res = await post({ "sec-fetch-site": "same-origin" });
  // The empty body is the action's own 400, not cop's 403.
  assertEquals(res.status, 400);
  await res.body?.cancel();
});
