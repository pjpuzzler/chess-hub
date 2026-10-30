// Move and result sounds: short CC0 recordings in public/sounds (see the
// LICENSE.txt there). Only the expanded view imports this. iOS only lets a
// page start audio from a user gesture, so one shared AudioContext is
// created and unlocked on the first touch or key press, and each file is
// decoded once into a buffer that plays with no delay from then on.
export type SoundKind = 'move' | 'capture' | 'check' | 'success' | 'fail';

const KINDS: SoundKind[] = ['move', 'capture', 'check', 'success', 'fail'];
// Every gesture event that might unlock audio. On iOS only a tap or key press
// does: a touch that moves (a drag) never counts, so a first move made by
// dragging stays silent until the first tap. Tested on device, 0.1.4-0.1.5.
const GESTURES = [
  'pointerdown',
  'touchstart',
  'touchend',
  'mousedown',
  'pointerup',
  'click',
  'keydown',
] as const;

let ctx: AudioContext | null = null;
const buffers = new Map<SoundKind, AudioBuffer>();
let files: Promise<Map<SoundKind, ArrayBuffer>> | null = null;

// The raw files are fetched once (no gesture needed for that).
function fetchFiles(): Promise<Map<SoundKind, ArrayBuffer>> {
  files ??= Promise.all(
    KINDS.map(async (kind) => {
      try {
        const url = new URL(`sounds/${kind}.mp3`, document.baseURI);
        const res = await fetch(url);
        return [kind, res.ok ? await res.arrayBuffer() : null] as const;
      } catch {
        return [kind, null] as const;
      }
    })
  ).then((list) => {
    const map = new Map<SoundKind, ArrayBuffer>();
    for (const [kind, data] of list) if (data) map.set(kind, data);
    return map;
  });
  return files;
}

async function decodeAll(ac: AudioContext): Promise<void> {
  const raw = await fetchFiles();
  for (const [kind, data] of raw) {
    if (buffers.has(kind)) continue;
    try {
      // decodeAudioData detaches its input, so decode a copy.
      buffers.set(kind, await ac.decodeAudioData(data.slice(0)));
    } catch (err) {
      console.error(`sound ${kind} failed to decode`, err);
    }
  }
}

// A context can be created and decode before any gesture; it just stays
// suspended until unlock() runs inside one.
function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    void decodeAll(ctx);
  }
  return ctx;
}

// Runs inside a user gesture: resume the context and play one silent
// sample, which is what makes iOS let later sounds through.
function unlock(): void {
  const ac = context();
  if (!ac) return;
  if (ac.state !== 'running') void ac.resume().catch(() => undefined);
  const silent = ac.createBufferSource();
  silent.buffer = ac.createBuffer(1, 1, ac.sampleRate);
  silent.connect(ac.destination);
  silent.start(0);
}

export function sound(kind: SoundKind): void {
  if (typeof document === 'undefined' || document.hidden) return;
  const ac = ctx;
  const buffer = buffers.get(kind);
  if (!ac || !buffer) return;
  // Not unlocked yet, or iOS suspended it in the background. Skip this sound:
  // a source started on a suspended context is queued and would play late,
  // on the next tap, out of context.
  if (ac.state !== 'running') {
    void ac.resume().catch(() => undefined);
    primeSound(); // re-arm the gesture unlock
    return;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.connect(ac.destination);
  src.start(0);
}

// Starts decoding the files and arms the unlock for every later gesture
// (iOS can interrupt the context again after a call or backgrounding).
export function primeSound(): void {
  if (typeof window === 'undefined') return;
  context();
  for (const type of GESTURES)
    document.addEventListener(type, unlockIfNeeded, {
      capture: true,
      passive: true,
    });
}

// Stays armed until the context really runs, then stops listening.
function unlockIfNeeded(): void {
  if (ctx?.state === 'running') {
    for (const type of GESTURES)
      document.removeEventListener(type, unlockIfNeeded, { capture: true });
    return;
  }
  unlock();
}

// Which sound a SAN move makes.
export function soundForSan(san: string): SoundKind {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}
