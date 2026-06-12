<script setup lang="ts">
definePageMeta({ layout: 'admin' });

const route = useRoute();
const { api } = useApi();
const { user, fetchMe } = useAuth();
const { canConfig } = usePermissions();
const toast = useToast();

const domain = String(route.params.domain);
const meta = domainMeta(domain);

interface VersionRow {
  version: number;
  status: 'draft' | 'active' | 'retired';
  changeNote: string | null;
  createdAt: string;
  activatedAt: string | null;
}

const versions = ref<VersionRow[]>([]);
const payload = ref<Record<string, any>>({});
const editorText = ref('');
const mode = ref<'form' | 'json'>('form');
const loadedFrom = ref<string>('');
const changeNote = ref('');
const saving = ref(false);
const activating = ref<number | null>(null);
const issues = ref<{ path: (string | number)[]; message: string }[]>([]);
const jsonError = ref('');

const modeItems = [
  { label: 'Form', value: 'form', icon: 'i-lucide-list-checks' },
  { label: 'JSON (advanced)', value: 'json', icon: 'i-lucide-braces' },
];

watch(mode, (next, prev) => {
  if (next === 'json') {
    // Don't clobber the user's text when bouncing back after a failed parse.
    if (!jsonError.value) editorText.value = JSON.stringify(payload.value, null, 2);
  } else if (prev === 'json') {
    try {
      payload.value = JSON.parse(editorText.value);
      jsonError.value = '';
    } catch (e) {
      jsonError.value = `Invalid JSON — fix it before switching back: ${(e as Error).message}`;
      nextTick(() => (mode.value = 'json'));
    }
  }
});

async function loadVersions() {
  const res = await api<{ versions: VersionRow[] }>(`/api/v1/config/${domain}/versions`);
  versions.value = res.versions;
}

async function loadPayload(version?: number) {
  issues.value = [];
  jsonError.value = '';
  const target = version ?? versions.value.find((v) => v.status === 'active')?.version ?? versions.value[0]?.version;
  if (!target) {
    payload.value = {};
    editorText.value = '{}';
    loadedFrom.value = 'empty';
    return;
  }
  const res = await api<{ payload: Record<string, any>; version: number; status: string }>(
    `/api/v1/config/${domain}/versions/${target}`,
  );
  payload.value = res.payload ?? {};
  editorText.value = JSON.stringify(res.payload, null, 2);
  loadedFrom.value = `v${res.version} (${res.status})`;
}

async function saveDraft() {
  issues.value = [];
  jsonError.value = '';
  if (mode.value === 'json') {
    try {
      payload.value = JSON.parse(editorText.value);
    } catch (e) {
      jsonError.value = `Invalid JSON: ${(e as Error).message}`;
      return;
    }
  }
  saving.value = true;
  try {
    const res = await api<{ version: number }>(`/api/v1/config/${domain}`, {
      method: 'POST',
      body: { payload: payload.value, change_note: changeNote.value || undefined },
    });
    toast.add({ title: `Draft v${res.version} saved`, color: 'success' });
    changeNote.value = '';
    await loadVersions();
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string; issues?: typeof issues.value } }).data;
    if (data?.issues) {
      issues.value = data.issues;
      toast.add({ title: 'Validation failed', description: 'The draft was not saved.', color: 'error' });
    } else {
      toast.add({ title: data?.error ?? 'Save failed', color: 'error' });
    }
  } finally {
    saving.value = false;
  }
}

async function activate(version: number) {
  activating.value = version;
  try {
    await api(`/api/v1/config/${domain}/${version}/activate`, { method: 'POST', body: {} });
    toast.add({ title: `v${version} is now active`, color: 'success' });
    await loadVersions();
    await loadPayload(version);
  } catch (e: unknown) {
    const data = (e as { data?: { error?: string } }).data;
    toast.add({ title: data?.error ?? 'Activation failed', color: 'error' });
  } finally {
    activating.value = null;
  }
}

// Subsection panels: the sidebar's sub-items set the hash; only that panel is rendered.
const activeSection = computed(
  () => route.hash?.slice(1) || meta?.subsections?.[0]?.id || '',
);
const activeSectionLabel = computed(
  () => meta?.subsections?.find((s) => s.id === activeSection.value)?.label ?? '',
);
// Jump back to the top of the pane when switching panels.
watch(activeSection, () => {
  document.querySelector('main')?.scrollTo({ top: 0 });
});

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
  if (!canConfig(domain)) return navigateTo('/admin');
  await loadVersions();
  await loadPayload();
});
</script>

