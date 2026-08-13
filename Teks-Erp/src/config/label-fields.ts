// =============================================================================
// TeksERP - Etiket Field Catalog (source of truth)
// =============================================================================
// Her LabelKind için hangi field key'ler izinli ve default Türkçe başlıkları
// nedir — burada tanımlı. LabelTemplateService bu catalog ile validate eder
// (whitelist), frontend de buradan gelen liste üzerinden UI render eder.
// Yeni alan eklemek için: önce buraya, sonra label payload builder'a, sonra
// frontend renderer'a.
// =============================================================================

import { LabelKind } from "@prisma/client";

export type FontSize = "sm" | "md" | "lg" | "xl";

export const FONT_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"] as const;

export interface FieldDef {
  /** Payload'daki key — backend bu key'in değerini döner. */
  key: string;
  /** Default Türkçe başlık (template'te override edilebilir). */
  defaultLabel: string;
  /** UX ipucu — tip bilgisi: text/number/date/qr/barcode. Frontend render seçimi için. */
  type: "text" | "number" | "date" | "qr" | "barcode" | "table";
  /** Bu alan kapatılabilir mi? false ise template'te isVisible=true zorunlu (örn. barkod). */
  required?: boolean;
}

export interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: FontSize;
}

// =============================================================================
// ROLL_RAW — KK1 ham mal kabul etiketi
// =============================================================================
// Sade etiket: renk yok, müşteri/sipariş bağı yok. KK1'de basılır, ham kumaş
// stoğa girerken yapışır. Üretim akışında Kurşun/Tambur'da topla beraber gezer.
// =============================================================================
export const ROLL_RAW_FIELDS: readonly FieldDef[] = [
  { key: "barcode",         defaultLabel: "Barkod",            type: "barcode" },
  { key: "qrCode",          defaultLabel: "QR Kod",            type: "qr" },
  { key: "itemName",        defaultLabel: "Ürün",              type: "text" },
  { key: "itemCode",        defaultLabel: "Ürün Kodu",         type: "text" },
  { key: "qualityGrade",    defaultLabel: "Kalite",            type: "text" },
  { key: "widthCm",         defaultLabel: "En (cm)",           type: "number" },
  { key: "lengthMeters",    defaultLabel: "Metraj (m)",        type: "number" },
  { key: "weightKg",        defaultLabel: "Ağırlık (kg)",      type: "number" },
  // KAT — katalog KODU basılır ("6-KAT"/"TUP"), ad değil (bkz. LabelPayload.foldType).
  { key: "foldType",        defaultLabel: "Kat",               type: "text" },
  { key: "printedAt",       defaultLabel: "Baskı Tarihi",      type: "date" },
] as const;

// =============================================================================
// ROLL_FINISHED — Tambur sonrası bitmiş kumaş etiketi
// =============================================================================
// Renk + müşteri + sipariş + alias dahil tam set. Tambur'dan finalize çıkışında
// her top için ayrı basılır; sevkiyat öncesi son fiziksel iz.
// =============================================================================
export const ROLL_FINISHED_FIELDS: readonly FieldDef[] = [
  { key: "barcode",          defaultLabel: "Barkod",                 type: "barcode" },
  { key: "qrCode",           defaultLabel: "QR Kod",                 type: "qr" },
  { key: "itemName",         defaultLabel: "Ürün (müşterideki ad)",  type: "text" },
  { key: "itemNameDefault",  defaultLabel: "Ürün (bizdeki ad)",      type: "text" },
  { key: "itemCode",         defaultLabel: "Ürün Kodu",              type: "text" },
  { key: "colorName",        defaultLabel: "Renk (müşterideki ad)",  type: "text" },
  { key: "colorNameDefault", defaultLabel: "Renk (bizdeki ad)",      type: "text" },
  { key: "colorCode",        defaultLabel: "Renk Kodu",              type: "text" },
  { key: "qualityGrade",     defaultLabel: "Kalite",                 type: "text" },
  { key: "widthCm",          defaultLabel: "En (cm)",                type: "number" },
  { key: "lengthMeters",     defaultLabel: "Metraj (m)",             type: "number" },
  { key: "weightKg",         defaultLabel: "Ağırlık (kg)",           type: "number" },
  // KAT — bitmiş topta da basılabilir; kesimde SEÇİLEN değer topun üstünde kalıcıdır
  // (miras alınmaz), yani etikete basılan kat o parçanın gerçeğidir.
  { key: "foldType",         defaultLabel: "Kat",                    type: "text" },
  { key: "customerName",     defaultLabel: "Müşteri",                type: "text" },
  { key: "orderNumber",      defaultLabel: "Sipariş No",             type: "text" },
  { key: "batchNumber",      defaultLabel: "Parti No",               type: "text" },
  { key: "workOrderNumber",  defaultLabel: "İş Emri No",             type: "text" },
  // Kartelalık damgası — top Tambur'da kartela için işaretlendiyse (markedForKartela)
  // etiketin üstünde belirgin mor şerit basılır. Yalnız işaretli topta görünür;
  // bu alan template'te kapatılırsa işaretli toplarda da basılmaz.
  { key: "kartelaMark",      defaultLabel: "Kartelalık",             type: "text" },
  { key: "printedAt",        defaultLabel: "Baskı Tarihi",           type: "date" },
] as const;

