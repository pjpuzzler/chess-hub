import type { DrawShape } from 'chessground/draw';
import type { Color } from 'chessground/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatScore, whiteShare, type PvLine } from '../engine/uci';
import { useEngine } from '../engine/useEngine';
import { holyHell } from '../lib/anarchy';
import {
  gameEnd,
  playMove,
  turnOf,
  uciKeys,
  type LineMove,
} from '../lib/chess';
import { useMoveKeys } from '../lib/useMoveKeys';
import { Board } from './Board';
import { drawnLines, endText } from '../lib/engine-text';
import { EngineLines, EngineSummary, EvalBar } from './EnginePanel';
import { MoveStrip } from './MoveStrip';
import { Screen } from './Screen';
import { Button, Line, NavButton } from './ui';

type Props = {
  startFen: string;
  mainline: LineMove[];
  initialIndex: number;
  orientation: Color;
  anarchy: boolean;
  // The position on the board, for "Poll this position" in the + sheet.
  onPosition?: (p: AnalysisPosition) => void;
  active?: boolean;
};

// Same width for both arrows; the second line is the same colour, fainter.
const BRUSHES = ['engine1', 'engine2'];

export type AnalysisPosition = {
  fen: string;
  lastMove: string | null;
  orientation: Color;
  over: boolean; // no poll from a finished game
};

export function AnalysisBoard({
  startFen,
  mainline,
  initialIndex,
  orientation: initialOrientation,
  anarchy,
  onPosition,
  active = true,
}: Props) {
  const [line, setLine] = useState<LineMove[]>(mainline);
  const [index, setIndex] = useState(Math.min(initialIndex, mainline.length));
  const [orientation, setOrientation] = useState<Color>(initialOrientation);

  const fen = index === 0 ? startFen : (line[index - 1]?.fen ?? startFen);
  const last = index > 0 ? line[index - 1] : undefined;
  const end = useMemo(() => gameEnd(fen), [fen]);
  const engine = useEngine(end ? null : fen, active);
  const lastUci = last?.uci ?? null;
  useEffect(() => {
    onPosition?.({ fen, lastMove: lastUci, orientation, over: end !== null });
  }, [onPosition, fen, lastUci, orientation, end]);
  const diverged =
    mainline.length > 0 &&
    line !== mainline &&
    line.some((m, i) => mainline[i]?.uci !== m.uci);

  const play = (uci: string) => {
    const next = line[index];
    if (next && next.uci === uci) {
      setIndex(index + 1);
      return;
    }
    const move = playMove(fen, uci);
    if (!move) return;
    if (move.enPassant && anarchy) holyHell();
    setLine([...line.slice(0, index), move]);
    setIndex(index + 1);
  };

  const go = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(line.length, i))),
    [line.length]
  );
  useMoveKeys(active, index, line.length, go);

  const backToMain = () => {
    const firstDiff = line.findIndex((m, i) => mainline[i]?.uci !== m.uci);
    setLine(mainline);
    setIndex(Math.min(Math.max(firstDiff, 0), mainline.length));
  };

  const shapes = useMemo<DrawShape[]>(() => {
    if (end) return [];
    return drawnLines(engine.lines).flatMap((l, i) => {
      const keys = uciKeys(l.pv[0]);
      return keys
        ? [{ orig: keys[0], dest: keys[1], brush: BRUSHES[i] ?? 'paleBlue' }]
        : [];
    });
  }, [engine.lines, end]);

  // Game over: pin the bar to the result instead of asking the engine.
  const endLine: PvLine | undefined =
    end === 'checkmate'
      ? {
          multipv: 1,
          depth: 0,
          pv: [],
          score: { mate: turnOf(fen) === 'white' ? -1 : 1 },
        }
      : end
        ? { multipv: 1, depth: 0, pv: [], score: { cp: 0 } }
        : undefined;
  const barLine = endLine ?? engine.lines[0];

  return (
    <>
      <Screen
        top={
          <Line tone="muted">
            {end
              ? endText(end, fen)
              : `${turnOf(fen) === 'white' ? 'White' : 'Black'} to move`}
          </Line>
        }
        evalBar={
          <EvalBar
            share={barLine ? whiteShare(barLine.score) : null}
            label={barLine ? formatScore(barLine.score) : ''}
            orientation={orientation}
          />
        }
        board={
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={uciKeys(last?.uci)}
            interactive={!end}
            shapes={shapes}
            onMove={play}
            label="Analysis board"
          />
        }
        strip={
          <MoveStrip
            startFen={startFen}
            moves={line}
            index={index}
            onSelect={go}
          />
        }
        summary={
          <>
            <EngineSummary fen={fen} engine={engine} end={end} />
            {diverged ? (
              <Button variant="link" onClick={backToMain}>
                Back
              </Button>
            ) : null}
          </>
        }
        extra={
          // Only the engine's first line: the board is the point here.
          end ? null : (
            <EngineLines
              fen={fen}
              engine={engine}
              onPlay={play}
              anarchy={anarchy}
              from={0}
              count={1}
              plies={5}
            />
          )
        }
        infoRows={2}
        // Short screens: the engine's line (or the thinking/ended text).
        compact={
          end || engine.lines.length === 0 ? (
            <EngineSummary fen={fen} engine={engine} end={end} />
          ) : (
            <EngineLines
              fen={fen}
              engine={engine}
              onPlay={play}
              anarchy={anarchy}
              from={0}
              count={1}
              plies={5}
            />
          )
        }
        nav={
          <>
            <NavButton
              icon="first"
              label="First move"
              onClick={() => go(0)}
              disabled={index === 0}
            />
            <NavButton
              icon="prev"
              label="Previous move"
              onClick={() => go(index - 1)}
              disabled={index === 0}
            />
            <NavButton
              icon="next"
              label="Next move"
              onClick={() => go(index + 1)}
              disabled={index >= line.length}
            />
            <NavButton
              icon="last"
              label="Last move"
              onClick={() => go(line.length)}
              disabled={index >= line.length}
            />
            <NavButton
              icon="flip"
              label="Flip board"
              onClick={() =>
                setOrientation((o) => (o === 'white' ? 'black' : 'white'))
              }
            />
          </>
        }
      />
    </>
  );
}
