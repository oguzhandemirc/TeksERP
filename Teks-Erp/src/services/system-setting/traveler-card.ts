// =============================================================================
// TeksERP - System Setting / traveler-card
// =============================================================================
// Refakat kartı yapılandırması (tipler + normalize + okuyucu).
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { TRAVELER_FIELD_SIZE_MAX, TRAVELER_FIELD_SIZE_MIN, sanitizeTravelerFields, type TravelerFieldStyle } from "../document-render/traveler-card.fields";
import { resolveSectionOrder, type TravelerSection } from "../document-render/traveler-card.sections";
import { sanitizeBlankGrid, type BlankGridConfig } from "../document-render/doc-style";
import { resolveConfigPageSize } from "../document-render/traveler-card.density";
import prisma from "../../lib/prisma";
import { readCompanyName } from "./general";
import { SETTING_KEYS } from "./keys";


/** Refakat kartı sayfa boyutu. */
export type TravelerCardPageSize = "A4" | "A5";

/** Refakat kartı kenar boşlukları (mm) — pay bırakmak için (ciltleme/delik zımbası). */
export interface TravelerCardMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Yazı kalınlığı — tüm font-weight'leri kaydırır (ince −100, kalın +100). */
export type TravelerCardFontWeight = "light" | "normal" | "bold";

/** Alan boyutu — sm/md/lg. ESKİ kademe; yeni kayıtlar `px` taşır (bkz. aşağı). */
export type TravelerCardFieldSize = "sm" | "md" | "lg";

/** Hücre kalınlığı — 2026-08-05'te `medium`/`black` eklendi (panel beş kademe). */
export type TravelerCardCellWeight = TravelerCardFontWeight | "medium" | "black";

/**
 * Tek tablo hücresi ayarı — göster + boyut + kalınlık (hücre-başına bağımsız).
 *
 * ⚠️ İKİ BOYUT ALANI VAR ve bu geçicidir DEĞİL, KALICIDIR:
 *   • `px` — 2026-08-05'te panel tek birime (sayısal punto) geçti; yeni kayıtlar
 *     bunu yazar ve renderer'da kademenin ÜSTÜNDE gelir.
 *   • `size` — eski kademe (sm/md/lg). SİLİNEMEZ: yıllar önce basılmış kartların
 *     donmuş snapshot'ları bu alanı taşıyor ve o belgeler aynen basılabilmeli.
 * Panel yalnız `px` gösterir; `size` okunur ama yazılmaz.
 */
export interface TravelerCardSpecField {
  show: boolean;
  size: TravelerCardFieldSize;
  weight: TravelerCardCellWeight;
  /** Sayısal punto (5–48). Verilmezse `size` kademesi, o da yoksa profil tabanı. */
  px?: number;
}

/** Spec grid alanları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardSpecFields {
  color: TravelerCardSpecField;
  width: TravelerCardSpecField;
  targetQuantity: TravelerCardSpecField;
  targetWeight: TravelerCardSpecField;
  foldType: TravelerCardSpecField;
  startDate: TravelerCardSpecField;
  endDate: TravelerCardSpecField;
}

/** Bağlı siparişler tablosu sütunları — her biri tek tek (göster/boyut/kalınlık). */
export interface TravelerCardOrderFields {
  orderNumber: TravelerCardSpecField;
  customer: TravelerCardSpecField;
  item: TravelerCardSpecField;
  color: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
}

/**
 * Partiler tablosu sütunları — her biri tek tek (göster/boyut/kalınlık).
 * İçerik baskı anında CANLI çözülür (parti kart donduktan SONRA doğar); burada
 * yalnız GÖRÜNÜM kararı yaşar. Bkz. `document-render/traveler-card.html`.
 */
export interface TravelerCardBatchFields {
  batchNumber: TravelerCardSpecField;
  rollCount: TravelerCardSpecField;
  quantity: TravelerCardSpecField;
  /** Partinin açık fason sevki (firma · irsaliye no) — mal dışarıdayken kartta görünür. */
  dispatch: TravelerCardSpecField;
}

const CELL_WEIGHTS = new Set<TravelerCardCellWeight>(["light", "medium", "bold", "black"]);

/** Ham değeri (boolean eski şekil | nesne | undefined) tam spec alanına çözer. */
export function coerceSpecField(v: unknown): TravelerCardSpecField {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Record<string, unknown>;
  // `px` sınırları alan kataloğuyla AYNI (5–48) — panel tek bir sınır gösteriyor,
  // iki farklı sınır tutmak kullanıcıya iki farklı kırpma davranışı yaşatırdı.
  const rawPx = typeof f.px === "number" ? f.px : Number(f.px);
  const px = Number.isFinite(rawPx)
    ? Number(Math.min(TRAVELER_FIELD_SIZE_MAX, Math.max(TRAVELER_FIELD_SIZE_MIN, rawPx)).toFixed(2))
    : undefined;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? f.size : "md",
    weight:
      typeof f.weight === "string" && CELL_WEIGHTS.has(f.weight as TravelerCardCellWeight)
        ? (f.weight as TravelerCardCellWeight)
        : "normal",
    ...(px != null ? { px } : {}),
  };
}

