/* Chameleon online: lobby + game server. Every player joins from their own phone. */
"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const BUILTIN_TOPICS = require("./public/js/topics.js");

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const WIN_SCORE = 5;
const COLS = ["A", "B", "C", "D"];
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;   // drop rooms untouched for 2h
const EMPTY_ROOM_MS = 10 * 60 * 1000;      // drop rooms with nobody connected for 10m
const LOBBY_LEAVE_GRACE_MS = 60 * 1000;    // lobby players who vanish are removed after 60s

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();   // code -> room
const socketIndex = new Map(); // socket.id -> { code, playerId }

// ---------- helpers ----------
function rand(n) { return crypto.randomInt(n); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do { code = Array.from({ length: 4 }, () => letters[rand(letters.length)]).join(""); } while (rooms.has(code));
  return code;
}
function shortId() { return crypto.randomBytes(4).toString("hex"); }
function cleanName(n) { return String(n || "").trim().replace(/\s+/g, " ").slice(0, 16); }
function coordLabel(idx) { return COLS[idx % 4] + (Math.floor(idx / 4) + 1); }

function allTopics(room) {
  return BUILTIN_TOPICS.map((t, i) => ({ id: "b" + i, name: t.name, words: t.words, builtin: true }))
    .concat(room.customTopics.map((t, i) => ({ id: "c" + i, name: t.name, words: t.words, builtin: false })));
}
function enabledTopics(room) { return allTopics(room).filter(t => !room.disabledTopics.includes(t.id)); }

function player(room, id) { return room.players.find(p => p.id === id); }
function playerByKey(room, key) { return room.players.find(p => p.key === key); }
function connectedPlayers(room) { return room.players.filter(p => p.connected); }
function touch(room) { room.lastActivity = Date.now(); }

// ---------- room lifecycle ----------
function createRoom(hostName, key) {
  const room = {
    code: makeCode(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    hostId: null,
    players: [],
    settings: { scoring: true, debateSeconds: 120, hideCardLarge: true },
    customTopics: [],
    disabledTopics: [],
    deck: [],
    roundNumber: 0,
    dealerId: null,
    phase: "lobby",
    round: null,
    timer: null,
    leaveTimers: new Map()
  };
  const p = addPlayer(room, hostName, key);
  room.hostId = p.id;
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, name, key) {
  const p = { id: shortId(), key, name, score: 0, connected: true, socketId: null };
  room.players.push(p);
  return p;
}

function removePlayer(room, id) {
  const idx = room.players.findIndex(p => p.id === id);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  if (room.hostId === id) {
    const next = connectedPlayers(room)[0] || room.players[0];
    room.hostId = next ? next.id : null;
  }
  if (room.players.length === 0) { destroyRoom(room); return; }
  if (room.phase !== "lobby" && room.phase !== "gameover") {
    // Removing a player mid-game: keep things consistent.
    if (room.round) {
      if (room.round.chameleonId === id || room.players.length < MIN_PLAYERS) {
        // Can't continue this round sensibly. Abandon the round.
        clearRoomTimer(room);
        room.phase = "lobby";
        room.round = null;
        room.notice = room.players.length < MIN_PLAYERS ? "Not enough players left. Back to the lobby." : "The Chameleon left the game. Round abandoned.";
      } else {
        room.round.clueOrder = room.round.clueOrder.filter(pid => pid !== id);
        room.round.clues = room.round.clues.filter(c => c.id !== id);
        delete room.round.votes[id];
        if (room.round.clueTurn >= room.round.clueOrder.length) room.round.clueTurn = room.round.clueOrder.length - 1;
        if (room.phase === "clues" && room.round.clues.length >= room.round.clueOrder.length) startDebate(room);
        if (room.phase === "vote") maybeTally(room);
      }
    }
  }
  if (room.dealerId === id) room.dealerId = room.players[0].id;
}

function destroyRoom(room) {
  clearRoomTimer(room);
  for (const t of room.leaveTimers.values()) clearTimeout(t);
  rooms.delete(room.code);
}

function clearRoomTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyConnected = room.players.some(p => p.connected);
    if (now - room.lastActivity > ROOM_IDLE_MS || (!anyConnected && now - room.lastActivity > EMPTY_ROOM_MS)) destroyRoom(room);
  }
}, 60 * 1000);

// ---------- game flow ----------
function startGame(room) {
  room.players.forEach(p => { p.score = 0; });
  room.deck = [];
  room.roundNumber = 0;
  room.dealerId = room.players[rand(room.players.length)].id;
  room.notice = null;
  startRound(room);
}

