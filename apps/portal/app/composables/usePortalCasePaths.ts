/** Public portal paths for case reference deep links (SMS / email templates). */
export function usePortalCasePaths() {
  function appealPath(reference: string) {
    return `/appeal/${encodeURIComponent(reference.trim())}`;
  }

  function trackPath(reference: string) {
    return `/track?ref=${encodeURIComponent(reference.trim())}`;
  }

  return { appealPath, trackPath };
}
