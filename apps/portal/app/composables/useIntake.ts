export interface IntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'phone' | 'email' | 'number';
  section: 'complainant' | 'grievance' | 'outcome';
  required: boolean;
  label: Record<string, string>;
  help?: Record<string, string>;
  options?: { value: string; label: Record<string, string> }[];
  options_ref?: string;
}

export interface IntakeMeta {
  locales: { default: string; enabled: string[] };
  anonymous_allowed: boolean;
  consent_text: Record<string, string>;
  fields: IntakeField[];
  categories: { code: string; label: Record<string, string> }[];
  levels: { code: string; label: string; allows_intake?: boolean; is_intake_default?: boolean }[];
  units: IntakeUnit[];
}

export interface IntakeUnit {
  id: string;
  levelCode: string;
  parentId: string | null;
  name: string;
}

export interface IntakeOption {
  value: string;
  label: string;
}

export interface IntakeUnitOption extends IntakeOption {
  kind: 'unit';
  name: string;
  levelLabel: string;
  ancestors: { name: string; levelLabel: string }[];
}

export interface IntakeOptionGroup {
  type: 'label';
  label: string;
}

export type IntakeSelectItem = IntakeOption | IntakeUnitOption | IntakeOptionGroup;

export function isUnitOption(item: unknown): item is IntakeUnitOption {
  return typeof item === 'object' && item !== null && 'kind' in item && (item as IntakeUnitOption).kind === 'unit';
}

function levelIndex(levels: IntakeMeta['levels'], code: string): number {
  const needle = code.toLowerCase();
  return levels.findIndex((l) => l.code.toLowerCase() === needle);
}

function levelLabel(levels: IntakeMeta['levels'], code: string): string {
  const level = levels.find((l) => l.code.toLowerCase() === code.toLowerCase());
  return level?.label ?? code;
}

/** Build root-to-parent chain for breadcrumb display. */
function buildAncestorChain(
  unit: IntakeUnit,
  unitsById: Map<string, IntakeUnit>,
  levels: IntakeMeta['levels'],
): { name: string; levelLabel: string }[] {
  const chain: { name: string; levelLabel: string }[] = [];
  let current = unit.parentId ? unitsById.get(unit.parentId) : null;
  while (current) {
    chain.unshift({
      name: current.name,
      levelLabel: levelLabel(levels, current.levelCode),
    });
    current = current.parentId ? unitsById.get(current.parentId) : null;
  }
  return chain;
}

function unitSearchLabel(
  unit: IntakeUnit,
  ancestors: { name: string; levelLabel: string }[],
  lvl: string,
): string {
  return [...ancestors.map((a) => a.name), unit.name, lvl].join(' ');
}

function intakeUnitSelectItems(meta: IntakeMeta): IntakeSelectItem[] {
  const unitsById = new Map(meta.units.map((u) => [u.id, u]));
  const intakeLevels = meta.levels.filter((l) => l.allows_intake || l.is_intake_default);
  const intakeLevelCodes = new Set(intakeLevels.map((l) => l.code.toLowerCase()));
  const showGroups = intakeLevels.length > 1;

  const units = meta.units
    .filter((u) => intakeLevelCodes.size === 0 || intakeLevelCodes.has(u.levelCode.toLowerCase()))
    .map((u) => {
      const ancestors = buildAncestorChain(u, unitsById, meta.levels);
      const lvl = levelLabel(meta.levels, u.levelCode);
      return {
        kind: 'unit' as const,
        value: u.id,
        name: u.name,
        levelLabel: lvl,
        levelCode: u.levelCode.toLowerCase(),
        levelIndex: levelIndex(meta.levels, u.levelCode),
        ancestors,
        parentName: ancestors.at(-1)?.name ?? '',
        label: unitSearchLabel(u, ancestors, lvl),
      };
    })
    .sort((a, b) => a.levelIndex - b.levelIndex || a.parentName.localeCompare(b.parentName) || a.name.localeCompare(b.name));

  const items: IntakeSelectItem[] = [];
  let lastGroup: string | null = null;
  for (const unit of units) {
    if (showGroups && unit.levelCode !== lastGroup) {
      items.push({ type: 'label', label: unit.levelLabel });
      lastGroup = unit.levelCode;
    }
    items.push(unit);
  }
  return items;
}

export function useIntake() {
  const config = useRuntimeConfig();
  const headers = { 'x-tenant': config.public.tenant };

  const meta = useState<IntakeMeta | null>('intake_meta', () => null);

  async function loadMeta() {
    if (meta.value) return meta.value;
    meta.value = await $fetch<IntakeMeta>('/api/v1/public/intake-meta', {
      baseURL: config.public.apiBase,
      headers,
    });
    return meta.value;
  }

  /** Options for a field, resolving options_ref against meta (units / taxonomy lists). */
  function fieldOptions(field: IntakeField, locale: string): IntakeSelectItem[] {
    if (field.options) {
      return field.options.map((o) => ({ value: o.value, label: o.label[locale] ?? o.label.en ?? o.value }));
    }
    if (field.options_ref === 'units' && meta.value) {
      return intakeUnitSelectItems(meta.value);
    }
    if (field.options_ref === 'taxonomy:categories' && meta.value) {
      return meta.value.categories.map((c) => ({ value: c.code, label: c.label[locale] ?? c.label.en ?? c.code }));
    }
    return [];
  }

  async function submit(payload: { anonymous: boolean; consent: boolean; values: Record<string, unknown> }) {
    return await $fetch<{
      reference: string;
      status: string;
      tracking_pin?: string;
      possible_duplicates: number;
    }>('/api/v1/public/cases', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers,
      body: payload,
    });
  }

  async function track(reference: string, verifier: string) {
    return await $fetch<{
      reference: string;
      status: string;
      status_tag: string;
      level: string;
      submitted_at: string;
      timeline: { kind: string; data: Record<string, unknown>; createdAt: string }[];
    }>('/api/v1/public/cases/track', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers,
      body: { reference, verifier },
    });
  }

  return { meta, loadMeta, fieldOptions, submit, track };
}
