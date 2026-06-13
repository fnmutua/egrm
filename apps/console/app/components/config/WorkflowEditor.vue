<script setup lang="ts">
/**
 * Dedicated form for CD-04 Workflow: statuses (collapsible/reorderable cards),
 * initial rules, transitions (from→to with roles/effects/requires), closure
 * and appeal policies. Mutates payload in place; `section` shows one panel.
 */
const SEMANTIC_TAGS = [
  { value: 'open', label: 'Open', color: 'info' as const },
  { value: 'in_progress', label: 'In progress', color: 'primary' as const },
  { value: 'resolved', label: 'Resolved', color: 'warning' as const },
  { value: 'closed', label: 'Closed', color: 'success' as const },
  { value: 'rejected', label: 'Rejected', color: 'error' as const },
  { value: 'on_hold', label: 'On hold', color: 'neutral' as const },
  { value: 'appeal', label: 'Appeal', color: 'secondary' as const },
];

const GUARDS = [
  { value: '', label: 'None' },
  { value: 'confirmation', label: 'Confirmation (closure policy)' },
];

const EFFECT_TYPES = [
  { value: 'move_level', label: 'Move jurisdiction level' },
  { value: 'restart_sla', label: 'Restart SLA clock' },
  { value: 'set_assignee', label: 'Set assignee' },
];

interface Status {
  name: string;
  tag: string;
  label?: Record<string, string>;
}

interface Transition {
  from: string[];
  to: string;
  roles: string[];
  levels?: string[];
  requires?: { fields?: string[]; attachments?: string[]; note?: boolean };
  allows?: { attachments?: string[] };
  effects?: Record<string, string>[];
  guard?: string;
}

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();
const { roleNames, loadRoleNames } = useTenantRoles();

const show = (id: string) => !props.section || props.section === id;

const locales = ref<string[]>(['en']);
const attachmentKindItems = ref<{ value: string; label: string }[]>([]);
const hierarchyLevels = ref<{ code: string; label: string }[]>([]);

onMounted(async () => {
  try {
    const [identity, hierarchy, intake] = await Promise.all([
      api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity'),
      api<{ payload?: { levels?: { code: string; label: string }[] } }>('/api/v1/config/cd02_hierarchy'),
      api<{ payload?: { attachment_kinds?: { code: string; label?: Record<string, string>; active?: boolean }[] } }>(
        '/api/v1/config/cd06_intake_forms',
      ).catch(() => ({ payload: undefined })),
    ]);
    if (identity.payload?.locales?.enabled?.length) locales.value = identity.payload.locales.enabled;
    hierarchyLevels.value = (hierarchy.payload?.levels ?? []).map((l) => ({
      code: l.code,
      label: typeof l.label === 'string' ? l.label : l.code,
    }));
    attachmentKindItems.value = (intake.payload?.attachment_kinds ?? [])
      .filter((k) => k.active !== false && k.console_allowed !== false)
      .map((k) => ({
        value: k.code,
        label: k.label?.en ?? k.code,
      }));
  } catch {
    /* defaults */
  }
  await loadRoleNames();
  ensure();
});

function localized(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of locales.value) o[loc] = '';
  return o;
}

