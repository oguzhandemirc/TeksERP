/**
 * Lisans kapısı sinyali — `apiClient` bir `LICENSE_*` 403'ü gördüğünde durum
 * sorgusu hemen tazelenir (kilit/bant bir sonraki yoklamayı beklemesin).
 * React'e bağlı değil: interceptor modül düzeyinde yaşar.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function notifyLicenseGate(): void {
  for (const l of listeners) l();
}

export function onLicenseGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
