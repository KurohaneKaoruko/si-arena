/**
 * 复制文本到剪贴板，返回是否成功。
 * Async Clipboard API 仅在安全上下文（HTTPS 或 localhost）暴露；
 * 纯 HTTP 部署下 navigator.clipboard 不存在，需降级为隐藏 textarea + execCommand。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    // 只读且透明、固定定位：不弹移动端键盘、不引起滚动跳动。
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}
