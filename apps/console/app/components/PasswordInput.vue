<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    autocomplete?: string;
    required?: boolean;
    id?: string;
  }>(),
  {
    modelValue: '',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const show = ref(false);
</script>

<template>
  <UInput
    :id="props.id"
    :model-value="props.modelValue"
    :type="show ? 'text' : 'password'"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :required="required"
    class="w-full"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #trailing>
      <UButton
        type="button"
        color="neutral"
        variant="link"
        size="sm"
        :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="show ? 'Hide password' : 'Show password'"
        :aria-pressed="show"
        :aria-controls="props.id"
        tabindex="-1"
        @click.prevent="show = !show"
      />
    </template>
  </UInput>
</template>
