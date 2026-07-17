export const DATABASE_HEALTH_FAILURE_MESSAGE = 'Database health check failed.'

export function databaseHealthFailure() {
  return {
    configured: true,
    ok: false,
    error: DATABASE_HEALTH_FAILURE_MESSAGE,
  }
}
