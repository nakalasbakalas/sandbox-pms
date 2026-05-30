const env = import.meta.env ?? {}

export const SERVER_AUTH_ENABLED = env.VITE_PMS_API_MODE === 'server'
export const LOCAL_AUTH_FALLBACK_ENABLED = env.DEV === true && !SERVER_AUTH_ENABLED

export function normalizeAuthEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}
