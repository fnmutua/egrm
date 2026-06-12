<script setup lang="ts">
/**
 * Dedicated form for CD-05 SLA: named plans (targets + stage durations),
 * working calendars, reminder ladder, and escalation rules.
 */
interface Plan {
  code: string;
  label?: string;
  time_mode: 'working' | 'calendar';
  calendar_code?: string;
  acknowledge_within?: string;
  first_response_within?: string;
  resolve_within?: string;
  stage_durations?: Record<string, string>;
  is_default: boolean;
}

interface Calendar {
  code: string;
  label?: string;
  timezone: string;
  working_days: number[];
  start_hour: number;
  end_hour: number;
  holidays: string[];
}

interface Reminder {
  at: string;
  notify: 'assignee' | 'supervisor';
  role?: string;
}

interface EscRule {
  name: string;
  enabled: boolean;
  trigger: { clock?: string; state?: string; on?: string };
  condition?: Record<string, unknown>;
  actions: Record<string, unknown>[];
}

const DAY_LABELS = [
  { v: 0, l: 'Sun' }, { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' },
];

const CLOCK_KINDS = [
  { value: 'acknowledge', label: 'Acknowledge' },
  { value: 'first_response', label: 'First response' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'stage', label: 'Stage' },
];

const TRIGGER_EVENTS = [
  { value: 'case_created', label: 'Case created' },
  { value: 'satisfaction_recorded', label: 'Satisfaction recorded' },
];

const ESC_ACTION_TYPES = [
  { value: 'move_level', label: 'Move level' },
  { value: 'set_status', label: 'Set status' },
  { value: 'notify', label: 'Notify role' },
  { value: 'set_sla_plan', label: 'Switch SLA plan' },
  { value: 'open_appeal', label: 'Open appeal' },
];

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;

const workflowStatuses = ref<string[]>([]);
const knownRoles = ['grm_officer', 'grm_officer_national', 'administrator', 'me_analyst'];

onMounted(async () => {
  try {
    const wf = await api<{ payload?: { statuses?: { name: string }[] } }>('/api/v1/config/cd04_workflow');
    workflowStatuses.value = (wf.payload?.statuses ?? []).map((s) => s.name).filter(Boolean);
  } catch {
    /* optional cross-ref */
  }
  ensure();
});

function ensure() {
  const p = props.payload;
  if (!Array.isArray(p.plans) || p.plans.length === 0) {
    p.plans = [{
      code: 'standard',
      label: 'Standard',
      time_mode: 'working',
      is_default: true,
      stage_durations: {},
    }];
  }
  for (const plan of p.plans) {
    plan.time_mode ??= 'working';
    plan.is_default ??= false;
    plan.stage_durations ??= {};
  }
  p.calendars ??= [];
  for (const c of p.calendars) {
    c.timezone ??= 'Africa/Nairobi';
    c.working_days ??= [1, 2, 3, 4, 5];
    c.start_hour ??= 8;
    c.end_hour ??= 17;
    c.holidays ??= [];
  }
  p.reminders ??= [];
  p.escalation_rules ??= [];
  if (!p.default_plan && p.plans.some((x: Plan) => x.is_default)) {
    p.default_plan = p.plans.find((x: Plan) => x.is_default)?.code;
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const plans = computed<Plan[]>(() => props.payload.plans);
const calendars = computed<Calendar[]>(() => props.payload.calendars);
const reminders = computed<Reminder[]>(() => props.payload.reminders);
const escRules = computed<EscRule[]>(() => props.payload.escalation_rules);

const planCodes = computed(() => plans.value.map((p) => p.code));
const calendarCodes = computed(() => calendars.value.map((c) => c.code));

function setDefaultPlan(plan: Plan, on: boolean) {
  if (on) {
    for (const p of plans.value) p.is_default = p === plan;
    props.payload.default_plan = plan.code;
  } else {
    plan.is_default = false;
  }
}

// --- plans ---
const expandedPlan = ref<Set<Plan>>(new Set());
function togglePlan(plan: Plan) {
  if (expandedPlan.value.has(plan)) expandedPlan.value.delete(plan);
  else expandedPlan.value.add(plan);
  expandedPlan.value = new Set(expandedPlan.value);
}

function addPlan() {
  const plan: Plan = { code: '', label: '', time_mode: 'working', is_default: false, stage_durations: {} };
  props.payload.plans.push(plan);
  expandedPlan.value = new Set([...expandedPlan.value, plan]);
}

function removePlan(plan: Plan) {
  if (plans.value.length <= 1) return;
  props.payload.plans = plans.value.filter((p) => p !== plan);
  if (props.payload.default_plan === plan.code) {
    props.payload.default_plan = props.payload.plans[0]?.code;
    if (props.payload.plans[0]) props.payload.plans[0].is_default = true;
  }
}

const stageEntries = (plan: Plan) =>
  Object.entries(plan.stage_durations ?? {}).map(([status, duration]) => ({ status, duration }));

function addStageDuration(plan: Plan) {
  const status = workflowStatuses.value.find((s) => !(s in (plan.stage_durations ?? {}))) ?? '';
  plan.stage_durations ??= {};
  plan.stage_durations[status || 'Sorting'] = '7d';
}

function updateStageDuration(plan: Plan, oldStatus: string, status: string, duration: string) {
  plan.stage_durations ??= {};
  if (oldStatus !== status) delete plan.stage_durations[oldStatus];
  plan.stage_durations[status] = duration;
}

function removeStageDuration(plan: Plan, status: string) {
  delete plan.stage_durations?.[status];
}

// --- calendars ---
function addCalendar() {
  props.payload.calendars.push({
    code: '',
    label: '',
    timezone: 'Africa/Nairobi',
    working_days: [1, 2, 3, 4, 5],
    start_hour: 8,
    end_hour: 17,
    holidays: [],
  });
}

function removeCalendar(c: Calendar) {
  props.payload.calendars = calendars.value.filter((x) => x !== c);
}

function toggleWorkingDay(c: Calendar, day: number, on: boolean) {
  if (on && !c.working_days.includes(day)) c.working_days.push(day);
  else c.working_days = c.working_days.filter((d) => d !== day);
  c.working_days.sort((a, b) => a - b);
}

const holidaysText = (c: Calendar) => c.holidays.join('\n');
function setHolidaysText(c: Calendar, text: string) {
  c.holidays = text.split(/[\n,]+/).map((d) => d.trim()).filter(Boolean);
}

// --- reminders ---
function addReminder() {
  props.payload.reminders.push({ at: 'T-2d', notify: 'assignee' });
}

function removeReminder(i: number) {
  props.payload.reminders.splice(i, 1);
}

// --- escalation ---
const expandedEsc = ref<Set<EscRule>>(new Set());
function toggleEsc(r: EscRule) {
  if (expandedEsc.value.has(r)) expandedEsc.value.delete(r);
  else expandedEsc.value.add(r);
  expandedEsc.value = new Set(expandedEsc.value);
}

function addEscRule() {
  const r: EscRule = {
    name: '',
    enabled: true,
    trigger: { clock: 'stage', state: 'breached' },
    actions: [{ move_level: 'up' }],
  };
  props.payload.escalation_rules.push(r);
  expandedEsc.value = new Set([...expandedEsc.value, r]);
}

function removeEscRule(r: EscRule) {
  props.payload.escalation_rules = escRules.value.filter((x) => x !== r);
}

function escTriggerKind(r: EscRule): 'clock' | 'event' {
  return r.trigger.on ? 'event' : 'clock';
}

function setEscTriggerKind(r: EscRule, kind: 'clock' | 'event') {
  if (kind === 'event') {
    r.trigger = { on: 'case_created' };
  } else {
    r.trigger = { clock: 'stage', state: 'breached' };
  }
}

function escActionKind(a: Record<string, unknown>): string {
  if ('move_level' in a) return 'move_level';
  if ('set_status' in a) return 'set_status';
  if ('notify' in a) return 'notify';
  if ('set_sla_plan' in a) return 'set_sla_plan';
  if ('open_appeal' in a) return 'open_appeal';
  return 'move_level';
}

function setEscActionKind(a: Record<string, unknown>, kind: string) {
  for (const k of Object.keys(a)) delete a[k];
  if (kind === 'move_level') a.move_level = 'up';
  else if (kind === 'set_status') a.set_status = workflowStatuses.value[0] ?? 'Escalated';
  else if (kind === 'notify') a.notify = { role: 'grm_officer' };
  else if (kind === 'set_sla_plan') a.set_sla_plan = planCodes.value[0] ?? 'standard';
  else if (kind === 'open_appeal') a.open_appeal = { route: 'next_level' };
}

function addEscAction(r: EscRule) {
  r.actions.push({ move_level: 'up' });
}

function removeEscAction(r: EscRule, i: number) {
  r.actions.splice(i, 1);
}

const conditionText = (r: EscRule) => JSON.stringify(r.condition ?? {}, null, 0);
function setConditionText(r: EscRule, text: string) {
  try {
    r.condition = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    /* keep typing */
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Overview -->
    <section v-show="show('sec-overview')">
      <p class="text-xs text-muted mb-3">
        SLA plans define acknowledgement, response, resolution, and per-status targets.
        Working-time plans use a calendar; calendar-time counts 24/7. Priority multipliers
        from taxonomy (CD-03) scale these targets at runtime.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UFormField label="Default plan" help="Applied to new cases unless category/priority overrides.">
          <USelectMenu
            v-model="payload.default_plan"
            :items="planCodes.map((c) => ({ value: c, label: c }))"
            value-key="value"
            label-key="label"
            class="w-full"
            placeholder="Select plan…"
          />
        </UFormField>
        <UFormField label="Default calendar" help="Used by working-time plans when none is specified.">
          <USelectMenu
            v-model="payload.default_calendar"
            :items="calendarCodes.map((c) => ({ value: c, label: c }))"
            value-key="value"
            label-key="label"
            class="w-full"
            placeholder="Select calendar…"
          />
        </UFormField>
      </div>
    </section>

    <!-- Plans -->
    <section v-show="show('sec-plans')">
      <p class="text-xs text-muted mb-3">
        Named SLA plans. KISIP uses <b>stage durations</b> per workflow status; KUSP2 uses
        acknowledge / first-response / resolve targets. You can combine both.
      </p>
      <div class="space-y-2">
        <div v-for="(plan, pi) in plans" :key="pi" class="rounded-lg border border-default bg-default">
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="togglePlan(plan)">
            <span class="font-medium truncate">{{ plan.label || plan.code || '(unnamed plan)' }}</span>
            <UBadge v-if="plan.code" size="sm" variant="subtle" color="neutral" class="font-mono">{{ plan.code }}</UBadge>
            <UBadge v-if="plan.is_default" size="sm" variant="subtle" color="primary">default</UBadge>
            <UBadge size="sm" variant="subtle" color="neutral">{{ plan.time_mode }}</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="plans.length <= 1" @click.stop="removePlan(plan)" />
              <UIcon :name="expandedPlan.has(plan) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted" />
            </div>
          </div>
          <div v-if="expandedPlan.has(plan)" class="border-t border-default px-4 py-3 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Code" required>
                <UInput v-model="plan.code" class="w-full font-mono" placeholder="standard" />
              </UFormField>
              <UFormField label="Label">
                <UInput v-model="plan.label" class="w-full" placeholder="Standard GRM plan" />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Time mode">
                <USelectMenu
                  v-model="plan.time_mode"
                  :items="[{ value: 'working', label: 'Working time (uses calendar)' }, { value: 'calendar', label: 'Calendar time (24/7)' }]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
              <UFormField v-if="plan.time_mode === 'working'" label="Calendar">
                <USelectMenu
                  v-model="plan.calendar_code"
                  :items="calendarCodes.map((c) => ({ value: c, label: c }))"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  placeholder="default calendar"
                />
              </UFormField>
            </div>
            <div class="flex items-center justify-between gap-2 text-sm sm:w-64">
              <span>Default plan for new cases</span>
              <USwitch :model-value="plan.is_default" @update:model-value="setDefaultPlan(plan, $event)" />
            </div>

            <div class="text-sm font-medium">Global targets</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <UFormField label="Acknowledge" help="immediate or e.g. 1d">
                <UInput v-model="plan.acknowledge_within" class="w-full font-mono" placeholder="immediate" />
              </UFormField>
              <UFormField label="First response" help="e.g. 14d or 14d_working">
                <UInput v-model="plan.first_response_within" class="w-full font-mono" placeholder="14d" />
              </UFormField>
              <UFormField label="Resolve" help="e.g. 30d">
                <UInput v-model="plan.resolve_within" class="w-full font-mono" placeholder="30d" />
              </UFormField>
            </div>

            <div>
              <div class="text-sm font-medium mb-2">Stage durations (per workflow status)</div>
              <p v-if="!workflowStatuses.length" class="text-xs text-muted mb-2">Configure CD-04 workflow statuses to pick from a list.</p>
              <div v-for="(row, si) in stageEntries(plan)" :key="si" class="flex flex-wrap items-end gap-2 mb-2">
                <UFormField label="Status" class="grow sm:grow-0 sm:w-48">
                  <USelectMenu
                    :model-value="row.status"
                    :items="workflowStatuses.map((n) => ({ value: n, label: n }))"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="updateStageDuration(plan, row.status, $event as string, row.duration)"
                  />
                </UFormField>
                <UFormField label="Duration" class="w-32">
                  <UInput
                    :model-value="row.duration"
                    class="font-mono"
                    placeholder="7d"
                    @update:model-value="updateStageDuration(plan, row.status, row.status, $event as string)"
                  />
                </UFormField>
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="mb-1" @click="removeStageDuration(plan, row.status)" />
              </div>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addStageDuration(plan)">Add stage duration</UButton>
            </div>
          </div>
        </div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addPlan">Add plan</UButton>
    </section>

    <!-- Calendars -->
    <section v-show="show('sec-calendars')">
      <p class="text-xs text-muted mb-3">
        Working hours and public holidays for SLA due-date calculation. Times use the
        tenant timezone unless overridden here.
      </p>
      <div class="space-y-3">
        <div v-for="(cal, ci) in calendars" :key="ci" class="rounded-lg border border-default px-4 py-3 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">{{ cal.label || cal.code || 'Calendar' }}</span>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeCalendar(cal)" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Code" required>
              <UInput v-model="cal.code" class="font-mono" placeholder="kenya" />
            </UFormField>
            <UFormField label="Label">
              <UInput v-model="cal.label" placeholder="Kenya working calendar" />
            </UFormField>
            <UFormField label="Timezone">
              <UInput v-model="cal.timezone" class="font-mono" placeholder="Africa/Nairobi" />
            </UFormField>
            <div class="flex gap-3">
              <UFormField label="Start hour" class="w-24">
                <UInput v-model.number="cal.start_hour" type="number" min="0" max="23" />
              </UFormField>
              <UFormField label="End hour" class="w-24">
                <UInput v-model.number="cal.end_hour" type="number" min="0" max="23" />
              </UFormField>
            </div>
          </div>
          <UFormField label="Working days">
            <div class="flex flex-wrap gap-2">
              <label
                v-for="d in DAY_LABELS"
                :key="d.v"
                class="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-default cursor-pointer"
                :class="cal.working_days.includes(d.v) ? 'bg-primary/10 border-primary/40' : ''"
              >
                <input type="checkbox" class="rounded" :checked="cal.working_days.includes(d.v)" @change="toggleWorkingDay(cal, d.v, ($event.target as HTMLInputElement).checked)" />
                {{ d.l }}
              </label>
            </div>
          </UFormField>
          <UFormField label="Holidays" help="One ISO date per line (YYYY-MM-DD).">
            <UTextarea :model-value="holidaysText(cal)" :rows="3" class="w-full font-mono text-xs" @update:model-value="setHolidaysText(cal, $event as string)" />
          </UFormField>
        </div>
        <div v-if="!calendars.length" class="text-sm text-muted">No calendars — working-time SLAs fall back to 24/7 unless a calendar is added.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addCalendar">Add calendar</UButton>
    </section>

    <!-- Reminders -->
    <section v-show="show('sec-reminders')">
      <p class="text-xs text-muted mb-3">
        Notify staff before a clock breaches. <b>T-2d</b> = two days before due;
        evaluated by the SLA scheduler in the worker.
      </p>
      <div class="space-y-2">
        <div v-for="(rem, ri) in reminders" :key="ri" class="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-default">
          <UFormField label="Lead time" class="w-28">
            <UInput v-model="rem.at" class="font-mono" placeholder="T-2d" />
          </UFormField>
          <UFormField label="Notify" class="w-36">
            <USelectMenu
              v-model="rem.notify"
              :items="[{ value: 'assignee', label: 'Assignee' }, { value: 'supervisor', label: 'Supervisor' }]"
              value-key="value"
              label-key="label"
            />
          </UFormField>
          <UFormField label="Role (optional)" class="grow sm:grow-0 sm:w-48">
            <UInput v-model="rem.role" class="font-mono" :placeholder="knownRoles[0]" />
          </UFormField>
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="mb-1" @click="removeReminder(ri)" />
        </div>
        <div v-if="!reminders.length" class="text-sm text-muted">No reminders configured.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addReminder">Add reminder</UButton>
    </section>

    <!-- Escalation rules -->
    <section v-show="show('sec-escalation')">
      <p class="text-xs text-muted mb-3">
        Automatic actions when clocks breach or events fire — move level, change status,
        notify roles, switch SLA plan. Manual escalation remains a normal workflow transition.
      </p>
      <div class="space-y-2">
        <div v-for="(rule, ri) in escRules" :key="ri" class="rounded-lg border border-default bg-default">
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggleEsc(rule)">
            <span class="font-medium truncate">{{ rule.name || '(unnamed rule)' }}</span>
            <UBadge size="sm" variant="subtle" :color="rule.enabled ? 'success' : 'neutral'">{{ rule.enabled ? 'on' : 'off' }}</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeEscRule(rule)" />
              <UIcon :name="expandedEsc.has(rule) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted" />
            </div>
          </div>
          <div v-if="expandedEsc.has(rule)" class="border-t border-default px-4 py-3 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Rule name" required>
                <UInput v-model="rule.name" class="font-mono" placeholder="overdue-auto-escalate" />
              </UFormField>
              <div class="flex items-center justify-between gap-2 text-sm pt-6">
                <span>Enabled</span>
                <USwitch v-model="rule.enabled" />
              </div>
            </div>

            <UFormField label="Trigger type">
              <USelectMenu
                :model-value="escTriggerKind(rule)"
                :items="[{ value: 'clock', label: 'SLA clock state' }, { value: 'event', label: 'Case event' }]"
                value-key="value"
                label-key="label"
                class="w-full sm:w-64"
                @update:model-value="setEscTriggerKind(rule, $event as 'clock' | 'event')"
              />
            </UFormField>

            <div v-if="escTriggerKind(rule) === 'clock'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Clock">
                <USelectMenu v-model="rule.trigger.clock" :items="CLOCK_KINDS" value-key="value" label-key="label" class="w-full" />
              </UFormField>
              <UFormField label="State">
                <USelectMenu
                  v-model="rule.trigger.state"
                  :items="[{ value: 'at_risk', label: 'At risk' }, { value: 'breached', label: 'Breached' }]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UFormField v-else label="Event">
              <USelectMenu v-model="rule.trigger.on" :items="TRIGGER_EVENTS" value-key="value" label-key="label" class="w-full sm:w-72" />
            </UFormField>

            <UFormField label="Condition (JSON)" help='e.g. {"status_tag":"in_progress"} or {"priority":"emergency"}'>
              <UInput :model-value="conditionText(rule)" class="font-mono text-xs" @update:model-value="setConditionText(rule, $event as string)" />
            </UFormField>

            <div>
              <div class="text-sm font-medium mb-2">Actions</div>
              <div v-for="(act, ai) in rule.actions" :key="ai" class="flex flex-wrap items-end gap-2 mb-2">
                <USelectMenu
                  :model-value="escActionKind(act)"
                  :items="ESC_ACTION_TYPES"
                  value-key="value"
                  label-key="label"
                  class="w-44"
                  @update:model-value="setEscActionKind(act, $event as string)"
                />
                <USelectMenu
                  v-if="'move_level' in act"
                  v-model="(act as { move_level: string }).move_level"
                  :items="[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]"
                  value-key="value"
                  label-key="label"
                  class="w-28"
                />
                <USelectMenu
                  v-if="'set_status' in act"
                  v-model="(act as { set_status: string }).set_status"
                  :items="workflowStatuses.map((n) => ({ value: n, label: n }))"
                  value-key="value"
                  label-key="label"
                  class="w-48"
                />
                <UInput
                  v-if="'notify' in act"
                  v-model="(act.notify as { role: string }).role"
                  class="w-48 font-mono"
                  placeholder="role name"
                />
                <USelectMenu
                  v-if="'set_sla_plan' in act"
                  v-model="(act as { set_sla_plan: string }).set_sla_plan"
                  :items="planCodes.map((c) => ({ value: c, label: c }))"
                  value-key="value"
                  label-key="label"
                  class="w-40"
                />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeEscAction(rule, ai)" />
              </div>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addEscAction(rule)">Add action</UButton>
            </div>
          </div>
        </div>
        <div v-if="!escRules.length" class="text-sm text-muted">No automatic escalation rules.</div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" class="mt-3" @click="addEscRule">Add escalation rule</UButton>
    </section>
  </div>
</template>
