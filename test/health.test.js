"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers.js");

let ctx;
test("server starts on a random loopback port", async () => {
  ctx = await startTestServer();
  assert.ok(ctx.port > 1024);
});
after(async () => { if (ctx) await ctx.inst.shutdown("tests"); });

test("GET /healthz returns the deploy-gate JSON", async () => {
  const res = await fetch(ctx.url + "/healthz");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof body.build === "string" && body.build.length >= 7);
  assert.equal(typeof body.playing, "number");
  assert.equal(body.playing, 0);
});

test("index.html is never cached and points at hashed assets", async () => {
  const res = await fetch(ctx.url + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  const html = await res.text();
  const m = html.match(/\/a\/([0-9a-f]{12})\/js\/client\.js/);
  assert.ok(m, "index references hashed client.js");
  assert.equal(m[1], ctx.inst.assetHash);
  assert.ok(html.includes(`/a/${ctx.inst.assetHash}/css/styles.css`));
  assert.ok(!/(src|href)="https?:\/\//.test(html), "no absolute script or stylesheet URLs in index.html");
});

test("hashed assets are immutable, unhashed ones revalidate", async () => {
  const hashed = await fetch(ctx.url + `/a/${ctx.inst.assetHash}/js/client.js`);
  assert.equal(hashed.status, 200);
  assert.match(hashed.headers.get("cache-control"), /immutable/);
  assert.match(hashed.headers.get("cache-control"), /max-age=31536000/);
  const plain = await fetch(ctx.url + "/js/client.js");
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("cache-control"), "no-cache");
  const sio = await fetch(ctx.url + "/socket.io/socket.io.js");
  assert.equal(sio.status, 200, "socket.io client is served locally");
});
