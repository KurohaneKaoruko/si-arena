<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: readonly SelectOption[];
    id?: string | undefined;
    /** 无可见标签时用作无障碍名称。 */
    label?: string | undefined;
    placeholder?: string | undefined;
    size?: "sm" | "md";
    disabled?: boolean;
  }>(),
  { size: "md" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const listbox = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
/** 下方空间不足时向上弹出，避免弹层溢出视口。 */
const dropUp = ref(false);

const listboxId = computed(() => `${props.id ?? "select"}-listbox`);
const selected = computed(() => props.options.find((option) => option.value === props.modelValue));

function openList() {
  if (props.disabled) return;
  const rect = trigger.value?.getBoundingClientRect();
  if (rect) {
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const needed = Math.min(props.options.length * 32 + 10, 250);
    dropUp.value = below < needed && above > below;
  }
  open.value = true;
  activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  void nextTick(() => listbox.value?.focus());
}
function closeList(restoreFocus = true) {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) void nextTick(() => trigger.value?.focus());
}
function choose(option: SelectOption | undefined) {
  if (!option || option.disabled) return;
  emit("update:modelValue", option.value);
  closeList();
}
function move(delta: number) {
  const count = props.options.length;
  if (!count) return;
  let next = activeIndex.value;
  for (let step = 0; step < count; step++) {
    next = (next + delta + count) % count;
    if (!props.options[next]?.disabled) break;
  }
  activeIndex.value = next;
  void nextTick(() => {
    // scrollIntoView 在部分环境（如 jsdom）不存在
    listbox.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({
      block: "nearest",
    });
  });
}
function onTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
    event.preventDefault();
    openList();
  } else if (event.key === " " && !open.value) {
    event.preventDefault();
    openList();
  }
}
function onListKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
  } else if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = props.options.length - 1;
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    choose(props.options[activeIndex.value]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeList();
  } else if (event.key === "Tab") {
    closeList(false);
  }
}
function onPointerDown(event: PointerEvent) {
  if (!open.value) return;
  if (root.value && !root.value.contains(event.target as Node)) closeList(false);
}
watch(
  () => props.modelValue,
  () => {
    if (!open.value) return;
    activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  },
);
onMounted(() => document.addEventListener("pointerdown", onPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      :id="id"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :disabled="disabled"
      class="flex w-full min-w-0 items-center gap-2 border border-line bg-surface text-left text-ink transition hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10 disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60"
      :class="
        size === 'sm'
          ? 'min-h-9 rounded-control px-2.5 text-[13px]'
          : 'min-h-10 rounded-control px-3 text-sm'
      "
      @click="open ? closeList() : openList()"
      @keydown="onTriggerKeydown"
    >
      <span class="min-w-0 flex-1 truncate">{{ selected?.label ?? placeholder ?? "请选择" }}</span>
      <svg
        class="size-3.5 shrink-0 text-faint transition"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6.5 8 10.5 12 6.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <Transition name="select">
      <ul
        v-if="open"
        :id="listboxId"
        ref="listbox"
        role="listbox"
        :aria-label="label"
        tabindex="-1"
        class="absolute left-0 z-50 max-h-60 w-full min-w-32 overflow-auto rounded-card border border-line bg-surface p-1 shadow-pop focus:outline-none"
        :class="dropUp ? 'bottom-full mb-1' : 'top-full mt-1'"
        @keydown="onListKeydown"
      >
        <li
          v-for="(option, index) in options"
          :key="option.value"
          role="option"
          :data-value="option.value"
          :data-active="index === activeIndex ? 'true' : 'false'"
          :aria-selected="option.value === modelValue"
          :aria-disabled="option.disabled ? 'true' : undefined"
          class="flex cursor-pointer items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-sm transition"
          :class="[
            option.value === modelValue ? 'text-ink' : 'text-soft',
            index === activeIndex ? 'bg-muted' : '',
            option.disabled ? 'cursor-not-allowed opacity-45' : '',
          ]"
          @click="choose(option)"
          @mouseenter="activeIndex = index"
        >
          <span class="min-w-0 truncate">{{ option.label }}</span>
          <svg
            v-if="option.value === modelValue"
            class="size-3.5 shrink-0 text-accent"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3.5 8.5 6.5 11.5 12.5 5"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.select-enter-active,
.select-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.select-enter-from,
.select-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
