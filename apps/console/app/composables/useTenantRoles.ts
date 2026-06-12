/** Tenant role names from the live role table (synced from CD-10 on activate). */
export function useTenantRoles() {
  const { api } = useApi();
  const roleNames = useState<string[]>('tenant_role_names', () => []);

  async function loadRoleNames() {
    if (roleNames.value.length) return roleNames.value;
    try {
      const res = await api<{ roles: { name: string }[] }>('/api/v1/roles');
      roleNames.value = res.roles.map((r) => r.name).sort();
    } catch {
      roleNames.value = [];
    }
    return roleNames.value;
  }

  return { roleNames, loadRoleNames };
}
