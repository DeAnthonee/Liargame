"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startTestServer, connect, call, waitFor, makeRoom } = require("./helpers.js");

test("rooms survive a SIGTERM-style restart when DATA_DIR is set", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chameleon-test-"));
  const first = await startTestServer({ dataDir });
  const { code, sockets, host } = await makeRoom(first.url, ["Jo", "Kim", "Lee"]);
  await call(host, "start");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "reveal")));
  const roles = Object.fromEntries(sockets.map(s => [s.latest.me.name, s.latest.me.role]));
  const secret = sockets.find(s => s.latest.me.role === "agent").latest.me.secretIdx;

  const restarting = new Promise(resolve => host.once("serverRestarting", resolve));
  const how = await first.inst.shutdown("SIGTERM");
  assert.equal(how, "clean");
  assert.equal((await restarting).resume, true);
  sockets.forEach(s => s.close());
  assert.ok(fs.existsSync(path.join(dataDir, "rooms.json")), "snapshot written");

  const second = await startTestServer({ dataDir });
  try {
    assert.equal(second.inst.loadSnapshot(), 1, "one room restored");
    assert.ok(!fs.existsSync(path.join(dataDir, "rooms.json")), "snapshot consumed");
    const back = [];
    for (const name of ["Jo", "Kim", "Lee"]) {
      const s = await connect(second.url);
      const res = await call(s, "rejoin", { code, key: "key-" + name });
      assert.equal(res.ok, true, name + " rejoins");
      back.push(s);
    }
    await Promise.all(back.map(s => waitFor(s, st => st.room.phase === "reveal" && st.room.players.every(p => p.connected))));
    for (const s of back) assert.equal(s.latest.me.role, roles[s.latest.me.name], "roles preserved");
    assert.equal(back.find(s => s.latest.me.role === "agent").latest.me.secretIdx, secret, "secret word preserved");
    const h = await fetch(second.url + "/healthz").then(r => r.json());
    assert.equal(h.playing, 1);
    back.forEach(s => s.close());
  } finally {
    await second.inst.shutdown("tests");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("without DATA_DIR, shutdown is still clean and tells clients the room will close", async () => {
  const inst = await startTestServer({ dataDir: null });
  const { sockets, host } = await makeRoom(inst.url, ["Max", "Nia", "Oli"]);
  const msg = new Promise(resolve => host.once("serverRestarting", resolve));
  const how = await inst.inst.shutdown("SIGTERM");
  assert.equal(how, "clean");
  assert.equal((await msg).resume, false);
  sockets.forEach(s => s.close());
});
