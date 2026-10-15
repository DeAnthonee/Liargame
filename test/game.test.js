"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, connect, call, waitFor, makeRoom } = require("./helpers.js");

let ctx;
const open = [];
test("boot", async () => { ctx = await startTestServer(); });
after(async () => { open.forEach(s => s.close()); if (ctx) await ctx.inst.shutdown("tests"); });

async function playClues(sockets) {
  for (let i = 0; i < sockets.length; i++) {
    await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "debate" || (st.room.phase === "clues" && st.room.round.clues.length === i), "clue turn " + i)));
    const turn = sockets.find(s => s.latest.room.round.currentClueId === s.latest.me.id);
    assert.ok(turn, "someone has the clue turn");
    const res = await call(turn, "submitClue", { word: "clue" + i });
    assert.equal(res.ok, true);
  }
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "debate", "debate")));
}

test("full round: lobby -> reveal -> clues -> debate -> vote -> guess -> result, with scoring", async () => {
  const { sockets, host } = await makeRoom(ctx.url, ["Alice", "Bob", "Cara"]);
  open.push(...sockets);
  assert.equal(host.latest.room.hostId, host.latest.me.id);
  assert.equal((await call(sockets[1], "start")).ok, false, "non-host cannot start");

  host.emit("updateSettings", { debateSeconds: 0 });
  await waitFor(host, st => st.room.settings.debateSeconds === 0, "settings");
  assert.equal((await call(host, "start")).ok, true);
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "reveal", "reveal")));

  const h = await fetch(ctx.url + "/healthz").then(r => r.json());
  assert.equal(h.playing, 1, "healthz counts the live match");

  const chams = sockets.filter(s => s.latest.me.role === "chameleon");
  const agents = sockets.filter(s => s.latest.me.role === "agent");
  assert.equal(chams.length, 1);
  assert.equal(agents.length, 2);
  const cham = chams[0];
  assert.equal(cham.latest.me.secretIdx, null, "chameleon never receives the secret");
  assert.equal(cham.latest.room.round.chameleonId, null, "identity hidden before result");
  const secretIdx = agents[0].latest.me.secretIdx;
  assert.equal(agents[1].latest.me.secretIdx, secretIdx);

  for (const s of sockets) s.emit("seenCard");
  await playClues(sockets);
  assert.equal(host.latest.room.round.clues.length, 3);

  host.emit("endDebate");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "vote", "vote")));
  assert.equal((await call(cham, "vote", { id: cham.latest.me.id })).ok, false, "no self votes");
  for (const a of agents) assert.equal((await call(a, "vote", { id: cham.latest.me.id })).ok, true);
  assert.equal((await call(cham, "vote", { id: agents[0].latest.me.id })).ok, true);
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "guess", "guess")));
  assert.equal(host.latest.room.round.guessesAllowed, 2, "3 players: two guesses");

  assert.equal((await call(agents[0], "guess", { idx: 0 })).ok, false, "only the chameleon guesses");
  const wrong1 = (secretIdx + 1) % 16, wrong2 = (secretIdx + 2) % 16;
  assert.equal((await call(cham, "guess", { idx: wrong1 })).ok, true);
  await waitFor(host, st => st.room.round.guesses.length === 1, "one guess");
  assert.equal(host.latest.room.phase, "guess");
  assert.equal((await call(cham, "guess", { idx: wrong2 })).ok, true);
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "result", "result")));

  const r = host.latest.room.round;
  assert.equal(r.outcome, "caught");
  assert.equal(r.chameleonId, cham.latest.me.id);
  assert.equal(r.secretIdx, secretIdx);
  const scoreOf = id => host.latest.room.players.find(p => p.id === id).score;
  assert.equal(scoreOf(cham.latest.me.id), 0);
  for (const a of agents) assert.equal(scoreOf(a.latest.me.id), 2);

  host.emit("nextRound");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "reveal" && st.room.roundNumber === 2, "round 2")));
  assert.equal(host.latest.room.dealerId, cham.latest.me.id, "the chameleon deals next");
});

test("three-way tie goes to the dealer, wrong accusation lets the chameleon escape with 2 points", async () => {
  const { sockets, host } = await makeRoom(ctx.url, ["Dee", "Eve", "Fay"]);
  open.push(...sockets);
  host.emit("updateSettings", { debateSeconds: 0 });
  await waitFor(host, st => st.room.settings.debateSeconds === 0);
  await call(host, "start");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "reveal")));
  for (const s of sockets) s.emit("seenCard");
  await playClues(sockets);
  host.emit("endDebate");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "vote")));
  const ids = sockets.map(s => s.latest.me.id);
  await call(sockets[0], "vote", { id: ids[1] });
  await call(sockets[1], "vote", { id: ids[2] });
  await call(sockets[2], "vote", { id: ids[0] });
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "tiebreak")));
  const dealerId = host.latest.room.round.dealerId;
  const dealer = sockets.find(s => s.latest.me.id === dealerId);
  const notDealer = sockets.find(s => s.latest.me.id !== dealerId);
  assert.equal((await call(notDealer, "tiebreak", { id: ids[0] })).ok, false, "only the dealer breaks ties");
  const cham = sockets.find(s => s.latest.me.role === "chameleon");
  const innocent = sockets.find(s => s.latest.me.role === "agent");
  assert.equal((await call(dealer, "tiebreak", { id: innocent.latest.me.id })).ok, true);
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "result")));
  assert.equal(host.latest.room.round.outcome, "escaped");
  assert.equal(host.latest.room.players.find(p => p.id === cham.latest.me.id).score, 2);
});

test("a player who drops mid-game keeps their seat and can rejoin with their key", async () => {
  const { code, sockets, host } = await makeRoom(ctx.url, ["Gus", "Hal", "Ivy"]);
  open.push(...sockets);
  await call(host, "start");
  await Promise.all(sockets.map(s => waitFor(s, st => st.room.phase === "reveal")));
  const dropped = sockets[2];
  const droppedId = dropped.latest.me.id;
  const role = dropped.latest.me.role;
  dropped.close();
  await waitFor(host, st => st.room.players.find(p => p.id === droppedId).connected === false, "marked away");
  assert.equal(host.latest.room.players.length, 3, "seat kept");
  const back = await connect(ctx.url);
  open.push(back);
  const res = await call(back, "rejoin", { code, key: "key-Ivy" });
  assert.equal(res.ok, true);
  assert.equal(res.playerId, droppedId);
  await waitFor(back, st => st.me.id === droppedId);
  assert.equal(back.latest.me.role, role, "same role after rejoin");
  assert.equal((await call(await connect(ctx.url), "join", { code, name: "Late", key: "key-Late" })).ok, false, "no new joins mid-game");
});

test("room code validation and limits", async () => {
  const s = await connect(ctx.url);
  open.push(s);
  assert.equal((await call(s, "join", { code: "ZZZZ", name: "Nobody", key: "k" })).ok, false);
  assert.equal((await call(s, "create", { name: "", key: "k" })).ok, false);
  const created = await call(s, "create", { name: "  Spacey   Name  ", key: "k" });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z]{4}$/);
  await waitFor(s, st => st.room.players.length === 1);
  assert.equal(s.latest.room.players[0].name, "Spacey Name");
  assert.equal((await call(s, "addCustomTopic", { name: "Short", words: ["a", "b"] })).ok, false);
  assert.equal((await call(s, "addCustomTopic", { name: "Movies", words: Array.from({ length: 16 }, (_, i) => "Film " + i) })).ok, true);
  await waitFor(s, st => st.room.topics.some(t => t.name === "Movies"));
});
