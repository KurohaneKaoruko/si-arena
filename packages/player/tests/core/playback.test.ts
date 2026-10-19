import { effectScope, shallowRef } from "vue";
import { expect, test } from "vitest";
import { usePlayback, type PlaybackOptions, type PlaybackSource } from "../../src";

function setup(options: PlaybackOptions = {}) {
  const source = shallowRef<PlaybackSource | null>({ totalTicks: 10, errorTicks: [0, 3, 8] });
  const callbacks = new Map<number, (time: number) => void>();
  let id = 0;
  const scope = effectScope();
  const playback = scope.run(() =>
    usePlayback(
      source,
      {
        request(callback) {
          callbacks.set(++id, callback);
          return id;
        },
        cancel(handle) {
          callbacks.delete(handle);
        },
      },
      options,
    ),
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
  expect(f.playback.progress.value).toBe(1);
  f.source.value = { totalTicks: 5, errorTicks: [] };
  f.playback.play();
  f.scope.stop();
  expect(f.callbacks.size).toBe(0);
});
test("animation progress tracks the tick window, and only natural crossings arm it", () => {
  const f = setup();
  try {
    expect(f.playback.progress.value).toBe(1);
    f.playback.play();
    f.advance(0);
    f.advance(40);
    expect(f.playback.tick.value).toBe(0);
    expect(f.playback.progress.value).toBe(1);
    f.advance(100);
    expect(f.playback.tick.value).toBe(1);
    expect(f.playback.progress.value).toBeCloseTo(0);
    f.advance(130);
    expect(f.playback.progress.value).toBeCloseTo(0.3);
    f.playback.seek(5);
    expect(f.playback.progress.value).toBe(1);
    f.playback.play();
    f.advance(0);
    f.advance(50);
    // The window entered by a seek stays settled; no replay of skipped transient animations.
    expect(f.playback.tick.value).toBe(5);
    expect(f.playback.progress.value).toBe(1);
    f.advance(100);
    expect(f.playback.tick.value).toBe(6);
    expect(f.playback.progress.value).toBeCloseTo(0);
    f.playback.step(1);
    expect(f.playback.progress.value).toBe(1);
  } finally {
    f.scope.stop();
  }
});
test("pausing freezes the animation progress and resuming continues the window", () => {
  const f = setup();
  try {
    f.playback.play();
    f.advance(0);
    f.advance(100);
    f.advance(140);
    expect(f.playback.tick.value).toBe(1);
    expect(f.playback.progress.value).toBeCloseTo(0.4);
    f.playback.pause();
    expect(f.playback.progress.value).toBeCloseTo(0.4);
    f.playback.play();
    f.advance(500);
    expect(f.playback.progress.value).toBeCloseTo(0.4);
    f.advance(520);
    expect(f.playback.progress.value).toBeCloseTo(0.6);
  } finally {
    f.scope.stop();
  }
});
test("a non-finite speed written onto the ref stalls playback without leaking NaN progress", () => {
  const f = setup();
  try {
    f.playback.play();
    f.advance(0);
    f.advance(100);
    expect(f.playback.tick.value).toBe(1);
    f.playback.speed.value = Number.NaN;
    f.advance(200);
    f.advance(300);
    expect(f.playback.tick.value).toBe(1);
    expect(Number.isFinite(f.playback.progress.value)).toBe(true);
    f.playback.setSpeed(1);
    f.advance(400);
    expect(f.playback.tick.value).toBe(2);
    f.advance(500);
    expect(f.playback.tick.value).toBe(3);
  } finally {
    f.scope.stop();
  }
});
test("onFrame fires once per playing clock callback and the end settles progress", () => {
  let frames = 0;
  const f = setup({ onFrame: () => (frames += 1) });
  try {
    f.playback.play();
    f.advance(0);
    expect(frames).toBe(1);
    f.advance(40);
    expect(frames).toBe(2);
    f.playback.pause();
    expect(frames).toBe(2);
    f.playback.seek(9);
    f.playback.play();
    f.advance(0);
    f.advance(100);
    expect(f.playback.tick.value).toBe(10);
    expect(f.playback.playing.value).toBe(false);
    expect(f.playback.progress.value).toBe(1);
    expect(frames).toBe(4);
    f.playback.play();
    expect(f.playback.tick.value).toBe(0);
    expect(f.playback.progress.value).toBe(1);
  } finally {
    f.scope.stop();
  }
});
