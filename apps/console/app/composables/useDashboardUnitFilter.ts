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

const levels = ref<HierarchyLevelOption[]>([]);
const selections = ref<Record<string, string>>({});
const unitsByLevel = ref<Record<string, UnitOption[]>>({});
const loading = ref(false);
const initialized = ref(false);
const enabled = ref(false);

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
    levels.value = res.levels.length ? res.levels : levels.value;
    unitsByLevel.value[level.code] = res.units ?? [];
  }

  async function initFilter() {
    loading.value = true;
    try {
      const res = await api<UnitFilterResponse>('/api/v1/dashboards/unit-filter');
      levels.value = res.levels ?? [];
      selections.value = {};
      unitsByLevel.value = {};
      for (const lvl of levels.value) {
        selections.value[lvl.code] = ALL_VALUE;
      }
      if (levels.value.length) await loadUnitsForLevel(0);
      initialized.value = true;
    } catch {
      levels.value = [];
      selections.value = {};
      unitsByLevel.value = {};
      initialized.value = false;
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    selections.value = {};
    unitsByLevel.value = {};
    for (const lvl of levels.value) {
      selections.value[lvl.code] = ALL_VALUE;
    }
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
    onLevelChange,
    selectItems,
    levelCacheKey,
  };
}
