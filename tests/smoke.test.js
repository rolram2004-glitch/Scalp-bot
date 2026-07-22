const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server');
const oanda = require('../src/oanda');

async function request(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

test('health endpoint returns ok', async () => {
  const app = createApp();
  const server = app.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));

  const response = await request(server, '/health');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"status":"ok"/);

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test('public OANDA status masks the account identifier', async (t) => {
  const original = oanda.getConnectionStatus;
  oanda.getConnectionStatus = async () => ({
    connected: true,
    accountId: '101-999-12345678-001',
    currency: 'CHF',
    mode: 'practice'
  });
  t.after(() => {
    oanda.getConnectionStatus = original;
  });

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await request(server, '/api/oanda/status');
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.accountId, '***-001');
  assert.equal(payload.currency, 'CHF');
  assert.ok(Number.isFinite(Date.parse(payload.checkedAt)));
  assert.doesNotMatch(response.body, /12345678/);
});

test('intelligence endpoint rejects symbols outside the configured universe without a data call', async (t) => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await request(server, '/api/intelligence?symbol=NOT_A_SYMBOL');

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'unsupported_symbol' });
});
