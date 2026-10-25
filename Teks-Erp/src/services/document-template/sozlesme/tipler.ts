// =============================================================================
// Belge VERİ SÖZLEŞMESİ — tipler (plan §3.1)
// =============================================================================
// Tasarımcı şablonu (Liquid) belgeyi yalnız bu katmanın ürettiği DÜZ JSON
// bağlamından görür. Sözleşme yalnız BÜYÜR (alan silinmez, adı/türü değişmez,
// `ic → musteri` olmaz) — bekçi `scripts/test_belge_sozlesme.ts` özetle ölçer.
// =============================================================================

import type { PrintedDocType } from "@prisma/client";
import type { PrintedDocSnapshot } from "../../printed-document.service";

/** Sözleşmenin bağlandığı belge türü — donmuş belgeler + donmayan iki tür (plan §3.5). */
export type ContractDocType = `${PrintedDocType}` | "FREE_DOCUMENT" | "FASON_CEKI_DRAFT";

export type FieldType = "metin" | "sayi" | "tarih" | "tarih_saat" | "takvim" | "para" | "gorsel" | "mantiksal";

/** `ic` alan müşteri belgesinde VARSAYILANSIZDIR: yalnız `internalFields` opt-in'iyle bağlama girer. */
export type FieldClass = "musteri" | "ic";

export type SampleValue = string | number | boolean | null;

/** Tek alan. Kök alanda `yol` tam yoldur ("belge.no"); tablo kolonunda satır içi anahtardır ("ad"). */
export interface FieldDef {
  yol: string;
  etiket: string;
  tur: FieldType;
  ondalik?: number;
  birim?: string;
  sinif: FieldClass;
  /** Veri ağacı ve tamamlama için örnek değer. */
  ornek: SampleValue;
  /** Yalnız `sinif: "ic"`: `internalFields` ve `ic_acik.<kod>` anahtarı. */
  icKod?: string;
}

/** Tablo kolonu — `DocColSpec` eşi. */
export interface TableColumnDef extends FieldDef {
  hiza: "l" | "r" | "c";
  /** Sistem renderer'ındaki kolon anahtarı — `ayar.columns` ve `columns.*.shown` eşlemesi. */
  kaynakKolon?: string;
  /** Toplam satırında basılan `toplamlar.<anahtar>`. */
  toplam?: string;
}

export interface TableDef {
  /** `tablolar.<anahtar>` — satır dizisi. */
  anahtar: string;
  etiket: string;
  kolonlar: TableColumnDef[];
}

export type ConfigFieldType = "metin" | "sayi" | "mantiksal" | "secim" | "liste" | "nesne";

/** `ayar` şemasının bir yaprağı; `yol` `ayar.` önekisizdir. */
export interface ConfigFieldDef {
  yol: string;
  etiket: string;
  tur: ConfigFieldType;
  secenekler?: readonly string[];
}

/** `ayar.kolonlar.<tablo>` öğesi — ayara göre görünür, sıralı, başlığı çözülmüş kolon. */
export interface ColumnView {
  /** Satırdaki alan anahtarı (`tablolar.<t>[].<anahtar>`). */
  anahtar: string;
  /** Sistem renderer'ındaki kolon anahtarı. */
  kaynak: string;
  /** Başlık — ham metin (şablon kaçırır); boş = başlıksız kolon. */
  etiket: string;
  hiza: "l" | "r" | "c";
  /** Toplam satırı hücresi `toplamlar.<toplam>`; toplamsız kolonda null. */
  toplam: string | null;
}

/** Render anında servis katmanının verdiği, donmuş snapshot'ta OLMAYAN bilgiler. */
export interface PrintInput {
  surum?: number | null;
  durum?: "ACTIVE" | "VOIDED" | "SUPERSEDED" | null;
  taslak?: boolean;
  iptalNedeni?: string | null;
  /** Basım anı (ISO); şablon `tarih_saat` filtresiyle fabrika diliminde basar. */
  zaman?: string | null;
  basan?: string | null;
  /** Tek seferlik baskı notu (hiçbir yere yazılmaz). */
  not?: string | null;
  /** Snapshot `logoHash`inin çözülmüş data URL'i. */
  logo?: string | null;
  /** Doğrulama karekodu data URL'i. */
  qr?: string | null;
}

export interface BuildExtras<C> {
  baski?: PrintInput;
  /** Belgeye özel canlı ayarlar (ör. sevk ad rejimi) — her baskıda okunur, donmaz. */
  canli?: C;
}

export type ContextValue = string | number | boolean | null | ContextValue[] | { [k: string]: ContextValue };
export type ContextObject = { [k: string]: ContextValue };

/** Şablonun gördüğü bağlam — kökler sabittir; düz JSON (undefined/prototip yok). */
export interface TemplateContext {
  belge: ContextObject;
  firma: ContextObject;
  karsi_taraf: ContextObject;
  tablolar: { [anahtar: string]: ContextObject[] };
  toplamlar: ContextObject;
  ayar: ContextObject;
  ic_acik: { [kod: string]: boolean };
  baski: ContextObject;
}

export const CONTEXT_ROOTS = [
  "belge",
  "firma",
  "karsi_taraf",
  "tablolar",
  "toplamlar",
  "ayar",
  "ic_acik",
  "baski",
] as const satisfies readonly (keyof TemplateContext)[];

/** `S`: render kaynağı — donmuş belgede zarf; refakat kartı/serbest belgede canlı kaynak (P-e). */
export interface Scenario<C, S = PrintedDocSnapshot> {
  ad: string;
  aciklama: string;
  snapshot: S;
  ek?: BuildExtras<C>;
}

/**
 * Bir belge türünün sözleşmesi. `contractVersion` var olan türe alan eklendikçe
 * artar (şablon sürümü doğduğu sözleşme sürümünü damgalar); özet bekçisi ölçer.
 */
export interface DocumentContract<A extends object = object, C = unknown, S = PrintedDocSnapshot> {
  docType: ContractDocType;
  hedef: "musteri" | "ic";
  contractVersion: number;
  /** `tablolar` ve `ic_acik` dışındaki kök alanlar (belge/firma/karsi_taraf/toplamlar/baski). */
  kokler: FieldDef[];
  tablolar: TableDef[];
  ayarSemasi: ConfigFieldDef[];
  /** Ham ayar (DocumentConfig biçimi, kısmi/bozuk olabilir) → eksiksiz ayar; idempotent. */
  ayarNormalize(raw: unknown): A;
  insa(snapshot: S, ayar: unknown, internalFields: readonly string[], ek?: BuildExtras<C>): TemplateContext;
  senaryolar(): Scenario<C, S>[];
}