<template>
  <div v-if="user" class="p-4 sm:p-6 lg:p-8 w-full max-w-none">
    <div class="flex items-center gap-3 mb-1 flex-wrap">
      <UIcon :name="meta?.icon ?? 'i-lucide-settings'" class="text-2xl text-primary" />
      <h1 class="text-2xl font-semibold">{{ meta?.title ?? domain }}</h1>
      <UBadge variant="subtle" color="neutral">{{ meta?.cd }}</UBadge>
      <UBadge v-if="meta?.strict" variant="subtle" color="info" title="Validated against a strict schema">schema-validated</UBadge>
    </div>
    <p class="text-muted mb-6 max-w-3xl">{{ meta?.description }}</p>

    <!-- Editor fills the page; version history is a narrow sticky rail on the far right. -->
    <div class="flex flex-col xl:flex-row xl:items-start gap-4 xl:gap-5">
      <div class="min-w-0 flex-1 space-y-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
              <div class="flex items-center gap-3 min-w-0 flex-wrap">
                <UTabs v-model="mode" :items="modeItems" :content="false" size="xs" />
                <UBadge v-if="mode === 'form' && activeSectionLabel" variant="subtle" color="primary" class="shrink-0">
                  {{ activeSectionLabel }}
                </UBadge>
              </div>
              <span class="text-xs text-muted shrink-0">loaded from {{ loadedFrom }}</span>
            </div>
          </template>

          <!-- Form mode -->
          <div v-if="mode === 'form'">
            <ConfigIdentityEditor v-if="domain === 'cd01_identity'" :payload="payload" :section="activeSection" />
            <ConfigHierarchyEditor v-else-if="domain === 'cd02_hierarchy'" :payload="payload" />
            <ConfigTaxonomyEditor v-else-if="domain === 'cd03_taxonomy'" :payload="payload" :section="activeSection" />
            <ConfigWorkflowEditor v-else-if="domain === 'cd04_workflow'" :payload="payload" :section="activeSection" />
            <ConfigSlaEditor v-else-if="domain === 'cd05_sla'" :payload="payload" :section="activeSection" />
            <ConfigIntakeFormsEditor v-else-if="domain === 'cd06_intake_forms'" :payload="payload" :section="activeSection" />
            <ConfigChannelsEditor v-else-if="domain === 'cd08_channels'" :payload="payload" :section="activeSection" />
            <ConfigNotificationsEditor v-else-if="domain === 'cd09_notifications'" :payload="payload" :section="activeSection" />
            <ConfigOrgAccessEditor v-else-if="domain === 'cd10_org_access'" :payload="payload" :section="activeSection" />
            <ConfigValueEditor v-else :model-value="payload" @update:model-value="payload = ($event as Record<string, any>)" />
          </div>

          <!-- JSON mode -->
          <textarea
            v-else
            v-model="editorText"
            spellcheck="false"
            class="w-full h-[28rem] font-mono text-xs p-3 rounded border border-default bg-elevated/40 focus:outline-none focus:ring-2 ring-primary/40"
          />

          <UAlert v-if="jsonError" color="error" :title="jsonError" class="mt-3" />
          <UAlert v-if="issues.length" color="error" title="Validation issues" class="mt-3">
            <template #description>
              <ul class="list-disc pl-4 space-y-1">
                <li v-for="(iss, i) in issues" :key="i" class="text-xs">
                  <code v-if="iss.path?.length">{{ iss.path.join('.') }}</code>
                  {{ iss.message }}
                </li>
              </ul>
            </template>
          </UAlert>

          <template #footer>
            <div class="flex items-center gap-3">
              <UInput v-model="changeNote" placeholder="Change note (recommended)" class="flex-1" />
              <UButton :loading="saving" icon="i-lucide-save" @click="saveDraft">Save as draft</UButton>
            </div>
          </template>
        </UCard>
        <p class="text-xs text-muted">
          Saving creates a new <b>draft</b> version after server-side validation. Activating a version is atomic:
          the current active version is retired in the same transaction. Activate an older version to roll back.
        </p>
      </div>

      <!-- Version history: compact rail, far right on desktop -->
      <aside class="w-full xl:w-36 shrink-0 xl:sticky xl:top-4 xl:self-start">
        <UCard :ui="{ body: 'p-2 sm:p-2', header: 'px-2 py-1.5 sm:px-2' }">
          <template #header>
            <span class="text-xs font-semibold text-muted uppercase tracking-wide">Versions</span>
          </template>
          <div v-if="versions.length === 0" class="text-[11px] text-muted px-1">None yet</div>
          <ol class="space-y-1.5">
            <li
              v-for="v in versions"
              :key="v.version"
              class="rounded-md border border-default/80 px-1.5 py-1.5 text-[11px] leading-tight"
              :class="v.status === 'active' ? 'bg-primary/5 border-primary/20' : ''"
            >
              <div class="flex items-center justify-between gap-0.5">
                <div class="min-w-0">
                  <span class="font-mono font-medium">v{{ v.version }}</span>
                  <UBadge
                    size="xs" variant="subtle" class="ml-1 align-middle"
                    :color="v.status === 'active' ? 'success' : v.status === 'draft' ? 'info' : 'neutral'"
                  >
                    {{ v.status === 'active' ? 'live' : v.status === 'draft' ? 'draft' : 'old' }}
                  </UBadge>
                </div>
                <div class="flex shrink-0">
                  <UButton
                    size="xs" variant="ghost" color="neutral" icon="i-lucide-eye"
                    class="size-6 p-0" title="Load into editor" @click="loadPayload(v.version)"
                  />
                  <UButton
                    v-if="v.status !== 'active'"
                    size="xs" variant="ghost" color="primary" icon="i-lucide-play"
                    class="size-6 p-0"
                    :loading="activating === v.version"
                    :title="v.status === 'retired' ? 'Roll back' : 'Activate'"
                    @click="activate(v.version)"
                  />
                </div>
              </div>
              <time class="block text-muted mt-0.5 truncate" :title="new Date(v.createdAt).toLocaleString()">
                {{ new Date(v.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}
              </time>
              <p v-if="v.changeNote" class="text-muted mt-0.5 line-clamp-2" :title="v.changeNote">{{ v.changeNote }}</p>
            </li>
          </ol>
        </UCard>
      </aside>
    </div>
  </div>
</template>
