import { breadcrumbsForPath, type PageBreadcrumbItem } from '~/utils/page-breadcrumbs';

export function usePageBreadcrumbs() {
  const route = useRoute();
  const { visibleDashboards } = useDashboards();
  const override = useState<{ key: string; items: PageBreadcrumbItem[] } | null>(
    'page_breadcrumb_override',
    () => null,
  );

  const items = computed(() => {
    if (override.value?.key === route.fullPath) return override.value.items;

    const dashId = route.query.d as string | undefined;
    const dash = visibleDashboards.value.find((d) => d.id === dashId) ?? visibleDashboards.value[0];

    return breadcrumbsForPath(route.path, route.params, {
      dashboardTitle: dash?.title,
      multiDashboard: visibleDashboards.value.length > 1,
    });
  });

  function setPageBreadcrumb(items: PageBreadcrumbItem[]) {
    override.value = { key: route.fullPath, items };
  }

  function clearPageBreadcrumb() {
    override.value = null;
  }

  return { items, setPageBreadcrumb, clearPageBreadcrumb };
}
