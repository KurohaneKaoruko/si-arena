/** Trusted guest code. Capture intrinsics before loading the SDK and player module. */
export const BOOTSTRAP = String.raw`(function(emitLog) {
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const ownKeys = Reflect.ownKeys;
  const descriptor = Object.getOwnPropertyDescriptor;
  const proto = Object.getPrototypeOf;
  const objectProto = Object.prototype;
  const hasOwn = Object.prototype.hasOwnProperty;
  const arrayIsArray = Array.isArray;
  const finite = Number.isFinite;
  const freeze = Object.freeze;
  const defineProperty = Object.defineProperty;
  const apply = Reflect.apply;
  const slice = String.prototype.slice;
  const charCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
  const setAdd = Set.prototype.add;
  const setHas = Set.prototype.has;
  const setDelete = Set.prototype.delete;
  const SetClass = Set;
  let config;
  let game, action, submitted = false, phase = 'closed';
  let failure;
  let logLines = 0, logBytes = 0, logsTruncated = false;
  function freezeData(value) {
    if (value && typeof value === 'object') {
      // Only fresh data from the captured JSON.parse reaches this function:
      // arrays are dense and every own key is a data property, never a getter.
      // Avoid descriptors and recursive calls for large primitive grids.
      if (arrayIsArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child = value[i];
          if (child && typeof child === 'object') freezeData(child);
        }
      } else {
        const keys = ownKeys(value);
        for (let i = 0; i < keys.length; i++) {
          const child = value[keys[i]];
          if (child && typeof child === 'object') freezeData(child);
        }
      }
      freeze(value);
    }
    return value;
  }
  function size(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const c = charCodeAt(text, i);
      if (c < 128) bytes++; else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && charCodeAt(text, i+1) >= 0xdc00 && charCodeAt(text, i+1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function cut(text, max) {
    let bytes = 0, end = 0;
    while (end < text.length) {
      const c = charCodeAt(text, end);
      let cost = c < 128 ? 1 : c < 2048 ? 2 : 3, units = 1;
      if (c >= 0xd800 && c <= 0xdbff && end + 1 < text.length) {
        const next = charCodeAt(text, end + 1);
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
    consoleObject[level] = (...args) => { if (config.captureLogs) log(level, args); };
  }
  defineProperty(globalThis, 'console', {value: freeze(consoleObject), writable: false, configurable: false});
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
    begin(text) {
      config = parse(text);
      game = action = undefined;
      submitted = false;
      phase = 'closed';
      failure = undefined;
      logLines = logBytes = 0;
      logsTruncated = false;
    },
    prepare(createGame) {
      const tickConfig = config;
      function checkActive() {
        if (config !== tickConfig || phase === 'closed') fail('INVALID_ACTION', 'Commands belong to their current tick only');
      }
      const commands = freeze({
        submit(value) { checkActive(); action = value; submitted = true; },
        reject(message) { checkActive(); fail('INVALID_ACTION', typeof message === 'string' ? message : 'Invalid game command'); }
      });
      phase = 'setup';
      try {
        game = createGame(freezeData(config.observation), commands);
        if (!game || typeof game !== 'object' || !submitted) throw new Error('Trusted game API must initialize its default action and view');
      } finally { phase = 'closed'; }
    },
    run(fn) {
      failure = undefined;
      phase = 'player';
      try {
        if (typeof fn !== 'function') fail('ENTRYPOINT_ERROR', 'Default export must be a synchronous function');
        const args = freeze({game, Memory: config.memory});
        const result = fn(args);
        if (result !== undefined) fail('ENTRYPOINT_ERROR', 'Submit commands through the game API; the entrypoint must return undefined');
        if (failure) return errorResult(failure);
        const a = encode(action, config.limits.actionBytes, 'INVALID_ACTION', 'INVALID_ACTION', false);
        const m = encode(config.memory, config.limits.memoryBytes, 'MEMORY_INVALID', 'MEMORY_LIMIT', true);
        return '{"ok":true,"action":' + a + ',"memory":' + m + ',"logsTruncated":' + logsTruncated + '}';
      } catch (error) {
        const e = failure || { type: 'RUNTIME_ERROR', ...errorText(error) };
        return errorResult(e);
      } finally { phase = 'closed'; }
    },
    diagnose(error) { return errorResult({type:'RUNTIME_ERROR', ...errorText(error)}); }
  };
})`;
