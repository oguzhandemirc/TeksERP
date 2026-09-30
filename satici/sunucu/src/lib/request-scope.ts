// İSTEK KAPSAMI — isteğin hangi dinleyiciden geldiği (ERİŞİM'de Access kimliği de) işleyici boyunca taşınır.
// Kapsamı portal yönlendiricileri kurar (portal-http.ts `scopedHandler`; gövde ayrıştırıldıktan SONRA); CLI kapsamı
// yalnız scripts/'ten (`runAsCli`). Okuyucular: imza boğazı (keys/signing-scope.ts — kapsamsız imza RED) ve denetim
// (lib/audit.ts — ERİŞİM'den gelen her satıra Access e-postası).
import { AsyncLocalStorage } from "node:async_hooks";

export type ScopeOrigin = "TAILNET" | "ERISIM" | "GENEL" | "CLI";

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

export function runInScope<T>(origin: ScopeOrigin, fn: () => T, accessEmail?: string): T {
  return storage.run({ origin, accessEmail, actor: undefined, audits: 0 }, fn);
}

/** Satıcı CLI'ı (scripts/): anahtar töreni, sertifika imzası, bekçi fikstürü — sunucu kodu bunu ÇAĞIRMAZ. */
export function runAsCli<T>(fn: () => T): T {
  return runInScope("CLI", fn);
}

export function currentScope(): RequestScope | undefined {
  return storage.getStore();
}