function drawTopic(room) {
  const enabled = enabledTopics(room);
  if (room.deck.length === 0) room.deck = shuffle(enabled.map(t => t.id));
  let id = room.deck.pop();
  let topic = allTopics(room).find(t => t.id === id && !room.disabledTopics.includes(t.id));
  if (!topic) topic = enabled[rand(enabled.length)];
  return topic;
}

function orderFrom(room, startId) {
  const n = room.players.length;
  const start = Math.max(0, room.players.findIndex(p => p.id === startId));
  const order = [];
  for (let i = 0; i < n; i++) order.push(room.players[(start + i) % n].id);
  return order;
}

function startRound(room) {
  clearRoomTimer(room);
  room.roundNumber += 1;
  if (!player(room, room.dealerId)) room.dealerId = room.players[0].id;
  const topic = drawTopic(room);
  room.round = {
    topic: { id: topic.id, name: topic.name, words: topic.words },
    secretIdx: rand(16),
    chameleonId: room.players[rand(room.players.length)].id,
    dealerId: room.dealerId,
    dice: { yellow: 1 + rand(6), blue: 1 + rand(8) },
    seen: {},
    clueOrder: orderFrom(room, room.dealerId),
    clues: [],
    clueTurn: 0,
    debateEndsAt: null,
    votes: {},
    tally: null,
    tied: null,
    accusedId: null,
    guesses: [],
    guessesAllowed: room.players.length === 3 ? 2 : 1,
    outcome: null,
    deltas: null,
    cardHidden: false
  };
  room.phase = "reveal";
}

function maybeStartClues(room) {
  const r = room.round;
  if (room.players.every(p => r.seen[p.id] || !p.connected) && room.players.some(p => r.seen[p.id])) {
    room.phase = "clues";
  }
}

function currentClueId(room) {
  const r = room.round;
  return r.clueOrder[r.clueTurn] || null;
}

function advanceClue(room) {
  const r = room.round;
  r.clueTurn += 1;
  if (r.clueTurn >= r.clueOrder.length) startDebate(room);
}

function startDebate(room) {
  const r = room.round;
  room.phase = "debate";
  clearRoomTimer(room);
  if (room.players.length >= 7 && room.settings.hideCardLarge) r.cardHidden = true;
  const secs = room.settings.debateSeconds;
  if (secs > 0) {
    r.debateEndsAt = Date.now() + secs * 1000;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (room.phase === "debate") { startVote(room); broadcast(room); }
    }, secs * 1000);
  } else {
    r.debateEndsAt = null;
  }
}

function startVote(room) {
  clearRoomTimer(room);
  room.round.votes = {};
  room.phase = "vote";
}

function maybeTally(room, force) {
  const r = room.round;
  const voters = connectedPlayers(room);
  const allVoted = voters.every(p => r.votes[p.id]);
  if (!allVoted && !force) return;
  const counts = {};
  room.players.forEach(p => { counts[p.id] = 0; });
  Object.values(r.votes).forEach(t => { if (counts[t] != null) counts[t] += 1; });
  r.tally = counts;
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter(id => counts[id] === max);
  if (top.length === 1) {
    accuse(room, top[0]);
  } else {
    r.tied = top;
    room.phase = "tiebreak";
  }
}

function accuse(room, id) {
  const r = room.round;
  r.accusedId = id;
  r.tied = null;
  if (id === r.chameleonId) {
    room.phase = "guess";
  } else {
    finishRound(room, "escaped");
  }
}

function guess(room, idx) {
  const r = room.round;
  if (r.guesses.includes(idx)) return;
  r.guesses.push(idx);
  if (idx === r.secretIdx) finishRound(room, "guessed");
  else if (r.guesses.length >= r.guessesAllowed) finishRound(room, "caught");
}

function finishRound(room, outcome) {
  const r = room.round;
  r.outcome = outcome;
  const deltas = {};
  room.players.forEach(p => { deltas[p.id] = 0; });
  if (outcome === "escaped") deltas[r.chameleonId] = 2;
  else if (outcome === "guessed") deltas[r.chameleonId] = 1;
  else room.players.forEach(p => { if (p.id !== r.chameleonId) deltas[p.id] = 2; });
  r.deltas = deltas;
  if (room.settings.scoring) room.players.forEach(p => { p.score += deltas[p.id]; });
  room.phase = "result";
}

function nextRound(room) {
  room.dealerId = room.round.chameleonId;
  if (room.settings.scoring && room.players.some(p => p.score >= WIN_SCORE)) {
    room.phase = "gameover";
    room.round = null;
  } else {
    startRound(room);
  }
}

