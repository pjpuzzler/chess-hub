# Chess Hub

Daily puzzles, Guess the Elo, move polls, game reviews and a community game, right inside your
subreddit's posts. Free for every community, with no accounts or extra sites.

![Chess Hub: the Daily Puzzle, a community game vote, a move poll and a game review](https://raw.githubusercontent.com/pjpuzzler/chess-hub/main/docs/screens.png)

## What it adds

- **Daily Puzzle.** A new puzzle every day at the hour you choose, pinned to your community
  highlights. Members keep a streak, earn a puzzle rating for your community and climb the
  leaderboard. Puzzles come from the Lichess puzzle database: real game positions, verified by
  Stockfish and rated by thousands of players each.
- **Guess the Elo.** A real rated game, names hidden. Step through it, guess the players' average
  rating, see how close you were and how you compare. Weekly by default, linked from the daily puzzle. Members can also post
  their own games ("Guess my Elo").
- **What's the move?** Anyone can set up a position and ask the community. Members vote by playing
  a move, results stay hidden until you vote, then Stockfish weighs in.
- **Community game.** The whole subreddit plays one game together, a move a day. Everyone votes
  by playing a move, the most popular one is played, and the next post goes up. A moderator
  starts it.
- **Game Review.** Paste a game (PGN or a Lichess link) for a full review: accuracy for both
  players, inaccuracies, mistakes, blunders and brilliant moves, a win-chance graph and the
  engine's best move at every turn.
- **Stockfish in every post.** Each post has an Analyze tab with an eval bar and the engine's top
  lines. The engine runs on the viewer's device, so it costs your community nothing.
- **r/AnarchyChess edition.** In r/AnarchyChess only, the daily puzzle rotates the sub's favourite
  special moves. Holy hell.

In the feed, each post is a compact card with the position and one tap to play:

![Feed cards for a Daily Puzzle, a Game Review and Guess the Elo](https://raw.githubusercontent.com/pjpuzzler/chess-hub/main/docs/feed.png)

## For moderators

After installing, Daily Puzzle #1 is posted right away. Members can post move polls, game reviews
and "Guess my Elo" games from inside any Chess Hub post or the subreddit menu (5 a day per person,
mods unlimited; turn off with "Members can post"). They post as themselves.

Subreddit menu, for everyone:

- **New move poll** takes a FEN, a PGN or a lichess.org analysis link.
- **Review a chess game** takes a lichess.org game link or a PGN.
- **Guess my Elo** takes a lichess.org game link, or a PGN with WhiteElo and BlackElo.

For moderators:

- **Post today's daily puzzle** posts now instead of waiting for the scheduled hour.
- **Post a Guess the Elo game now** posts the next curated game.
- **Start a community game** / **End community game** (see below).
- **Close this poll** is on each poll's mod menu.

Settings (Mod Tools → Installed Apps → Chess Hub):

| Setting                      | Default             |                                                                                                           |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| Post a daily puzzle          | On                  | Easy Mon–Tue, medium Wed–Fri, hard on weekends                                                            |
| Posting hour (UTC)           | 13                  | When the daily puzzle and Guess the Elo go up                                                             |
| Pin the daily puzzle         | Community highlight | Highlights the daily puzzle, and each Guess the Elo for its first day; or sticky the puzzle, or don't pin |
| Highlight the community game | On                  | Keeps the current community game post in Community Highlights                                             |
| Guess the Elo game           | Weekly (Saturdays)  | Or daily, or off                                                                                          |
| Members can post             | On                  | Reviews, Guess my Elo and polls by members                                                                |

## Community game

A moderator starts it from the subreddit menu ("Start a community game"); move 1 is posted right
away. The subreddit plays both sides: everyone votes on every move by playing it on the board.
Each day at the posting hour the move with the most votes is played (a tie goes to the move that
got there first) and the next position is posted. A day with no votes keeps the same post open.
When the game ends, the next post shows the result with a full game review. One game runs at a
time; a moderator can stop it with "End community game".

In r/AnarchyChess the daily puzzle follows the sub's memes (en passant three days a week, plus knight boosts, double checks, smothered mates and rook sacrifices).

## Privacy

Chess Hub stores only what it needs to run inside your subreddit: usernames with puzzle results,
streaks and ratings, poll and community game votes, Guess the Elo guesses, and the posts members
make. Nothing leaves Reddit, and the only outside request is fetching a game from lichess.org when
someone pastes a Lichess game link.

Retention: who voted for what on a closed poll or community game move is deleted 30 days after it
closes (vote counts stay). Per-person data is deleted after 400 days without activity. Accounts
deleted from Reddit are found by a rolling check (about 600 accounts a day) and every trace is removed, including author names
on their posts. Deleting a post removes everything stored for it.

- [Terms of service](https://github.com/pjpuzzler/chess-hub/blob/main/TERMS.md)
- [Privacy policy](https://github.com/pjpuzzler/chess-hub/blob/main/PRIVACY.md)

## Fetch Domains

- `lichess.org`: download the PGN of a game a user links to (game export API).

## Credits and license

- Engine: [Stockfish](https://stockfishchess.org) 19 (GPL-3.0), via stockfish.js.
- Board: [Chessground](https://github.com/lichess-org/chessground) (GPL-3.0), cburnett pieces.
- Rules: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2).
- Puzzles: [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0).
- Sounds: CC0 recordings from Freesound (sources in `public/sounds/LICENSE.txt`).

Chess Hub is free software under the GNU GPL v3 or later
([source code](https://github.com/pjpuzzler/chess-hub)). Not affiliated with Lichess or Chess.com.
