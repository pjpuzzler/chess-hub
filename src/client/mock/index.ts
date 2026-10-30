// Harness index: pick a fixture, see the inline splash at feed sizes and the
// expanded game in a phone frame. Mock mode only (`npm run mock`).
import { FIXTURES } from './fixtures';

const params = new URLSearchParams(location.search);
const current = params.get('fixture') ?? 'puzzle';
const q = (name: string) => `?fixture=${encodeURIComponent(name)}`;

const style = document.createElement('style');
style.textContent = `
  body { margin: 0; font: 14px system-ui, sans-serif; background: #e9e6e0; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #0e0d0b; color: #ddd; } a { color: #9cc; } }
  header { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  header strong { margin-right: 8px; }
  header a { padding: 4px 10px; border-radius: 999px; text-decoration: none; border: 1px solid #9994; color: inherit; }
  header a.on { background: #4f7f22; color: #fff; border-color: transparent; }
  main { display: flex; flex-wrap: wrap; gap: 20px; padding: 8px 16px 32px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-size: 12px; opacity: .7; margin-bottom: 4px; }
  iframe { display: block; border: 0; border-radius: 12px; background: #fff; box-shadow: 0 2px 12px #0003; }
`;
document.head.append(style);

const header = document.createElement('header');
const brand = document.createElement('strong');
brand.textContent = 'Chess Hub mock';
header.append(brand);
for (const [name, f] of Object.entries(FIXTURES)) {
  const a = document.createElement('a');
  a.href = q(name);
  a.textContent = f.label;
  if (name === current) a.className = 'on';
  header.append(a);
}

const main = document.createElement('main');
const frame = (caption: string, src: string, w: number, h: number) => {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = `${caption} (${w}×${h})`;
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.width = String(w);
  iframe.height = String(h);
  iframe.title = caption;
  fig.append(cap, iframe);
  main.append(fig);
};
frame('Inline, phone, tall', `/splash.html${q(current)}`, 375, 512);
frame('Inline, phone, regular', `/splash.html${q(current)}`, 375, 320);
frame('Inline, desktop, tall', `/splash.html${q(current)}`, 640, 512);
frame('Expanded, small phone', `/game.html${q(current)}`, 375, 640);
frame('Expanded, phone', `/game.html${q(current)}`, 375, 812);

const open = document.createElement('p');
const openLink = document.createElement('a');
openLink.href = `/game.html${q(current)}`;
openLink.textContent = 'Open expanded view full window';
open.append(openLink);
header.append(open);

document.getElementById('root')?.append(header, main);
