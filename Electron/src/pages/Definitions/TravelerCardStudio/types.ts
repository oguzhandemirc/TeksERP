import type { TravelerCardConfig } from "@/services/featureFlagService";

/** Üç kademe — backend `TravelerTemplateMode` ile birebir. */
export type TravelerTemplateMode = "BUILTIN" | "SECTIONS" | "RAW_HTML";

export interface TravelerTemplate {
  id: string;
  name: string;
  mode: TravelerTemplateMode;
  isDefault: boolean;
  isActive: boolean;
  config: TravelerCardConfig;
  html: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Kartın gövde bölümleri — backend `traveler-card.sections.ts` ile aynı anahtarlar. */
export const SECTION_KEYS = [
  "header",
  "identity",
  "spec",
  "properties",
  "batches",
  "operations",
  "instructions",
  "orders",
  "footer",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SectionEntry {
  key: SectionKey;
  enabled?: boolean;
}

export const SECTION_LABELS: Record<SectionKey, { label: string; desc: string }> = {
  header: { label: "Antet", desc: "Firma adı, künye, KART NO, basım bilgisi" },
  identity: { label: "Kimlik + Karekod", desc: "İş emri no, tür/rota, ürün, okutulacak karekod" },
  spec: { label: "Özet Tablo", desc: "Renk / En / Hedef metraj / Kat tipi / tarihler" },
  properties: { label: "Özellikler", desc: "Hedef özellik rozetleri" },
  batches: { label: "Partiler", desc: "Parti no, top adedi, metraj, açık fason sevki" },
  operations: { label: "Operasyon Kaydı", desc: "İstasyon satırları + imza grid'i" },
  instructions: { label: "Talimatlar", desc: "Adım notları (boyahane talimatı vb.)" },
  orders: { label: "Bağlı Siparişler", desc: "Sipariş no, müşteri, ürün, renk, miktar" },
  footer: { label: "Alt Not", desc: "Kartın altına basılan serbest not" },
};

/**
 * Bölümün ESKİ görünürlük bayrağı (varsa). Stüdyodaki tek anahtar BU bayrağı
 * yazar — böylece "Refakat Kartı Ayarları" ekranıyla stüdyo aynı gerçeği söyler.
 * Bayrağı olmayan bölümlerde (`null`) `sections[].enabled` tek kapıdır.
 */
export const SECTION_LEGACY_FLAG: Record<SectionKey, keyof TravelerCardConfig | null> = {
  header: null,
  identity: null,
  spec: null,
  properties: "showProperties",
  batches: "showBatches",
  operations: "showOperationGrid",
  instructions: "showNotes",
  orders: "showOrders",
  footer: null,
};

/** Uzman modu ön-denetim sonucu (backend `inspect`). */
export interface TemplateInspection {
  stripped: string[];
  unknownKeys: string[];
}
