// Stockfish 19 lite (single-threaded WASM) in a Web Worker, speaking UCI.
// The worker script and its .wasm are served from our own origin at /engine/.
import { parseInfo, type PvLine } from './uci';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

// Absolute: the build's base is '/' (see the script tags in dist/client/*.html).
export const ENGINE_URL = '/engine/stockfish-19-lite-single.js';
export const ENGINE_NAME = 'Stockfish 19 lite';
const MULTI_PV = 3;
const MAX_DEPTH = 22;
const BOOT_TIMEOUT_MS = 15_000;

type Listener = {
  onStatus: (status: EngineStatus) => void;
  onLines: (fen: string, lines: PvLine[]) => void;
};

export class Engine {
  private worker: Worker | null = null;
  private status: EngineStatus = 'idle';
  private searching = false;
  private stopping = false;
  private pending: string | null = null;
  private current: string | null = null;
  private lines: PvLine[] = [];
  private bootTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly listener: Listener) {}

  boot(): void {
    if (this.status !== 'idle') return;
    if (typeof Worker === 'undefined' || typeof WebAssembly !== 'object') {
      this.fail('Worker or WebAssembly missing');
      return;
    }
    this.setStatus('loading');
    try {
      this.worker = new Worker(ENGINE_URL);
    } catch (err) {
      this.fail(err);
      return;
    }
    this.worker.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (typeof e.data === 'string') this.onLine(e.data);
    });
    this.worker.addEventListener('error', (e) =>
      this.fail(e.message || 'worker error')
    );
    this.bootTimer = setTimeout(
      () => this.fail('engine boot timed out'),
      BOOT_TIMEOUT_MS
    );
    this.send('uci');
  }

  // Analyse `fen` (replacing any running search).
  analyze(fen: string): void {
    this.pending = fen;
    if (this.status !== 'ready') return;
    if (this.searching) this.requestStop();
    else this.startPending();
  }

  stop(): void {
    this.pending = null;
    if (this.searching) this.requestStop();
  }

  destroy(): void {
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    this.worker = null;
    this.status = 'unavailable';
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.listener.onStatus(status);
  }

  private fail(reason: unknown): void {
    if (this.status === 'unavailable') return;
    console.warn('[chess-hub] Stockfish unavailable:', reason);
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    this.worker = null;
    this.searching = false;
    this.setStatus('unavailable');
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  private requestStop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.send('stop');
  }

  private startPending(): void {
    const fen = this.pending;
    if (!fen) return;
    this.pending = null;
    this.current = fen;
    this.lines = [];
    this.searching = true;
    this.stopping = false;
    this.send(`position fen ${fen}`);
    this.send(`go depth ${MAX_DEPTH}`);
  }

  private onLine(line: string): void {
    if (line === 'uciok') {
      this.send(`setoption name MultiPV value ${MULTI_PV}`);
      this.send('isready');
      return;
    }
    if (line === 'readyok') {
      if (this.status !== 'loading') return;
      clearTimeout(this.bootTimer);
      console.info('[chess-hub] Stockfish ready');
      this.setStatus('ready');
      this.startPending();
      return;
    }
    if (line.startsWith('bestmove')) {
      this.searching = false;
      this.stopping = false;
      this.startPending();
      return;
    }
    if (!this.searching || this.stopping || !this.current) return;
    const info = parseInfo(line, this.current.split(' ')[1] !== 'b');
    if (!info) return;
    // A new depth for PV 1 starts a fresh set; keep deeper siblings until replaced.
    this.lines[info.multipv - 1] = info;
    this.listener.onLines(
      this.current,
      this.lines.filter((l) => l !== undefined)
    );
  }
}
