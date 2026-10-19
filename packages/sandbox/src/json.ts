import type { JsonValue } from "@si-arena/protocol";

/** Validate host input without calling toJSON or getters. Never accepts guest handles. */
export function encodeJson(value: unknown, maxBytes: number): string {
  const ancestors = new Set<object>();
  let bytes = 0;
  const emit = (part: string): string => {
    bytes += Buffer.byteLength(part);
    if (bytes > maxBytes) throw new RangeError("JSON byte limit exceeded");
    return part;
  };
  const visit = (item: unknown): string => {
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return emit(JSON.stringify(item));
    if (typeof item === "number" && Number.isFinite(item)) return emit(JSON.stringify(item));
    if (typeof item !== "object" || item === null || ancestors.has(item))
      throw new TypeError("Invalid JSON data");
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new TypeError("JSON requires plain objects");
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors).filter(
      (key) => descriptors[key as string]?.enumerable,
    );
    if (keys.some((key) => typeof key !== "string"))
      throw new TypeError("Symbol keys are not JSON data");
    const parts: string[] = [emit(array ? "[" : "{")];
    if (array && item.length > maxBytes) throw new RangeError("Array exceeds JSON byte limit");
    const names = array
      ? Array.from({ length: item.length }, (_, i) => String(i))
      : (keys as string[]);
    if (array && names.length !== keys.length)
      throw new TypeError("Arrays must be dense and have no extra properties");
    for (const [index, key] of names.entries()) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor))
        throw new TypeError("Accessors and sparse arrays are not JSON data");
      if (index) parts.push(emit(","));
      if (!array) parts.push(emit(JSON.stringify(key)), emit(":"));
      parts.push(visit(descriptor.value));
    }
    parts.push(emit(array ? "]" : "}"));
    ancestors.delete(item);
    return parts.join("");
  };
  return visit(value);
}

export function cloneJson<T extends JsonValue>(value: T, maxBytes: number): T {
  return JSON.parse(encodeJson(value, maxBytes)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text);
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}
