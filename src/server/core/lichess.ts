// Fetch one game's PGN from lichess.org. Lichess asks API users to make one
// request at a time and to wait a minute after a 429, so both are enforced
// across all server instances via Redis.
import { redis } from '@devvit/web/server';
import { keys, toInt } from './store';

const LOCK_STALE_MS = 15_000;
const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 10_000;

export const BUSY = 'Lichess is busy, try again in a minute.';
const NOT_FOUND = "We couldn't find that Lichess game.";
const FAILED = "Couldn't get that game from Lichess. Paste the PGN instead.";

/**
 * Game id from a lichess.org game URL: 8-char game ids, 12-char player URLs
 * (game id + 4), optional /white or /black, #ply or query. Null otherwise.
 */
export const lichessGameId = (text: string): string | null => {
  const m =
    /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?(?:[?#].*)?$/.exec(
      text.trim()
    );
  return m?.[1] ?? null;
};

/** Does the text look like any lichess.org URL (so we can say it's wrong)? */
export const looksLikeLichessUrl = (text: string) =>
  /^(?:https?:\/\/)?(?:www\.)?lichess\.org\//i.test(text.trim());

const takeLock = async (now: number): Promise<boolean> => {
  if ((await redis.hSetNX(keys.lichessLock, 'held', String(now))) === 1)
    return true;
  const held = toInt(await redis.hGet(keys.lichessLock, 'held'));
  if (now - held < LOCK_STALE_MS) return false;
  await redis.hDel(keys.lichessLock, ['held']);
  return (await redis.hSetNX(keys.lichessLock, 'held', String(now))) === 1;
};

export const fetchLichessPgn = async (
  id: string,
  now: number = Date.now()
): Promise<{ pgn: string } | { error: string }> => {
  if (toInt(await redis.get(keys.lichessCooldown)) > now)
    return { error: BUSY };
  if (!(await takeLock(now))) return { error: BUSY };
  try {
    const res = await fetch(
      `https://lichess.org/game/export/${id}?clocks=false&evals=false`,
      {
        headers: { Accept: 'application/x-chess-pgn' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (res.status === 429) {
      await redis.set(keys.lichessCooldown, String(now + COOLDOWN_MS));
      return { error: BUSY };
    }
    if (res.status === 404) return { error: NOT_FOUND };
    const body = res.ok ? await res.text() : '';
    // Lichess sometimes redirects anonymous exports to a sign-up page.
    if (!body.trimStart().startsWith('[')) {
      console.error(`lichess export ${id}: status ${res.status}, not a PGN`);
      return { error: FAILED };
    }
    return { pgn: body };
  } catch (e) {
    console.error(`lichess export ${id} failed: ${e}`);
    return { error: FAILED };
  } finally {
    await redis.hDel(keys.lichessLock, ['held']).catch(() => undefined);
  }
};
