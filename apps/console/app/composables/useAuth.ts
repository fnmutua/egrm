interface AuthUser {
  id: string;
  email: string;
  name: string;
  permissions: string[];
  manages_staff_users?: boolean;
  staff_user_management_full?: boolean;
  manageable_role_names?: string[];
}

export function useAuth() {
  const config = useRuntimeConfig();
  const token = useCookie<string | null>('egrm_token', {
    sameSite: 'lax',
    secure: !import.meta.dev,
  });
  const refreshToken = useCookie<string | null>('egrm_refresh', {
    sameSite: 'lax',
    secure: !import.meta.dev,
  });
  const user = useState<AuthUser | null>('auth_user', () => null);

  async function login(email: string, password: string) {
    const res = await $fetch<{
      token: string;
      refresh_token: string;
      user: AuthUser;
    }>('/api/v1/auth/login', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers: { 'x-tenant': config.public.tenant },
      body: { email, password },
    });
    token.value = res.token;
    refreshToken.value = res.refresh_token;
    user.value = res.user;
    return res.user;
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshToken.value) return null;
    try {
      const res = await $fetch<{ token: string; refresh_token: string }>('/api/v1/auth/refresh', {
        baseURL: config.public.apiBase,
        method: 'POST',
        headers: { 'x-tenant': config.public.tenant },
        body: { refresh_token: refreshToken.value },
      });
      token.value = res.token;
      refreshToken.value = res.refresh_token;
      return res.token;
    } catch {
      token.value = null;
      refreshToken.value = null;
      user.value = null;
      return null;
    }
  }

  async function fetchMe() {
    if (!token.value && refreshToken.value) {
      await refreshAccessToken();
    }
    if (!token.value) return null;
    try {
      const res = await $fetch<{ user: AuthUser }>('/api/v1/me', {
        baseURL: config.public.apiBase,
        headers: { authorization: `Bearer ${token.value}`, 'x-tenant': config.public.tenant },
      });
      user.value = res.user;
      return res.user;
    } catch {
      const refreshed = await refreshAccessToken();
      if (!refreshed) return null;
      try {
        const res = await $fetch<{ user: AuthUser }>('/api/v1/me', {
          baseURL: config.public.apiBase,
          headers: { authorization: `Bearer ${refreshed}`, 'x-tenant': config.public.tenant },
        });
        user.value = res.user;
        return res.user;
      } catch {
        token.value = null;
        refreshToken.value = null;
        user.value = null;
        return null;
      }
    }
  }

  function logout() {
    token.value = null;
    refreshToken.value = null;
    user.value = null;
    return navigateTo('/login');
  }

  return { token, refreshToken, user, login, logout, fetchMe, refreshAccessToken };
}
