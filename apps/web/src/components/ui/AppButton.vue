<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
    size?: "sm" | "md" | "lg";
    to?: string | Record<string, unknown>;
    href?: string;
    download?: string | boolean;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
  }>(),
  { variant: "secondary", size: "md", type: "button" },
);

const variants = {
  primary: "bg-accent text-white shadow-sm hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle",
  ghost: "text-soft hover:bg-muted hover:text-ink",
  danger: "border border-danger/25 bg-danger-soft text-danger hover:bg-danger/10",
  link: "text-accent underline underline-offset-4 hover:text-accent-strong",
} as const;

const sizes = {
  sm: "min-h-8 rounded-md px-2.5 text-[13px]",
  md: "min-h-9 rounded-control px-3.5 text-sm",
  lg: "min-h-11 rounded-control px-5 text-[15px]",
} as const;

const classes = computed(() => [
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition",
  props.variant === "link" ? "min-h-0 px-0" : "",
  variants[props.variant],
  sizes[props.size],
  props.block ? "w-full" : "",
  props.disabled || props.loading ? "pointer-events-none opacity-50" : "",
]);

const element = computed(() => (props.to ? RouterLink : props.href ? "a" : "button"));
const attributes = computed(() => {
  if (props.to) return { to: props.to };
  if (props.href) return { href: props.href, download: props.download };
  return {
    type: props.type,
    disabled: props.disabled || props.loading,
    "aria-busy": props.loading || undefined,
  };
});
</script>

<template>
  <component :is="element" v-bind="attributes" :class="classes">
    <span
      v-if="loading"
      class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </component>
</template>
