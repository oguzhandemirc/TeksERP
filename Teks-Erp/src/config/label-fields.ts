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
import { TERIM } from "../constants/terim";

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
  /** false → yeni şablonda ve eski kayıtlı şablonlarda KAPALI doğar (opt-in alan). */
  defaultVisible?: boolean;
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
  // Müşterinin GELEN BELGESİNDEKİ kumaş adı/rengi (hizmet ekseni E3) — ham metin, Tambur çocuğunda ata topun
  // satırından. OPT-IN: şablonda açılmadıkça basılmaz (müşteri metni bizim ürün adımızın yerine geçmez).
  { key: "deliveryNoteItemText",  defaultLabel: "Kumaş (müşteri belgesindeki)", type: "text", defaultVisible: false },
  { key: "deliveryNoteColorText", defaultLabel: "Renk (müşteri belgesindeki)",  type: "text", defaultVisible: false },
  { key: "deliveryNoteRollNo",    defaultLabel: "Müşteri top no",               type: "text", defaultVisible: false },
  { key: "customerCode",          defaultLabel: "Müşteri barkodu",              type: "text", defaultVisible: false },
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
  { key: "workOrderNumber",  defaultLabel: `${TERIM.terbiyeIsEmri.tekil} No`, type: "text" },
  // Kartelalık damgası — top Tambur'da kartela için işaretlendiyse (markedForKartela)
  // etiketin üstünde belirgin mor şerit basılır. Yalnız işaretli topta görünür;
  // bu alan template'te kapatılırsa işaretli toplarda da basılmaz.
  { key: "kartelaMark",      defaultLabel: "Kartelalık",             type: "text" },
  // Açık (kararsız) hatalar — tambursuz rotada bilgi (KQ-D8). OPT-IN: şablonda açılmadıkça basılmaz.
  { key: "openDefects",      defaultLabel: "Hata Notu",              type: "text", defaultVisible: false },
  // Müşterinin GELEN BELGESİNDEKİ kumaş adı/rengi (hizmet ekseni E3) — ham metin, Tambur çocuğunda ata topun
  // satırından. OPT-IN: şablonda açılmadıkça basılmaz (müşteri metni bizim ürün adımızın yerine geçmez).
  { key: "deliveryNoteItemText",  defaultLabel: "Kumaş (müşteri belgesindeki)", type: "text", defaultVisible: false },
  { key: "deliveryNoteColorText", defaultLabel: "Renk (müşteri belgesindeki)",  type: "text", defaultVisible: false },
  { key: "deliveryNoteRollNo",    defaultLabel: "Müşteri top no",               type: "text", defaultVisible: false },
  { key: "customerCode",          defaultLabel: "Müşteri barkodu",              type: "text", defaultVisible: false },
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
  // Sevk partisi (2026-09-21): parti içi ambalaj no + parti adı. Opt-in — şablona
  // sürüklenmezse basılmaz; partisiz çuvalda boş → eleman atlanır (present:false).
  { key: "packageNo",    defaultLabel: "Ambalaj No",    type: "number" },
  { key: "packingGroupName", defaultLabel: "Sevk Partisi", type: "text" },
  { key: "printedAt",    defaultLabel: "Baskı Tarihi",  type: "date" },
] as const;

// =============================================================================
// MACHINE — Tezgah etiketi (dokuma manuel veri S1b, D3)
// =============================================================================
// Operatör topa yapıştırır, KK1 okutur → top hangi tezgahtan çıktı. Barkod + QR =
// `Machine.code` (ayrı barkod kolonu YOK — tek kod kuralı). Kimlik alanı
// `machineCode`: şablon onu bağlamadıkça etiket basılmaz (IDENTITY_BIND, fail-closed).
// =============================================================================
export const MACHINE_FIELDS: readonly FieldDef[] = [
  { key: "barcode",     defaultLabel: "Barkod",       type: "barcode" },
  { key: "qrCode",      defaultLabel: "QR Kod",       type: "qr" },
  { key: "machineCode", defaultLabel: "Tezgah Kodu",  type: "text", required: true },
  { key: "machineName", defaultLabel: "Tezgah Adı",   type: "text" },
  { key: "stationName", defaultLabel: "Dokuma Holü",  type: "text" },
  { key: "printedAt",   defaultLabel: "Baskı Tarihi", type: "date" },
] as const;

