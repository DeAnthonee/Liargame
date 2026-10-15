# Chameleon (Liargame) – project notes

Mobile web version of the party game *The Chameleon*. Every player joins a room
from their own phone. Node + Express + Socket.IO server, vanilla JS client, no
build step, no database.

## Layout

- `server.js` – game server. Exports `createServer()` for tests; listens only when run directly.
- `public/` – static client. `index.html` is served with no-cache; CSS/JS are served under `/a/<hash>/…` with immutable caching (hash computed at startup from file contents).
- `public/js/topics.js` – topic card data (16 words per card), shared by server and client.
- `test/` – `node:test` suites run by `npm test`. Tests bind random ports on 127.0.0.1 only.

## Hosting rules (production runs on a Mac mini LaunchAgent behind Cloudflare)

- Deploy branch: `claude/mobile-web-game-nqcqgo`. Every push is auto-deployed after `npm test` passes, so never push a red test run.
- Server must keep reading `PORT` from env and binding `HOST` (default `0.0.0.0`). Never hardcode hostnames or ports; the client derives everything from `location`.
- `GET /healthz` must keep returning JSON with `ok`, `version`, `build` and `playing`. The deploy pipeline gates on it.
- Shutdown must stay graceful on SIGTERM within 15 seconds. If `DATA_DIR` is set, rooms are snapshotted there on shutdown and restored on boot.
- Exactly one server process. Game state is in memory; do not add multi-process assumptions.
- `index.html` stays uncached; hashed assets stay immutable. Do not add long cache lifetimes to unhashed URLs.
- No external services: the host needs only Node and this repo.

## Ops issues

Hosting bugs arrive as GitHub Issues titled `[OPS] …`. For each one: reproduce it
locally (`npm test`, then `npm start` and a browser), fix it on the deploy branch
`claude/mobile-web-game-nqcqgo`, keep `npm test` green, push, and reply on the
issue with what changed and the commit hash.

## Conventions

- Keep the game rules faithful to the official Chameleon rulebook (scoring 2/1/0, first to 5, 3-player double guess, 7+ player face-down card).
- Bump `version` in `package.json` on user-visible changes; `/healthz` reports it.
