// İSTEK KAPSAMI — isteğin hangi dinleyiciden geldiği (ERİŞİM'de Access kimliği de) işleyici boyunca taşınır.
// Sunucu kodu (src/) kapsamı YALNIZ `runInListenerScope` ile kurar (portal-http.ts `scopedHandler`; gövde ayrıştırıldıktan
// SONRA) — o yol CLI kapsamı AÇAMAZ. `runAsCli` (anahtar töreni, sertifika imzası) ve serbest kökenli `runInScope`
// yalnız scripts/ ve bekçiler içindir: src/ içinde anılmaları bekçi `test_imza_parolasi` §8'de kırmızıdır.
// Okuyucular: imza boğazı (keys/signing-scope.ts — kapsamsız imza RED) ve denetim (lib/audit.ts — ERİŞİM satırına e-posta).
import { AsyncLocalStorage } from "node:async_hooks";

export type ScopeOrigin = "TAILNET" | "ERISIM" | "GENEL" | "CLI";
/** Dinleyici kökenleri — sunucu kodunun kurabildiği TEK kapsamlar (CLI hariç). */
export type ListenerOrigin = Exclude<ScopeOrigin, "CLI">;
const LISTENER_ORIGINS: readonly ListenerOrigin[] = ["TAILNET", "ERISIM", "GENEL"];

export interface RequestScope {
  readonly origin: ScopeOrigin;
  /** Yalnız ERİŞİM: Access JWT'sinin DOĞRULANMIŞ e-postası. */
  readonly accessEmail: string | undefined;
  /** Oturum çözülünce yazılır (ERİŞİM yazma ayak izinin `yapan`ı). */
  actor: string | undefined;
  /** Kapsam içinde yazılan denetim satırı sayısı: sıfırsa ERİŞİM yazması genel ayak izi satırı alır. */
  audits: number;
}

const storage = new AsyncLocalStorage<RequestScope>();

function enter<T>(origin: ScopeOrigin, fn: () => T, accessEmail?: string): T {
  return storage.run({ origin, accessEmail, actor: undefined, audits: 0 }, fn);
}

/** Portal yönlendiricilerinin kapsamı: yalnız dinleyici kökeni (çalışma anında da denetlenir — CLI buradan açılmaz). */
export function runInListenerScope<T>(origin: ListenerOrigin, fn: () => T, accessEmail?: string): T {
  if (!LISTENER_ORIGINS.includes(origin)) throw new Error(`Dinleyici kapsamı değil: ${String(origin)}`);
  return enter(origin, fn, accessEmail);
}

/** YALNIZ scripts/ ve bekçiler: serbest kökenli kapsam (bekçi sondası). Sunucu kodu çağırmaz (bekçi ölçer). */
export function runInScope<T>(origin: ScopeOrigin, fn: () => T, accessEmail?: string): T {
  return enter(origin, fn, accessEmail);
}

/** YALNIZ scripts/: anahtar töreni, sertifika imzası, bekçi fikstürü — sunucu kodu bunu ÇAĞIRMAZ (bekçi ölçer). */
export function runAsCli<T>(fn: () => T): T {
  return enter("CLI", fn);
}

export function currentScope(): RequestScope | undefined {
  return storage.getStore();
}
