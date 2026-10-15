"use strict";
const { createServer } = require("../server.js");
const { io: ioc } = require("socket.io-client");

async function startTestServer(options) {
  const inst = createServer(Object.assign({ log: () => {} }, options || {}));
  const addr = await inst.listen(0, "127.0.0.1"); // random high port, loopback only
  const url = `http://127.0.0.1:${addr.port}`;
  return { inst, url, port: addr.port };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const s = ioc(url, { transports: ["websocket"], reconnection: false, forceNew: true });
    s.latest = null;
    s.on("state", st => { s.latest = st; });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function call(socket, ev, data) {
  return new Promise(resolve => socket.emit(ev, data || {}, resolve));
}

function waitFor(socket, pred, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (socket.latest && pred(socket.latest)) return resolve(socket.latest);
    const t = setTimeout(() => { socket.off("state", h); reject(new Error("timeout waiting for " + (label || "state"))); }, timeoutMs || 3000);
    const h = st => { if (pred(st)) { clearTimeout(t); socket.off("state", h); resolve(st); } };
    socket.on("state", h);
  });
}

async function makeRoom(url, names) {
  const sockets = [];
  const host = await connect(url);
  const created = await call(host, "create", { name: names[0], key: "key-" + names[0] });
  if (!created.ok) throw new Error(created.error);
  sockets.push(host);
  for (const n of names.slice(1)) {
    const s = await connect(url);
    const res = await call(s, "join", { name: n, code: created.code, key: "key-" + n });
    if (!res.ok) throw new Error(res.error);
    sockets.push(s);
  }
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.players.length === names.length, "all joined")));
  return { code: created.code, sockets, host };
}

module.exports = { startTestServer, connect, call, waitFor, makeRoom };
