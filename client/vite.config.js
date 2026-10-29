import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function swVersionPlugin() {
  const version = Date.now().toString(36);
  return {
    name: 'sw-version-plugin',
    closeBundle() {
      const distSwPath = path.resolve(__dirname, 'dist/sw.js');
      if (fs.existsSync(distSwPath)) {
        let content = fs.readFileSync(distSwPath, 'utf8');
        content = content.replace(/__BUILD_VERSION__/g, version);
        fs.writeFileSync(distSwPath, content, 'utf8');
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sw.js') {
          const swSrcPath = path.resolve(__dirname, 'public/sw.js');
          if (fs.existsSync(swSrcPath)) {
            let content = fs.readFileSync(swSrcPath, 'utf8');
            content = content.replace(/__BUILD_VERSION__/g, 'dev-' + version);
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            return res.end(content);
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  server: {
    host: true, // Listen on all network interfaces for local phone testing
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
