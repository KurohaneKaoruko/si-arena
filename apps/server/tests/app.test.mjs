import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../dist/app.js";

test("health and game metadata work without a database or player executor", async () => {
  const app = buildApp();
  try {
    assert.equal((await app.inject("/health")).statusCode, 200);
    const list = (await app.inject("/api/games")).json();
    assert.equal(list.games.length, 1);
    const game = (await app.inject("/api/games/paper")).json();
    assert.equal(game.id, "paper");
    assert.equal(game.resolvedLimits.cpuMs, 20);
    assert.equal(game.botProtocolVersion, 1);
    assert.deepEqual(game, list.games[0]);
    assert.equal((await app.inject("/api/games/missing")).statusCode, 404);
    assert.equal((await app.inject("/api/games/__proto__")).statusCode, 404);
  } finally {
    await app.close();
  }
});
