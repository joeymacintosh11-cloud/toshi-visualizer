// Wires the local native-ffmpeg proxy backend into Vite's own dev server as
// middleware, so `npm run dev` starts one process that serves both the
// React frontend and the /api/* proxy-generation endpoints — no second
// port, no CORS, no `concurrently` needed.
import type { Plugin } from 'vite';
import express from 'express';
import { proxyRouter } from './proxyApi.js';
import { exportRouter } from './exportApi.js';
import { PROXIES_DIR } from './tempStorage.js';

export function nativeProxyBackendPlugin(): Plugin {
  return {
    name: 'toshi-native-proxy-backend',
    configureServer(server) {
      const app = express();
      app.use('/api', proxyRouter);
      app.use('/api', exportRouter);
      server.middlewares.use(app);
      // Serves generated proxy files (and lets the frontend simply <video src="/temp/proxies/...">).
      // Express's static handler is typed against Express's Request/Response,
      // which don't structurally match Connect's NextHandleFunction even
      // though they're runtime-compatible (Express's types are a superset
      // of Node's http types) — this cast is the standard way to mount an
      // Express middleware into Vite's Connect-based dev server.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      server.middlewares.use('/temp/proxies', express.static(PROXIES_DIR) as any);
    },
  };
}