/** Refakat kartı marka/içerik ayarı. Snapshot'a dondurulur. */
export interface TravelerCardConfig {
  /** Kart başlığındaki firma adı. */
  companyName: string;
  /** Firma adının altında basılan adres satırı (boş → basılmaz). */
  addressLine: string;
  /** Firma adının altında basılan telefon (boş → basılmaz). */
  phone: string;
  /** Sayfa boyutu — A4 (standart) veya A5. */
  pageSize: TravelerCardPageSize;
  /** Kenar boşlukları (mm) — hangi kenardan ne kadar pay. */
  margins: TravelerCardMargins;
  /** Yazı boyutu ölçeği — tüm yazılar bununla çarpılır (0.7–1.4, default 1). */
  fontScale: number;
  /** Yazı kalınlığı — ince/normal/kalın. */
  fontWeight: TravelerCardFontWeight;
  /** Operasyon imza grid'i basılsın mı. */
  showOperationGrid: boolean;
  /** Talimatlar/Boyahane notu kutusu basılsın mı. */
  showNotes: boolean;
  /** Bağlı siparişler tablosu basılsın mı. */
  showOrders: boolean;
  /** Özellikler (ÖZELLİKLER) satırı basılsın mı. */
  showProperties: boolean;
  /** Spec grid alanları (Renk/En/Hedef Metraj/... tek tek). */
  specFields: TravelerCardSpecFields;
  /** Spec grid'de satır başına sütun sayısı (1–4, default 3). */
  specColumns: number;
  /** Bağlı siparişler tablosu sütunları (Sipariş No/Müşteri/Ürün/Renk/Miktar tek tek). */
  orderFields: TravelerCardOrderFields;
  /** Miktar toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  orderTotal: TravelerCardSpecField;
  /** Partiler tablosu basılsın mı (parti yoksa zaten basılmaz). */
  showBatches: boolean;
  /** Partiler tablosu sütunları (Parti No/Top/Metraj/Sevk tek tek). */
  batchFields: TravelerCardBatchFields;
  /** Parti toplamı satırı — göster/boyut/kalınlık (show=false → basılmaz). */
  batchTotal: TravelerCardSpecField;
  /**
   * Bölüm SIRASI + açık/kapalı (Şablon Stüdyosu). Yoksa varsayılan sıra —
   * yerleşik kart. Tanınmayan anahtar atılır, eksik bölüm sona eklenir
   * (`document-render/traveler-card.sections.resolveSectionOrder`).
   */
  sections?: TravelerSection[];
  /**
   * ALAN BAZLI yazı ayarı — `key → { size?: px, weight? }`. Katalog + CSS üretimi
   * `document-render/traveler-card.fields.ts`'te; burada yalnız SAKLANIR.
   *
   * `specFields`/`orderFields`/`batchFields` ile ÇAKIŞMAZ, KATMANLIDIR: onlar
   * hücre-başına sm/lg kademesidir ve inline basıldıkları için CSS'i ezerler;
   * buradaki `specValue`/`orderCell`/`batchCell` o kademelerin TABANINI belirler
   * (renderer sm/lg'yi tabana oranlar). Diğer ~20 anahtar kartın hiçbir yerden
   * ayarlanamayan yazı yüzeylerine (firma adı, İŞ EMRİ NO, özet tablo etiketleri,
   * bölüm başlıkları, filigran…) karşılık gelir.
   *
   * ⚠️ Verilmemişse (`undefined`) renderer TEK BAYT ek CSS basmaz — ayara hiç
   * dokunulmamış kartın çıktısı bugünküyle birebir aynı kalır. Bu yüzden boş
   * nesne YAZILMAZ (`sanitizeTravelerFields` boşta `undefined` döner).
   */
  fields?: Record<string, TravelerFieldStyle>;
  /**
   * BOŞ GRID (2026-08-13 saha isteği) — kartın alt boşluğuna elle doldurulacak
   * tablo (kurşuncular kendi kayıtlarını buraya yazıyor).
   *
   * ⚠️ TİP BELGELERLE ORTAK (`doc-style.BlankGridConfig`) ve bu bilinçli: aynı
   * kavram için ikinci bir şekil, ikinci bir kayıt kapısı ve ikinci bir renderer
   * demekti — panelde "satır/sütun/genişlik" iki farklı biçimde sorulurdu.
   * Sanitize (`sanitizeBlankGrid`) ve çizim (`docBlankGridHtml/Css`) da AYNI.
   * Tek fark konum: belgede `position` çıpası var, kartta bölüm SIRASI belirler.
   *
   * ⚠️ VERİ TAŞIMAZ, kasten: hücreler boş basılır. Sisteme girmesi gereken bir
   * bilgiyi buraya yazdırmak onu aranamaz/raporlanamaz kılar.
   */
  blankGrid?: BlankGridConfig;
  /** Kart altına basılan serbest not (boş → basılmaz). */
  footerNote: string;
}

