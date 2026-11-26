'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Keep test writes away from the repository's seed data.
const sandbox = fs.mkdtempSync(path.join(__dirname, '.test-'));
let server;
let timeout;
async function run() {
  delete process.env.VERCEL;
  fs.mkdirSync(path.join(sandbox, 'data'));
  fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(sandbox, 'server.js'));
  fs.copyFileSync(path.join(__dirname, 'data', 'db.json'), path.join(sandbox, 'data', 'db.json'));
  const app = require(path.join(sandbox, 'server.js'));
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const port = server.address().port;
  function request(route, method = 'GET', body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1', port, path: route, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  const health = await request('/api/health');
  assert.equal(health.status, 200, 'health endpoint');
  const me = await request('/api/auth/me');
  assert.equal(me.status, 200, 'demo session endpoint');
  assert.equal(me.data.authenticated, true, 'demo session flag');
  const users = await request('/api/auth/users');
  assert.equal(users.status, 200, 'demo users endpoint');
  assert.ok(Array.isArray(users.data) && users.data.length >= 4, 'users must be an array of demo personas');
  const login = await request('/api/auth/login', 'POST', { email: 'demo@example.test', role: 'Administrator' });
  assert.equal(login.status, 200, 'demo login status');
  assert.equal(typeof login.data.token, 'string', 'demo token type');
  assert.ok(login.data.token.length > 0, 'demo token must not be empty');

  const route = "/api/groceries";
  const before = await request(route);
  assert.equal(before.status, 200, 'list status');
  assert.ok(Array.isArray(before.data), 'list returns an array');
  const created = await request(route, 'POST', { name: 'Smoke test record', status: 'Test' });
  assert.equal(created.status, 201, 'create status');
  assert.ok(created.data.id, 'created ID');
  const itemRoute = route + '/' + encodeURIComponent(created.data.id);
  const retrieved = await request(itemRoute);
  assert.equal(retrieved.status, 200, 'read status');
  assert.equal(retrieved.data.name, 'Smoke test record', 'created data persisted');
  const updated = await request(itemRoute, 'PUT', { status: 'Verified Test' });
  assert.equal(updated.status, 200, 'update status');
  const reread = await request(itemRoute);
  assert.equal(reread.data.status, 'Verified Test', 'updated data persisted');
  const removed = await request(itemRoute, 'DELETE');
  assert.equal(removed.status, 200, 'delete status');
  assert.equal((await request(itemRoute)).status, 404, 'deleted item is missing');
  const after = await request(route);
  assert.equal(after.status, 200, 'final list status');
  assert.deepEqual(after.data, before.data, 'CRUD cycle preserves existing records');
  console.log('API smoke tests passed. Demo authentication is not a security validation.');
}

timeout = setTimeout(() => {
  console.error('Test suite timed out');
  process.exitCode = 1;
  if (server) server.closeAllConnections?.();
}, 20000);

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

