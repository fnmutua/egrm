<script setup lang="ts">
import type { IntakeField } from '../composables/useIntake';

const props = defineProps<{
  field: IntakeField;
  locale: string;
  options: { value: string; label: string }[];
}>();

const model = defineModel<unknown>();

const label = computed(() => props.field.label[props.locale] ?? props.field.label.en ?? props.field.key);
</script>

<template>
  <UFormField :label="label" :required="field.required">
    <UTextarea v-if="field.type === 'textarea'" v-model="model as string" class="w-full" :rows="4" />
    <USelectMenu
      v-else-if="field.type === 'select'"
      v-model="model as string"
      :items="options"
      value-key="value"
      label-key="label"
      class="w-full"
      placeholder="Select…"
    />
    <USelectMenu
      v-else-if="field.type === 'multiselect'"
      v-model="model as string[]"
      :items="options"
      value-key="value"
      label-key="label"
      multiple
      class="w-full"
      placeholder="Select one or more…"
    />
    <UInput
      v-else
      v-model="model as string"
      :type="field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type"
      class="w-full"
    />
  </UFormField>
</template>
