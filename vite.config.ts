import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { devvit } from '@devvit/start/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

// Stockfish 19 lite single-threaded (no SharedArrayBuffer needed). The worker
// loads the .wasm from its own URL with .js swapped for .wasm, so both files
// are served side by side at /engine/ on the webview's own origin.
const ENGINE_DIR = path.join(root, 'node_modules/stockfish/bin');
const ENGINE_FILES = [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
];

function stockfishEngine(): Plugin {
  return {
    name: 'chess-hub-stockfish',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(/^\/engine\//, '');
        if (!name || !ENGINE_FILES.includes(name)) return next();
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
        );
        res.end(readFileSync(path.join(ENGINE_DIR, name)));
      });
    },
    generateBundle() {
      if (this.environment.name !== 'client') return;
      for (const name of ENGINE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `engine/${name}`,
          source: readFileSync(path.join(ENGINE_DIR, name)),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'mock') {
    // Local harness (`npm run mock`): serves src/client with a fake
    // @devvit/web/client whose fetch shim answers /api/* from fixtures.
    // The alias exists only here, so nothing mock-related reaches the build.
    return {
      root: path.join(root, 'src/client'),
      publicDir: path.join(root, 'public'),
      plugins: [
        react(),
        stockfishEngine(),
        {
          name: 'chess-hub-mock-index',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url !== '/' && req.url !== '/index.html') return next();
              res.statusCode = 302;
              res.setHeader('Location', '/mock/index.html');
              res.end();
            });
          },
        },
      ],
      resolve: {
        alias: {
          '@devvit/web/client': path.join(
            root,
            'src/client/mock/devvit-client.ts'
          ),
        },
      },
      server: { port: 5180, strictPort: true },
    };
  }
  return {
    plugins: [react(), devvit(), stockfishEngine()],
  };
});
