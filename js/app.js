/* Chameleon: pass-the-phone party game. Vanilla JS, no build step. */
(function () {
  "use strict";

  const COLS = ["A", "B", "C", "D"];
  const WIN_SCORE = 5;
  const STORAGE_KEY = "chameleon.v1";
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;

  const app = document.getElementById("app");

  // ---------- persistence ----------
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        names: state.players.map(p => p.name),
        settings: state.settings,
        customTopics: state.customTopics,
        disabledTopics: state.disabledTopics
      }));
    } catch (e) { /* storage unavailable, keep going */ }
  }

  const saved = loadSaved();

  // ---------- state ----------
  const state = {
    screen: "home",
    players: (saved.names && saved.names.length >= MIN_PLAYERS ? saved.names : ["", "", "", ""]).map(n => ({ name: n, score: 0 })),
    settings: Object.assign({
      scoring: true,
      debateSeconds: 120,
      hideCardLarge: true
    }, saved.settings || {}),
    customTopics: saved.customTopics || [],
    disabledTopics: saved.disabledTopics || [],
    deck: [],
    roundNumber: 0,
    dealerIdx: 0,
    round: null,
    timer: null,
    timerLeft: 0,
    editingTopic: null,
    setupError: ""
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function rand(n) { return Math.floor(Math.random() * n); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function coordLabel(idx) { return COLS[idx % 4] + (Math.floor(idx / 4) + 1); }
  function initial(name) { return (name.trim()[0] || "?").toUpperCase(); }
  function allTopics() {
    return window.TOPICS.map((t, i) => ({ ...t, id: "b" + i, builtin: true }))
      .concat(state.customTopics.map((t, i) => ({ ...t, id: "c" + i, builtin: false })));
  }
  function enabledTopics() { return allTopics().filter(t => !state.disabledTopics.includes(t.id)); }
  function playerCount() { return state.players.length; }
  function isLargeGroup() { return playerCount() >= 7; }
  function guessesAllowed() { return playerCount() === 3 ? 2 : 1; }

  function setScreen(s) {
    state.screen = s;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- game flow ----------
  function startGame() {
    const names = state.players.map(p => p.name.trim());
    if (names.some(n => !n)) { state.setupError = "Every player needs a name."; render(); return; }
    const lower = names.map(n => n.toLowerCase());
    if (new Set(lower).size !== lower.length) { state.setupError = "Player names must be different."; render(); return; }
    if (enabledTopics().length === 0) { state.setupError = "Turn on at least one topic card."; render(); return; }
    state.setupError = "";
    state.players.forEach((p, i) => { p.name = names[i]; p.score = 0; });
    save();
    state.deck = [];
    state.roundNumber = 0;
    state.dealerIdx = rand(playerCount());
    startRound();
  }

  function drawTopic() {
    if (state.deck.length === 0) state.deck = shuffle(enabledTopics().map(t => t.id));
    const id = state.deck.pop();
    return allTopics().find(t => t.id === id) || enabledTopics()[0];
  }

  function startRound() {
    state.roundNumber += 1;
    const topic = drawTopic();
    state.round = {
      topic,
      secretIdx: rand(16),
      chameleonIdx: rand(playerCount()),
      dealerIdx: state.dealerIdx,
      revealIdx: 0,
      dice: { yellow: 1 + rand(6), blue: 1 + rand(8) },
      cardHidden: false,
      accusedIdx: null,
      guesses: [],
      outcome: null,
      deltas: null
    };
    setScreen("pass");
  }

  function revealOrder() {
    // Deal starting with the player left of the dealer, so the dealer sees their card last.
    const n = playerCount();
    const order = [];
    for (let i = 1; i <= n; i++) order.push((state.round.dealerIdx + i) % n);
    return order;
  }
  function clueOrder() {
    const n = playerCount();
    const order = [];
    for (let i = 0; i < n; i++) order.push((state.round.dealerIdx + i) % n);
    return order;
  }

  function nextReveal() {
    state.round.revealIdx += 1;
    if (state.round.revealIdx >= playerCount()) {
      state.round.cardHidden = false;
      setScreen("clues");
    } else {
      setScreen("pass");
    }
  }

  function startDebate() {
    stopTimer();
    if (state.settings.debateSeconds > 0) {
      state.timerLeft = state.settings.debateSeconds;
      state.timer = setInterval(() => {
        state.timerLeft -= 1;
        if (state.timerLeft <= 0) { stopTimer(); state.timerLeft = 0; }
        if (state.screen === "debate") renderTimerOnly();
      }, 1000);
    }
    setScreen("debate");
  }
  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function accuse(idx) {
    state.round.accusedIdx = idx;
    setScreen("flip");
  }

  function resolveFlip() {
    const r = state.round;
    if (r.accusedIdx !== r.chameleonIdx) {
      finishRound("escaped");
    } else {
      setScreen("guess");
    }
  }

  function guessWord(idx) {
    const r = state.round;
    if (r.guesses.includes(idx)) return;
    r.guesses.push(idx);
    if (idx === r.secretIdx) {
      finishRound("guessed");
    } else if (r.guesses.length >= guessesAllowed()) {
      finishRound("caught");
    } else {
      render();
    }
  }

  function finishRound(outcome) {
    const r = state.round;
    r.outcome = outcome;
    const deltas = state.players.map(() => 0);
    if (outcome === "escaped") deltas[r.chameleonIdx] = 2;
    else if (outcome === "guessed") deltas[r.chameleonIdx] = 1;
    else deltas.forEach((_, i) => { if (i !== r.chameleonIdx) deltas[i] = 2; });
    r.deltas = deltas;
    if (state.settings.scoring) state.players.forEach((p, i) => { p.score += deltas[i]; });
    setScreen("result");
  }

  function nextRound() {
    // The Chameleon for this round deals the next one.
    state.dealerIdx = state.round.chameleonIdx;
    if (state.settings.scoring && state.players.some(p => p.score >= WIN_SCORE)) {
      setScreen("gameover");
    } else {
      startRound();
    }
  }

  // ---------- rendering ----------
  function render() {
    const views = {
      home: viewHome, setup: viewSetup, rules: viewRules, topics: viewTopics, editTopic: viewEditTopic,
      pass: viewPass, reveal: viewReveal, clues: viewClues, debate: viewDebate, vote: viewVote,
      flip: viewFlip, guess: viewGuess, result: viewResult, gameover: viewGameOver
    };
    app.innerHTML = `<div class="stack grow fade-in">${(views[state.screen] || viewHome)()}</div>`;
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
    const cells = [];
    cells.push(`<div class="hdr"></div>`);
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
    const ready = state.players.length >= MIN_PLAYERS;
    return `
      <div class="pass-screen">
        <div class="avatar" aria-hidden="true">🦎</div>
        <h1>Chameleon</h1>
        <p class="muted">One of you is lying. Everyone else is trying to prove it without giving the game away.</p>
        <p class="pill">${MIN_PLAYERS} to ${MAX_PLAYERS} players · one phone</p>
      </div>
      <div class="stack">
        <button class="btn" data-action="goto" data-screen="setup">${ready && state.players.every(p => p.name.trim()) ? "Play" : "New game"}</button>
        <button class="btn secondary" data-action="goto" data-screen="rules">How to play</button>
        <button class="btn secondary" data-action="goto" data-screen="topics">Topic cards (${enabledTopics().length})</button>
      </div>`;
  }

  function viewSetup() {
    const rows = state.players.map((p, i) => `
      <div class="player-row">
        <span class="num">${i + 1}</span>
        <input class="input" data-player="${i}" value="${esc(p.name)}" placeholder="Player ${i + 1}" maxlength="16" autocomplete="off" enterkeyhint="next">
        <button class="btn ghost icon" data-action="removePlayer" data-idx="${i}" aria-label="Remove player" ${state.players.length <= MIN_PLAYERS ? "disabled" : ""}>&times;</button>
      </div>`).join("");
    return `
      ${topbar("New game", "home")}
      <div class="card">
        <h2>Players</h2>
        <div class="player-list">${rows}</div>
        <button class="btn secondary" data-action="addPlayer" ${state.players.length >= MAX_PLAYERS ? "disabled" : ""}>+ Add player</button>
        ${state.setupError ? `<p style="color:var(--red);font-weight:600">${esc(state.setupError)}</p>` : ""}
      </div>
      <div class="card">
        <h2>Options</h2>
        <div class="toggle">
          <div><div class="label">Keep score</div><div class="desc">First to ${WIN_SCORE} points wins. Off for casual rounds.</div></div>
          <button class="switch ${state.settings.scoring ? "on" : ""}" data-action="toggle" data-key="scoring" aria-label="Keep score"></button>
        </div>
        <div class="toggle stacked">
          <div><div class="label">Debate timer</div><div class="desc">How long to argue before the vote.</div></div>
          <div class="row timer-opts">
            ${[0, 60, 120, 180].map(s => `<button class="btn sm ${state.settings.debateSeconds === s ? "" : "ghost"}" data-action="setTimer" data-sec="${s}">${s === 0 ? "Off" : (s / 60) + " min"}</button>`).join("")}
          </div>
        </div>
        <div class="toggle">
          <div><div class="label">Hide card for 7+ players</div><div class="desc">After the clues, turn the topic card face-down so the Chameleon has a harder time.</div></div>
          <button class="switch ${state.settings.hideCardLarge ? "on" : ""}" data-action="toggle" data-key="hideCardLarge" aria-label="Hide card with 7 or more players"></button>
        </div>
        <p class="small muted">With 3 players the Chameleon gets two guesses at the Secret Word, as the rules suggest.</p>
      </div>
      <button class="btn" data-action="startGame">Start game</button>`;
  }

  function viewRules() {
    return `
      ${topbar("How to play", "home")}
      <div class="card rules">
        <h3>Aim</h3>
        <p>Unmask the Chameleon without giving away the Secret Word. If you are the Chameleon, blend in, avoid detection and work out the Secret Word.</p>
        <h3>Setup</h3>
        <p>Gather ${MIN_PLAYERS} to ${MAX_PLAYERS} players around one phone. Enter your names and start. The phone secretly makes one of you the Chameleon each round.</p>
        <h3>The hunt begins</h3>
        <p>Pass the phone around. Each player taps to see their card in private. Everyone except the Chameleon sees the Topic Card with the Secret Word highlighted. The Chameleon sees the same Topic Card, but no Secret Word.</p>
        <p>Starting with the dealer and moving clockwise, each player says one word related to the Secret Word. Say it without hesitation. If someone steals your word you can repeat it, but it looks very suspicious.</p>
        <p>Choose wisely. Too obvious and the Chameleon works out the Secret Word. Too cryptic and people start to think you are the Chameleon.</p>
        <h3>Unmasking the Chameleon</h3>
        <p>Once everyone has said their word, debate who the Chameleon is. Then everyone votes by pointing at a player. If two players tie, the dealer gets the deciding vote. Tap the accused on the phone.</p>
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
          <li>First to ${WIN_SCORE} points wins.</li>
        </ul>
        <h3>More or fewer players</h3>
        <ul>
          <li>3 players: the Chameleon, if caught, gets two guesses at the Secret Word.</li>
          <li>7 or 8 players: once everyone has said their word, the topic card is turned face-down to make it harder for the Chameleon.</li>
        </ul>
        <h3>Custom cards</h3>
        <p>Feel like mixing it up? Create your own Topic Cards from the Topic cards screen.</p>
      </div>`;
  }

  function viewTopics() {
    const chips = allTopics().map(t => {
      const off = state.disabledTopics.includes(t.id);
      return `<button class="chip ${off ? "off" : ""} ${t.builtin ? "" : "custom"}" data-action="toggleTopic" data-id="${t.id}">${esc(t.name)}</button>`;
    }).join("");
    const customRows = state.customTopics.map((t, i) => `
      <div class="row between">
        <span style="font-weight:600">${esc(t.name)}</span>
        <div class="row">
          <button class="btn sm ghost" data-action="editTopic" data-idx="${i}">Edit</button>
          <button class="btn sm danger" data-action="deleteTopic" data-idx="${i}">Delete</button>
        </div>
      </div>`).join("");
    return `
      ${topbar("Topic cards", "home")}
      <div class="card">
        <h2>In the deck</h2>
        <p class="muted small">Tap a card to take it out of the deck or put it back. ${enabledTopics().length} of ${allTopics().length} in play.</p>
        <div class="topic-chip-list">${chips}</div>
      </div>
      <div class="card">
        <h2>Custom cards</h2>
        <p class="muted small">Make your own topic with 16 words.</p>
        ${customRows || `<p class="muted small">No custom cards yet.</p>`}
        <button class="btn secondary" data-action="newTopic">+ New custom card</button>
      </div>`;
  }

  function viewEditTopic() {
    const t = state.editingTopic;
    return `
      ${topbar(t.index == null ? "New custom card" : "Edit custom card", "topics")}
      <div class="card">
        <label class="muted small" for="topicName">Topic name</label>
        <input id="topicName" class="input" value="${esc(t.name)}" placeholder="e.g. Movies" maxlength="24">
        <label class="muted small" for="topicWords">16 words, one per line</label>
        <textarea id="topicWords" class="input" rows="10" placeholder="Jaws&#10;Titanic&#10;...">${esc(t.wordsText)}</textarea>
        ${t.error ? `<p style="color:var(--red);font-weight:600">${esc(t.error)}</p>` : ""}
        <button class="btn" data-action="saveTopic">Save card</button>
      </div>`;
  }

  function viewPass() {
    const r = state.round;
    const idx = revealOrder()[r.revealIdx];
    const p = state.players[idx];
    const first = r.revealIdx === 0;
    return `
      ${topbar(`Round ${state.roundNumber}`, null, `<span class="pill yellow">Dealer: ${esc(state.players[r.dealerIdx].name)}</span>`)}
      <div class="pass-screen">
        ${first ? `<div class="dice" aria-hidden="true"><div class="die yellow roll">${r.dice.yellow}</div><div class="die blue roll">${r.dice.blue}</div></div>
        <p class="muted small">The dealer rolls the dice. The Topic Card is <strong>${esc(r.topic.name)}</strong>.</p>` : ""}
        <div class="avatar">${esc(initial(p.name))}</div>
        <p class="muted">Pass the phone to</p>
        <div class="who">${esc(p.name)}</div>
        <p class="muted small">${r.revealIdx + 1} of ${playerCount()} · keep the screen to yourself</p>
      </div>
      <button class="btn" data-action="showCard">I'm ${esc(p.name)}, show my card</button>`;
  }

  function viewReveal() {
    const r = state.round;
    const idx = revealOrder()[r.revealIdx];
    const p = state.players[idx];
    const isCham = idx === r.chameleonIdx;
    const banner = isCham
      ? `<div class="role-banner chameleon">
           <div class="big">YOU ARE THE CHAMELEON</div>
           <p>You don't know the Secret Word. Listen to the clues, blend in, and don't get caught.</p>
         </div>`
      : `<div class="role-banner agent">
           <p class="muted">${esc(p.name)}, the Secret Word is</p>
           <div class="secret-word">${esc(r.topic.words[r.secretIdx])}</div>
           <span class="coord">${coordLabel(r.secretIdx)} on the card</span>
         </div>`;
    return `
      ${topbar(`Round ${state.roundNumber}`, null, `<span class="pill">${esc(p.name)}</span>`)}
      <div class="reveal-wrap">
        ${banner}
        ${topicGrid(r.topic, { secretIdx: isCham ? -1 : r.secretIdx })}
      </div>
      <button class="btn" data-action="nextReveal">${r.revealIdx + 1 >= playerCount() ? "Got it, start the round" : "Hide and pass on"}</button>`;
  }

  function viewClues() {
    const r = state.round;
    const order = clueOrder().map((idx, i) => `
      <div class="item ${i === 0 ? "dealer" : ""}"><span class="n">${i + 1}</span>${esc(state.players[idx].name)}${i === 0 ? ` <span class="muted small">· dealer goes first</span>` : ""}</div>`).join("");
    const canHide = isLargeGroup() && state.settings.hideCardLarge;
    return `
      ${topbar(`Round ${state.roundNumber}`, null, `<span class="pill yellow">Dealer: ${esc(state.players[r.dealerIdx].name)}</span>`)}
      <div class="card flat">
        <h2>Say your words</h2>
        <p class="muted">Going clockwise from the dealer, each player says <strong>one word</strong> related to the Secret Word. No hesitation.</p>
        <div class="order">${order}</div>
      </div>
      ${topicGrid(r.topic, { hidden: r.cardHidden })}
      ${canHide ? `<button class="btn secondary" data-action="toggleHideCard">${r.cardHidden ? "Show the topic card" : "Everyone has spoken: turn card face-down"}</button>` : ""}
      <button class="btn" data-action="startDebate">Everyone has said a word</button>`;
  }

  function timerHtml() {
    const m = Math.floor(state.timerLeft / 60);
    const s = state.timerLeft % 60;
    const low = state.timerLeft <= 10;
    return `<div class="timer ${low ? "low" : ""}" id="timer">${state.timerLeft === 0 ? "Time's up" : `${m}:${String(s).padStart(2, "0")}`}</div>`;
  }
  function renderTimerOnly() {
    const el = document.getElementById("timer");
    if (el) el.outerHTML = timerHtml();
  }

  function viewDebate() {
    const r = state.round;
    const hideNow = isLargeGroup() && state.settings.hideCardLarge;
    return `
      ${topbar(`Round ${state.roundNumber}`, null, `<span class="pill yellow">Dealer: ${esc(state.players[r.dealerIdx].name)}</span>`)}
      <div class="card flat">
        <h2>Debate</h2>
        <p class="muted">Channel your inner attorney. Pick holes in each other's words. Who hesitated? Whose clue was a little too vague?</p>
        ${state.settings.debateSeconds > 0 ? timerHtml() : ""}
      </div>
      ${topicGrid(r.topic, { hidden: hideNow || r.cardHidden })}
      <button class="btn" data-action="goVote">Time to vote</button>`;
  }

  function viewVote() {
    const r = state.round;
    const list = state.players.map((p, i) => `
      <button class="vote-btn" data-action="accuse" data-idx="${i}">
        <span>${esc(p.name)}</span><span class="count">${i === r.dealerIdx ? "dealer" : ""}</span>
      </button>`).join("");
    return `
      ${topbar(`Round ${state.roundNumber}`)}
      <div class="card flat">
        <h2>Who is the Chameleon?</h2>
        <p class="muted">On the count of three, everyone points at their suspect. Tap the player with the most votes. If it's a tie, the dealer decides.</p>
      </div>
      <div class="vote-list">${list}</div>
      <button class="btn ghost" data-action="goto" data-screen="debate">Back to the debate</button>`;
  }

  function viewFlip() {
    const r = state.round;
    const p = state.players[r.accusedIdx];
    return `
      ${topbar(`Round ${state.roundNumber}`)}
      <div class="pass-screen">
        <div class="avatar">${esc(initial(p.name))}</div>
        <p class="muted">The table has accused</p>
        <div class="who">${esc(p.name)}</div>
        <p class="muted">${esc(p.name)}, turn over your card.</p>
      </div>
      <button class="btn" data-action="flip">Turn over ${esc(p.name)}'s card</button>`;
  }

  function viewGuess() {
    const r = state.round;
    const cham = state.players[r.chameleonIdx];
    const left = guessesAllowed() - r.guesses.length;
    return `
      ${topbar(`Round ${state.roundNumber}`)}
      <div class="role-banner chameleon">
        <div class="big">It's a Chameleon Card!</div>
        <p>${esc(cham.name)} is the Chameleon, but it's not over yet. ${esc(cham.name)}, guess the Secret Word to escape.</p>
        <span class="coord">${left} guess${left === 1 ? "" : "es"} left</span>
      </div>
      ${topicGrid(r.topic, { pick: true, wrong: r.guesses })}`;
  }

  function viewResult() {
    const r = state.round;
    const cham = state.players[r.chameleonIdx];
    const word = r.topic.words[r.secretIdx];
    let hero;
    if (r.outcome === "escaped") {
      hero = `<div class="result-hero bad"><div class="emoji">🦎💨</div><div class="big">The Chameleon escapes!</div>
        <p>You accused ${esc(state.players[r.accusedIdx].name)}, but <strong>${esc(cham.name)}</strong> was the Chameleon all along.</p></div>`;
    } else if (r.outcome === "guessed") {
      hero = `<div class="result-hero neutral"><div class="emoji">🎯</div><div class="big">Caught, but guessed right!</div>
        <p>${esc(cham.name)} was cornered and still worked out the Secret Word. They slip away with the win.</p></div>`;
    } else {
      hero = `<div class="result-hero good"><div class="emoji">🔒</div><div class="big">Chameleon caught!</div>
        <p>${esc(cham.name)} couldn't guess the Secret Word. Great work, everyone.</p></div>`;
    }
    const scoreRows = state.players.map((p, i) => `
      <div class="score-row ${state.settings.scoring && p.score >= WIN_SCORE ? "leader" : ""}">
        <span>${esc(p.name)}${i === r.chameleonIdx ? ` <span class="pill green" style="padding:2px 8px;font-size:0.75rem">Chameleon</span>` : ""}</span>
        <span><span class="pts">${state.settings.scoring ? p.score : ""}</span>${r.deltas[i] ? `<span class="delta">+${r.deltas[i]}</span>` : ""}</span>
      </div>`).join("");
    return `
      ${topbar(`Round ${state.roundNumber}`)}
      ${hero}
      <div class="card flat">
        <div class="row between"><span class="muted">Secret Word</span><strong>${esc(word)} <span class="muted small">(${coordLabel(r.secretIdx)}, ${esc(r.topic.name)})</span></strong></div>
      </div>
      <div class="card flat">
        <h3>${state.settings.scoring ? "Scores" : "Players"}</h3>
        <div class="score-table">${scoreRows}</div>
        ${state.settings.scoring ? `<p class="muted small">First to ${WIN_SCORE} wins. ${esc(cham.name)} deals the next round.</p>` : `<p class="muted small">${esc(cham.name)} deals the next round.</p>`}
      </div>
      <button class="btn" data-action="nextRound">${state.settings.scoring && state.players.some(p => p.score >= WIN_SCORE) ? "See the winner" : "Next round"}</button>
      <button class="btn ghost" data-action="endGame">End game</button>`;
  }

  function viewGameOver() {
    const top = Math.max(...state.players.map(p => p.score));
    const winners = state.players.filter(p => p.score === top);
    const rows = state.players.slice().sort((a, b) => b.score - a.score).map(p => `
      <div class="score-row ${p.score === top ? "leader" : ""}"><span>${esc(p.name)}</span><span class="pts">${p.score}</span></div>`).join("");
    return `
      ${topbar("Game over")}
      <div class="result-hero neutral">
        <div class="emoji">🏆</div>
        <div class="big">${winners.map(w => esc(w.name)).join(" & ")} win${winners.length === 1 ? "s" : ""}!</div>
        <p>${state.roundNumber} round${state.roundNumber === 1 ? "" : "s"} played.</p>
      </div>
      <div class="card flat"><div class="score-table">${rows}</div></div>
      <button class="btn" data-action="playAgain">Play again</button>
      <button class="btn ghost" data-action="goto" data-screen="home">Back to menu</button>`;
  }

  // ---------- events ----------
  app.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case "goto": stopTimer(); setScreen(el.dataset.screen); break;
      case "home": stopTimer(); setScreen("home"); break;
      case "topics": setScreen("topics"); break;
      case "addPlayer": if (state.players.length < MAX_PLAYERS) { readNames(); state.players.push({ name: "", score: 0 }); render(); focusLastPlayer(); } break;
      case "removePlayer": if (state.players.length > MIN_PLAYERS) { readNames(); state.players.splice(+el.dataset.idx, 1); render(); } break;
      case "toggle": readNames(); state.settings[el.dataset.key] = !state.settings[el.dataset.key]; save(); render(); break;
      case "setTimer": readNames(); state.settings.debateSeconds = +el.dataset.sec; save(); render(); break;
      case "startGame": readNames(); startGame(); break;
      case "showCard": setScreen("reveal"); break;
      case "nextReveal": nextReveal(); break;
      case "toggleHideCard": state.round.cardHidden = !state.round.cardHidden; render(); break;
      case "startDebate": startDebate(); break;
      case "goVote": stopTimer(); setScreen("vote"); break;
      case "accuse": accuse(+el.dataset.idx); break;
      case "flip": resolveFlip(); break;
      case "guess": guessWord(+el.dataset.idx); break;
      case "nextRound": nextRound(); break;
      case "endGame": setScreen("gameover"); break;
      case "playAgain": state.players.forEach(p => { p.score = 0; }); state.deck = []; state.roundNumber = 0; state.dealerIdx = rand(playerCount()); startRound(); break;
      case "toggleTopic": {
        const id = el.dataset.id;
        const i = state.disabledTopics.indexOf(id);
        if (i >= 0) state.disabledTopics.splice(i, 1); else state.disabledTopics.push(id);
        save(); render(); break;
      }
      case "newTopic": state.editingTopic = { index: null, name: "", wordsText: "", error: "" }; setScreen("editTopic"); break;
      case "editTopic": {
        const i = +el.dataset.idx;
        const t = state.customTopics[i];
        state.editingTopic = { index: i, name: t.name, wordsText: t.words.join("\n"), error: "" };
        setScreen("editTopic"); break;
      }
      case "deleteTopic": {
        const i = +el.dataset.idx;
        if (confirm(`Delete "${state.customTopics[i].name}"?`)) {
          state.customTopics.splice(i, 1);
          state.disabledTopics = state.disabledTopics.filter(id => !id.startsWith("c"));
          save(); render();
        }
        break;
      }
      case "saveTopic": saveTopic(); break;
    }
  });

  app.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input[data-player]")) {
      const i = +e.target.dataset.player;
      const next = app.querySelector(`input[data-player="${i + 1}"]`);
      if (next) next.focus(); else e.target.blur();
    }
    if (e.key === "Enter" && e.target.matches(".cell.pick")) e.target.click();
  });

  function readNames() {
    app.querySelectorAll("input[data-player]").forEach(inp => {
      state.players[+inp.dataset.player].name = inp.value;
    });
  }
  function focusLastPlayer() {
    const inputs = app.querySelectorAll("input[data-player]");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function saveTopic() {
    const t = state.editingTopic;
    t.name = (document.getElementById("topicName").value || "").trim();
    t.wordsText = document.getElementById("topicWords").value || "";
    const words = t.wordsText.split(/\n|,/).map(w => w.trim()).filter(Boolean);
    if (!t.name) { t.error = "Give the card a name."; render(); return; }
    if (words.length !== 16) { t.error = `You have ${words.length} word${words.length === 1 ? "" : "s"}. A card needs exactly 16.`; render(); return; }
    const card = { name: t.name, words };
    if (t.index == null) state.customTopics.push(card); else state.customTopics[t.index] = card;
    save();
    state.editingTopic = null;
    setScreen("topics");
  }

  render();
})();
