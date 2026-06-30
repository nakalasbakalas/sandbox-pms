export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function safeCssColor(value: unknown, fallback = '#000000'): string {
  const color = String(value ?? '').trim()
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback
}