// ---------- state broadcast ----------
function publicState(room) {
  const r = room.round;
  const revealAll = room.phase === "result" || room.phase === "gameover";
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    notice: room.notice || null,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
    settings: room.settings,
    topics: allTopics(room).map(t => ({ id: t.id, name: t.name, builtin: t.builtin, enabled: !room.disabledTopics.includes(t.id), words: t.builtin ? undefined : t.words })),
    roundNumber: room.roundNumber,
    dealerId: room.dealerId,
    constants: { MIN_PLAYERS, MAX_PLAYERS, WIN_SCORE },
    round: r ? {
      topic: r.topic,
      dealerId: r.dealerId,
      dice: r.dice,
      seen: r.seen,
      clueOrder: r.clueOrder,
      clues: r.clues,
      currentClueId: room.phase === "clues" ? currentClueId(room) : null,
      debateEndsAt: r.debateEndsAt,
      serverNow: Date.now(),
      votedIds: Object.keys(r.votes),
      tally: r.tally,
      tied: r.tied,
      accusedId: r.accusedId,
      guesses: r.guesses,
      guessesAllowed: r.guessesAllowed,
      outcome: r.outcome,
      deltas: r.deltas,
      cardHidden: r.cardHidden,
      chameleonId: revealAll ? r.chameleonId : null,
      secretIdx: revealAll ? r.secretIdx : null,
      secretCoord: revealAll ? coordLabel(r.secretIdx) : null
    } : null
  };
}

function privateState(room, p) {
  const r = room.round;
  if (!r) return {};
  const isCham = p.id === r.chameleonId;
  return {
    role: isCham ? "chameleon" : "agent",
    secretIdx: isCham ? null : r.secretIdx,
    secretCoord: isCham ? null : coordLabel(r.secretIdx),
    myVote: r.votes[p.id] || null
  };
}

