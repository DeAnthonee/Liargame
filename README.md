# Chameleon

A mobile web version of the party game *The Chameleon*. Every player joins a
lobby from their own phone using a 4-letter room code. 3 to 8 players.

## How a game works

1. One player opens the site, enters a name and taps **Create a room**. They
   become the host and get a room code to share.
2. Everyone else opens the site on their phone, enters their name and the code.
3. The host picks options (scoring, debate timer, topic cards) and starts.
4. Each round, every phone shows the Topic Card. Everyone except the Chameleon
   also sees the Secret Word highlighted.
5. Starting with the dealer, players take turns saying one related word out
   loud and tapping once to pass the turn. The host can skip straight to the
   discussion if someone's phone is closed.
6. Debate (optional timer), then everyone votes secretly on their own phone.
   Ties go to the dealer.
7. If the accused is the Chameleon, they get one guess at the Secret Word
   (two guesses in a 3-player game). Official scoring applies: first to 5 wins.

Players who close their phone keep their seat for 10 minutes and rejoin
automatically when they reopen the page. Rooms close after 2 hours of
inactivity or 15 minutes with nobody connected.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000. To test with phones on the same Wi-Fi, open
`http://<your-computer-ip>:3000` on each phone. Run `npm test` to run the test suite.

## Deployment notes (for whoever hosts it)

- **Runtime:** Node.js 18 or newer (tested on 22 and 26). No database, no build step.
- **Install:** `npm ci` (uses the committed `package-lock.json`). Only `socket.io-client` is a devDependency, and it is needed for `npm test` only.
- **Test gate:** `npm test` (syntax checks plus `node:test` suites). Tests bind random ports on 127.0.0.1 only.
- **Start:** `node server.js` from the repo root. Reads `PORT` (default 3000) and `HOST` (default `0.0.0.0`).
- **Optional env:** `DATA_DIR=/path/outside/the/clone` makes the server snapshot live rooms to `DATA_DIR/rooms.json` on SIGTERM and restore them on the next boot, so a redeploy mid-game is a few-second blip instead of a lost game. Without it, rooms live in memory only and a restart closes them. `BUILD_ID` overrides the build identifier reported by `/healthz` (otherwise the git commit is used).
- **Health:** `GET /healthz` returns `{"ok":true,"version":"1.4.0","build":"<git sha>","playing":<live matches>,"rooms":<n>,"players":<connected>,"uptime":<s>,"draining":<bool>}`.
- **Shutdown:** SIGTERM or SIGINT drains cleanly, normally in about a second, worst case 10 seconds.
- **WebSockets:** Socket.IO on the same port, path `/socket.io/`. The reverse proxy or tunnel must pass WebSocket upgrades through. The client derives `ws`/`wss` from the page URL; nothing is hardcoded.
- **Caching:** `index.html` is served with `no-store`. CSS and JS are referenced as `/a/<content-hash>/…` and served with `max-age=31536000, immutable`, so every deploy gets fresh URLs. Unhashed paths such as `/js/client.js` are served with `no-cache`.
- **Single instance:** game state lives in memory. Run exactly one process.
- **External services:** none. The server serves the Socket.IO client itself; fonts are system fonts.

## Topic cards

Built-in cards live in `public/js/topics.js` as 4x4 grids of 16 words. Add a
card by appending an object with a `name` and 16 `words`. The host can also
create custom cards from the lobby; those live for the life of the room.

## Files

- `server.js` – Express + Socket.IO game server (rooms, rounds, scoring)
- `public/index.html` – app shell
- `public/css/styles.css` – mobile-first styling
- `public/js/client.js` – phone client (lobby and all game screens)
- `public/js/topics.js` – topic card data, shared by server and client
