export function useAssignableUnits() {
  const { api } = useApi();

  async function searchAssignableUnits(opts: { q?: string; id?: string; limit?: number }) {
    const rows = await api<{
      units: { id: string; name: string; levelLabel: string; breadcrumb: string }[];
    }>('/api/v1/users/assignable-units', { query: opts });
    return rows.units.map((u) => ({
      value: u.id,
      label: u.name,
      description: `${u.levelLabel} · ${u.breadcrumb}`,
    }));
  }

  return { searchAssignableUnits };
}
