// =============================================================================
// Refakat kartı — TEK TABLO ayar modeli (satır kataloğu + okuma/yazma)
// =============================================================================
// 2026-08-05 kullanıcı kararı: görünürlük ve stil AYRI bölümlerde durmasın.
// Tek tablo, her satırda solda onay kutusu, sağında sayısal punto + kalınlık.
//
// ⚠️ ARKADA İKİ DEPO VAR, kullanıcı bunu GÖRMEZ ve görmesi de gerekmez:
//
//   kind:"field" → `config.fields[key]`  — kartın TEKİL yüzeyleri (firma adı,
//       İŞ EMRİ NO, bölüm başlıkları, filigran…). Backend CSS kuralı basar.
//       Görünürlük = `hidden`, punto = `size`.
//   kind:"cell"  → `config.specFields/orderFields/batchFields[key]` ve
//       `config.orderTotal/batchTotal` — TABLO HÜCRELERİ. Backend hücre-başına
//       INLINE basar (sütun sütun farklı olabilsin diye) ve inline CSS'i ezer,
//       bu yüzden `fields`e taşınamazlar. Görünürlük = `show`, punto = `px`.
//
// Backend tek kaynağı: `Teks-Erp/src/services/document-render/traveler-card.fields.ts`
// (seçici + yoğunluk profilinden gelen taban punto). Electron backend'i import
// EDEMEZ — burada yalnız ANAHTAR ve panel ETİKETİ aynalanır; seçici/taban
// değerler BİLEREK kopyalanmaz, çünkü sayfa boyutuna bağlıdırlar ve iki yerde
// tutulursa sessizce ayrışırlar.
//
// ⚠️ İKİ YER BİRLİKTE GÜNCELLENİR. Buraya yazılmayan anahtar panelde GÖRÜNMEZ
// (ayar var, kapısı yok); backend'e yazılmayan anahtar sanitize'dan geçer ama
// hiçbir CSS üretmez (kullanıcı ayarlar, kâğıt değişmez). İkisi de sessizdir —
// bekçi backend tarafında: `scripts/test_traveler_card_fields.ts` §2.
// =============================================================================

import type {
  TravelerCardConfig,
  TravelerCardFieldStyle,
  TravelerCardSpecField,
} from "@/services/featureFlagService";

/**
 * Panelde sunulan kalınlık kademeleri.
 *
 * ⚠️ "Normal" BİLEREK YOK. İki depoda "normal"in anlamı farklı: `fields`te
 * açık bir değer (400), hücrelerde ise *"inline basma, sütunun kendi tabanını
 * koru"* demek. Aynı etiketi iki farklı şeye bağlamak yerine ikisinde de
 * boş seçenek "Varsayılan" adını taşır ve doğru olanı yazar.
 */
export type PanelWeight = "light" | "medium" | "bold" | "black";
export const PANEL_WEIGHTS: { value: PanelWeight; label: string }[] = [
  { value: "light", label: "İnce" },
  { value: "medium", label: "Orta" },
  { value: "bold", label: "Kalın" },
  { value: "black", label: "Çok kalın" },
];

/** Backend `traveler-card.fields.ts` ile AYNI sınırlar. */
export const FIELD_SIZE_MIN = 5;
export const FIELD_SIZE_MAX = 48;

export type CellBucket = "specFields" | "orderFields" | "batchFields";

export type RowSource =
  | { kind: "field"; key: string }
  | { kind: "cell"; bucket: CellBucket; key: string }
  | { kind: "total"; key: "orderTotal" | "batchTotal" };

export interface FieldRow {
  /** React anahtarı — depolar arası çakışmasın diye önekli. */
  id: string;
  label: string;
  hint?: string;
  source: RowSource;
}

export interface FieldGroup {
  key: string;
  title: string;
  desc?: string;
  /**
   * Grubun tamamını kapatan config anahtarı (varsa). Bu, eskiden ayrı bir
   * "toggle listesi" bölümünde duran anahtarların yeni evi — bölüm başlığındaki
   * kutu artık o bölümün basılıp basılmayacağını söylüyor.
   */
  toggle?: "showProperties" | "showOperationGrid" | "showOrders" | "showBatches" | "showNotes";
  rows: FieldRow[];
}

const f = (key: string, label: string, hint?: string): FieldRow => ({
  id: `field:${key}`,
  label,
  hint,
  source: { kind: "field", key },
});
const c = (bucket: CellBucket, key: string, label: string, hint?: string): FieldRow => ({
  id: `${bucket}:${key}`,
  label,
  hint,
  source: { kind: "cell", bucket, key },
});

