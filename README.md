# Chameleon

A mobile-friendly, pass-the-phone web version of the party game *The Chameleon*.
3 to 8 players, one phone, no install and no server.

## Play it

Open `index.html` in any browser, or host the folder on any static host
(GitHub Pages works: Settings → Pages → deploy from the branch root).

## How a round works

1. Enter player names and start. The phone secretly picks one Chameleon.
2. Pass the phone around. Each player taps to see their card in private:
   everyone sees the Topic Card, and everyone except the Chameleon sees the
   Secret Word highlighted.
3. Starting with the dealer, each player says one word related to the Secret Word.
4. Debate (optional timer), then everyone points at their suspect. Tap the
   accused on the phone. Ties go to the dealer.
5. If the accused is the Chameleon, they get one guess at the Secret Word
   (two guesses in a 3-player game). Scoring follows the official rules:
   first to 5 points wins.

## Topic cards

Built-in cards live in `js/topics.js` as 4x4 grids of 16 words. Add a card by
appending an object with a `name` and 16 `words`. Players can also create
custom cards from the Topic cards screen; those are saved in the browser.

## Files

- `index.html` – app shell
- `css/styles.css` – mobile-first styling
- `js/topics.js` – topic card data
- `js/app.js` – game logic and screens
