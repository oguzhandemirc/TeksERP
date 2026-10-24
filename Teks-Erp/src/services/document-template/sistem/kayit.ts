// =============================================================================
// Sistem eşleniği ERİŞİMİ — `getSystemEquivalent`
// =============================================================================
// Kayıt `index.ts`ten kurulur; aynı docType iki kez kayıtlıysa modül yüklenirken düşer.
// Eşleniği olmayan tür `null` döner — "Sistemden kopyala" o türde 409 `NO_SYSTEM_EQUIVALENT`.
// =============================================================================

import * as REGISTRY from "./index";
import type { SystemEquivalent } from "./tipler";

export type SystemEquivalentLookup = (docType: string) => SystemEquivalent | null;

const EQUIVALENTS: ReadonlyMap<string, SystemEquivalent> = (() => {
  const m = new Map<string, SystemEquivalent>();
  for (const e of Object.values(REGISTRY as Record<string, unknown>) as SystemEquivalent[]) {
    if (m.has(e.docType)) throw new Error(`Sistem eşleniği iki kez kayıtlı: ${e.docType}`);
    m.set(e.docType, e);
  }
  return m;
})();

export const getSystemEquivalent: SystemEquivalentLookup = (docType) => EQUIVALENTS.get(docType) ?? null;
