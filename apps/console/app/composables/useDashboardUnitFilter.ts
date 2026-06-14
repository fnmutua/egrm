export interface HierarchyLevelOption {
  code: string;
  label: string;
}

export interface UnitOption {
  id: string;
  name: string;
  levelCode: string;
}

interface UnitFilterResponse {
  levels: HierarchyLevelOption[];
  units: UnitOption[];
}

const ALL_VALUE = '__all__';

const allLevels = ref<HierarchyLevelOption[]>([]);
const startLevelCode = ref<string | null>(null);
const selections = ref<Record<string, string>>({});
const unitsByLevel = ref<Record<string, UnitOption[]>>({});
const loading = ref(false);
const initialized = ref(false);
const enabled = ref(false);

/** Visible cascade levels — skips the hierarchy top; starts at configured/default 2nd level. */
const levels = computed(() => {
  if (!allLevels.value.length) return [];
  const topCode = allLevels.value[0]?.code;
  const fallback = allLevels.value[1]?.code ?? allLevels.value[0]?.code;
  let start = startLevelCode.value ?? fallback;
  if (start === topCode) start = fallback;
  const idx = allLevels.value.findIndex((l) => l.code === start);
  if (idx < 0) return allLevels.value.length > 1 ? allLevels.value.slice(1) : allLevels.value;
  return allLevels.value.slice(idx);
});

function levelCacheKey(levelCode: string, parentId: string | null): string {
  return `${levelCode}:${parentId ?? 'root'}`;
}

export function useDashboardUnitFilter() {
  const { api } = useApi();

  const effectiveUnitId = computed(() => {
    if (!enabled.value) return null;
    for (let i = levels.value.length - 1; i >= 0; i--) {
      const code = levels.value[i]!.code;
      const sel = selections.value[code];
      if (sel && sel !== ALL_VALUE) return sel;
    }
    return null;
  });

  const hasActiveFilter = computed(() => effectiveUnitId.value !== null);

  async function loadUnitsForLevel(levelIndex: number) {
    const level = levels.value[levelIndex];
    if (!level) return;

    let parentId: string | null = null;
    if (levelIndex > 0) {
      const parentCode = levels.value[levelIndex - 1]!.code;
      const parentSel = selections.value[parentCode];
      if (!parentSel || parentSel === ALL_VALUE) {
        unitsByLevel.value[level.code] = [];
        return;
      }
      parentId = parentSel;
    }

    const params = new URLSearchParams({ level_code: level.code });
    if (parentId) params.set('parent_id', parentId);

    const res = await api<UnitFilterResponse>(`/api/v1/dashboards/unit-filter?${params}`);
    allLevels.value = res.levels.length ? res.levels : allLevels.value;
    unitsByLevel.value[level.code] = res.units ?? [];
  }

  function initSelections() {
    selections.value = {};
    unitsByLevel.value = {};
    for (const lvl of levels.value) {
      selections.value[lvl.code] = ALL_VALUE;
    }
  }

  async function initFilter() {
    loading.value = true;
    try {
      const res = await api<UnitFilterResponse>('/api/v1/dashboards/unit-filter');
      allLevels.value = res.levels ?? [];
      initSelections();
      if (levels.value.length) await loadUnitsForLevel(0);
      initialized.value = true;
    } catch {
      allLevels.value = [];
      selections.value = {};
      unitsByLevel.value = {};
      initialized.value = false;
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    initSelections();
    if (levels.value.length) void loadUnitsForLevel(0);
  }

  async function onLevelChange(levelCode: string, value: string) {
    const idx = levels.value.findIndex((l) => l.code === levelCode);
    if (idx < 0) return;

    selections.value[levelCode] = value;

    for (let i = idx + 1; i < levels.value.length; i++) {
      const code = levels.value[i]!.code;
      selections.value[code] = ALL_VALUE;
      unitsByLevel.value[code] = [];
    }

    if (value !== ALL_VALUE && idx + 1 < levels.value.length) {
      await loadUnitsForLevel(idx + 1);
    }
  }

  function selectItems(levelCode: string) {
    const level = levels.value.find((l) => l.code === levelCode);
    const units = unitsByLevel.value[levelCode] ?? [];
    return [
      { value: ALL_VALUE, label: level ? `All ${level.label}` : 'All' },
      ...units.map((u) => ({ value: u.id, label: u.name })),
    ];
  }

  function setEnabled(active: boolean) {
    enabled.value = active;
    if (!active) resetFilter();
  }

  function setStartLevel(code: string | null | undefined) {
    const next = code ?? null;
    const changed = startLevelCode.value !== next;
    startLevelCode.value = next;
    if (changed && initialized.value && enabled.value) resetFilter();
  }

  return {
    ALL_VALUE,
    levels,
    selections,
    unitsByLevel,
    loading,
    initialized,
    enabled,
    effectiveUnitId,
    hasActiveFilter,
    initFilter,
    resetFilter,
    setEnabled,
    setStartLevel,
    onLevelChange,
    selectItems,
    levelCacheKey,
  };
}
