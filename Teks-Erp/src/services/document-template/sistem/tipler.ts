// =============================================================================
// Sistem şablonu ↔ Liquid eşleniği — TİP (plan §3.4, D2)
// =============================================================================
// Bugünkü TS renderer'ın tasarımcıda kopyalanabilir Liquid karşılığı. Kayıt `index.ts`te
// docType başına TEK satırdır; eşlenikleri T6 ekler, eşitlik bekçisi kilitler.
// CSS ve sayfa ayarı ayarın stil bölümünü taşır (ölçek, yoğunluk, kâğıt, kenar): Liquid'de
// aritmetik yok, bu yüzden kopya anında dondurulan `ayar`dan üretilirler (`materialize`).
// =============================================================================

import type { DocumentConfig } from "../../system-setting.service";
import type { ContractDocType, PrintInput } from "../sozlesme/tipler";

/** Ayarlı içerik: sabit değer ya da dondurulmuş ayardan (`ayarNormalize` çıktısı) üretilen. */
export type SettingsDerived<T> = T | ((settings: Readonly<Record<string, unknown>>) => T);

/** Eşitlik bekçisinin bir ayar varyantı — `config` Sistem'e ham `docConfigOverride` olarak gider. */
export interface EquivalenceVariant {
  name: string;
  config: DocumentConfig;
  /** Baskı girdisi eki (logo/QR data URL, basım damgası) — senaryonun `baski`sının üstüne biner. */
  print?: PrintInput;
}

export interface SystemEquivalent {
  docType: ContractDocType;
  editMode: "VISUAL" | "CODE";
  /** Görsel kipte data-* yönergeli HTML, kod kipinde ham Liquid. */
  html: string;
  css: SettingsDerived<string>;
  pageSettings: SettingsDerived<Record<string, unknown>>;
  tableBindings: Record<string, unknown>;
  /** Eşitlik bekçisi (`test_belge_sistem_esdegeri`) varsayılan ayarın yanında bunları da koşar. */
  variants?: readonly EquivalenceVariant[];
}

/** Kopyaya giden düz içerik — ayar dondurulduktan sonra. */
export interface MaterializedEquivalent {
  docType: ContractDocType;
  editMode: "VISUAL" | "CODE";
  html: string;
  css: string;
  pageSettings: Record<string, unknown>;
  tableBindings: Record<string, unknown>;
}
