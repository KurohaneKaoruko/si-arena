import type { DeepReadonly, JsonValue } from "./json";

/** Strict JSON encoding: no getters, toJSON hooks, sparse arrays, cycles or implicit coercion. */
export function stringifyJson(
  value: unknown,
  options: { canonical?: boolean; maxBytes?: number } = {},
): string {
  const ancestors = new Set<object>();
  const parts: string[] = [];
  let bytes = 0;
  const emit = (text: string) => {
    bytes += utf8Bytes(text);
    if (bytes > (options.maxBytes ?? Number.MAX_SAFE_INTEGER))
      throw new RangeError("JSON byte limit exceeded");
    parts.push(text);
  };
  const visit = (item: unknown): void => {
    if (!options.canonical && item !== null && typeof item === "object" && snapshots.has(item)) {
      const encoded = encodeSnapshot(item);
      bytes += snapshots.get(item)!;
      if (bytes > (options.maxBytes ?? Number.MAX_SAFE_INTEGER))
        throw new RangeError("JSON byte limit exceeded");
      parts.push(encoded);
      return;
    }
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      emit(JSON.stringify(item));
      return;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      emit(JSON.stringify(item));
      return;
    }
    if (item === null || typeof item !== "object" || ancestors.has(item))
      throw new TypeError("Expected strict JSON data");
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Expected a plain JSON object");
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    if (array) {
      if (
        item.length > (options.maxBytes ?? Number.MAX_SAFE_INTEGER) ||
        keys.length !== item.length + 1
      )
        throw new TypeError("Expected a dense JSON array without extra properties");
      emit("[");
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, index);
        if (!property?.enumerable || !Object.hasOwn(property, "value"))
          throw new TypeError("Expected a dense data array");
        if (index) emit(",");
        visit(property.value);
      }
      emit("]");
    } else {
      if (keys.some((key) => typeof key !== "string"))
        throw new TypeError("Symbol keys are not JSON data");
      const names = keys as string[];
      if (options.canonical) names.sort();
      emit("{");
      for (const [index, key] of names.entries()) {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property?.enumerable || !Object.hasOwn(property, "value"))
          throw new TypeError("Expected enumerable JSON data properties");
        if (index) emit(",");
        emit(JSON.stringify(key));
        emit(":");
        visit(property.value);
      }
      emit("}");
    }
    ancestors.delete(item);
  };
  visit(value);
  return parts.join("");
}

/** Encoded byte size of every deep-frozen node that passed the strict walk below. */
const snapshots = new WeakMap<object, number>();
const encodedSnapshots = new WeakMap<object, string>();
const joinNumbers = Function.prototype.call.bind(Array.prototype.join) as (
  values: readonly number[],
  separator: string,
) => string;

/** Only protocol-owned data reaches this path; no getters or toJSON hooks run. */
function encodeSnapshot(value: object): string {
  const cached = encodedSnapshots.get(value);
  if (cached !== undefined) return cached;
  const encode = (item: JsonValue): string =>
    item !== null && typeof item === "object" ? encodeSnapshot(item) : JSON.stringify(item);
  let text: string;
  if (Array.isArray(value)) {
    let numeric = true;
    for (let i = 0; i < value.length; i++)
      if (typeof value[i] !== "number") {
        numeric = false;
        break;
      }
    // Validated finite numbers stringify exactly like join, without JSON hooks.
    if (numeric) {
      text = `[${joinNumbers(value as number[], ",")}]`;
      encodedSnapshots.set(value, text);
      return text;
    }
    const parts: string[] = [];
    parts.length = value.length;
    for (let i = 0; i < value.length; i++) parts[i] = encode(value[i] as JsonValue);
    text = `[${parts.join(",")}]`;
  } else {
    const parts: string[] = [];
    for (const key of Object.keys(value))
      parts.push(`${JSON.stringify(key)}:${encode((value as Record<string, JsonValue>)[key]!)}`);
    text = `{${parts.join(",")}}`;
  }
  encodedSnapshots.set(value, text);
  return text;
}

/** True for data returned by snapshotJson: strict, deep-frozen and safe to share. */
export function isJsonSnapshot(value: unknown): boolean {
  return value !== null && typeof value === "object" && snapshots.has(value);
}

