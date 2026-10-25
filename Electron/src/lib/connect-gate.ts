// Renderer ayağı — istek atmadan ÖNCE hedef kökeni ana sürecin connect-src kümesine bildirir
// (`shared/connect-gate.ts`). Köken başına bir kez (söz önbelleği); tarayıcı derlemesinde köprü yok → no-op.
import { connectOrigin } from "@shared/connect-gate";

const pending = new Map<string, Promise<void>>();

export function ensureConnectOrigin(url: string | undefined | null): Promise<void> {
  const gate = typeof window !== "undefined" ? window.api?.connectGate : undefined;
  if (!gate || !url) return Promise.resolve();
  const origin = connectOrigin(url);
  if (!origin) return Promise.resolve();
  let p = pending.get(origin);
  if (!p) {
    // Bildirim düşerse istek yine gider ve kapıda kesilir (fail-closed); tekrar denensin diye önbellekten çıkar.
    p = gate.allow(url).then(
      () => undefined,
      () => {
        pending.delete(origin);
      },
    );
    pending.set(origin, p);
  }
  return p;
}

/** Yalnız test. */
export function resetConnectGateCacheForTest(): void {
  pending.clear();
}
