import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../../src/index.js';

describe('HTTP Endpoints & Health Check', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('responds with 200 and healthy JSON from /health endpoint', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
    assert.equal(typeof body.activeRooms, 'number');
    assert.ok(body.timestamp);
  });

  it('serves frontend index.html on root path', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('QuickDrop'));
    assert.ok(text.includes('id="root"'));
  });

  it('serves SPA fallback on /room/:id route', async () => {
    const res = await fetch(`${baseUrl}/room/1234567890abcdef1234567890abcdef`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('QuickDrop'));
  });

  it('serves PWA manifest.json and sw.js correctly', async () => {
    const manifestRes = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.equal(manifest.short_name, 'QuickDrop');
    assert.ok(manifest.icons.length >= 2);

    const swRes = await fetch(`${baseUrl}/sw.js`);
    assert.equal(swRes.status, 200);
    const swText = await swRes.text();
    assert.ok(swText.includes('quickdrop-shell-'));
  });

  it('returns 404 for missing static assets instead of serving index.html', async () => {
    const res = await fetch(`${baseUrl}/assets/nonexistent-bundle.js`);
    assert.equal(res.status, 404);
  });
});