function broadcast(room) {
  const pub = publicState(room);
  for (const p of room.players) {
    if (!p.connected || !p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("state", { room: pub, me: { id: p.id, name: p.name, ...privateState(room, p) } });
  }
}

// ---------- sockets ----------
io.on("connection", socket => {
  const fail = (cb, msg) => { if (typeof cb === "function") cb({ ok: false, error: msg }); };
  const ok = (cb, data) => { if (typeof cb === "function") cb({ ok: true, ...data }); };

  function bind(room, p) {
    p.connected = true;
    p.socketId = socket.id;
    socketIndex.set(socket.id, { code: room.code, playerId: p.id });
    socket.join(room.code);
    const t = room.leaveTimers.get(p.id);
    if (t) { clearTimeout(t); room.leaveTimers.delete(p.id); }
    touch(room);
  }

  function current() {
    const ref = socketIndex.get(socket.id);
    if (!ref) return null;
    const room = rooms.get(ref.code);
    if (!room) return null;
    const p = player(room, ref.playerId);
    if (!p) return null;
    return { room, p, isHost: room.hostId === p.id };
  }

  socket.on("create", (data, cb) => {
    const name = cleanName(data && data.name);
    const key = String((data && data.key) || "");
    if (!name) return fail(cb, "Enter your name.");
    if (!key) return fail(cb, "Missing device key.");
    const room = createRoom(name, key);
    bind(room, room.players[0]);
    ok(cb, { code: room.code, playerId: room.players[0].id });
    broadcast(room);
  });

  socket.on("join", (data, cb) => {
    const name = cleanName(data && data.name);
    const key = String((data && data.key) || "");
    const code = String((data && data.code) || "").trim().toUpperCase();
    if (!name) return fail(cb, "Enter your name.");
    if (!key) return fail(cb, "Missing device key.");
    const room = rooms.get(code);
    if (!room) return fail(cb, "No room with that code.");
    let p = playerByKey(room, key);
    if (p) {
      p.name = name;
      bind(room, p);
      ok(cb, { code: room.code, playerId: p.id });
      broadcast(room);
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "gameover") return fail(cb, "That game is already in progress.");
    if (room.players.length >= MAX_PLAYERS) return fail(cb, "That room is full.");
    if (room.players.some(x => x.name.toLowerCase() === name.toLowerCase())) return fail(cb, "Someone in that room already has that name.");
    p = addPlayer(room, name, key);
    bind(room, p);
    ok(cb, { code: room.code, playerId: p.id });
    broadcast(room);
  });

  socket.on("rejoin", (data, cb) => {
    const key = String((data && data.key) || "");
    const code = String((data && data.code) || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return fail(cb, "That room has closed.");
    const p = playerByKey(room, key);
    if (!p) return fail(cb, "You are not in that room.");
    bind(room, p);
    ok(cb, { code: room.code, playerId: p.id });
    broadcast(room);
  });

  socket.on("leave", () => {
    const c = current();
    if (!c) return;
    socketIndex.delete(socket.id);
    socket.leave(c.room.code);
    removePlayer(c.room, c.p.id);
    if (rooms.has(c.room.code)) broadcast(c.room);
  });

  // ----- lobby (host only) -----
  socket.on("updateSettings", data => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "lobby") return;
    const s = c.room.settings;
    if (data && typeof data.scoring === "boolean") s.scoring = data.scoring;
    if (data && [0, 60, 120, 180].includes(data.debateSeconds)) s.debateSeconds = data.debateSeconds;
    if (data && typeof data.hideCardLarge === "boolean") s.hideCardLarge = data.hideCardLarge;
    touch(c.room); broadcast(c.room);
  });

  socket.on("toggleTopic", data => {
    const c = current();
    if (!c || !c.isHost) return;
    const id = String((data && data.id) || "");
    if (!allTopics(c.room).some(t => t.id === id)) return;
    const i = c.room.disabledTopics.indexOf(id);
    if (i >= 0) c.room.disabledTopics.splice(i, 1); else c.room.disabledTopics.push(id);
    touch(c.room); broadcast(c.room);
  });

  socket.on("addCustomTopic", (data, cb) => {
    const c = current();
    if (!c || !c.isHost) return fail(cb, "Only the host can add cards.");
    const name = cleanName(data && data.name).slice(0, 24);
    const words = Array.isArray(data && data.words) ? data.words.map(w => String(w).trim().slice(0, 30)).filter(Boolean) : [];
    if (!name) return fail(cb, "Give the card a name.");
    if (words.length !== 16) return fail(cb, `A card needs exactly 16 words (you have ${words.length}).`);
    if (c.room.customTopics.length >= 30) return fail(cb, "Too many custom cards.");
    c.room.customTopics.push({ name, words });
    touch(c.room); broadcast(c.room);
    ok(cb, {});
  });

  socket.on("deleteCustomTopic", data => {
    const c = current();
    if (!c || !c.isHost) return;
    const idx = Number(data && data.idx);
    if (!(idx >= 0 && idx < c.room.customTopics.length)) return;
    c.room.customTopics.splice(idx, 1);
    c.room.disabledTopics = c.room.disabledTopics.filter(id => !id.startsWith("c"));
    touch(c.room); broadcast(c.room);
  });

  socket.on("kick", data => {
    const c = current();
    if (!c || !c.isHost) return;
    const id = String((data && data.id) || "");
    if (id === c.p.id) return;
    const target = player(c.room, id);
    if (!target) return;
    const ts = target.socketId && io.sockets.sockets.get(target.socketId);
    if (ts) { ts.emit("kicked"); socketIndex.delete(ts.id); ts.leave(c.room.code); }
    removePlayer(c.room, id);
    if (rooms.has(c.room.code)) broadcast(c.room);
  });

  socket.on("start", (data, cb) => {
    const c = current();
    if (!c || !c.isHost) return fail(cb, "Only the host can start.");
    if (c.room.phase !== "lobby" && c.room.phase !== "gameover") return fail(cb, "Game already running.");
    if (c.room.players.length < MIN_PLAYERS) return fail(cb, `You need at least ${MIN_PLAYERS} players.`);
    if (enabledTopics(c.room).length === 0) return fail(cb, "Turn on at least one topic card.");
    startGame(c.room);
    touch(c.room); broadcast(c.room); ok(cb, {});
  });

  // ----- round -----
  socket.on("seenCard", () => {
    const c = current();
    if (!c || c.room.phase !== "reveal") return;
    c.room.round.seen[c.p.id] = true;
    maybeStartClues(c.room);
    touch(c.room); broadcast(c.room);
  });

  socket.on("forceClues", () => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "reveal") return;
    c.room.phase = "clues";
    touch(c.room); broadcast(c.room);
  });

  socket.on("submitClue", (data, cb) => {
    const c = current();
    if (!c || c.room.phase !== "clues") return fail(cb, "Not the clue phase.");
    if (currentClueId(c.room) !== c.p.id) return fail(cb, "It's not your turn.");
    const word = cleanName(data && data.word).slice(0, 24);
    if (!word) return fail(cb, "Say a word.");
    c.room.round.clues.push({ id: c.p.id, word });
    advanceClue(c.room);
    touch(c.room); broadcast(c.room); ok(cb, {});
  });

  socket.on("skipClue", () => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "clues") return;
    const id = currentClueId(c.room);
    if (!id) return;
    c.room.round.clues.push({ id, word: "", skipped: true });
    advanceClue(c.room);
    touch(c.room); broadcast(c.room);
  });

  socket.on("toggleHideCard", () => {
    const c = current();
    if (!c || !c.isHost || !c.room.round) return;
    if (!["clues", "debate", "vote", "tiebreak"].includes(c.room.phase)) return;
    c.room.round.cardHidden = !c.room.round.cardHidden;
    touch(c.room); broadcast(c.room);
  });

  socket.on("endDebate", () => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "debate") return;
    startVote(c.room);
    touch(c.room); broadcast(c.room);
  });

  socket.on("vote", (data, cb) => {
    const c = current();
    if (!c || c.room.phase !== "vote") return fail(cb, "Voting is closed.");
    const id = String((data && data.id) || "");
    if (id === c.p.id) return fail(cb, "You can't vote for yourself.");
    if (!player(c.room, id)) return fail(cb, "Unknown player.");
    c.room.round.votes[c.p.id] = id;
    maybeTally(c.room, false);
    touch(c.room); broadcast(c.room); ok(cb, {});
  });

  socket.on("forceTally", () => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "vote") return;
    if (Object.keys(c.room.round.votes).length === 0) return;
    maybeTally(c.room, true);
    touch(c.room); broadcast(c.room);
  });

  socket.on("tiebreak", (data, cb) => {
    const c = current();
    if (!c || c.room.phase !== "tiebreak") return fail(cb, "No tie to break.");
    const r = c.room.round;
    const dealer = player(c.room, r.dealerId);
    const dealerCanAct = dealer && dealer.connected;
    const allowed = dealerCanAct ? c.p.id === r.dealerId : c.isHost;
    if (!allowed) return fail(cb, "Only the dealer breaks ties.");
    const id = String((data && data.id) || "");
    if (!r.tied.includes(id)) return fail(cb, "Pick one of the tied players.");
    accuse(c.room, id);
    touch(c.room); broadcast(c.room); ok(cb, {});
  });

  socket.on("guess", (data, cb) => {
    const c = current();
    if (!c || c.room.phase !== "guess") return fail(cb, "Not guessing right now.");
    if (c.p.id !== c.room.round.chameleonId) return fail(cb, "Only the Chameleon guesses.");
    const idx = Number(data && data.idx);
    if (!(idx >= 0 && idx < 16)) return fail(cb, "Bad guess.");
    guess(c.room, idx);
    touch(c.room); broadcast(c.room); ok(cb, {});
  });

  socket.on("nextRound", () => {
    const c = current();
    if (!c || !c.isHost || c.room.phase !== "result") return;
    nextRound(c.room);
    touch(c.room); broadcast(c.room);
  });

  socket.on("endGame", () => {
    const c = current();
    if (!c || !c.isHost) return;
    if (!["result", "reveal", "clues", "debate", "vote", "tiebreak", "guess"].includes(c.room.phase)) return;
    clearRoomTimer(c.room);
    c.room.phase = "gameover";
    c.room.round = null;
    touch(c.room); broadcast(c.room);
  });

  socket.on("backToLobby", () => {
    const c = current();
    if (!c || !c.isHost) return;
    clearRoomTimer(c.room);
    c.room.phase = "lobby";
    c.room.round = null;
    c.room.roundNumber = 0;
    c.room.notice = null;
    c.room.players.forEach(p => { p.score = 0; });
    touch(c.room); broadcast(c.room);
  });

  socket.on("disconnect", () => {
    const c = current();
    socketIndex.delete(socket.id);
    if (!c) return;
    const { room, p } = c;
    p.connected = false;
    p.socketId = null;
    touch(room);
    if (room.phase === "lobby" || room.phase === "gameover") {
      const t = setTimeout(() => {
        room.leaveTimers.delete(p.id);
        if (!p.connected && (room.phase === "lobby" || room.phase === "gameover")) {
          removePlayer(room, p.id);
          if (rooms.has(room.code)) broadcast(room);
        }
      }, LOBBY_LEAVE_GRACE_MS);
      room.leaveTimers.set(p.id, t);
    } else {
      // Mid-game: keep their seat. If the round was waiting only on them, let it move on.
      if (room.phase === "reveal") maybeStartClues(room);
      if (room.phase === "vote") maybeTally(room, false);
    }
    if (room.hostId === p.id) {
      const next = connectedPlayers(room)[0];
      if (next) room.hostId = next.id;
    }
    broadcast(room);
  });
});

server.listen(PORT, () => {
  console.log(`Chameleon server listening on http://localhost:${PORT}`);
});
