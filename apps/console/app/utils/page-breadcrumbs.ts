import { domainMeta } from '~/utils/config-domains';

export interface PageBreadcrumbItem {
  label: string;
  to?: string;
  icon?: string;
}

const ICONS = {
  admin: 'i-lucide-shield',
  config: 'i-lucide-sliders-horizontal',
  settings: 'i-lucide-wrench',
  cases: 'i-lucide-inbox',
  dashboards: 'i-lucide-layout-dashboard',
  notifications: 'i-lucide-bell',
} as const;

export function breadcrumbsForPath(
  path: string,
  params: Record<string, string | string[]>,
  options?: { dashboardTitle?: string; multiDashboard?: boolean },
): PageBreadcrumbItem[] {
  const domain = typeof params.domain === 'string' ? params.domain : undefined;

  if (path === '/') {
    const title = options?.dashboardTitle;
    if (title && options?.multiDashboard) {
      return [
        { label: 'Dashboards', to: '/', icon: ICONS.dashboards },
        { label: title },
      ];
    }
    return [{ label: title ?? 'Dashboards', to: '/', icon: ICONS.dashboards }];
  }
  if (path === '/cases') return [{ label: 'Cases', to: '/cases', icon: ICONS.cases }];
  if (path === '/cases/new') {
    return [
      { label: 'Cases', to: '/cases', icon: ICONS.cases },
      { label: 'New case' },
    ];
  }
  if (path.startsWith('/cases/')) {
    return [
      { label: 'Cases', to: '/cases', icon: ICONS.cases },
      { label: 'Case' },
    ];
  }
  if (path === '/notifications') {
    return [{ label: 'Notifications', to: '/notifications', icon: ICONS.notifications }];
  }
  if (path === '/admin') return [{ label: 'Admin', to: '/admin', icon: ICONS.admin }];
  if (path === '/admin/config') {
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Configuration', to: '/admin/config', icon: ICONS.config },
    ];
  }
  if (path.startsWith('/admin/config/') && domain) {
    const meta = domainMeta(domain);
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Configuration', to: '/admin/config', icon: ICONS.config },
      { label: meta?.title ?? domain },
    ];
  }
  if (path === '/admin/settings') {
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Settings', to: '/admin/settings', icon: ICONS.settings },
    ];
  }
  if (path === '/admin/settings/users' || path === '/admin/users') {
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Settings', to: '/admin/settings', icon: ICONS.settings },
      { label: 'Users' },
    ];
  }
  if (path.startsWith('/admin/settings/users/') || path.startsWith('/admin/users/')) {
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Settings', to: '/admin/settings', icon: ICONS.settings },
      { label: 'Users', to: '/admin/settings/users' },
      { label: 'Workload' },
    ];
  }
  if (path === '/admin/settings/units' || path === '/admin/units') {
    return [
      { label: 'Admin', to: '/admin', icon: ICONS.admin },
      { label: 'Settings', to: '/admin/settings', icon: ICONS.settings },
      { label: 'Jurisdiction units' },
    ];
  }

  return [];
}
