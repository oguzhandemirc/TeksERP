// =============================================================================
// Sistem eşleniği ERİŞİMİ — `getSystemEquivalent` + `materializeEquivalent`
// =============================================================================
// Kayıt `index.ts`ten kurulur; aynı docType iki kez kayıtlıysa modül yüklenirken düşer.
// Eşleniği olmayan tür `null` döner — "Sistemden kopyala" o türde 409 `NO_SYSTEM_EQUIVALENT`.
// =============================================================================

import * as REGISTRY from "./index";
import type { MaterializedEquivalent, SettingsDerived, SystemEquivalent } from "./tipler";

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

/** Kayıtlı eşleniği olan türler — eşitlik bekçisi bu listeyi koşar. */
export const listSystemEquivalents = (): SystemEquivalent[] => [...EQUIVALENTS.values()];

const derive = <T>(v: SettingsDerived<T>, settings: Readonly<Record<string, unknown>>): T =>
  typeof v === "function" ? (v as (s: Readonly<Record<string, unknown>>) => T)(settings) : v;

/** Dondurulmuş ayarla düz içerik (kopya ve sistem görünümü bunu kullanır; tel JSON'u). */
export function materializeEquivalent(eq: SystemEquivalent, settings: Readonly<Record<string, unknown>>): MaterializedEquivalent {
  return {
    docType: eq.docType,
    editMode: eq.editMode,
    html: eq.html,
    css: derive(eq.css, settings),
    pageSettings: derive(eq.pageSettings, settings),
    tableBindings: eq.tableBindings,
  };
}
