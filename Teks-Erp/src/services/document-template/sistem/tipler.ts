// =============================================================================
// Sistem şablonu ↔ Liquid eşleniği — TİP (plan §3.4, D2)
// =============================================================================
// Bugünkü TS renderer'ın tasarımcıda kopyalanabilir Liquid karşılığı. Kayıt `index.ts`te
// docType başına TEK satırdır; eşlenikleri T6 ekler, eşitlik bekçisi kilitler.
// =============================================================================

import type { ContractDocType } from "../sozlesme/tipler";

export interface SystemEquivalent {
  docType: ContractDocType;
  editMode: "VISUAL" | "CODE";
  /** Görsel kipte data-* yönergeli HTML, kod kipinde ham Liquid. */
  html: string;
  css: string;
  pageSettings: Record<string, unknown>;
  tableBindings: Record<string, unknown>;
}