// =============================================================================
// SWATCH — Kartela
// =============================================================================
export const SWATCH_FIELDS: readonly FieldDef[] = [
  { key: "barcode",           defaultLabel: "Barkod",                 type: "barcode" },
  { key: "qrCode",            defaultLabel: "QR Kod",                 type: "qr" },
  { key: "cardNumber",        defaultLabel: "Kart No",                type: "text" },
  { key: "itemName",          defaultLabel: "Ürün (müşterideki ad)",  type: "text" },
  { key: "itemNameDefault",   defaultLabel: "Ürün (bizdeki ad)",      type: "text" },
  { key: "itemCode",          defaultLabel: "Ürün Kodu",              type: "text" },
  { key: "colorName",         defaultLabel: "Renk (müşterideki ad)",  type: "text" },
  { key: "colorNameDefault",  defaultLabel: "Renk (bizdeki ad)",      type: "text" },
  { key: "colorCode",         defaultLabel: "Renk Kodu",              type: "text" },
  { key: "widthCm",           defaultLabel: "En (cm)",          type: "number" },
  { key: "lengthCm",          defaultLabel: "Boy (cm)",         type: "number" },
  { key: "weightKg",          defaultLabel: "Ağırlık (kg)",     type: "number" },
  { key: "customerName",      defaultLabel: "Müşteri",          type: "text" },
  { key: "batchNumber",       defaultLabel: "Parti No",         type: "text" },
  { key: "parentRollBarcode", defaultLabel: "Ana Top Barkodu",  type: "text" },
  { key: "printedAt",         defaultLabel: "Baskı Tarihi",     type: "date" },
] as const;

// =============================================================================
// SACK — Çuval etiketi
// =============================================================================
// Çuvala yapışan etiket. Barkod + QR = `Sack.sackNo` (CV+GGAAYY+NNNN) — Sack'te
// ayrı `barcode` kolonu YOK, "tek kod" kuralı (code-format.ts).
//
// ÜRÜN/RENK ALANI YOK, bilinçli: bir çuvalda N farklı kumaş/renk olabilir; tek bir
// ürün adı basmak karışık çuvalda SESSİZCE yanlış olur. Çuval etiketi bir TOPLAM
// belgesidir: kaç top, kaç metre, kaç kg, kimin için.
//
// Terminoloji kök CLAUDE.md standardı: "ÇUVAL NO" / "TOP ADEDİ".
// =============================================================================
export const SACK_FIELDS: readonly FieldDef[] = [
  { key: "barcode",      defaultLabel: "Barkod",        type: "barcode" },
  { key: "qrCode",       defaultLabel: "QR Kod",        type: "qr" },
  { key: "sackNo",       defaultLabel: "Çuval No",      type: "text" },
  { key: "rollCount",    defaultLabel: "Top Adedi",     type: "number" },
  { key: "lengthMeters", defaultLabel: "Toplam Metraj", type: "number" },
  { key: "weightKg",     defaultLabel: "Brüt Ağırlık (kg)", type: "number" },
  { key: "customerName", defaultLabel: "Müşteri",       type: "text" },
  { key: "branchName",   defaultLabel: "Şube",          type: "text" },
  // Çuval notu — iç not. Şablona SÜRÜKLENMEZSE basılmaz (kanvas modeli gereği
  // varsayılan kapalı); not boşsa eleman baskıda atlanır (present:false).
  { key: "sackNote",     defaultLabel: "Çuval Notu",    type: "text" },
  { key: "printedAt",    defaultLabel: "Baskı Tarihi",  type: "date" },
] as const;

