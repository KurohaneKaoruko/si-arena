import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const commit = "df4efb9ef2cb25c417ecb57986da462d11b244ed";
const emcc = process.env.EMCC ?? "emcc";
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (!run(emcc, ["--version"]).includes("5.0.1")) throw new Error("Emscripten 5.0.1 is required");
const temporary = mkdtempSync(join(tmpdir(), "si-arena-wasm-"));
const output = fileURLToPath(new URL("../runtime/", import.meta.url));
try {
  const source = join(temporary, "upstream");
  if (process.env.ARENA_QUICKJS_SOURCE) {
    if (run("git", ["rev-parse", "HEAD"], process.env.ARENA_QUICKJS_SOURCE).trim() !== commit)
      throw new Error("Unexpected upstream revision");
    cpSync(process.env.ARENA_QUICKJS_SOURCE, source, { recursive: true });
  } else {
    run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      "v0.32.0",
      "https://github.com/justjake/quickjs-emscripten.git",
      source,
    ]);
    if (run("git", ["rev-parse", "HEAD"], source).trim() !== commit)
      throw new Error("Unexpected upstream revision");
  }
  const quickjs = join(source, "vendor/quickjs/quickjs.c");
  let code = readFileSync(quickjs, "utf8");
  const replace = (before, after) => {
    if (!code.includes(before)) throw new Error("Upstream patch no longer applies");
    code = code.replace(before, after);
  };
  // Upstream's Emscripten fallback reports zero usable bytes. Count real dlmalloc allocations.
  replace(
    "#include <stdlib.h>",
    "#include <stdlib.h>\n#ifdef __EMSCRIPTEN__\n#include <malloc.h>\n#endif",
  );
  replace(
    "#elif defined(EMSCRIPTEN)\n    return 0;",
    "#elif defined(EMSCRIPTEN)\n    return malloc_usable_size((void *)ptr);",
  );
  replace(
    "void *js_malloc_rt(JSRuntime *rt, size_t size)\n{\n    return rt->mf.js_malloc(&rt->malloc_state, size);",
    "static int arena_failure;\nint arena_get_failure(void) { return arena_failure; }\nvoid arena_reset_failure(void) { arena_failure = 0; }\nvoid *js_malloc_rt(JSRuntime *rt, size_t size)\n{\n    void *ptr = rt->mf.js_malloc(&rt->malloc_state, size);\n    if (!ptr && size) arena_failure |= 1;\n    return ptr;",
  );
  replace(
    "return rt->mf.js_realloc(&rt->malloc_state, ptr, size);",
    "void *result = rt->mf.js_realloc(&rt->malloc_state, ptr, size);\n    if (!result && size) arena_failure |= 1;\n    return result;",
  );
  replace(
    "return unlikely(sp < rt->stack_limit);",
    "if (unlikely(sp < rt->stack_limit)) { arena_failure |= 2; return TRUE; }\n    return FALSE;",
  );
  replace(
    "JSValue JS_ThrowOutOfMemory(JSContext *ctx)\n{",
    "JSValue JS_ThrowOutOfMemory(JSContext *ctx)\n{\n    arena_failure |= 1;",
  );
  writeFileSync(quickjs, code);
  const wrapper = readFileSync(join(source, "c/interface.c"), "utf8");
  const symbols = [...wrapper.matchAll(/^([\w()* ]+[\s*]+)(QTS_\w+)\((.*?)\) ?\{/gm)]
    .filter((match) => !/AsyncifyOnly|DebugOnly/.test(match[1]))
    .map((match) => "_" + match[2]);
  symbols.push("_malloc", "_free", "_arena_get_failure", "_arena_reset_failure");
  const exportsFile = join(temporary, "exports.json");
  writeFileSync(exportsFile, JSON.stringify(symbols));
  mkdirSync(output, { recursive: true });
  const version = readFileSync(join(source, "vendor/quickjs/VERSION"), "utf8").trim();
  run(
    emcc,
    [
      "c/interface.c",
      ...["quickjs", "dtoa", "libregexp", "libunicode", "cutils", "quickjs-libc"].map(
        (name) => `vendor/quickjs/${name}.c`,
      ),
      "-O2",
      "-flto",
      "-D_GNU_SOURCE",
      `-DCONFIG_VERSION="${version}"`,
      "-DCONFIG_STACK_CHECK",
      "--no-entry",
      "-sMODULARIZE=1",
      "-sEXPORT_NAME=QuickJSRaw",
      "-sENVIRONMENT=node",
      "-sFILESYSTEM=0",
      "-sALLOW_MEMORY_GROWTH=1",
      "-sALLOW_TABLE_GROWTH=1",
      "-sSTACK_SIZE=5MB",
      "-sABORTING_MALLOC=0",
      "-sINVOKE_RUN=0",
      "-sNODEJS_CATCH_EXIT=0",
      `-sEXPORTED_FUNCTIONS=@${exportsFile}`,
      "-sEXPORTED_RUNTIME_METHODS=@exportedRuntimeMethods.json",
      "--pre-js",
      "templates/pre-extension.js",
      "--pre-js",
      "templates/pre-wasmMemory.js",
      "-o",
      join(output, "quickjs.cjs"),
    ],
    source,
  );
  writeFileSync(join(output, "LICENSE"), readFileSync(join(source, "LICENSE")));
  writeFileSync(
    join(output, "QUICKJS-LICENSE"),
    readFileSync(join(source, "vendor/quickjs/LICENSE")),
  );
  writeFileSync(
    join(output, "build.json"),
    JSON.stringify(
      {
        upstream: commit,
        quickjs: version,
        emscripten: "5.0.1",
        patch: "allocation-accounting-stack-latch-v1",
        wasmSha256: createHash("sha256")
          .update(readFileSync(join(output, "quickjs.wasm")))
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Built synchronous QuickJS with irreversible allocation and stack failure flags");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
