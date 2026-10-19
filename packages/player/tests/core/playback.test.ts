import { effectScope, shallowRef } from "vue";
import { expect, test } from "vitest";
import { usePlayback, type PlaybackSource } from "../../src";

function setup() {
  const source = shallowRef<PlaybackSource | null>({ totalTicks: 10, errorTicks: [0, 3, 8] });
  const callbacks = new Map<number, (time: number) => void>();
  let id = 0;
  const scope = effectScope();
  const playback = scope.run(() =>
    usePlayback(source, {
      request(callback) {
        callbacks.set(++id, callback);
        return id;
      },
      cancel(handle) {
        callbacks.delete(handle);
      },
    }),
  )!;
  return {
    source,
    callbacks,
    scope,
    playback,
    advance(time: number) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    },
  };
}
test("pause, resume, speed and end-of-match use bounded clock increments", () => {
  const f = setup();
  try {
    f.playback.play();
    f.advance(0);
    f.advance(100);
    expect(f.playback.tick.value).toBe(1);
    f.playback.pause();
    expect(f.callbacks.size).toBe(0);
    f.playback.setSpeed(2);
    f.playback.play();
    f.advance(2000);
    f.advance(2100);
    expect(f.playback.tick.value).toBe(3);
    f.advance(999999);
    expect(f.playback.tick.value).toBe(8);
    f.advance(1000099);
    expect(f.playback.tick.value).toBe(10);
    expect(f.playback.playing.value).toBe(false);
    f.playback.play();
    expect(f.playback.tick.value).toBe(0);
    expect(() => f.playback.setSpeed(99)).toThrow();
  } finally {
    f.scope.stop();
  }
});
test("error navigation targets the world after the input tick, and seeks pause playback", () => {
  const f = setup();
  try {
    f.playback.jumpError(1);
    expect(f.playback.tick.value).toBe(1);
    f.playback.jumpError(1);
    expect(f.playback.tick.value).toBe(4);
    f.playback.jumpError(-1);
    expect(f.playback.tick.value).toBe(1);
    f.playback.play();
    f.playback.seek(999);
    expect(f.playback.tick.value).toBe(10);
    expect(f.playback.playing.value).toBe(false);
    f.playback.seek(-1);
    expect(f.playback.tick.value).toBe(0);
    f.playback.seek(NaN);
    expect(f.playback.tick.value).toBe(0);
  } finally {
    f.scope.stop();
  }
});
test("replacing the session or disposing the scope stops outstanding animation callbacks", () => {
  const f = setup();
  f.playback.play();
  f.playback.seek(3);
  f.playback.play();
  f.source.value = null;
  expect(f.callbacks.size).toBe(0);
  expect(f.playback.tick.value).toBe(0);
  f.source.value = { totalTicks: 5, errorTicks: [] };
  f.playback.play();
  f.scope.stop();
  expect(f.callbacks.size).toBe(0);
});
