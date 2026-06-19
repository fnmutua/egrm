<script setup lang="ts">
/**
 * CD-14 Feature flags — AI toggles live in CD-16 only.
 */
const props = defineProps<{ payload: Record<string, any> }>();

const FEATURE_FLAGS: { key: string; label: string; help: string }[] = [
  { key: 'knowledge_base', label: 'Knowledge base', help: 'Published articles and staff KB workspace.' },
  { key: 'tasks', label: 'Tasks', help: 'Assignable tasks linked to cases.' },
  { key: 'committees', label: 'Committees', help: 'Committee rosters and decision records.' },
  { key: 'appeals', label: 'Appeals', help: 'Appeal workflow after closure.' },
  { key: 'satisfaction_survey', label: 'Satisfaction survey', help: 'Post-resolution complainant survey.' },
  { key: 'transparency_page', label: 'Transparency page', help: 'Public statistics and reports.' },
  { key: 'complainant_accounts', label: 'Complainant accounts', help: 'Registered portal users (not anonymous-only).' },
  { key: 'organizations', label: 'Organizations', help: 'Representative / organization intake.' },
  { key: 'ussd', label: 'USSD', help: 'Feature-phone menu channel.' },
  { key: 'hotline', label: 'Hotline', help: 'Telephony intake module.' },
  { key: 'public_api', label: 'Public API', help: 'Partner / system integration endpoints.' },
  { key: 'custom_dashboards', label: 'Custom dashboards', help: 'Admin-built dashboards (CD-15).' },
];

function flag(key: string): boolean {
  return Boolean(props.payload[key]);
}

function setFlag(key: string, value: boolean) {
  props.payload[key] = value;
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-bot"
      title="AI settings moved"
      description="Staff AI and portal chatbot are configured in one place: Configuration → Chatbot & AI (CD-16)."
    >
      <UButton to="/admin/config/cd16_ai" size="xs" variant="soft" class="mt-2">Open Chatbot & AI</UButton>
    </UAlert>

    <p class="text-sm text-muted">Module activation for non-AI platform features.</p>

    <div class="grid gap-2 sm:grid-cols-2">
      <div
        v-for="f in FEATURE_FLAGS"
        :key="f.key"
        class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm"
      >
        <div class="min-w-0">
          <span class="font-medium">{{ f.label }}</span>
          <p class="text-xs text-muted">{{ f.help }}</p>
        </div>
        <USwitch :model-value="flag(f.key)" @update:model-value="setFlag(f.key, $event)" />
      </div>
    </div>
  </div>
</template>