// =============================================================================
// WARP_BEAM — Levent etiketi (dokuma manuel veri S1b, D12)
// =============================================================================
// Levente yapışır; barkod + QR = `WarpBeam.beamNo` (LV+GGAAYY+NNNN, tek kod).
// Sarım gerçekleri (metre/kg/tarih) iptal edilmemiş WOUND satırından gelir; sarılmamış
// (PLANNED) leventte boş → eleman baskıda atlanır (present:false).
// =============================================================================
export const WARP_BEAM_FIELDS: readonly FieldDef[] = [
  { key: "barcode",            defaultLabel: "Barkod",            type: "barcode" },
  { key: "qrCode",             defaultLabel: "QR Kod",            type: "qr" },
  { key: "beamNo",             defaultLabel: "Levent No",         type: "text", required: true },
  { key: "physicalBeamNo",     defaultLabel: "Gövde No",          type: "text" },
  { key: "warpSpecCode",       defaultLabel: "Çözgü Kartı Kodu",  type: "text" },
  { key: "warpSpecName",       defaultLabel: "Çözgü Kartı",       type: "text" },
  { key: "plannedLengthM",     defaultLabel: "Plan Metre",        type: "number" },
  { key: "woundLengthM",       defaultLabel: "Sarılan Metre",     type: "number" },
  { key: "woundKg",            defaultLabel: "Sarılan kg",        type: "number" },
  { key: "weavingOrderNumber", defaultLabel: "Dokuma İş Emri No", type: "text" },
  { key: "itemName",           defaultLabel: "Kumaş",             type: "text" },
  { key: "woundAt",            defaultLabel: "Sarım Tarihi",      type: "date" },
  { key: "printedAt",          defaultLabel: "Baskı Tarihi",      type: "date" },
] as const;

// =============================================================================
// Aggregation + lookup
// =============================================================================

export const FIELD_CATALOG: Record<LabelKind, readonly FieldDef[]> = {
  [LabelKind.ROLL_RAW]:      ROLL_RAW_FIELDS,
  [LabelKind.ROLL_FINISHED]: ROLL_FINISHED_FIELDS,
  [LabelKind.SWATCH]:        SWATCH_FIELDS,
  [LabelKind.SACK]:          SACK_FIELDS,
  [LabelKind.MACHINE]:       MACHINE_FIELDS,
  [LabelKind.WARP_BEAM]:     WARP_BEAM_FIELDS,
};

/**
 * Sağ dikey METRAJ BANDI bu bağlamda anlamlı mı — yalnız TOP etiketleri (ROLL_*) ve
 * türsüz (deprecated `kind` null) şablon. Kartela/çuval/tezgah/levent tek-top metrajı
 * taşımaz. TEK KAYNAK: varsayılan tasarım (`getTemplateDefaults`) ve akış→kanvas
 * dönüşümü buradan sorar. Literal karşılaştırma: modül-üstü enum deref'i yok (TDZ).
 */
export function kindHasLengthBanner(kind: LabelKind | null | undefined): boolean {
  return kind == null || kind === ("ROLL_RAW" as LabelKind) || kind === ("ROLL_FINISHED" as LabelKind);
}

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
    isVisible: f.defaultVisible !== false,
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

/**
 * Eski panelin (S1b öncesi, ≤1.6.x) tanıdığı bağlamlar. O sürümlerin eleman paleti
 * `labelKindLabels[k].split(...)` yazar → bilinmeyen tür (MACHINE/WARP_BEAM) Etiket
 * Stüdyosu'nu ÇÖKERTİR (ölçüldü: ElementPalette). Birleşik katalog `?kinds=all`
 * istemeyen istemciye yalnız bu bağlamlarla döner — eski panel bugünkü yanıtı BAYT-AYNI
 * alır; yeni panel `kinds=all` gönderir ve bilinmeyen türde ham ada düşer (fail-soft).
 */
export const LEGACY_PANEL_LABEL_KINDS: ReadonlySet<string> = new Set(["ROLL_RAW", "ROLL_FINISHED", "SWATCH", "SACK"]);

/** Katalogu verilen bağlam kümesine daraltır: `kinds` ve `labelByKind` süzülür, bağlamı kalmayan alan düşer. */
export function catalogForKinds(fields: readonly UnifiedFieldDef[], allowed: ReadonlySet<string>): UnifiedFieldDef[] {
  return fields.flatMap((f) => {
    const kinds = f.kinds.filter((k) => allowed.has(k));
    if (kinds.length === 0) return [];
    const byKind = Object.entries(f.labelByKind ?? {}).filter(([k]) => allowed.has(k));
    return [{ ...f, kinds, labelByKind: byKind.length ? (Object.fromEntries(byKind) as UnifiedFieldDef["labelByKind"]) : undefined }];
  });
}

/** Birleşik katalogdaki tüm izinli bind anahtarları (kanvas field elemanı için). */
export function getUnifiedKeys(): Set<string> {
  return new Set(getUnifiedCatalog().map((f) => f.key));
}
