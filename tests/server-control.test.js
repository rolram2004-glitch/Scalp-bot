const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

require("ts-node/register/transpile-only");

const { createApp } = require("../server");

function post(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2",
        ...headers
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end("{}");
  });
}

test("remote-style bot controls require the configured control token", async () => {
  const previousToken = process.env.CONTROL_PANEL_TOKEN;
  process.env.CONTROL_PANEL_TOKEN = "unit-test-control-token";
  const server = createApp().listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const port = server.address().port;
    const response = await post(port, "/api/bot/stop");

    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), {
      error: "control_panel_authorization_required"
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) delete process.env.CONTROL_PANEL_TOKEN;
    else process.env.CONTROL_PANEL_TOKEN = previousToken;
  }
});
