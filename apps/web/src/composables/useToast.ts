import { ref } from "vue";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const current = ref<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let counter = 0;

const durations: Record<ToastTone, number> = {
  info: 2800,
  success: 2800,
  warning: 4000,
  danger: 5200,
};

/**
 * 全局提示：同一时间只显示一条，新的提示覆盖旧的，避免遮挡内容。
 */
export function useToast() {
  function dismiss() {
    clearTimeout(timer);
    timer = undefined;
    current.value = null;
  }
  function show(message: string, tone: ToastTone = "info", duration?: number) {
    if (!message) return;
    current.value = { id: ++counter, tone, message };
    clearTimeout(timer);
    timer = setTimeout(dismiss, duration ?? durations[tone]);
  }
  return {
    current,
    show,
    dismiss,
    info: (message: string) => show(message, "info"),
    success: (message: string) => show(message, "success"),
    warning: (message: string) => show(message, "warning"),
    error: (message: string) => show(message, "danger"),
  };
}
