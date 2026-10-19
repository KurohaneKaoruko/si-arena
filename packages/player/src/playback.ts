import { computed, onScopeDispose, ref, watch, type ShallowRef } from "vue";

export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8] as const);
export interface AnimationClock {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}
export interface PlaybackSource {
  totalTicks: number;
  errorTicks: readonly number[];
}
export interface PlaybackOptions {
  /** Called once per clock callback while playing, after tick and progress settle. */
  onFrame?: () => void;
}

/**
 * Clock injection keeps playback deterministic in tests and leaves browser scheduling at the edge.
 * `progress` is the fraction of the current tick's animation window: it only advances while
 * playing, windows are entered by natural forward crossings, and every seek settles at 1 so
 * transient animations of skipped ticks never replay.
 */
export function usePlayback(
  source: ShallowRef<PlaybackSource | null>,
  clock: AnimationClock,
  options: PlaybackOptions = {},
) {
  const tick = ref(0),
    playing = ref(false),
    speed = ref<number>(1),
    progress = ref(1);
  let handle: number | undefined;
  let previous: number | undefined;
  let carry = 0;
  let armed = false;
  function settle() {
    carry = 0;
    armed = false;
    progress.value = 1;
  }
  function pause() {
    playing.value = false;
    if (handle !== undefined) clock.cancel(handle);
    handle = undefined;
    previous = undefined;
  }
  function advance(time: number) {
    handle = undefined;
    if (!playing.value || !source.value) return;
    if (previous !== undefined) {
      // Hidden/slow tabs never accumulate an unbounded catch-up burst.
      carry += (Math.min(250, Math.max(0, time - previous)) * speed.value) / 100;
      // A non-finite speed written straight onto the exposed ref must not poison the window forever.
      if (!Number.isFinite(carry)) carry = 0;
      const steps = Math.floor(carry);
      carry -= steps;
      if (steps > 0) {
        armed = true;
        tick.value = Math.min(source.value.totalTicks, tick.value + steps);
      }
    }
    previous = time;
    if (tick.value >= source.value.totalTicks) {
      pause();
      settle();
    } else {
      handle = clock.request(advance);
    }
    progress.value = armed ? carry : 1;
    options.onFrame?.();
  }
  function play() {
    if (!source.value || playing.value) return;
    if (tick.value >= source.value.totalTicks) {
      tick.value = 0;
      settle();
    }
    playing.value = true;
    handle = clock.request(advance);
  }
  function seek(value: number) {
    pause();
    settle();
    if (!source.value || !Number.isFinite(value)) return;
    tick.value = Math.max(0, Math.min(source.value.totalTicks, Math.trunc(value)));
  }
  function setSpeed(value: number) {
    if (!(PLAYBACK_SPEEDS as readonly number[]).includes(value))
      throw new RangeError("Invalid playback speed");
    speed.value = value;
  }
  const previousError = computed(() =>
    source.value?.errorTicks.findLast((inputTick) => inputTick + 1 < tick.value),
  );
  const nextError = computed(() =>
    source.value?.errorTicks.find((inputTick) => inputTick + 1 > tick.value),
  );
  watch(
    source,
    () => {
      pause();
      tick.value = 0;
      settle();
    },
    { flush: "sync" },
  );
  onScopeDispose(pause);
  return {
    tick,
    playing,
    speed,
    progress,
    previousError,
    nextError,
    play,
    pause,
    seek,
    setSpeed,
    step: (delta: number) => seek(tick.value + delta),
    jumpError(direction: -1 | 1) {
      const target = direction === 1 ? nextError.value : previousError.value;
      if (target !== undefined) seek(target + 1);
    },
  };
}