export const FIELD_GROUPS: FieldGroup[] = [
  {
    key: "header",
    title: "Antet",
    rows: [
      f("company", "Firma adı"),
      f("companyMeta", "Adres / telefon satırı"),
      f("docTitle", "Belge başlığı (REFAKAT KARTI)"),
      f("smallLabel", "Küçük etiketler", "KART NO / ÖZELLİKLER gibi üst yazılar."),
      f("cardNo", "Kart no"),
      f("cardMeta", "Basım bilgisi (tarih · versiyon)"),
    ],
  },
  {
    key: "identity",
    title: "Kimlik + Karekod",
    rows: [
      f("woNo", "İŞ EMRİ NO", "Kartın en büyük yazısı."),
      f("typeText", "Tür · rota satırı"),
      f("productCode", "Ürün kodu rozeti"),
      f("productName", "Ürün adı"),
      f("qrBlock", "Karekod kutusu", "Kapatılırsa karekod da basılmaz — kart okutulamaz."),
      f("barcodeText", "Karekod altındaki kod metni"),
      f("qrHint", "Karekod ipucu yazısı"),
    ],
  },
  {
    key: "spec",
    title: "Özet Tablo",
    desc: "Renk / En / Hedef metraj / Kat tipi / tarihler.",
    rows: [
      f("specLabel", "Etiketler", "RENK / EN / HEDEF METRAJ başlıkları — hepsi birlikte."),
      c("specFields", "color", "Renk"),
      c("specFields", "width", "En"),
      c("specFields", "targetQuantity", "Hedef Metraj"),
      c("specFields", "targetWeight", "Hedef Ağırlık"),
      c("specFields", "foldType", "Kat Tipi"),
      c("specFields", "startDate", "Başlangıç"),
      c("specFields", "endDate", "Bitiş"),
    ],
  },
  {
    key: "properties",
    title: "Özellikler",
    toggle: "showProperties",
    rows: [f("chip", "Özellik rozetleri", "Su İticilik, Zımparalı…")],
  },
  {
    key: "operations",
    title: "Operasyon Kaydı",
    desc: "İstasyon satırları + elle doldurulan imza grid'i.",
    toggle: "showOperationGrid",
    rows: [
      f("opHead", "Başlık satırı"),
      f("opStation", "İstasyon adı"),
      f("opSub", "İstasyon alt satırı (fason firma)"),
    ],
  },
  {
    key: "orders",
    title: "Bağlı Siparişler",
    toggle: "showOrders",
    rows: [
      f("orderHead", "Başlık satırı"),
      c("orderFields", "orderNumber", "Sipariş No"),
      c("orderFields", "customer", "Müşteri"),
      c("orderFields", "item", "Kumaş"),
      c("orderFields", "color", "Renk"),
      c("orderFields", "quantity", "Miktar"),
      { id: "total:orderTotal", label: "Toplam satırı", source: { kind: "total", key: "orderTotal" } },
    ],
  },
  {
    key: "batches",
    title: "Partiler",
    desc: "Her baskıda GÜNCEL okunur (kart iş emri açılışında donar, parti sonra doğar). İş emrinin partisi yoksa blok hiç basılmaz.",
    toggle: "showBatches",
    rows: [
      f("batchHead", "Başlık satırı"),
      c("batchFields", "batchNumber", "Parti No"),
      c("batchFields", "rollCount", "Top Adedi"),
      c("batchFields", "quantity", "Metraj"),
      c("batchFields", "dispatch", "Sevk (firma · irsaliye)"),
      { id: "total:batchTotal", label: "Toplam satırı", source: { kind: "total", key: "batchTotal" } },
    ],
  },
  {
    key: "notes",
    title: "Talimatlar",
    desc: "Adım notları (boyahane talimatı vb.).",
    toggle: "showNotes",
    rows: [f("notesText", "Talimat metni")],
  },
  {
    key: "footer",
    title: "Alt Bant",
    rows: [
      f("sectionTitle", "Bölüm başlıkları", "OPERASYON KAYDI, BAĞLI SİPARİŞLER…"),
      f("emptyText", '"Kayıt yok" metni'),
      f("footNote", "Alt not"),
      f("watermark", "Filigran (İPTAL / TASLAK)"),
    ],
  },
];

// ─── okuma / yazma ───────────────────────────────────────────────────────────

export interface RowValue {
  visible: boolean;
  size?: number;
  weight?: PanelWeight;
}

const DEFAULT_CELL: TravelerCardSpecField = { show: true, size: "md", weight: "normal" };

