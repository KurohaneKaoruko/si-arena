/** Trusted guest code. Capture intrinsics before loading the SDK and player module. */
export const BOOTSTRAP = String.raw`(function(config, emitLog) {
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const ownKeys = Reflect.ownKeys;
  const descriptor = Object.getOwnPropertyDescriptor;
  const proto = Object.getPrototypeOf;
  const objectProto = Object.prototype;
  const hasOwn = Object.prototype.hasOwnProperty;
  const promiseProto = Promise.prototype;
  const arrayIsArray = Array.isArray;
  const finite = Number.isFinite;
  const freeze = Object.freeze;
  const apply = Reflect.apply;
  const slice = String.prototype.slice;
  const charCodeAt = String.prototype.charCodeAt;
  const setAdd = Set.prototype.add;
  const setHas = Set.prototype.has;
  const setDelete = Set.prototype.delete;
  const SetClass = Set;
  let failure;
  let logLines = 0, logBytes = 0, logsTruncated = false;
  function size(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const c = apply(charCodeAt, text, [i]);
      if (c < 128) bytes++; else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && apply(charCodeAt, text, [i+1]) >= 0xdc00 && apply(charCodeAt, text, [i+1]) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function cut(text, max) {
    let bytes = 0, end = 0;
    while (end < text.length) {
      const c = apply(charCodeAt, text, [end]);
      let cost = c < 128 ? 1 : c < 2048 ? 2 : 3, units = 1;
      if (c >= 0xd800 && c <= 0xdbff && end + 1 < text.length) {
        const next = apply(charCodeAt, text, [end + 1]);
        if (next >= 0xdc00 && next <= 0xdfff) { cost = 4; units = 2; }
      }
      if (bytes + cost > max) break;
      bytes += cost; end += units;
    }
    return apply(slice, text, [0, end]);
  }
  function fail(type, message) { failure = { type, message }; throw null; }
  function encode(value, limit, invalid, tooLarge, rootObject) {
    const ancestors = new SetClass();
    let output = '', bytes = 0;
    function add(text) {
      bytes += size(text);
      if (bytes > limit) fail(tooLarge, 'Serialized output exceeds byte limit');
      output += text;
    }
    function visit(item) {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') { add(stringify(item)); return; }
      if (typeof item === 'number' && finite(item)) { add(stringify(item)); return; }
      if (typeof item !== 'object' || apply(setHas, ancestors, [item])) fail(invalid, 'Value is not strict JSON data');
      const array = arrayIsArray(item), prototype = proto(item);
      if (!array && prototype !== objectProto && prototype !== null) fail(invalid, 'Only plain JSON objects are supported');
      apply(setAdd, ancestors, [item]);
      const keys = ownKeys(item);
      let count = 0;
      if (array) {
        const length = descriptor(item, 'length').value;
        if (length > limit) fail(tooLarge, 'Array exceeds byte limit');
        add('[');
        for (let i = 0; i < length; i++) {
          const d = descriptor(item, '' + i);
          if (!d || !apply(hasOwn, d, ['value']) || !d.enumerable) fail(invalid, 'Sparse arrays and accessors are forbidden');
          if (i) add(',');
          visit(d.value); count++;
        }
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i], d = descriptor(item, key);
          if (d && d.enumerable) count--;
        }
        if (count !== 0) fail(invalid, 'Extra array properties are forbidden');
        add(']');
      } else {
        add('{');
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i], d = descriptor(item, key);
          if (!d || !d.enumerable) continue;
          if (typeof key !== 'string' || !apply(hasOwn, d, ['value'])) fail(invalid, 'Symbol keys and accessors are forbidden');
          if (count++) add(',');
          add(stringify(key)); add(':'); visit(d.value);
        }
        add('}');
      }
      apply(setDelete, ancestors, [item]);
    }
    if (rootObject && (value === null || typeof value !== 'object' || arrayIsArray(value))) fail(invalid, 'Memory root must be an object');
    visit(value);
    return output;
  }
  function markTruncated() {
    if (!logsTruncated) { logsTruncated = true; emitLog("__truncated", ""); }
  }
  function log(level, args) {
    if (logLines >= config.limits.logs.tickLines || logBytes >= config.logBytes) { markTruncated(); return; }
    const available = config.limits.logs.lineBytes < config.logBytes - logBytes ? config.limits.logs.lineBytes : config.logBytes - logBytes;
    let text = '';
    for (let i = 0; i < args.length; i++) {
      if (size(text) >= available) { markTruncated(); break; }
      if (i) text += ' ';
      const item = args[i];
      if (typeof item === 'string') text += cut(item, available - size(text));
      else {
        const saved = failure;
        try { text += encode(item, available - size(text), 'LOG', 'LOG', false); }
        catch (_) { text += '[unserializable or truncated]'; markTruncated(); }
        failure = saved;
      }
    }
    if (size(text) > available) { text = cut(text, available); markTruncated(); }
    // A string may have been shortened without reaching the line cap.
    for (let i = 0; i < args.length; i++) if (typeof args[i] === 'string' && size(args[i]) > available) markTruncated();
    logLines++; logBytes += size(text);
    emitLog(level, text);
  }
  const consoleObject = {};
  for (const level of ['log','info','warn','error','debug']) {
    consoleObject[level] = config.captureLogs ? (...args) => log(level, args) : () => {};
  }
  globalThis.console = freeze(consoleObject);
  const input = freeze({ observation: config.observation, Memory: config.memory, sdk: config.sdk });
  function errorText(error) {
    let name = 'Error', message = 'Player execution failed', stack;
    // Descriptors never invoke guest getters. Proxy traps remain inside the budget.
    try {
      if (typeof error === 'string') message = error;
      else if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
        const m = descriptor(error, 'message'), n = descriptor(error, 'name'), s = descriptor(error, 'stack');
        if (m && typeof m.value === 'string') message = m.value;
        if (n && typeof n.value === 'string') name = n.value;
        if (s && typeof s.value === 'string') stack = s.value;
      }
    } catch (_) {}
    return { name: cut(name, 64), message: cut(message, config.limits.errorBytes / 8 | 0), ...(stack === undefined ? {} : {stack: cut(stack, config.limits.errorBytes / 8 | 0)}) };
  }
  function errorResult(error) {
    // Never stringify an object: player-installed Object.prototype.toJSON could forge success.
    let message = error.message;
    const n = descriptor(error, 'name'), s = descriptor(error, 'stack');
    let name = n ? n.value : undefined, stack = s ? s.value : undefined;
    function build() {
      return '{"type":' + stringify(error.type) + ',"message":' + stringify(message)
        + (name === undefined ? '' : ',"name":' + stringify(name))
        + (stack === undefined ? '' : ',"stack":' + stringify(stack)) + '}';
    }
    let encoded = build();
    if (size(encoded) > config.limits.errorBytes) { name = undefined; stack = undefined; encoded = build(); }
    while (size(encoded) > config.limits.errorBytes && message.length) {
      message = apply(slice, message, [0, message.length >> 1]); encoded = build();
    }
    return '{"ok":false,"error":' + encoded + ',"logsTruncated":' + logsTruncated + '}';
  }
  return {
    run(fn, sdk) {
      failure = undefined;
      try {
        if (typeof fn !== 'function') fail('ENTRYPOINT_ERROR', 'Default export must be a synchronous function');
        const args = freeze({observation: input.observation, Memory: input.Memory, sdk});
        const action = fn(args);
        if (action && typeof action === 'object') {
          let p = proto(action);
          while (p !== null) { if (p === promiseProto) fail('ENTRYPOINT_ERROR', 'Promise results are forbidden'); p = proto(p); }
        }
        const a = encode(action, config.limits.actionBytes, 'INVALID_ACTION', 'INVALID_ACTION', false);
        const m = encode(input.Memory, config.limits.memoryBytes, 'MEMORY_INVALID', 'MEMORY_LIMIT', true);
        return '{"ok":true,"action":' + a + ',"memory":' + m + ',"logsTruncated":' + logsTruncated + '}';
      } catch (error) {
        const e = failure || { type: 'RUNTIME_ERROR', ...errorText(error) };
        return errorResult(e);
      }
    },
    diagnose(error) { return errorResult({type:'RUNTIME_ERROR', ...errorText(error)}); }
  };
})`;
