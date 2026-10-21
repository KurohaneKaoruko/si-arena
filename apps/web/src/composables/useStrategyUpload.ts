import type { GameCatalogEntry, GameMeResponse } from "@si-arena/protocol";
import { onUnmounted, ref } from "vue";
import { ApiError, errorMessage } from "../api/client";
import { parseGameMe, parseUpload } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import type { ApiResource } from "./useApiResource";

/**
 * Reads a strategy file and replaces the user's code. A lost upload response is
 * reconciled against the server's source before anything else may proceed.
 */
export function useStrategyUpload(options: {
  game: () => GameCatalogEntry;
  me: ApiResource<GameMeResponse>;
  /** Another request (such as matching) currently owns the entry. */
  blocked: () => boolean;
  onAccepted: () => void;
}) {
  const { me } = options;
  const candidate = ref<string | null>(null);
  const fileError = ref("");
  const feedback = ref("");
  const uncertain = ref(false);
  const busy = ref<"read" | "upload" | "verify" | null>(null);
  const base = () => `/api/games/${encodeURIComponent(options.game().id)}/me`;
  let current: AbortController | undefined;
  let revision = 0;

  function accept(source: string, metadata: ReturnType<typeof parseUpload>) {
    if (!me.data.value) return;
    me.data.value = {
      ...me.data.value,
      code: { ...metadata, source },
      canMatch: true,
      cannotMatchReason: null,
    };
    candidate.value = null;
    uncertain.value = false;
    fileError.value = "";
    me.refreshError.value = "";
    feedback.value = "策略已更新";
    options.onAccepted();
  }

  async function verify() {
    if (busy.value || candidate.value === null) return;
    const source = candidate.value;
    me.cancel();
    const request = new AbortController();
    current = request;
    busy.value = "verify";
    try {
      const result = await authorizedRequest(base(), parseGameMe, { signal: request.signal });
      if (request.signal.aborted) return;
      me.data.value = result;
      if (result.code?.source === source) accept(source, result.code);
      else fileError.value = "尚未确认上传结果，请重试上传。";
    } catch (failure) {
      if (!request.signal.aborted) fileError.value = errorMessage(failure);
    } finally {
      if (current === request) busy.value = null;
    }
  }

  async function upload() {
    if (candidate.value === null || busy.value || options.blocked()) return;
    const source = candidate.value;
    me.cancel();
    const request = new AbortController();
    current = request;
    busy.value = "upload";
    fileError.value = "";
    feedback.value = "";
    let reconcile = false;
    try {
      const result = await authorizedRequest(`${base()}/code`, parseUpload, {
        method: "PUT",
        body: source,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        signal: request.signal,
      });
      if (!request.signal.aborted) accept(source, result);
    } catch (failure) {
      if (request.signal.aborted) return;
      fileError.value = errorMessage(failure);
      // A transport or server failure may happen after the new source was saved.
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        uncertain.value = true;
        reconcile = true;
      }
    } finally {
      if (current === request) busy.value = null;
    }
    if (reconcile) await verify();
  }

  async function read(file: File) {
    if (busy.value || options.blocked() || uncertain.value) return;
    const version = ++revision;
    fileError.value = "";
    feedback.value = "";
    candidate.value = null;
    if (!/\.m?js$/i.test(file.name)) {
      fileError.value = "请选择 .js 或 .mjs 文件。";
      return;
    }
    if (file.size > options.game().resolvedLimits.codeBytes) {
      fileError.value = "文件超过该游戏的代码大小限制。";
      return;
    }
    busy.value = "read";
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (version !== revision) return;
      if (!source.trim()) fileError.value = "策略文件不能为空。";
      else candidate.value = source;
    } catch {
      if (version === revision)
        fileError.value = "无法读取文件，请使用 UTF-8 编码的 JavaScript 文件。";
    } finally {
      if (version === revision) busy.value = null;
    }
    if (version === revision && candidate.value !== null) await upload();
  }

  onUnmounted(() => {
    revision++;
    current?.abort();
  });
  return { busy, candidate, fileError, feedback, uncertain, read, upload, verify };
}
