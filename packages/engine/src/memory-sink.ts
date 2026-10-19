import { cloneJson, stringifyJson, utf8Bytes, type Replay } from "@si-arena/protocol";
import {
  EngineError,
  type ReplayFooter,
  type ReplayHeader,
  type ReplaySink,
  type ReplayTick,
} from "./types";

/** Explicitly bounded convenience sink for tests and short local sessions. */
export class MemoryReplaySink<State, Action> implements ReplaySink<State, Action> {
  private header: ReplayHeader<State> | undefined;
  private ticks: ReplayTick<Action>[] = [];
  private footer: ReplayFooter | undefined;
  private bytes = 32;
  private started = false;
  constructor(private readonly maxBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new RangeError("Invalid in-memory replay budget");
  }
  private account(value: unknown): void {
    this.bytes += utf8Bytes(stringifyJson(value, { maxBytes: this.maxBytes })) + 1;
    if (this.bytes > this.maxBytes) throw new RangeError("In-memory replay budget exceeded");
  }
  async start(header: ReplayHeader<State>): Promise<void> {
    if (this.started) throw new EngineError("Replay sinks can only be used once");
    this.started = true;
    this.account(header);
    this.header = cloneJson(header);
  }
  async append(tick: ReplayTick<Action>): Promise<void> {
    if (!this.header || this.footer || tick.tick !== this.ticks.length)
      throw new EngineError("Invalid replay write order");
    this.account(tick);
    this.ticks.push(cloneJson(tick));
  }
  async finish(footer: ReplayFooter): Promise<void> {
    if (!this.header || this.footer || footer.result.completedTicks !== this.ticks.length)
      throw new EngineError("Invalid replay completion");
    this.account(footer);
    this.footer = cloneJson(footer);
  }
  async abort(): Promise<void> {
    this.header = undefined;
    this.footer = undefined;
    this.ticks = [];
  }
  get replay(): Replay<State, Action> {
    if (!this.header || !this.footer)
      throw new EngineError("Replay has not completed successfully");
    return cloneJson({ ...this.header, ticks: this.ticks, ...this.footer });
  }
}
