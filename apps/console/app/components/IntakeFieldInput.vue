<script setup lang="ts">
import type { AssistedIntakeField } from '~/composables/useAssistedIntake';

const props = defineProps<{
  field: AssistedIntakeField;
  locale: string;
  options: { value: string; label: string }[];
}>();

const model = defineModel<unknown>();

const label = computed(() => props.field.label[props.locale] ?? props.field.label.en ?? props.field.key);
</script>

<template>
  <div class="w-full min-w-0 max-w-full [&_button]:max-w-full [&_button]:truncate">
    <UFormField :label="label" :required="field.required" class="w-full min-w-0">
      <UTextarea v-if="field.type === 'textarea'" v-model="model as string" class="w-full max-w-full" :rows="3" />
      <IntakeUnitSelect
        v-else-if="field.type === 'select' && field.options_ref === 'units'"
        v-model="model as string"
      />
      <USelectMenu
        v-else-if="field.type === 'select'"
        v-model="model as string"
        :items="options"
        value-key="value"
        label-key="label"
        class="w-full max-w-full"
        placeholder="Select…"
      />
      <USelectMenu
        v-else-if="field.type === 'multiselect'"
        v-model="model as string[]"
        :items="options"
        value-key="value"
        label-key="label"
        multiple
        class="w-full max-w-full"
        placeholder="Select one or more…"
      />
      <UInput
        v-else
        v-model="model as string"
        :type="field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type"
        class="w-full max-w-full"
      />
    </UFormField>
  </div>
</template>
