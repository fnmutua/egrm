<script setup lang="ts">
const locale = useCookie<string>('egrm_locale', { default: () => 'en' });
const consoleLoginUrl = useConsoleLoginUrl();

const label = computed(() => (locale.value === 'sw' ? 'Ingia (wafanyakazi)' : 'Staff login'));
const labelShort = computed(() => (locale.value === 'sw' ? 'Ingia' : 'Login'));
</script>

<template>
  <UButton
    v-if="consoleLoginUrl"
    :href="consoleLoginUrl"
    size="sm"
    variant="ghost"
    icon="i-lucide-log-in"
  >
    <span class="sm:hidden">{{ labelShort }}</span>
    <span class="hidden sm:inline">{{ label }}</span>
  </UButton>
</template>
