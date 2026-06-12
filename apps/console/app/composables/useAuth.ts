interface AuthUser {
  id: string;
  email: string;
  name: string;
  permissions: string[];
}

export function useAuth() {
  const config = useRuntimeConfig();
  const token = useCookie<string | null>('egrm_token', { sameSite: 'strict' });
  const user = useState<AuthUser | null>('auth_user', () => null);

  async function login(email: string, password: string) {
    const res = await $fetch<{ token: string; user: AuthUser }>('/api/v1/auth/login', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers: { 'x-tenant': config.public.tenant },
      body: { email, password },
    });
    token.value = res.token;
    user.value = res.user;
    return res.user;
  }

  async function fetchMe() {
    if (!token.value) return null;
    try {
      const res = await $fetch<{ user: AuthUser }>('/api/v1/me', {
        baseURL: config.public.apiBase,
        headers: { authorization: `Bearer ${token.value}`, 'x-tenant': config.public.tenant },
      });
      user.value = res.user;
      return res.user;
    } catch {
      token.value = null;
      user.value = null;
      return null;
    }
  }

  function logout() {
    token.value = null;
    user.value = null;
    return navigateTo('/login');
  }

  return { token, user, login, logout, fetchMe };
}