export const DEFAULT_TRAVELER_CARD_CONFIG: TravelerCardConfig = {
  // Boş = kurulumun firma adı (`company.name`); `readTravelerCardConfig` doldurur.
  companyName: "",
  addressLine: "",
  phone: "",
  // Varsayılan A5: kart tek yaprak, malla birlikte gezen operasyon kâğıdıdır —
  // A4'e ihtiyaç duyan (çok adımlı rota + uzun sipariş listesi) kurulumlar
  // panelden/baskı diyaloğundan A4'e çeker. Sayfa boyutuna bağlı ölçüler:
  // `document-render/traveler-card.density.ts`.
  pageSize: "A5",
  margins: { top: 8, right: 8, bottom: 8, left: 8 },
  fontScale: 1,
  fontWeight: "normal",
  showOperationGrid: true,
  showNotes: true,
  showOrders: true,
  showProperties: true,
  specFields: {
    color: { show: true, size: "md", weight: "normal" },
    width: { show: true, size: "md", weight: "normal" },
    targetQuantity: { show: true, size: "md", weight: "normal" },
    targetWeight: { show: true, size: "md", weight: "normal" },
    foldType: { show: true, size: "md", weight: "normal" },
    startDate: { show: true, size: "md", weight: "normal" },
    endDate: { show: true, size: "md", weight: "normal" },
  },
  specColumns: 3,
  orderFields: {
    orderNumber: { show: true, size: "md", weight: "normal" },
    customer: { show: true, size: "md", weight: "normal" },
    item: { show: true, size: "md", weight: "normal" },
    color: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
  },
  orderTotal: { show: true, size: "md", weight: "bold" },
  showBatches: true,
  batchFields: {
    batchNumber: { show: true, size: "md", weight: "normal" },
    rollCount: { show: true, size: "md", weight: "normal" },
    quantity: { show: true, size: "md", weight: "normal" },
    dispatch: { show: true, size: "md", weight: "normal" },
  },
  batchTotal: { show: true, size: "md", weight: "bold" },
  // Boş grid varsayılanda YOK (anahtar hiç yazılmaz) — belgelerdeki kuralın
  // aynısı: kartın bugünkü çıktısı bayt-bayt korunur, açan kurulum sütunlarını
  // kendi kurar.
  footerNote: "",
};

/** Ham objeyi (kaydet girişi / saklanan değer) tam + güvenli TravelerCardConfig'e çözer.
 *  Kaydet ve oku yolları paylaşır → drift yok. Eksik alan → default açık/değer. */