// =============================================================================
// Aggregation + lookup
// =============================================================================

export const FIELD_CATALOG: Record<LabelKind, readonly FieldDef[]> = {
  [LabelKind.ROLL_RAW]:      ROLL_RAW_FIELDS,
  [LabelKind.ROLL_FINISHED]: ROLL_FINISHED_FIELDS,
  [LabelKind.SWATCH]:        SWATCH_FIELDS,
  [LabelKind.SACK]:          SACK_FIELDS,
};

export function getAllowedKeys(kind: LabelKind): Set<string> {
  return new Set(FIELD_CATALOG[kind].map((f) => f.key));
}

export function getRequiredKeys(kind: LabelKind): Set<string> {
  return new Set(FIELD_CATALOG[kind].filter((f) => f.required).map((f) => f.key));
}

export function findFieldDef(kind: LabelKind, key: string): FieldDef | null {
  return FIELD_CATALOG[kind].find((f) => f.key === key) ?? null;
}

/**
 * Catalog'daki TÜM alanları visible=true + ardışık order ile döner.
 * Yeni template oluştururken "sıfırdan iyi bir başlangıç" üretir.
 */
export function buildDefaultFields(kind: LabelKind): TemplateField[] {
  return FIELD_CATALOG[kind].map((f, idx) => ({
    key: f.key,
    label: f.defaultLabel,
    order: idx + 1,
    isVisible: true,
  }));
}

// =============================================================================
// BİRLEŞİK KATALOG (Etiket Stüdyosu v2 — tek havuz)
// =============================================================================
// Üç bağlamın alan kümelerinin birleşimi + her alanın hangi bağlamlarda DEĞER
// ürettiği. Kanvas editörü bu listeden eleman ekler; bağlam-dışı alan baskıda
// boş kalır (present:false → eleman atlanır). TEMBEL kurulur — modül-üstü yeni
// enum derefi eklememek için (TDZ kuralı).

export interface UnifiedFieldDef extends FieldDef {
  /** Bu alanın değer ürettiği bağlamlar. */
  kinds: LabelKind[];
  /**
   * Bağlama özel başlık — YALNIZ ilk tanımdan FARKLI olan bağlamlar için dolu.
   * Aynı key birden çok bağlamda yaşayabilir (`weightKg` top'ta "Ağırlık (kg)",
   * çuvalda "Brüt Ağırlık (kg)"); birleşik katalog ilk tanımı sakladığı için
   * çuval etiketi tasarlayan kişi jenerik adı görüyor ve alanı bulamıyordu.
   * Stüdyo paleti seçili bağlamda bunu tercih eder.
   */
  labelByKind?: Partial<Record<LabelKind, string>>;
}

let unifiedCache: UnifiedFieldDef[] | null = null;

export function getUnifiedCatalog(): UnifiedFieldDef[] {
  if (unifiedCache) return unifiedCache;
  const byKey = new Map<string, UnifiedFieldDef>();
  for (const kind of Object.keys(FIELD_CATALOG) as LabelKind[]) {
    for (const def of FIELD_CATALOG[kind]) {
      const existing = byKey.get(def.key);
      if (existing) {
        existing.kinds.push(kind);
        // Bağlam başlığı ilk tanımdan farklıysa kaydet (palet onu gösterir).
        if (def.defaultLabel !== existing.defaultLabel) {
          existing.labelByKind = { ...existing.labelByKind, [kind]: def.defaultLabel };
        }
      } else {
        byKey.set(def.key, { ...def, kinds: [kind] });
      }
    }
  }
  unifiedCache = [...byKey.values()];
  return unifiedCache;
}

/** Birleşik katalogdaki tüm izinli bind anahtarları (kanvas field elemanı için). */
export function getUnifiedKeys(): Set<string> {
  return new Set(getUnifiedCatalog().map((f) => f.key));
}
