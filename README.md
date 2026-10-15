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
   loud and typing it in, so the whole table can see every clue.
6. Debate (optional timer), then everyone votes secretly on their own phone.
   Ties go to the dealer.
7. If the accused is the Chameleon, they get one guess at the Secret Word
   (two guesses in a 3-player game). Official scoring applies: first to 5 wins.

Players who lose connection keep their seat and rejoin automatically when the
page reloads. Rooms close after 2 hours of inactivity or 10 minutes with nobody
connected.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000. To test with phones on the same Wi-Fi, open
`http://<your-computer-ip>:3000` on each phone.

## Deployment notes (for whoever hosts it)

- **Runtime:** Node.js 18 or newer. No database, no build step.
- **Start command:** `npm install` then `npm start` (runs `node server.js`).
- **Port:** reads the `PORT` environment variable, defaults to 3000.
- **WebSockets:** the game uses Socket.IO. The reverse proxy must pass
  WebSocket upgrades through to the Node process (for nginx: `proxy_http_version 1.1;`,
  `proxy_set_header Upgrade $http_upgrade;`, `proxy_set_header Connection "upgrade";`).
  Socket.IO falls back to long-polling if upgrades are blocked, but it is slower.
- **Single instance:** game state lives in memory, so run exactly one process.
  If the host wants to scale to multiple instances later, sticky sessions and a
  Socket.IO Redis adapter are needed. For a party game with a handful of rooms,
  one small instance is plenty.
- **HTTPS:** recommended. Phones need a secure origin for the "Share invite"
  button to use the native share sheet and clipboard.
- **Health check:** `GET /healthz` returns `ok`.
- Any platform that runs a Node web service works: a VPS with pm2 or systemd,
  Render, Railway, Fly.io, Heroku, or a Docker container.

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
