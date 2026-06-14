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

function createUnitFilterStore() {
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

  return {
    allLevels,
    startLevelCode,
    selections,
    unitsByLevel,
    loading,
    initialized,
    enabled,
    levels,
  };
}

type UnitFilterStore = ReturnType<typeof createUnitFilterStore>;

const stores = new Map<string, UnitFilterStore>();

function getUnitFilterStore(scope: string): UnitFilterStore {
  let store = stores.get(scope);
  if (!store) {
    store = createUnitFilterStore();
    stores.set(scope, store);
  }
  return store;
}

function levelCacheKey(levelCode: string, parentId: string | null): string {
  return `${levelCode}:${parentId ?? 'root'}`;
}

export function useDashboardUnitFilter(scope = 'dashboard') {
  const { api } = useApi();
  const store = getUnitFilterStore(scope);

  const effectiveUnitId = computed(() => {
    if (!store.enabled.value) return null;
    for (let i = store.levels.value.length - 1; i >= 0; i--) {
      const code = store.levels.value[i]!.code;
      const sel = store.selections.value[code];
      if (sel && sel !== ALL_VALUE) return sel;
    }
    return null;
  });

  const hasActiveFilter = computed(() => effectiveUnitId.value !== null);

  async function loadUnitsForLevel(levelIndex: number) {
    const level = store.levels.value[levelIndex];
    if (!level) return;

    let parentId: string | null = null;
    if (levelIndex > 0) {
      const parentCode = store.levels.value[levelIndex - 1]!.code;
      const parentSel = store.selections.value[parentCode];
      if (!parentSel || parentSel === ALL_VALUE) {
        store.unitsByLevel.value[level.code] = [];
        return;
      }
      parentId = parentSel;
    }

    const params = new URLSearchParams({ level_code: level.code });
    if (parentId) params.set('parent_id', parentId);

    const res = await api<UnitFilterResponse>(`/api/v1/dashboards/unit-filter?${params}`);
    store.allLevels.value = res.levels.length ? res.levels : store.allLevels.value;
    store.unitsByLevel.value[level.code] = res.units ?? [];
  }

  function initSelections() {
    store.selections.value = {};
    store.unitsByLevel.value = {};
    for (const lvl of store.levels.value) {
      store.selections.value[lvl.code] = ALL_VALUE;
    }
  }

  async function initFilter() {
    store.loading.value = true;
    try {
      const res = await api<UnitFilterResponse>('/api/v1/dashboards/unit-filter');
      store.allLevels.value = res.levels ?? [];
      initSelections();
      if (store.levels.value.length) await loadUnitsForLevel(0);
      store.initialized.value = true;
    } catch {
      store.allLevels.value = [];
      store.selections.value = {};
      store.unitsByLevel.value = {};
      store.initialized.value = false;
    } finally {
      store.loading.value = false;
    }
  }

  function resetFilter() {
    initSelections();
    if (store.levels.value.length) void loadUnitsForLevel(0);
  }

  async function onLevelChange(levelCode: string, value: string) {
    const idx = store.levels.value.findIndex((l) => l.code === levelCode);
    if (idx < 0) return;

    store.selections.value[levelCode] = value;

    for (let i = idx + 1; i < store.levels.value.length; i++) {
      const code = store.levels.value[i]!.code;
      store.selections.value[code] = ALL_VALUE;
      store.unitsByLevel.value[code] = [];
    }

    if (value !== ALL_VALUE && idx + 1 < store.levels.value.length) {
      await loadUnitsForLevel(idx + 1);
    }
  }

  function selectItems(levelCode: string) {
    const level = store.levels.value.find((l) => l.code === levelCode);
    const units = store.unitsByLevel.value[levelCode] ?? [];
    return [
      { value: ALL_VALUE, label: level ? `All ${level.label}` : 'All' },
      ...units.map((u) => ({ value: u.id, label: u.name })),
    ];
  }

  function setEnabled(active: boolean) {
    store.enabled.value = active;
    if (!active) resetFilter();
  }

  function setStartLevel(code: string | null | undefined) {
    const next = code ?? null;
    const changed = store.startLevelCode.value !== next;
    store.startLevelCode.value = next;
    if (changed && store.initialized.value && store.enabled.value) resetFilter();
  }

  return {
    ALL_VALUE,
    allLevels: store.allLevels,
    levels: store.levels,
    selections: store.selections,
    unitsByLevel: store.unitsByLevel,
    loading: store.loading,
    initialized: store.initialized,
    enabled: store.enabled,
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
