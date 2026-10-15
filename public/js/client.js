/* Chameleon online client. Each player runs this on their own phone. */
(function () {
  "use strict";

  const COLS = ["A", "B", "C", "D"];
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  // ---------- local persistence ----------
  const LS = "chameleon.online.v1";
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(local)); } catch (e) { /* ignore */ } }
  const local = loadLocal();
  if (!local.key) {
    local.key = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    saveLocal();
  }

  // ---------- state ----------
  const state = {
    view: "home",        // local-only views: home, rules, topics, editTopic
    room: null,          // server state
    me: null,
    connected: false,
    joining: false,
    serverOffset: 0,
    timerHandle: null,
    editingTopic: null,
    homeError: ""
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function coordLabel(idx) { return COLS[idx % 4] + (Math.floor(idx / 4) + 1); }
  function initial(name) { return (String(name).trim()[0] || "?").toUpperCase(); }
  function pl(id) { return state.room && state.room.players.find(p => p.id === id); }
  function nameOf(id) { const p = pl(id); return p ? p.name : "?"; }
  function isHost() { return state.room && state.me && state.room.hostId === state.me.id; }
  function isMe(id) { return state.me && state.me.id === id; }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }
  function setView(v) { state.view = v; render(); window.scrollTo(0, 0); }

  // ---------- socket ----------
  const socket = io({ reconnectionDelayMax: 5000 });

  socket.on("connect", () => {
    state.connected = true;
    if (local.code && local.key && !state.room) {
      state.joining = true;
      socket.emit("rejoin", { code: local.code, key: local.key }, res => {
        state.joining = false;
        if (!res || !res.ok) { delete local.code; saveLocal(); }
        render();
      });
    } else if (local.code && state.room) {
      socket.emit("rejoin", { code: local.code, key: local.key }, res => {
        if (!res || !res.ok) {
          state.room = null; state.me = null;
          delete local.code; saveLocal();
          toast((res && res.error) || "That room has closed.");
          state.view = "home";
        }
        render();
      });
    }
    render();
  });
  socket.on("disconnect", () => { state.connected = false; render(); });
  socket.on("serverRestarting", data => {
    toast(data && data.resume ? "Server restarting, back in a moment…" : "Server restarting. Your room will close.");
  });
  socket.on("state", data => {
    state.room = data.room;
    state.me = data.me;
    state.serverOffset = (data.room.round && data.room.round.serverNow ? data.room.round.serverNow : Date.now()) - Date.now();
    if (["home", "rules"].includes(state.view) || (state.view === "topics" && state.room.phase !== "lobby")) state.view = "game";
    if (state.view === "editTopic" && !isHost()) state.view = "game";
    render();
  });
  socket.on("kicked", () => {
    state.room = null; state.me = null;
    delete local.code; saveLocal();
    toast("You were removed from the room.");
    setView("home");
  });

  function emit(ev, data, cb) {
    socket.emit(ev, data || {}, res => {
      if (res && res.ok === false && res.error) toast(res.error);
      if (cb) cb(res);
    });
  }

  function createRoom(name) {
    state.joining = true; render();
    socket.emit("create", { name, key: local.key }, res => {
      state.joining = false;
      if (res && res.ok) { local.code = res.code; local.name = name; saveLocal(); state.view = "game"; }
      else state.homeError = (res && res.error) || "Could not create a room.";
      render();
    });
  }
  function joinRoom(name, code) {
    state.joining = true; render();
    socket.emit("join", { name, code, key: local.key }, res => {
      state.joining = false;
      if (res && res.ok) { local.code = res.code; local.name = name; saveLocal(); state.view = "game"; }
      else state.homeError = (res && res.error) || "Could not join.";
      render();
    });
  }
  function leaveRoom() {
    socket.emit("leave");
    state.room = null; state.me = null;
    delete local.code; saveLocal();
    setView("home");
  }

  // ---------- rendering ----------
  function render() {
    let html;
    if (state.view === "rules") html = viewRules();
    else if (!state.room) html = viewHome();
    else if (state.view === "topics") html = viewTopics();
    else if (state.view === "editTopic") html = viewEditTopic();
    else html = viewGame();
    app.innerHTML = `<div class="stack grow fade-in">${html}</div>${state.connected ? "" : `<div class="conn">● reconnecting…</div>`}`;
    manageTimer();
  }

  function topbar(title, backAction, right) {
    return `<div class="topbar">
      ${backAction ? `<button class="btn ghost icon" data-action="${backAction}" aria-label="Back">&#8249;</button>` : `<span style="width:44px"></span>`}
      <span class="title">${esc(title)}</span>
      ${right || `<span style="width:44px"></span>`}
    </div>`;
  }

  function topicGrid(topic, opts) {
    opts = opts || {};
    const cells = [`<div class="hdr"></div>`];
    COLS.forEach(c => cells.push(`<div class="hdr">${c}</div>`));
    for (let row = 0; row < 4; row++) {
      cells.push(`<div class="hdr">${row + 1}</div>`);
      for (let col = 0; col < 4; col++) {
        const idx = row * 4 + col;
        const cls = ["cell"];
        if (opts.secretIdx === idx) cls.push("secret");
        if (opts.pick) cls.push("pick");
        if (opts.wrong && opts.wrong.includes(idx)) cls.push("wrong");
        const attr = opts.pick && !(opts.wrong && opts.wrong.includes(idx)) ? ` data-action="guess" data-idx="${idx}" role="button" tabindex="0"` : "";
        cells.push(`<div class="${cls.join(" ")}"${attr}>${esc(topic.words[idx] || "")}</div>`);
      }
    }
    return `<div class="topic ${opts.hidden ? "hidden-card" : ""}">
      <div class="topic-title">${opts.hidden ? "Topic card face-down" : esc(topic.name)}</div>
      <div class="grid">${cells.join("")}</div>
    </div>`;
  }

  function viewHome() {
    return `
      <div class="pass-screen" style="flex:0 0 auto;padding-top:24px">
        <div class="avatar" aria-hidden="true">🦎</div>
        <h1>Chameleon</h1>
        <p class="muted">One of you is lying. Everyone else is trying to prove it without giving the game away.</p>
        <p class="pill">3 to 8 players · everyone on their own phone</p>
      </div>
      <div class="card">
        <label class="muted small" for="name">Your name</label>
        <input id="name" class="input" value="${esc(local.name || "")}" placeholder="Your name" maxlength="16" autocomplete="off" enterkeyhint="done">
        <button class="btn" data-action="create" ${state.joining ? "disabled" : ""}>Create a room</button>
        <div class="row" style="align-items:center;gap:8px"><span class="grow" style="height:1px;background:var(--line)"></span><span class="muted small">or join with a code</span><span class="grow" style="height:1px;background:var(--line)"></span></div>
        <input id="code" class="input code-input" value="${esc(local.pendingCode || "")}" placeholder="CODE" maxlength="4" autocomplete="off" autocapitalize="characters" enterkeyhint="go">
        <button class="btn secondary" data-action="join" ${state.joining ? "disabled" : ""}>Join room</button>
        ${state.homeError ? `<p style="color:var(--red);font-weight:600">${esc(state.homeError)}</p>` : ""}
        ${state.joining ? `<p class="waiting"><span class="spinner"></span>Connecting…</p>` : ""}
      </div>
      <button class="btn ghost" data-action="rules">How to play</button>`;
  }

  function viewRules() {
    return `
      ${topbar("How to play", "back")}
      <div class="card rules">
        <h3>Aim</h3>
        <p>Unmask the Chameleon without giving away the Secret Word. If you are the Chameleon, blend in, avoid detection and work out the Secret Word.</p>
        <h3>Setup</h3>
        <p>One player creates a room and shares the 4-letter code. Everyone else joins from their own phone. The host starts the game once 3 to 8 players are in.</p>
        <h3>The hunt begins</h3>
        <p>Each round, every phone shows the Topic Card. Everyone except the Chameleon also sees the Secret Word highlighted. The Chameleon only sees the card.</p>
        <p>Starting with the dealer and moving around the table, each player says one word related to the Secret Word out loud, then taps to pass the turn. Say it without hesitation. If someone steals your word you can repeat it, but it looks very suspicious.</p>
        <p>Choose wisely. Too obvious and the Chameleon works out the Secret Word. Too cryptic and people start to think you are the Chameleon.</p>
        <h3>Unmasking the Chameleon</h3>
        <p>If someone's phone is closed, the host can skip straight to the discussion. Anyone who closes their phone keeps their seat for 10 minutes and rejoins automatically when they reopen the page.</p>
        <p>Once everyone has said their word, debate who the Chameleon is. Then everyone votes on their own phone. If two players tie, the dealer gets the deciding vote.</p>
        <ul>
          <li>If the accused is not the Chameleon, the Chameleon escapes.</li>
          <li>If the accused is the Chameleon, they still get one guess at the Secret Word. Guess right and they escape.</li>
        </ul>
        <p>The Chameleon for that round deals the next one.</p>
        <h3>Scoring</h3>
        <ul>
          <li>Chameleon escapes undetected: Chameleon scores 2.</li>
          <li>Chameleon is caught but guesses the Secret Word: Chameleon scores 1.</li>
          <li>Chameleon is caught and guesses wrong: everyone else scores 2.</li>
          <li>First to 5 points wins.</li>
        </ul>
        <h3>More or fewer players</h3>
        <ul>
          <li>3 players: the Chameleon, if caught, gets two guesses at the Secret Word.</li>
          <li>7 or 8 players: once everyone has said their word, the topic card is turned face-down to make it harder for the Chameleon.</li>
        </ul>
        <h3>Custom cards</h3>
        <p>Feel like mixing it up? The host can create custom Topic Cards from the lobby.</p>
      </div>`;
  }

  function roster(opts) {
    opts = opts || {};
    const r = state.room;
    return `<div class="roster">${r.players.map(p => `
      <div class="item ${p.connected ? "" : "offline"} ${isMe(p.id) ? "me" : ""}">
        <span class="dot"></span>
        <span>${esc(p.name)}${isMe(p.id) ? ` <span class="muted small">(you)</span>` : ""}</span>
        <span class="tag">${p.id === r.hostId ? "HOST" : ""}${!p.connected ? " · away" : ""}${opts.scores ? ` · ${p.score} pts` : ""}</span>
        ${opts.kick && isHost() && !isMe(p.id) ? `<button class="btn sm danger" data-action="kick" data-id="${p.id}">Remove</button>` : ""}
      </div>`).join("")}</div>`;
  }

  function viewLobby() {
    const r = state.room;
    const s = r.settings;
    const enabledCount = r.topics.filter(t => t.enabled).length;
    const host = isHost();
    return `
      ${topbar("Lobby", null, `<button class="btn sm ghost" data-action="leave">Leave</button>`)}
      ${r.notice ? `<div class="card flat"><p style="color:var(--yellow);font-weight:600">${esc(r.notice)}</p></div>` : ""}
      <div class="code-box">
        <div class="muted small">Room code</div>
        <div class="code">${esc(r.code)}</div>
        <div class="muted small">Friends open this site on their phone and enter the code</div>
        <button class="btn sm secondary" data-action="share" style="margin-top:10px">Share invite</button>
      </div>
      <div class="card">
        <div class="row between"><h2>Players</h2><span class="pill">${r.players.length} / ${r.constants.MAX_PLAYERS}</span></div>
        ${roster({ kick: true })}
      </div>
      <div class="card">
        <h2>Options ${host ? "" : `<span class="muted small" style="font-weight:500">(host sets these)</span>`}</h2>
        <div class="toggle">
          <div><div class="label">Keep score</div><div class="desc">First to ${r.constants.WIN_SCORE} points wins.</div></div>
          <button class="switch ${s.scoring ? "on" : ""}" data-action="setting" data-key="scoring" ${host ? "" : "disabled"} aria-label="Keep score"></button>
        </div>
        <div class="toggle stacked">
          <div><div class="label">Debate timer</div><div class="desc">How long to argue before the vote.</div></div>
          <div class="row timer-opts">
            ${[0, 60, 120, 180].map(sec => `<button class="btn sm ${s.debateSeconds === sec ? "" : "ghost"}" data-action="setTimer" data-sec="${sec}" ${host ? "" : "disabled"}>${sec === 0 ? "Off" : (sec / 60) + " min"}</button>`).join("")}
          </div>
        </div>
        <div class="toggle">
          <div><div class="label">Hide card for 7+ players</div><div class="desc">After the clues, the topic card turns face-down.</div></div>
          <button class="switch ${s.hideCardLarge ? "on" : ""}" data-action="setting" data-key="hideCardLarge" ${host ? "" : "disabled"} aria-label="Hide card with 7 or more players"></button>
        </div>
        <button class="btn secondary" data-action="topics">Topic cards (${enabledCount} in deck)</button>
      </div>
      ${host
        ? `<button class="btn" data-action="start" ${r.players.length < r.constants.MIN_PLAYERS ? "disabled" : ""}>${r.players.length < r.constants.MIN_PLAYERS ? `Need ${r.constants.MIN_PLAYERS - r.players.length} more player${r.constants.MIN_PLAYERS - r.players.length === 1 ? "" : "s"}` : "Start game"}</button>`
        : `<p class="waiting"><span class="spinner"></span>Waiting for ${esc(nameOf(r.hostId))} to start the game</p>`}
      <button class="btn ghost" data-action="rules">How to play</button>`;
  }

  function viewTopics() {
    const r = state.room;
    const host = isHost();
    const chips = r.topics.map(t => `<button class="chip ${t.enabled ? "" : "off"} ${t.builtin ? "" : "custom"}" data-action="toggleTopic" data-id="${t.id}" ${host ? "" : "disabled"}>${esc(t.name)}</button>`).join("");
    const customs = r.topics.filter(t => !t.builtin);
    return `
      ${topbar("Topic cards", "game")}
      <div class="card">
        <h2>In the deck</h2>
        <p class="muted small">${host ? "Tap a card to take it out of the deck or put it back." : "Only the host can change the deck."} ${r.topics.filter(t => t.enabled).length} of ${r.topics.length} in play.</p>
        <div class="topic-chip-list">${chips}</div>
      </div>
      <div class="card">
        <h2>Custom cards</h2>
        ${customs.length ? customs.map((t, i) => `<div class="row between"><span style="font-weight:600">${esc(t.name)}</span>${host ? `<button class="btn sm danger" data-action="deleteTopic" data-idx="${i}">Delete</button>` : ""}</div>`).join("") : `<p class="muted small">No custom cards yet.</p>`}
        ${host ? `<button class="btn secondary" data-action="newTopic">+ New custom card</button>` : ""}
      </div>`;
  }

  function viewEditTopic() {
    const t = state.editingTopic || { name: "", wordsText: "", error: "" };
    return `
      ${topbar("New custom card", "topics")}
      <div class="card">
        <label class="muted small" for="topicName">Topic name</label>
        <input id="topicName" class="input" value="${esc(t.name)}" placeholder="e.g. Movies" maxlength="24">
        <label class="muted small" for="topicWords">16 words, one per line</label>
        <textarea id="topicWords" class="input" rows="10" placeholder="Jaws&#10;Titanic&#10;...">${esc(t.wordsText)}</textarea>
        ${t.error ? `<p style="color:var(--red);font-weight:600">${esc(t.error)}</p>` : ""}
        <button class="btn" data-action="saveTopic">Save card</button>
      </div>`;
  }

  function roundBar(extraRight) {
    const r = state.room;
    const right = extraRight || `<span class="pill yellow">Dealer: ${esc(nameOf(r.round.dealerId))}</span>`;
    return topbar(`Round ${r.roundNumber}`, null, right);
  }

  function myCardBanner() {
    const r = state.room.round;
    const me = state.me;
    if (me.role === "chameleon") {
      return `<div class="role-banner chameleon">
        <div class="big">YOU ARE THE CHAMELEON</div>
        <p>You don't know the Secret Word. Listen to the clues, blend in, and don't get caught.</p>
      </div>`;
    }
    return `<div class="role-banner agent">
      <p class="muted">The Secret Word is</p>
      <div class="secret-word">${esc(r.topic.words[me.secretIdx])}</div>
      <span class="coord">${esc(me.secretCoord)} on the card</span>
    </div>`;
  }

  function myGrid(opts) {
    const r = state.room.round;
    const me = state.me;
    return topicGrid(r.topic, Object.assign({ secretIdx: me.role === "agent" ? me.secretIdx : -1, hidden: r.cardHidden }, opts || {}));
  }

  function viewReveal() {
    const r = state.room.round;
    const seen = !!r.seen[state.me.id];
    const seenCount = state.room.players.filter(p => r.seen[p.id]).length;
    return `
      ${roundBar()}
      <div class="row wrap" style="justify-content:center">
        <div class="dice" aria-hidden="true"><div class="die yellow roll">${r.dice.yellow}</div><div class="die blue roll">${r.dice.blue}</div></div>
        <p class="muted small">The dealer rolls the dice. The Topic Card is <strong>${esc(r.topic.name)}</strong>.</p>
      </div>
      ${myCardBanner()}
      ${myGrid()}
      ${seen
        ? `<p class="waiting"><span class="spinner"></span>${seenCount} of ${state.room.players.length} have seen their card</p>
           ${isHost() ? `<button class="btn secondary" data-action="forceClues">Everyone's ready, start the clues</button>` : ""}`
        : `<button class="btn" data-action="seenCard">Got it</button>`}
      <p class="footer-note">Keep your screen to yourself.</p>`;
  }

  function clueList() {
    const r = state.room.round;
    return `<div class="clue-list">${r.clueOrder.map((id, i) => {
      const said = r.clues.some(x => x.id === id);
      const active = state.room.phase === "clues" && r.currentClueId === id;
      const p = pl(id);
      return `<div class="clue ${said ? "" : "pending"} ${active ? "active" : ""}">
        <span class="name">${i + 1}. ${esc(nameOf(id))}${id === r.dealerId ? " (dealer)" : ""}${p && !p.connected ? " · away" : ""}</span>
        <span class="word">${said ? "✓" : (active ? "speaking…" : "")}</span>
      </div>`;
    }).join("")}</div>`;
  }

  function viewClues() {
    const r = state.room.round;
    const myTurn = r.currentClueId === state.me.id;
    const cur = pl(r.currentClueId);
    return `
      ${roundBar()}
      <div class="card flat">
        <h2>Say your words</h2>
        <p class="muted small">Going around from the dealer, each player says <strong>one word</strong> related to the Secret Word out loud, then taps to pass the turn.</p>
        ${clueList()}
      </div>
      ${myTurn
        ? `<button class="btn yellow" data-action="saidClue">Your turn: say your word, then tap here</button>`
        : `<p class="waiting"><span class="spinner"></span>Waiting for ${esc(cur ? cur.name : "…")}${cur && !cur.connected ? " (away)" : ""}</p>`}
      ${myGrid()}
      ${isHost() ? `<button class="btn ghost" data-action="startDiscussion">Skip ahead: start the discussion</button>` : ""}`;
  }

  function timerHtml() {
    const r = state.room.round;
    if (!r.debateEndsAt) return "";
    const left = Math.max(0, Math.round((r.debateEndsAt - (Date.now() + state.serverOffset)) / 1000));
    const m = Math.floor(left / 60), s = left % 60;
    return `<div class="timer ${left <= 10 ? "low" : ""}" id="timer">${left === 0 ? "Time's up" : `${m}:${String(s).padStart(2, "0")}`}</div>`;
  }
  function manageTimer() {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
    if (state.room && state.room.phase === "debate" && state.room.round.debateEndsAt) {
      state.timerHandle = setInterval(() => {
        const el = document.getElementById("timer");
        if (el) el.outerHTML = timerHtml(); else clearInterval(state.timerHandle);
      }, 1000);
    }
  }

  function viewDebate() {
    return `
      ${roundBar()}
      <div class="card flat">
        <h2>Debate</h2>
        <p class="muted small">Channel your inner attorney. Pick holes in each other's words. Who hesitated? Whose clue was a little too vague?</p>
        ${timerHtml()}
        <div class="order">${state.room.round.clueOrder.map((id, i) => `<div class="item ${i === 0 ? "dealer" : ""}"><span class="n">${i + 1}</span>${esc(nameOf(id))}</div>`).join("")}</div>
      </div>
      ${myGrid()}
      ${isHost() ? `<button class="btn" data-action="endDebate">Time to vote</button>
        ${state.room.players.length >= 7 ? `<button class="btn ghost" data-action="toggleHideCard">${state.room.round.cardHidden ? "Show the topic card" : "Turn the card face-down"}</button>` : ""}`
        : `<p class="waiting">${esc(nameOf(state.room.hostId))} will open the vote</p>`}`;
  }

  function viewVote() {
    const r = state.room.round;
    const voted = !!state.me.myVote;
    const votedCount = r.votedIds.length;
    const total = state.room.players.filter(p => p.connected).length;
    const list = state.room.players.map(p => `
      <button class="vote-btn ${state.me.myVote === p.id ? "selected" : ""} ${isMe(p.id) ? "me" : ""}" data-action="vote" data-id="${p.id}" ${isMe(p.id) ? "disabled" : ""}>
        <span>${esc(p.name)}${isMe(p.id) ? " (you)" : ""}</span><span class="count">${p.id === r.dealerId ? "dealer" : ""}</span>
      </button>`).join("");
    return `
      ${roundBar()}
      <div class="card flat">
        <h2>Who is the Chameleon?</h2>
        <p class="muted small">${voted ? "You can change your vote until everyone has voted." : "Tap your suspect. Votes are secret."}</p>
      </div>
      <div class="vote-list">${list}</div>
      <p class="waiting"><span class="spinner"></span>${votedCount} of ${total} voted</p>
      ${isHost() && votedCount > 0 && votedCount < total ? `<button class="btn ghost" data-action="forceTally">Close the vote now</button>` : ""}`;
  }

  function viewTiebreak() {
    const r = state.room.round;
    const dealer = pl(r.dealerId);
    const decider = dealer && dealer.connected ? r.dealerId : state.room.hostId;
    const mine = isMe(decider);
    const tallyRows = state.room.players.map(p => `<div class="score-row ${r.tied.includes(p.id) ? "leader" : ""}"><span>${esc(p.name)}</span><span class="pts">${r.tally[p.id]} vote${r.tally[p.id] === 1 ? "" : "s"}</span></div>`).join("");
    return `
      ${roundBar()}
      <div class="card flat">
        <h2>It's a tie</h2>
        <p class="muted small">${mine ? "You have the deciding vote. Pick who turns over their card." : `${esc(nameOf(decider))} has the deciding vote.`}</p>
        <div class="score-table">${tallyRows}</div>
      </div>
      ${mine
        ? `<div class="vote-list">${r.tied.map(id => `<button class="vote-btn" data-action="tiebreak" data-id="${id}"><span>${esc(nameOf(id))}</span></button>`).join("")}</div>`
        : `<p class="waiting"><span class="spinner"></span>Waiting for ${esc(nameOf(decider))}</p>`}`;
  }

  function viewGuess() {
    const r = state.room.round;
    const chamName = nameOf(r.accusedId);
    const mine = isMe(r.accusedId);
    const left = r.guessesAllowed - r.guesses.length;
    return `
      ${roundBar()}
      <div class="role-banner chameleon">
        <div class="big">It's a Chameleon Card!</div>
        <p>${esc(chamName)} is the Chameleon, but it's not over yet. ${mine ? "Guess the Secret Word to escape." : `${esc(chamName)} gets to guess the Secret Word.`}</p>
        <span class="coord">${left} guess${left === 1 ? "" : "es"} left</span>
      </div>
      ${mine
        ? topicGrid(r.topic, { pick: true, wrong: r.guesses })
        : `${topicGrid(r.topic, { secretIdx: state.me.role === "agent" ? state.me.secretIdx : -1, wrong: r.guesses })}
           <p class="waiting"><span class="spinner"></span>Waiting for ${esc(chamName)} to guess</p>`}`;
  }

  function viewResult() {
    const r = state.room.round;
    const cham = nameOf(r.chameleonId);
    const word = r.topic.words[r.secretIdx];
    let hero;
    if (r.outcome === "escaped") {
      hero = `<div class="result-hero bad"><div class="emoji">🦎💨</div><div class="big">The Chameleon escapes!</div>
        <p>You accused ${esc(nameOf(r.accusedId))}, but <strong>${esc(cham)}</strong> was the Chameleon all along.</p></div>`;
    } else if (r.outcome === "guessed") {
      hero = `<div class="result-hero neutral"><div class="emoji">🎯</div><div class="big">Caught, but guessed right!</div>
        <p>${esc(cham)} was cornered and still worked out the Secret Word. They slip away with the win.</p></div>`;
    } else {
      hero = `<div class="result-hero good"><div class="emoji">🔒</div><div class="big">Chameleon caught!</div>
        <p>${esc(cham)} couldn't guess the Secret Word. Great work, everyone.</p></div>`;
    }
    const scoring = state.room.settings.scoring;
    const rows = state.room.players.map(p => `
      <div class="score-row ${scoring && p.score >= state.room.constants.WIN_SCORE ? "leader" : ""}">
        <span>${esc(p.name)}${p.id === r.chameleonId ? ` <span class="pill green" style="padding:2px 8px;font-size:0.75rem">Chameleon</span>` : ""}</span>
        <span><span class="pts">${scoring ? p.score : ""}</span>${r.deltas[p.id] ? `<span class="delta">+${r.deltas[p.id]}</span>` : ""}</span>
      </div>`).join("");
    const winner = scoring && state.room.players.some(p => p.score >= state.room.constants.WIN_SCORE);
    return `
      ${roundBar(`<span class="pill">${esc(r.topic.name)}</span>`)}
      ${hero}
      <div class="card flat"><div class="row between"><span class="muted">Secret Word</span><strong>${esc(word)} <span class="muted small">(${esc(r.secretCoord)})</span></strong></div></div>
      <div class="card flat">
        <h3>${scoring ? "Scores" : "Players"}</h3>
        <div class="score-table">${rows}</div>
        <p class="muted small">${scoring ? `First to ${state.room.constants.WIN_SCORE} wins. ` : ""}${esc(cham)} deals the next round.</p>
      </div>
      ${isHost()
        ? `<button class="btn" data-action="nextRound">${winner ? "See the winner" : "Next round"}</button><button class="btn ghost" data-action="endGame">End game</button>`
        : `<p class="waiting"><span class="spinner"></span>Waiting for ${esc(nameOf(state.room.hostId))} to continue</p>`}`;
  }

  function viewGameOver() {
    const players = state.room.players;
    const top = Math.max(...players.map(p => p.score));
    const winners = players.filter(p => p.score === top);
    const rows = players.slice().sort((a, b) => b.score - a.score).map(p => `<div class="score-row ${p.score === top ? "leader" : ""}"><span>${esc(p.name)}</span><span class="pts">${p.score}</span></div>`).join("");
    return `
      ${topbar("Game over", null, `<button class="btn sm ghost" data-action="leave">Leave</button>`)}
      <div class="result-hero neutral">
        <div class="emoji">🏆</div>
        <div class="big">${top > 0 ? `${winners.map(w => esc(w.name)).join(" & ")} win${winners.length === 1 ? "s" : ""}!` : "Thanks for playing!"}</div>
        <p>${state.room.roundNumber} round${state.room.roundNumber === 1 ? "" : "s"} played.</p>
      </div>
      <div class="card flat"><div class="score-table">${rows}</div></div>
      ${isHost()
        ? `<button class="btn" data-action="start">Play again</button><button class="btn ghost" data-action="backToLobby">Back to lobby</button>`
        : `<p class="waiting"><span class="spinner"></span>Waiting for ${esc(nameOf(state.room.hostId))}</p>`}`;
  }

  function viewGame() {
    const r = state.room;
    if (r.phase === "lobby") return viewLobby();
    if (r.phase === "gameover") return viewGameOver();
    if (!r.round || !state.me) return viewLobby();
    switch (r.phase) {
      case "reveal": return viewReveal();
      case "clues": return viewClues();
      case "debate": return viewDebate();
      case "vote": return viewVote();
      case "tiebreak": return viewTiebreak();
      case "guess": return viewGuess();
      case "result": return viewResult();
      default: return viewLobby();
    }
  }

  // ---------- events ----------
  app.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    switch (a) {
      case "rules": setView("rules"); break;
      case "back": setView(state.room ? "game" : "home"); break;
      case "game": setView("game"); break;
      case "topics": setView("topics"); break;
      case "create": {
        const name = document.getElementById("name").value.trim();
        state.homeError = "";
        if (!name) { state.homeError = "Enter your name."; render(); return; }
        createRoom(name); break;
      }
      case "join": {
        const name = document.getElementById("name").value.trim();
        const code = document.getElementById("code").value.trim().toUpperCase();
        state.homeError = "";
        if (!name) { state.homeError = "Enter your name."; render(); return; }
        if (code.length !== 4) { state.homeError = "Enter the 4-letter room code."; render(); return; }
        joinRoom(name, code); break;
      }
      case "leave": if (confirm("Leave this room?")) leaveRoom(); break;
      case "share": {
        const url = location.origin + location.pathname + "?code=" + state.room.code;
        const text = `Join my Chameleon game! Room code ${state.room.code}: ${url}`;
        if (navigator.share) navigator.share({ title: "Chameleon", text, url }).catch(() => {});
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Invite copied")).catch(() => toast(text));
        else toast(text);
        break;
      }
      case "kick": if (confirm(`Remove ${nameOf(el.dataset.id)}?`)) emit("kick", { id: el.dataset.id }); break;
      case "setting": emit("updateSettings", { [el.dataset.key]: !state.room.settings[el.dataset.key] }); break;
      case "setTimer": emit("updateSettings", { debateSeconds: +el.dataset.sec }); break;
      case "toggleTopic": emit("toggleTopic", { id: el.dataset.id }); break;
      case "deleteTopic": if (confirm("Delete this card?")) emit("deleteCustomTopic", { idx: +el.dataset.idx }); break;
      case "newTopic": state.editingTopic = { name: "", wordsText: "", error: "" }; setView("editTopic"); break;
      case "saveTopic": {
        const t = state.editingTopic;
        t.name = document.getElementById("topicName").value.trim();
        t.wordsText = document.getElementById("topicWords").value;
        const words = t.wordsText.split(/\n|,/).map(w => w.trim()).filter(Boolean);
        if (!t.name) { t.error = "Give the card a name."; render(); return; }
        if (words.length !== 16) { t.error = `You have ${words.length} word${words.length === 1 ? "" : "s"}. A card needs exactly 16.`; render(); return; }
        emit("addCustomTopic", { name: t.name, words }, res => { if (res && res.ok) { state.editingTopic = null; setView("topics"); } });
        break;
      }
      case "start": emit("start"); break;
      case "seenCard": emit("seenCard"); break;
      case "forceClues": emit("forceClues"); break;
      case "saidClue": emit("saidClue"); break;
      case "startDiscussion": emit("startDiscussion"); break;
      case "toggleHideCard": emit("toggleHideCard"); break;
      case "endDebate": emit("endDebate"); break;
      case "vote": emit("vote", { id: el.dataset.id }); break;
      case "forceTally": emit("forceTally"); break;
      case "tiebreak": emit("tiebreak", { id: el.dataset.id }); break;
      case "guess": emit("guess", { idx: +el.dataset.idx }); break;
      case "nextRound": emit("nextRound"); break;
      case "endGame": if (confirm("End the game for everyone?")) emit("endGame"); break;
      case "backToLobby": emit("backToLobby"); break;
    }
  });

  app.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (t.id === "code") { e.preventDefault(); app.querySelector('[data-action="join"]').click(); }
    else if (t.id === "name") { t.blur(); }
    else if (t.matches(".cell.pick")) t.click();
  });

  // Prefill a code from an invite link.
  const params = new URLSearchParams(location.search);
  if (params.get("code")) {
    local.pendingCode = params.get("code").toUpperCase();
    history.replaceState(null, "", location.pathname);
  }
  render();
})();