export function normalizeTravelerCardConfig(o: Record<string, unknown>): TravelerCardConfig {
  const D = DEFAULT_TRAVELER_CARD_CONFIG;
  const mm = (v: unknown, def: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(40, Math.max(0, Math.round(n))) : def;
  };
  const m = (o.margins && typeof o.margins === "object" ? o.margins : {}) as Record<string, unknown>;
  const sf = (o.specFields && typeof o.specFields === "object" ? o.specFields : {}) as Record<string, unknown>;
  const of = (o.orderFields && typeof o.orderFields === "object" ? o.orderFields : {}) as Record<string, unknown>;
  const bf = (o.batchFields && typeof o.batchFields === "object" ? o.batchFields : {}) as Record<string, unknown>;
  return {
    companyName:
      typeof o.companyName === "string" && o.companyName.trim()
        ? o.companyName.trim().slice(0, 120)
        : D.companyName,
    addressLine: typeof o.addressLine === "string" ? o.addressLine.trim().slice(0, 200) : "",
    phone: typeof o.phone === "string" ? o.phone.trim().slice(0, 60) : "",
    // AYAR katmanı → varsayılan A5. RENDER katmanı (donmuş snapshot) bilerek A4'e
    // düşer; ikisinin neden farklı olduğu: `document-render/traveler-card.density.ts`.
    pageSize: resolveConfigPageSize(o.pageSize),
    margins: {
      top: mm(m.top, D.margins.top),
      right: mm(m.right, D.margins.right),
      bottom: mm(m.bottom, D.margins.bottom),
      left: mm(m.left, D.margins.left),
    },
    fontScale: (() => {
      const n = typeof o.fontScale === "number" ? o.fontScale : Number(o.fontScale);
      return Number.isFinite(n) ? Math.min(1.4, Math.max(0.7, n)) : 1;
    })(),
    fontWeight: o.fontWeight === "light" || o.fontWeight === "bold" ? o.fontWeight : "normal",
    showOperationGrid: o.showOperationGrid !== false,
    showNotes: o.showNotes !== false,
    showOrders: o.showOrders !== false,
    showProperties: o.showProperties !== false,
    specFields: {
      color: coerceSpecField(sf.color),
      width: coerceSpecField(sf.width),
      targetQuantity: coerceSpecField(sf.targetQuantity),
      targetWeight: coerceSpecField(sf.targetWeight),
      foldType: coerceSpecField(sf.foldType),
      startDate: coerceSpecField(sf.startDate),
      endDate: coerceSpecField(sf.endDate),
    },
    specColumns: (() => {
      const n = typeof o.specColumns === "number" ? o.specColumns : Number(o.specColumns);
      return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.round(n))) : 3;
    })(),
    orderFields: {
      orderNumber: coerceSpecField(of.orderNumber),
      customer: coerceSpecField(of.customer),
      item: coerceSpecField(of.item),
      color: coerceSpecField(of.color),
      quantity: coerceSpecField(of.quantity),
    },
    // Toplam: yeni orderTotal nesnesi > eski showOrderTotal boolean; varsayılan KALIN.
    orderTotal: coerceSpecField(o.orderTotal ?? { show: o.showOrderTotal !== false, size: "md", weight: "bold" }),
    // Parti bloğu: bu alanları taşımayan ESKİ kayıtlı ayarlar `!== false` /
    // coerceSpecField sayesinde AÇIK doğar — blok iç veri değil sahanın kendi
    // partisidir (müşteriye giden belge değil), opt-in gerekmez.
    showBatches: o.showBatches !== false,
    batchFields: {
      batchNumber: coerceSpecField(bf.batchNumber),
      rollCount: coerceSpecField(bf.rollCount),
      quantity: coerceSpecField(bf.quantity),
      dispatch: coerceSpecField(bf.dispatch),
    },
    batchTotal: coerceSpecField(o.batchTotal ?? { show: true, size: "md", weight: "bold" }),
    // `sections` YALNIZ açıkça verilmişse yazılır — `undefined` bırakmak
    // "yerleşik sıra" demektir ve donmuş eski snapshot'larla aynı anlamı taşır.
    // Her config'e varsayılan sırayı YAZMAK cazip ama yanlış olurdu: o zaman
    // yarın eklenecek bir bölüm, bugün kaydedilmiş her kartta eksik kalırdı.
    ...(o.sections === undefined ? {} : { sections: resolveSectionOrder(o.sections) }),
    // Alan bazlı yazı ayarı — `sections` ile AYNI disiplin: boş/anlamsız girdi
    // `undefined`'a çözülür ve anahtar config'e HİÇ yazılmaz. Boş bir `{}`
    // yazmak zararsız görünür ama renderer'daki "override yoksa tek bayt CSS
    // basılmaz" kuralını okuması zorlaşan bir şarta çevirir; ayrıca her kayıtlı
    // ayara ölü bir anahtar eklerdi.
    ...(() => {
      const f = sanitizeTravelerFields(o.fields);
      return f ? { fields: f } : {};
    })(),
    // Belgelerdeki kayıt kapısının AYNISI: kapalı grid `undefined` döner ve
    // anahtar config'e HİÇ yazılmaz (`sections`/`fields` ile aynı disiplin).
    ...(() => {
      const g = sanitizeBlankGrid(o.blankGrid);
      return g ? { blankGrid: g } : {};
    })(),
    footerNote: typeof o.footerNote === "string" ? o.footerNote.trim().slice(0, 500) : "",
  };
}

/**
 * Refakat kartı marka/içerik ayarını okur (yoksa/eksikse default'lara düşer).
 * buildSnapshot bunu çağırıp config'i karta dondurur.
 */
export async function readTravelerCardConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TravelerCardConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TRAVELER_CARD_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  const cfg =
    !v || typeof v !== "object" || Array.isArray(v)
      ? DEFAULT_TRAVELER_CARD_CONFIG
      : normalizeTravelerCardConfig(v as Record<string, unknown>);
  // Kartın kendi adı yoksa kurulumun adı basılır — müşteri adı koda gömülmez.
  return cfg.companyName ? cfg : { ...cfg, companyName: await readCompanyName(client) };
}