function ensure() {
  const p = props.payload;
  p.case_type ??= 'grievance';
  if (!Array.isArray(p.statuses) || p.statuses.length < 2) {
    p.statuses = [
      { name: 'Received', tag: 'open', label: localized() },
      { name: 'Closed', tag: 'closed', label: localized() },
    ];
  }
  for (const s of p.statuses) {
    s.label ??= {};
    for (const loc of locales.value) s.label[loc] ??= s.name;
  }
  p.initial ??= { default: p.statuses[0]?.name ?? 'Received', rules: [] };
  p.initial.rules ??= [];
  p.transitions ??= [];
  p.closure ??= {};
  p.closure.confirmation ??= { required_when: {}, authority_level: '' };
  p.closure.satisfaction ??= { enabled: false, channels: [] };
  p.appeal ??= { enabled: false };
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const statuses = computed<Status[]>(() => props.payload.statuses);
const transitions = computed<Transition[]>(() => props.payload.transitions);
const statusNames = computed(() => statuses.value.map((s) => s.name).filter(Boolean));

const tagMeta = (tag: string) => SEMANTIC_TAGS.find((t) => t.value === tag) ?? { label: tag, color: 'neutral' as const };

// --- statuses ---
const expandedStatus = ref<Set<Status>>(new Set());
function toggleStatus(s: Status) {
  if (expandedStatus.value.has(s)) expandedStatus.value.delete(s);
  else expandedStatus.value.add(s);
  expandedStatus.value = new Set(expandedStatus.value);
}

function moveStatus(from: number, to: number) {
  if (to < 0 || to >= statuses.value.length || from === to) return;
  const list = [...statuses.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  props.payload.statuses = list;
}

const statusDrag = ref<number | null>(null);
const statusDragOver = ref<number | null>(null);

function addStatus() {
  const s: Status = { name: '', tag: 'open', label: localized() };
  props.payload.statuses.push(s);
  expandedStatus.value = new Set([...expandedStatus.value, s]);
}

function removeStatus(s: Status) {
  if (statuses.value.length <= 2) return;
  props.payload.statuses = statuses.value.filter((x) => x !== s);
  // Drop references in transitions and initial rules.
  props.payload.transitions = transitions.value
    .map((t) => ({ ...t, from: t.from.filter((f) => f !== s.name) }))
    .filter((t) => t.from.length > 0 && t.to !== s.name);
  if (props.payload.initial.default === s.name) {
    props.payload.initial.default = props.payload.statuses[0]?.name ?? '';
  }
  props.payload.initial.rules = (props.payload.initial.rules ?? []).filter(
    (r: { then: string | { status: string } }) => {
      const then = typeof r.then === 'string' ? r.then : r.then?.status;
      return then !== s.name;
    },
  );
}

// --- initial rules ---
function addInitialRule() {
  props.payload.initial.rules.push({ if: { flag: '' }, then: statusNames.value[0] ?? '' });
}

function removeInitialRule(i: number) {
  props.payload.initial.rules.splice(i, 1);
}

// --- transitions ---
const expandedTx = ref<Set<Transition>>(new Set());
function toggleTx(t: Transition) {
  if (expandedTx.value.has(t)) expandedTx.value.delete(t);
  else expandedTx.value.add(t);
  expandedTx.value = new Set(expandedTx.value);
}

function addTransition() {
  const t: Transition = {
    from: statusNames.value.length ? [statusNames.value[0]!] : [],
    to: statusNames.value[1] ?? statusNames.value[0] ?? '',
    roles: ['grm_officer'],
  };
  props.payload.transitions.push(t);
  expandedTx.value = new Set([...expandedTx.value, t]);
}

function removeTransition(t: Transition) {
  props.payload.transitions = transitions.value.filter((x) => x !== t);
}

function toggleFromStatus(t: Transition, name: string, on: boolean) {
  if (on && !t.from.includes(name)) t.from.push(name);
  else t.from = t.from.filter((f) => f !== name);
}

function rolesText(t: Transition) {
  return t.roles.join(', ');
}

function setRolesText(t: Transition, text: string) {
  t.roles = text.split(',').map((r) => r.trim()).filter(Boolean);
}

function addEffect(t: Transition) {
  t.effects ??= [];
  t.effects.push({ move_level: 'up' });
}

function removeEffect(t: Transition, i: number) {
  t.effects?.splice(i, 1);
}

function effectKind(e: Record<string, string>): string {
  if ('move_level' in e) return 'move_level';
  if ('restart_sla' in e) return 'restart_sla';
  if ('set_assignee' in e) return 'set_assignee';
  return 'move_level';
}

function setEffectKind(e: Record<string, string>, kind: string) {
  for (const k of Object.keys(e)) delete e[k];
  if (kind === 'move_level') e.move_level = 'up';
  else if (kind === 'restart_sla') e.restart_sla = 'stage';
  else if (kind === 'set_assignee') e.set_assignee = 'none';
}

function requiresFieldsText(t: Transition) {
  return (t.requires?.fields ?? []).join(', ');
}

function setRequiresFields(t: Transition, text: string) {
  t.requires ??= {};
  t.requires.fields = text.split(',').map((f) => f.trim()).filter(Boolean);
}

function setRequiresAttachments(t: Transition, codes: string[]) {
  t.requires ??= {};
  t.requires.attachments = codes.length ? codes : undefined;
  if (!t.requires.attachments?.length && !t.requires.fields?.length && !t.requires.note) {
    t.requires = undefined;
  }
}

function setAllowsAttachments(t: Transition, codes: string[]) {
  if (!codes.length) {
    t.allows = undefined;
    return;
  }
  t.allows ??= {};
  t.allows.attachments = codes;
}

const txSummary = (t: Transition) => {
  const from = t.from.length ? t.from.join(', ') : '(none)';
  return `${from} → ${t.to || '?'}`;
};

const satisfactionChannels = computed({
  get: () => (props.payload.closure?.satisfaction?.channels ?? []).join(', '),
  set: (v: string) => {
    props.payload.closure.satisfaction.channels = v.split(',').map((c) => c.trim()).filter(Boolean);
  },
});

/** Simple reachability hint for the admin (mirrors server validation). */
const reachabilityHint = computed(() => {
  const terminal = new Set(
    statuses.value.filter((s) => s.tag === 'closed' || s.tag === 'rejected').map((s) => s.name),
  );
  if (!terminal.size) return 'Add at least one Closed or Rejected status.';
  const start = props.payload.initial?.default;
  if (!start) return 'Set an initial status.';
  const edges = new Map<string, string[]>();
  for (const t of transitions.value) {
    for (const f of t.from) edges.set(f, [...(edges.get(f) ?? []), t.to]);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (terminal.has(cur)) return null;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(edges.get(cur) ?? []));
  }
  return `No path from "${start}" to a closed/rejected status — add transitions before activating.`;
});
</script>

<template>
  <div class="space-y-8">
    <!-- Overview -->
    <section v-show="show('sec-overview')">
      <p class="text-xs text-muted mb-3">
        One workflow definition per case type. Statuses carry <b>semantic tags</b> so reports work
        across tenants even when status names differ.
      </p>
      <UFormField label="Case type" required help="Binds this workflow to intake forms and numbering (e.g. grievance).">
        <UInput v-model="payload.case_type" class="w-full sm:w-72 font-mono" placeholder="grievance" />
      </UFormField>
      <UAlert v-if="reachabilityHint" color="warning" :title="reachabilityHint" class="mt-4" />
    </section>

    <!-- Statuses -->
    <section v-show="show('sec-statuses')">
      <p class="text-xs text-muted mb-3">
        Lifecycle stages in display order. Drag to reorder — order is cosmetic; transitions define
        the actual graph.
      </p>
      <div class="space-y-2">
        <div
          v-for="(s, i) in statuses"
          :key="i"
          class="rounded-lg border border-default bg-default transition"
          :class="{ 'opacity-50': statusDrag === i, 'ring-2 ring-primary/50': statusDragOver === i && statusDrag !== i }"
          draggable="true"
          @dragstart="statusDrag = i"
          @dragover.prevent="statusDragOver = i"
          @dragleave="statusDragOver === i && (statusDragOver = null)"
          @drop="moveStatus(statusDrag!, i); statusDrag = null; statusDragOver = null"
          @dragend="statusDrag = null; statusDragOver = null"
        >
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggleStatus(s)">
            <UIcon name="i-lucide-grip-vertical" class="text-muted cursor-grab shrink-0" />
            <span class="font-medium truncate">{{ s.name || '(unnamed)' }}</span>
            <UBadge size="sm" variant="subtle" :color="tagMeta(s.tag).color">{{ tagMeta(s.tag).label }}</UBadge>
            <UBadge v-if="payload.initial?.default === s.name" size="sm" variant="subtle" color="primary">initial</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="i === 0" @click.stop="moveStatus(i, i - 1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="i === statuses.length - 1" @click.stop="moveStatus(i, i + 1)" />
              <UButton
                size="xs" variant="ghost" color="error" icon="i-lucide-trash-2"
                :disabled="statuses.length <= 2"
                @click.stop="removeStatus(s)"
              />
              <UIcon :name="expandedStatus.has(s) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted ml-1" />
            </div>
          </div>
          <div v-if="expandedStatus.has(s)" class="border-t border-default px-4 py-3 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Status name" required help="Exact name used in transitions (case-sensitive).">
                <UInput v-model="s.name" class="w-full" placeholder="e.g. Investigation" />
              </UFormField>
              <UFormField label="Semantic tag" required help="Drives SLA logic and reporting aggregates.">
                <USelectMenu
                  v-model="s.tag"
                  :items="SEMANTIC_TAGS"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField v-for="loc in locales" :key="loc" :label="`Label (${loc})`">
                <UInput v-model="s.label![loc]" class="w-full" />
              </UFormField>
            </div>
          </div>
        </div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addStatus">Add status</UButton>
    </section>

    <!-- Initial status -->
    <section v-show="show('sec-initial')">
      <p class="text-xs text-muted mb-3">
        Every new case starts in the <b>default</b> status. Override rules route special cases
        (e.g. in-court flag → In Court).
      </p>
      <UFormField label="Default initial status" required class="mb-4">
        <USelectMenu
          v-model="payload.initial.default"
          :items="statusNames.map((n) => ({ value: n, label: n }))"
          value-key="value"
          label-key="label"
          class="w-full sm:w-72"
          placeholder="Select status…"
        />
      </UFormField>

      <div class="text-sm font-medium mb-2">Override rules</div>
      <div v-if="!payload.initial.rules.length" class="text-sm text-muted mb-2">No overrides — all cases use the default.</div>
      <div v-for="(rule, ri) in payload.initial.rules" :key="ri" class="flex flex-wrap items-end gap-2 mb-2 p-3 rounded-lg border border-default">
        <UFormField label="When flag" class="grow sm:grow-0 sm:w-40">
          <UInput v-model="rule.if.flag" placeholder="e.g. in_court" class="font-mono" />
        </UFormField>
        <span class="text-muted pb-2">→</span>
        <UFormField label="Start in status" class="grow sm:grow-0 sm:w-48">
          <USelectMenu
            :model-value="typeof rule.then === 'string' ? rule.then : rule.then?.status"
            :items="statusNames.map((n) => ({ value: n, label: n }))"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="rule.then = $event as string"
          />
        </UFormField>
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="mb-1" @click="removeInitialRule(ri)" />
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addInitialRule">Add override rule</UButton>
    </section>

    <!-- Transitions -->
    <section v-show="show('sec-transitions')">
      <p class="text-xs text-muted mb-3">
        Allowed moves between statuses. Each transition lists who may perform it, optional
        requirements, side effects (level move, SLA restart), and guards.
      </p>
      <div class="space-y-2">
        <div v-for="(t, ti) in transitions" :key="ti" class="rounded-lg border border-default bg-default">
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggleTx(t)">
            <UIcon name="i-lucide-arrow-right-left" class="text-primary shrink-0" />
            <span class="font-medium truncate text-sm">{{ txSummary(t) }}</span>
            <UBadge v-if="t.guard" size="sm" variant="subtle" color="warning">{{ t.guard }}</UBadge>
            <UBadge v-if="t.effects?.length" size="sm" variant="subtle" color="neutral">{{ t.effects.length }} effect(s)</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeTransition(t)" />
              <UIcon :name="expandedTx.has(t) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted" />
            </div>
          </div>
          <div v-if="expandedTx.has(t)" class="border-t border-default px-4 py-3 space-y-4">
            <UFormField label="To status" required>
              <USelectMenu
                v-model="t.to"
                :items="statusNames.map((n) => ({ value: n, label: n }))"
                value-key="value"
                label-key="label"
                class="w-full sm:w-72"
              />
            </UFormField>

            <UFormField label="From statuses" required help="Case must be in one of these statuses to use this transition.">
              <div class="flex flex-wrap gap-2">
                <label
                  v-for="name in statusNames"
                  :key="name"
                  class="inline-flex items-center gap-1.5 text-sm px-2 py-1 rounded-md border border-default cursor-pointer"
                  :class="t.from.includes(name) ? 'bg-primary/10 border-primary/40' : ''"
                >
                  <input
                    type="checkbox"
                    class="rounded"
                    :checked="t.from.includes(name)"
                    @change="toggleFromStatus(t, name, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ name }}
                </label>
              </div>
            </UFormField>

            <UFormField label="Allowed roles" required :help="roleNames.length ? 'From CD-10 org & access.' : 'Define roles under Org & access (CD-10), then re-open this editor.'">
              <USelectMenu
                v-if="roleNames.length"
                v-model="t.roles"
                :items="roleNames.map((n) => ({ value: n, label: n }))"
                value-key="value"
                label-key="label"
                multiple
                class="w-full font-mono"
                placeholder="Select roles..."
              />
              <UInput v-else :model-value="rolesText(t)" class="w-full font-mono" placeholder="grm_officer" @update:model-value="setRolesText(t, $event as string)" />
            </UFormField>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Guard">
                <USelectMenu
                  :model-value="t.guard ?? ''"
                  :items="GUARDS"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="t.guard = ($event as string) || undefined"
                />
              </UFormField>
              <UFormField label="Required fields" help="Comma-separated field keys (e.g. resolution_summary).">
                <UInput :model-value="requiresFieldsText(t)" class="w-full font-mono" @update:model-value="setRequiresFields(t, $event as string)" />
              </UFormField>
            </div>

            <div class="flex items-center gap-2 text-sm">
              <USwitch :model-value="!!t.requires?.note" @update:model-value="(t.requires ??= {}).note = $event || undefined" />
              <span>Requires a note / justification</span>
            </div>

            <UFormField
              label="Required document types"
              help="From CD-06 document types. Officer must attach at least one file of each kind before this transition."
            >
              <USelectMenu
                v-if="attachmentKindItems.length"
                :model-value="t.requires?.attachments ?? []"
                :items="attachmentKindItems"
                value-key="value"
                label-key="label"
                multiple
                class="w-full"
                placeholder="None required…"
                @update:model-value="setRequiresAttachments(t, $event as string[])"
              />
              <UInput
                v-else
                :model-value="(t.requires?.attachments ?? []).join(', ')"
                class="w-full font-mono"
                placeholder="signed_resolution_form"
                @update:model-value="setRequiresAttachments(t, ($event as string).split(',').map((s) => s.trim()).filter(Boolean))"
              />
            </UFormField>

            <UFormField
              label="Allowed document types (optional)"
              help="When set, only these types may be attached on this transition (required types must be included here)."
            >
              <USelectMenu
                v-if="attachmentKindItems.length"
                :model-value="t.allows?.attachments ?? []"
                :items="attachmentKindItems"
                value-key="value"
                label-key="label"
                multiple
                class="w-full"
                placeholder="Any active type…"
                @update:model-value="setAllowsAttachments(t, $event as string[])"
              />
              <UInput
                v-else
                :model-value="(t.allows?.attachments ?? []).join(', ')"
                class="w-full font-mono"
                placeholder="evidence, investigation_report"
                @update:model-value="setAllowsAttachments(t, ($event as string).split(',').map((s) => s.trim()).filter(Boolean))"
              />
            </UFormField>

            <div>
              <div class="text-sm font-medium mb-2">Side effects</div>
              <div v-for="(eff, ei) in t.effects ?? []" :key="ei" class="flex flex-wrap items-end gap-2 mb-2">
                <USelectMenu
                  :model-value="effectKind(eff)"
                  :items="EFFECT_TYPES"
                  value-key="value"
                  label-key="label"
                  class="w-48"
                  @update:model-value="setEffectKind(eff, $event as string)"
                />
                <USelectMenu
                  v-if="'move_level' in eff"
                  v-model="eff.move_level"
                  :items="[{ value: 'up', label: 'Move up' }, { value: 'down', label: 'Move down' }]"
                  value-key="value"
                  label-key="label"
                  class="w-36"
                />
                <USelectMenu
                  v-if="'restart_sla' in eff"
                  v-model="eff.restart_sla"
                  :items="[{ value: 'stage', label: 'Stage clock' }, { value: 'all', label: 'All clocks' }]"
                  value-key="value"
                  label-key="label"
                  class="w-36"
                />
                <USelectMenu
                  v-if="'set_assignee' in eff"
                  v-model="eff.set_assignee"
                  :items="[{ value: 'none', label: 'Clear assignee' }, { value: 'actor', label: 'Actor' }, { value: 'role_default', label: 'Role default' }]"
                  value-key="value"
                  label-key="label"
                  class="w-40"
                />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeEffect(t, ei)" />
              </div>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addEffect(t)">Add effect</UButton>
            </div>
          </div>
        </div>
        <div v-if="!transitions.length" class="text-sm text-muted">No transitions yet — cases cannot move between statuses.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addTransition">Add transition</UButton>
    </section>

    <!-- Closure -->
    <section v-show="show('sec-closure')">
      <p class="text-xs text-muted mb-3">
        Resolution ≠ closure. Configure when a higher level must confirm closure and whether
        complainant satisfaction is captured.
      </p>
      <div class="space-y-4 p-4 rounded-lg border border-default">
        <div class="text-sm font-medium">National / supervisory confirmation</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField label="Authority level" help="Level that may confirm closures (from hierarchy).">
            <USelectMenu
              v-model="payload.closure.confirmation.authority_level"
              :items="hierarchyLevels.map((l) => ({ value: l.code, label: l.label }))"
              value-key="value"
              label-key="label"
              class="w-full"
              placeholder="e.g. national"
            />
          </UFormField>
          <UFormField label="Required when resolved below" help="Level code — confirmation needed if case resolved at a lower level.">
            <UInput
              v-model="payload.closure.confirmation.required_when.resolved_below"
              class="w-full font-mono"
              placeholder="national"
            />
          </UFormField>
        </div>
      </div>
      <div class="mt-4 p-4 rounded-lg border border-default space-y-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">Complainant satisfaction survey</span>
          <USwitch v-model="payload.closure.satisfaction.enabled" />
        </div>
        <UFormField v-if="payload.closure.satisfaction.enabled" label="Channels" help="Comma-separated: sms, portal, email">
          <UInput v-model="satisfactionChannels" class="w-full" placeholder="sms, portal" />
        </UFormField>
      </div>
    </section>

    <!-- Appeal -->
    <section v-show="show('sec-appeal')">
      <p class="text-xs text-muted mb-3">
        Lets complainants challenge a resolution within a time window. Routes typically go to
        the next jurisdiction level.
      </p>
      <div class="p-4 rounded-lg border border-default space-y-4">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">Appeals enabled</span>
          <USwitch v-model="payload.appeal.enabled" />
        </div>
        <template v-if="payload.appeal.enabled">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UFormField label="Window (days)" help="Days after resolution notice.">
              <UInput v-model.number="payload.appeal.window_days" type="number" min="1" class="w-full" />
            </UFormField>
            <UFormField label="Routes to">
              <UInput v-model="payload.appeal.routes_to" class="w-full font-mono" placeholder="next_level" />
            </UFormField>
            <UFormField label="Max rounds">
              <UInput v-model.number="payload.appeal.max_rounds" type="number" min="1" class="w-full" />
            </UFormField>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