/**
 * Hücre sözlüklerini anahtar-erişilebilir yapar.
 *
 * `TravelerCardSpecFields`/`OrderFields`/`BatchFields` ADLANDIRILMIŞ alanlar
 * taşır (index signature YOK) — bu bilinçli: alan adını yanlış yazmak backend
 * tarafında derleme hatası vermeli. Panel ise satırları veriyle sürdüğü için
 * dinamik erişime ihtiyaç duyar; daraltma TEK YERDE, burada yapılır ki dosyanın
 * geri kalanı `as any` serpmek zorunda kalmasın.
 */
const asBucket = (v: unknown): Record<string, TravelerCardSpecField | undefined> =>
  (v ?? {}) as Record<string, TravelerCardSpecField | undefined>;

function readCell(v: TravelerCardSpecField | undefined): RowValue {
  const cell = v ?? DEFAULT_CELL;
  return {
    visible: cell.show !== false,
    size: cell.px,
    // "normal" panelde "Varsayılan"a karşılık gelir (bkz. PANEL_WEIGHTS notu).
    weight: cell.weight && cell.weight !== "normal" ? (cell.weight as PanelWeight) : undefined,
  };
}

/** Satırın ŞU ANKİ değerini config'ten okur (hangi depodan olduğunu satır bilir). */
export function readRow(cfg: TravelerCardConfig, src: RowSource): RowValue {
  if (src.kind === "field") {
    const s: TravelerCardFieldStyle | undefined = cfg.fields?.[src.key];
    return {
      visible: s?.hidden !== true,
      size: s?.size,
      weight: s?.weight && s.weight !== "normal" ? (s.weight as PanelWeight) : undefined,
    };
  }
  if (src.kind === "total") return readCell(cfg[src.key]);
  return readCell(asBucket(cfg[src.bucket])[src.key]);
}

export interface RowPatch {
  visible?: boolean;
  /** null → puntoyu temizle (varsayılana dön). */
  size?: number | null;
  /** null → kalınlığı temizle (varsayılana dön). */
  weight?: PanelWeight | null;
}

/**
 * Satırı günceller ve YENİ config döndürür (kaynağı mutate etmez — React state).
 *
 * ⚠️ BOŞ DEĞER ANAHTARI SİLER, sıfır YAZMAZ. Kullanıcı punto kutusunu boşaltınca
 * niyeti "0px" değil "varsayılana dön"dür. `fields` tarafında ayrıca: alan
 * tamamen varsayılana dönerse anahtar HARİTADAN düşer ve harita boşalırsa
 * `undefined` olur — backend'in "override yoksa tek bayt CSS basılmaz" kuralının
 * ön koşulu budur (`sanitizeTravelerFields` de aynısını yapar, iki taraf aynı
 * şeyi söyler).
 */
export function writeRow(
  cfg: TravelerCardConfig,
  src: RowSource,
  patch: RowPatch,
): TravelerCardConfig {
  if (src.kind === "field") {
    const next = { ...(cfg.fields ?? {}) };
    const cur: TravelerCardFieldStyle = { ...(next[src.key] ?? {}) };
    if (patch.visible != null) {
      if (patch.visible) delete cur.hidden;
      else cur.hidden = true;
    }
    if (patch.size !== undefined) {
      if (patch.size == null) delete cur.size;
      else cur.size = patch.size;
    }
    if (patch.weight !== undefined) {
      if (patch.weight == null) delete cur.weight;
      else cur.weight = patch.weight;
    }
    if (cur.size == null && cur.weight == null && !cur.hidden) delete next[src.key];
    else next[src.key] = cur;
    return { ...cfg, fields: Object.keys(next).length ? next : undefined };
  }

  // Hücreler: `show` her zaman yazılır (tam nesne saklanıyor), `px`/`weight`
  // temizlenebilir. "Varsayılan" kalınlık = "normal" (inline basılmaz).
  const apply = (cell: TravelerCardSpecField | undefined): TravelerCardSpecField => {
    const cur: TravelerCardSpecField = { ...DEFAULT_CELL, ...(cell ?? {}) };
    if (patch.visible != null) cur.show = patch.visible;
    if (patch.size !== undefined) {
      if (patch.size == null) delete cur.px;
      else cur.px = patch.size;
    }
    if (patch.weight !== undefined) cur.weight = patch.weight ?? "normal";
    return cur;
  };

  if (src.kind === "total") return { ...cfg, [src.key]: apply(cfg[src.key]) };
  const bucket = asBucket(cfg[src.bucket]);
  return { ...cfg, [src.bucket]: { ...bucket, [src.key]: apply(bucket[src.key]) } };
}

/** Girilen metni geçerli punto'ya çevirir; boş/anlamsız → null (= varsayılan). */
export function parseSize(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(FIELD_SIZE_MAX, Math.max(FIELD_SIZE_MIN, n));
}
