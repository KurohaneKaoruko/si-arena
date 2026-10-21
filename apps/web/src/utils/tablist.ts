/** Keyboard support for a `role="tablist"`: arrows, Home and End move focus and activate the tab. */
export function moveTabFocus(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const list = event.currentTarget as HTMLElement;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}
