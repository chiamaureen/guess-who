export function realtimeEnabled(environment: { VITE_ENABLE_REALTIME?: string } = import.meta.env) {
  return environment.VITE_ENABLE_REALTIME === 'true'
}
