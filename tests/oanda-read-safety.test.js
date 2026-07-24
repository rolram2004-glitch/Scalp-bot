const test = require('node:test');
const assert = require('node:assert/strict');

test('OANDA account test is direct, bounded, Practice-only and verifies the account ID', async () => {
  const axios = require('axios');
  const originalGet = axios.get;
  const old = {
    key: process.env.OANDA_API_KEY,
    account: process.env.OANDA_ACCOUNT_ID,
    mode: process.env.TRADING_MODE,
    live: process.env.LIVE_TRADING_ENABLED
  };
  process.env.OANDA_API_KEY = 'test-token-not-a-secret';
  process.env.OANDA_ACCOUNT_ID = 'practice-account';
  process.env.TRADING_MODE = 'PAPER';
  process.env.LIVE_TRADING_ENABLED = 'false';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/oanda')];

  let capturedUrl;
  let capturedOptions;
  axios.get = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      data: {
        account: {
          id: 'practice-account', currency: 'CHF', balance: '1000.00', NAV: '1000.00',
          unrealizedPL: '0.00', openTradeCount: 0, openPositionCount: 0, state: 'PENDING'
        }
      }
    };
  };

  try {
    const oanda = require('../src/oanda');
    const status = await oanda.getConnectionStatus();

    assert.equal(status.connected, true);
    assert.equal(status.currency, 'CHF');
    assert.match(capturedUrl, /^https:\/\/api-fxpractice\.oanda\.com\/v3\/accounts\/practice-account$/);
    assert.equal(capturedOptions.timeout, 8000);
    assert.equal(capturedOptions.proxy, false);
    assert.match(capturedOptions.headers.Authorization, /^Bearer /);

    axios.get = async () => ({ data: { account: { id: 'different-account', currency: 'CHF' } } });
    const mismatch = await oanda.getConnectionStatus();
    assert.equal(mismatch.connected, false);
    assert.equal(mismatch.reason, 'account_id_mismatch');
  } finally {
    axios.get = originalGet;
    if (old.key === undefined) delete process.env.OANDA_API_KEY; else process.env.OANDA_API_KEY = old.key;
    if (old.account === undefined) delete process.env.OANDA_ACCOUNT_ID; else process.env.OANDA_ACCOUNT_ID = old.account;
    if (old.mode === undefined) delete process.env.TRADING_MODE; else process.env.TRADING_MODE = old.mode;
    if (old.live === undefined) delete process.env.LIVE_TRADING_ENABLED; else process.env.LIVE_TRADING_ENABLED = old.live;
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/oanda')];
  }
});

test('malformed OANDA reconciliation responses fail closed', async () => {
  const axios = require('axios');
  const originalGet = axios.get;
  axios.get = async () => ({ data: {} });
  try {
    const oanda = require('../src/oanda');
    await assert.rejects(() => oanda.getOpenTrades(), (error) => {
      assert.equal(error.name, 'OandaAPIError');
      assert.equal(error.scope, 'open_trades');
      return true;
    });
  } finally {
    axios.get = originalGet;
  }
});
