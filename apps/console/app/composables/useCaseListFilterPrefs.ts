export type CaseListFilterKey = 'search' | 'status' | 'unit';

export interface CaseListFilterPrefs {
  search: boolean;
  status: boolean;
  unit: boolean;
}

const STORAGE_KEY = 'egrm:case-list-filters';

const DEFAULT_PREFS: CaseListFilterPrefs = {
  search: true,
  status: true,
  unit: true,
};

export const CASE_LIST_FILTER_OPTIONS: { key: CaseListFilterKey; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'status', label: 'Status' },
  { key: 'unit', label: 'Administrative unit' },
];

function readPrefs(): CaseListFilterPrefs {
  if (!import.meta.client) return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<CaseListFilterPrefs>;
    return {
      search: parsed.search ?? DEFAULT_PREFS.search,
      status: parsed.status ?? DEFAULT_PREFS.status,
      unit: parsed.unit ?? DEFAULT_PREFS.unit,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function useCaseListFilterPrefs() {
  const prefs = ref<CaseListFilterPrefs>(readPrefs());

  function persist() {
    if (!import.meta.client) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.value));
  }

  function setFilter(key: CaseListFilterKey, active: boolean) {
    const next = { ...prefs.value, [key]: active };
    if (!next.search && !next.status && !next.unit) return;
    prefs.value = next;
    persist();
  }

  const activeCount = computed(() =>
    CASE_LIST_FILTER_OPTIONS.filter((o) => prefs.value[o.key]).length,
  );

  return { prefs, setFilter, activeCount };
}