export function cloneJson<T>(value: T, maxBytes?: number): T {
  return copyJson(value, maxBytes, false) as T;
}

/**
 * Strict JSON validation like cloneJson, but the result is deep-frozen and
 * remembered. Snapshots are reused by reference instead of copied, so passing immutable data through several boundaries
 * costs one walk instead of one per boundary.
 */
export function snapshotJson<T>(value: T, maxBytes?: number): DeepReadonly<T> {
  return copyJson(value, maxBytes, true) as DeepReadonly<T>;
}

/** Plain mutable copy of a snapshot; its structure was already validated. */
function thaw(item: object): JsonValue {
  // Same null-prototype construction as the strict walk, so no inherited setter runs.
  const array = Array.isArray(item);
  const copied = (array ? [] : {}) as Record<string, JsonValue>;
  Object.setPrototypeOf(copied, null);
  for (const key of Object.keys(item)) {
    const child = (item as Record<string, JsonValue>)[key]!;
    copied[key] = child !== null && typeof child === "object" ? thaw(child) : child;
  }
  Object.setPrototypeOf(copied, array ? Array.prototype : Object.prototype);
  return copied as JsonValue;
}

function copyJson(value: unknown, maxBytes: number | undefined, freeze: boolean): JsonValue {
  const ancestors = new Set<object>();
  const limit = maxBytes ?? Number.MAX_SAFE_INTEGER;
  let bytes = 0;
  const charge = (count: number) => {
    bytes += count;
    if (bytes > limit) throw new RangeError("JSON byte limit exceeded");
  };
  const visit = (item: unknown): JsonValue => {
    if (item === null) {
      charge(4);
      return null;
    }
    if (typeof item === "boolean") {
      charge(item ? 4 : 5);
      return item;
    }
    if (typeof item === "string") {
      charge(utf8Bytes(JSON.stringify(item)));
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      const smallInteger = Number.isInteger(item) && item > -10 && item < 10;
      charge(smallInteger ? (item < 0 ? 2 : 1) : JSON.stringify(item).length);
      return item === 0 ? 0 : item;
    }
    if (typeof item !== "object") throw new TypeError("Expected strict JSON data");
    const known = snapshots.get(item);
    if (known !== undefined) {
      charge(known);
      return freeze ? (item as JsonValue) : thaw(item);
    }
    if (ancestors.has(item)) throw new TypeError("Expected strict JSON data");
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Expected a plain JSON object");
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    const start = bytes;
    charge(2);
    let result: JsonValue;
    if (array) {
      if (item.length > limit || keys.length !== item.length + 1)
        throw new TypeError("Expected a dense JSON array without extra properties");
      const copied: JsonValue[] = [];
      // A null prototype during construction prevents inherited setters, including
      // numeric Array.prototype setters. Return the same plain prototypes as JSON.parse.
      Object.setPrototypeOf(copied, null);
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, index);
        if (!property?.enumerable || !Object.hasOwn(property, "value"))
          throw new TypeError("Expected a dense data array");
        if (index) charge(1);
        copied[index] = visit(property.value);
      }
      Object.setPrototypeOf(copied, Array.prototype);
      result = copied;
    } else {
      const copied: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        if (typeof key !== "string") throw new TypeError("Symbol keys are not JSON data");
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property?.enumerable || !Object.hasOwn(property, "value"))
          throw new TypeError("Expected enumerable JSON data properties");
        if (index) charge(1);
        charge(utf8Bytes(JSON.stringify(key)) + 1);
        copied[key] = visit(property.value);
      }
      Object.setPrototypeOf(copied, Object.prototype);
      result = copied;
    }
    ancestors.delete(item);
    if (!freeze) return result;
    // Only copies built here are registered, so every snapshot is protocol-owned data.
    Object.freeze(result);
    snapshots.set(result as object, bytes - start);
    return result;
  };
  return visit(value);
}

export function toJsonValue(value: unknown, maxBytes?: number): JsonValue {
  return cloneJson(value, maxBytes) as JsonValue;
}

/** Call only after strict JSON validation. */
export function freezeJson<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0,
    end = 0;
  for (const character of text) {
    const size = utf8Bytes(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
}
