// =============================================================================
// TeksERP - System Setting / documents
// =============================================================================
// Antet · belge yapılandırması · belge logosu (tipler + okuyucular + kayıt kapısı).
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { sanitizeBlankGrid, sanitizeDocFields, sanitizeDocStyleConfig, type BlankGridConfig, type DocFieldStyle, type DocStyleConfig } from "../document-render/doc-style";
import prisma from "../../lib/prisma";
import { DEFAULT_COMPANY_LEGAL_IDENTITY, DEFAULT_EIRSALIYE_CONFIG, readEIrsaliyeConfigValue, sanitizeCompanyLegalIdentity, type CompanyLegalIdentity, type EIrsaliyeConfig } from "../e-irsaliye/e-irsaliye-settings";
import { SETTING_KEYS } from "./keys";


/** Belge künyesi — irsaliye/çeki başına basılan ek firma bilgisi (firma adı ayrı). */
export interface CompanyLetterhead {
  /** Firma adresi (boş → basılmaz). */
  addressLine: string;
  /** Telefon (boş → basılmaz). */
  phone: string;
  /** Vergi dairesi / no (boş → basılmaz). */
  taxInfo: string;
  /** Serbest ek künye satırları (IBAN, Mersis, e-posta, web...) — max 5, boşlar basılmaz. */
  extraLines?: string[];
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: "",
  phone: "",
  taxInfo: "",
};

/**
 * Yazdırılan belge içerik ayarı (sevk irsaliyesi / fason sevk / kartela çeki).
 * Tüm alanlar opsiyonel — verilmeyen alan client tarafında belge kayıt defterindeki
 * (DOC_DEFS) varsayılana çözülür (resolveDocConfig). Backend SADECE saklar; çözüm
 * client'ta (Electron/mobil) yapılır.
 */
export interface DocumentConfig {
  /** Belge başlığı override ("" / verilmedi → varsayılan başlık). */
  titleOverride?: string;
  /** Üst künye bloğu (firma adı + adres/tel/vergi) basılsın mı (default false). */
  showLetterhead?: boolean;
  /** Bölüm görünürlükleri: { [bölümKey]: boolean }. Verilmeyen bölüm → açık. */
  sections?: Record<string, boolean>;
  /** İmza kutusu etiketleri (boş dizi → varsayılan etiketler). */
  signatureLabels?: string[];
  /** İmza kutuları basılsın mı (default true). */
  showSignatures?: boolean;
  /** Belge altına basılan serbest not. */
  footerNote?: string;
  /** Görünüm ayarı (sayfa/font/tablo) — renderer document-render/doc-style ile çözer. */
  style?: DocStyleConfig;
  /** Firma logosu basılsın mı (default true — logo yüklüyse basılır). */
  showLogo?: boolean;
  /** Logo konumu: başlık sol bloğu (default) veya sağ blok. */
  logoPosition?: "left" | "right";
  /** Tablo kolonu aç/kapa + sıralama + BAŞLIK: { [tabloKey]: { hidden, order,
   *  shown, labels } } — renderer document-render/doc-table.ts ile uygular.
   *  `hidden` blocklist (normal kolonlar), `shown` allowlist (yalnız
   *  `defaultHidden` opt-in kolonlar — çuval yorumu gibi iç veri; onlarda
   *  `hidden` yok sayılır), `labels` kolon başlığı override'ı (boş dize =
   *  varsayılana dön; değer kullanıcı girdisidir → renderer HTML kaçırır). */
  columns?: Record<
    string,
    {
      hidden?: string[];
      order?: string[];
      shown?: string[];
      labels?: Record<string, string>;
      /** Başlığı BOŞ basılacak kolonlar — `labels`te boş dize "varsayılana dön" demek. */
      blankLabels?: string[];
    }
  >;
  /** Belge doğrulama karekodu (belge no + versiyon) basılsın mı (default false). */
  qr?: boolean;
  /** Sayfa altı damgaları: basım zamanı / basan kullanıcı / nüsha etiketi (ASIL, KOPYA...). */
  stamps?: { printedAt?: boolean; printedBy?: boolean; copyLabel?: string };
  /** Konumlu serbest metin blokları (yasal ibare vb.) — max 4, her biri ≤500 karakter. */
  blocks?: { position: "afterHeader" | "beforeSignatures"; text: string }[];
  /** Belge dili: tr (default) | en | auto (ihracat sevkiyatında EN) — yalnız
   *  müşteriye giden belgelerde (sevk irsaliyesi, fasondan sevk) uygulanır. */
  language?: "tr" | "en" | "auto";
  /** En (genişlik) kolonları basılsın ama değerleri BOŞ gelsin (elle doldurulacak /
   *  "iş emrinden çek" kapalı). Default false → enler top verisinden çekilir. */
  blankWidths?: boolean;
  /** Alt notun (footerNote) konumu: "bottom" (default, tablolardan sonra) veya
   *  "top" (başlık/araç satırından sonra, tablolardan ÖNCE). Yalnız destekleyen
   *  renderer'da uygulanır (sevk irsaliyesi). */
  footerNotePlacement?: "top" | "bottom";
  /** ALAN BAZLI yazı ayarı: { [alanKey]: { size, weight } }. Belge geneli
   *  `style.fontScale/fontWeight` TÜM belgeye uygulanır; bu ise tek bir alanı
   *  (ör. grid'deki METRE değeri) ayrı ayarlar ve genel ayar onun üstüne biner.
   *  Alan kataloğu belgeye özeldir — bugün yalnız fason çeki
   *  (`document-render/fason-ceki.fields.ts`). Bilinmeyen anahtar basımda
   *  sessizce atlanır (yazım hatası vardiyayı durdurmasın). */
  fields?: Record<string, DocFieldStyle>;
  /** Konumlandırılabilir bölümler: { [bölümKey]: "left" | "right" }. Bugün yalnız
   *  `batchInfo` (parti no — başlığın sol veya sağ bloğu; default "right" =
   *  bugünkü çıktı). Genel harita, çünkü ikinci bir alan için ikinci bir tekil
   *  anahtar açmak aynı kavramı iki yere böler. */
  placements?: Record<string, "left" | "right">;
  /** Fason çeki grid'inde satır başına grup sayısı (3 | 4 | 5; default 5 =
   *  fiziksel KUMAŞ İRSALİYESİ formu). Daha az grup = daha geniş hücre → A5'te
   *  punto büyütülebilir. Grup başına satır (20) ayarlanmaz. */
  gridGroups?: number;
  /**
   * AYARLANABİLİR BOŞ GRID (2026-08-09) — elle doldurulan kutular.
   *
   * ⚠️ OPT-IN, varsayılan KAPALI: verilmezse belgeye **tek bayt** eklenmez
   * (ne HTML ne CSS). Ayarına dokunulmamış ve donmuş belgelerin çıktısı
   * bayt-bayt korunur. Renderer: `document-render/doc-style.docBlankGridHtml`.
   */
  blankGrid?: BlankGridConfig;
  /** Fason çeki grid'inde GRUP BAŞINA SATIR (1–40; default 10).
   *  SAYFA BAŞINA TOP = gridGroups × gridRows (varsayılan 5 × 10 = 50).
   *  Hücreler elle doldurulan BOŞ kutulardır; eski 100'lük formda kutuların
   *  çoğu boş basılıyordu ve A5'te iyice sıkışıktı. */
  gridRows?: number;
}

/** Belge ayarları haritası: { [belgeKey]: DocumentConfig }. Ham saklanır, client çözer. */
export type DocumentsConfig = Record<string, DocumentConfig>;

/**
 * Belge künyesini okur (yoksa boş künye). irsaliye/çeki üst bloğunda firma adının
 * altına basılır.
 */
export async function readCompanyLetterhead(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<CompanyLetterhead> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_LETTERHEAD },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return DEFAULT_COMPANY_LETTERHEAD;
  }
  const o = v as Record<string, unknown>;
  return {
    addressLine: typeof o.addressLine === "string" ? o.addressLine : "",
    phone: typeof o.phone === "string" ? o.phone : "",
    taxInfo: typeof o.taxInfo === "string" ? o.taxInfo : "",
    extraLines: Array.isArray(o.extraLines)
      ? o.extraLines.filter((x): x is string => typeof x === "string").slice(0, 5)
      : [],
  };
}

/** Gönderici resmi künyesi (yoksa boş künye). Temizlik `sanitizeCompanyLegalIdentity`. */
export async function readCompanyLegalIdentity(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<CompanyLegalIdentity> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_LEGAL_IDENTITY },
    select: { value: true },
  });
  return setting ? sanitizeCompanyLegalIdentity(setting.value) : { ...DEFAULT_COMPANY_LEGAL_IDENTITY };
}

/** e-İrsaliye yapılandırması (yoksa/çöpse `{adapter:"yok"}` = bugünkü davranış). */
export async function readEIrsaliyeConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<EIrsaliyeConfig> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({
    where: { key: SETTING_KEYS.EIRSALIYE_CONFIG },
    select: { value: true },
  });
  return setting ? readEIrsaliyeConfigValue(setting.value) : { ...DEFAULT_EIRSALIYE_CONFIG };
}

/** Belge logosu kütüphanesi — bkz. SETTING_KEYS.DOCUMENTS_LOGO. */
export interface DocumentsLogo {
  current: string | null;
  items: Record<string, string>;
}

const EMPTY_DOCUMENTS_LOGO: DocumentsLogo = { current: null, items: {} };

/** data URL formatı + boyut guard'ı (100KB binary ≈ 137KB base64; üst sınır 160K karakter). */
export const LOGO_DATAURL_RE = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const LOGO_MAX_CHARS = 160_000;

/** Belge logosu kütüphanesini okur (yoksa boş). */
export async function readDocumentsLogo(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DocumentsLogo> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_LOGO },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY_DOCUMENTS_LOGO;
  const o = v as Record<string, unknown>;
  const items: Record<string, string> = {};
  if (o.items && typeof o.items === "object" && !Array.isArray(o.items)) {
    for (const [k, val] of Object.entries(o.items as Record<string, unknown>)) {
      if (typeof val === "string") items[k] = val;
    }
  }
  const current = typeof o.current === "string" && items[o.current] ? o.current : null;
  return { current, items };
}

/**
 * Yazdırılan belge içerik ayarını HAM okur (yoksa boş map). Çözüm (varsayılanlarla
 * birleştirme) client tarafında resolveDocConfig ile yapılır — backend yalnız saklar.
 */
export async function readDocumentsConfig(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DocumentsConfig> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_CONFIG },
    select: { value: true },
  });
  const v = setting?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return sanitizeDocumentsConfig(v as Record<string, unknown>);
}

/**
 * Belge ayar map'ini güvenli tipe indirger: bilinmeyen alanları atar, tip uymayan
 * değerleri yok sayar. Saklamadan önce ve okuduktan sonra uygulanır.
 */
export function sanitizeDocumentsConfig(raw: Record<string, unknown>): DocumentsConfig {
  const out: DocumentsConfig = {};
  for (const [docKey, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const cfg: DocumentConfig = {};
    if (typeof o.titleOverride === "string") {
      cfg.titleOverride = o.titleOverride.trim().slice(0, 80);
    }
    if (typeof o.showLetterhead === "boolean") cfg.showLetterhead = o.showLetterhead;
    if (typeof o.showSignatures === "boolean") cfg.showSignatures = o.showSignatures;
    if (typeof o.footerNote === "string") {
      cfg.footerNote = o.footerNote.trim().slice(0, 500);
    }
    if (o.sections && typeof o.sections === "object" && !Array.isArray(o.sections)) {
      const sections: Record<string, boolean> = {};
      for (const [sk, sv] of Object.entries(o.sections as Record<string, unknown>)) {
        if (typeof sv === "boolean") sections[sk] = sv;
      }
      cfg.sections = sections;
    }
    if (Array.isArray(o.signatureLabels)) {
      cfg.signatureLabels = o.signatureLabels
        .filter((x): x is string => typeof x === "string")
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 40));
    }
    const style = sanitizeDocStyleConfig(o.style);
    if (style) cfg.style = style;
    if (typeof o.showLogo === "boolean") cfg.showLogo = o.showLogo;
    if (o.logoPosition === "left" || o.logoPosition === "right") {
      cfg.logoPosition = o.logoPosition;
    }
    if (o.columns && typeof o.columns === "object" && !Array.isArray(o.columns)) {
      const columns: NonNullable<DocumentConfig["columns"]> = {};
      for (const [tk, tv] of Object.entries(o.columns as Record<string, unknown>)) {
        if (!tv || typeof tv !== "object" || Array.isArray(tv)) continue;
        const tvo = tv as Record<string, unknown>;
        const entry: {
          hidden?: string[];
          order?: string[];
          shown?: string[];
          labels?: Record<string, string>;
          blankLabels?: string[];
        } = {};
        if (Array.isArray(tvo.hidden)) {
          entry.hidden = tvo.hidden
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        if (Array.isArray(tvo.order)) {
          entry.order = tvo.order
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        if (Array.isArray(tvo.shown)) {
          entry.shown = tvo.shown
            .filter((x): x is string => typeof x === "string")
            .slice(0, 20);
        }
        // KOLON BAŞLIĞI ÖZELLEŞTİRME (2026-09-04). Boş dize SAKLANMAZ =
        // "varsayılana dön" (renderer da aynı yorumu yapar; ikisi ayrışırsa
        // kullanıcı kutuyu boşaltır, ayar kaydolur, başlık geri gelmez).
        if (tvo.labels && typeof tvo.labels === "object" && !Array.isArray(tvo.labels)) {
          const labels: Record<string, string> = {};
          for (const [ck, cv] of Object.entries(tvo.labels as Record<string, unknown>)) {
            if (typeof cv !== "string") continue;
            const t = cv.trim().slice(0, 40);
            if (t) labels[ck.slice(0, 40)] = t;
          }
          // Tablo başına kolon sayısı sınırı `hidden`/`order` ile aynı (20).
          const keys = Object.keys(labels).slice(0, 20);
          if (keys.length) {
            entry.labels = Object.fromEntries(keys.map((k) => [k, labels[k] as string]));
          }
        }
        // BAŞLIĞI BOŞ BASILACAK kolonlar — `labels`ten AYRI liste, çünkü orada
        // boş dize "varsayılana dön" demek ve aynı kutu iki niyeti anlatamaz.
        if (Array.isArray(tvo.blankLabels)) {
          entry.blankLabels = tvo.blankLabels
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().slice(0, 40))
            .filter((x) => x.length > 0)
            .slice(0, 20);
        }
        // ⚠️ `shown` bu kapıya EKLENMELİ — yoksa yalnız opt-in kolon açılmış bir satır
        // (hidden/order boş) sessizce atılır: kullanıcı kolonu açar, ayar kaydolmaz,
        // sebebi hiçbir yerde görünmez. (`labels` aynı sebeple burada.)
        if (
          entry.hidden?.length ||
          entry.order?.length ||
          entry.shown?.length ||
          entry.blankLabels?.length ||
          entry.labels
        ) {
          columns[tk.slice(0, 40)] = entry;
        }
      }
      if (Object.keys(columns).length) cfg.columns = columns;
    }
    if (typeof o.qr === "boolean") cfg.qr = o.qr;
    if (o.stamps && typeof o.stamps === "object" && !Array.isArray(o.stamps)) {
      const so = o.stamps as Record<string, unknown>;
      const stamps: NonNullable<DocumentConfig["stamps"]> = {};
      if (typeof so.printedAt === "boolean") stamps.printedAt = so.printedAt;
      if (typeof so.printedBy === "boolean") stamps.printedBy = so.printedBy;
      if (typeof so.copyLabel === "string") stamps.copyLabel = so.copyLabel.trim().slice(0, 20);
      if (Object.keys(stamps).length) cfg.stamps = stamps;
    }
    if (Array.isArray(o.blocks)) {
      const blocks = (o.blocks as unknown[])
        .filter(
          (b): b is { position: string; text: string } =>
            !!b &&
            typeof b === "object" &&
            typeof (b as Record<string, unknown>).text === "string" &&
            ((b as Record<string, unknown>).position === "afterHeader" ||
              (b as Record<string, unknown>).position === "beforeSignatures"),
        )
        .slice(0, 4)
        .map((b) => ({
          position: b.position as "afterHeader" | "beforeSignatures",
          text: b.text.trim().slice(0, 500),
        }))
        .filter((b) => b.text);
      if (blocks.length) cfg.blocks = blocks;
    }
    if (o.language === "tr" || o.language === "en" || o.language === "auto") {
      cfg.language = o.language;
    }
    if (typeof o.blankWidths === "boolean") cfg.blankWidths = o.blankWidths;
    if (o.footerNotePlacement === "top" || o.footerNotePlacement === "bottom") {
      cfg.footerNotePlacement = o.footerNotePlacement;
    }
    // ⚠️ AŞAĞIDAKİ ÜÇ ALAN BU KAPIDAN GEÇMEZSE AYAR SESSİZCE KAYBOLUR: kullanıcı
    // panelde ayarlar, Kaydet'e basar, istek 200 döner ve hiçbir şey olmaz —
    // sebebi de hiçbir yerde yazmaz. (`columns.shown` bu tuzağa bir kez düştü.)
    const fields = sanitizeDocFields(o.fields);
    if (fields) cfg.fields = fields;
    if (o.placements && typeof o.placements === "object" && !Array.isArray(o.placements)) {
      const placements: Record<string, "left" | "right"> = {};
      for (const [pk, pv] of Object.entries(o.placements as Record<string, unknown>)) {
        if (pv === "left" || pv === "right") placements[pk.slice(0, 40)] = pv;
      }
      if (Object.keys(placements).length) cfg.placements = placements;
    }
    if (o.gridGroups === 3 || o.gridGroups === 4 || o.gridGroups === 5) {
      cfg.gridGroups = o.gridGroups;
    }
    if (typeof o.gridRows === "number" && Number.isFinite(o.gridRows)) {
      cfg.gridRows = Math.min(40, Math.max(1, Math.round(o.gridRows)));
    }
    // BOŞ GRID — kayıt kapısının DÖRDÜNCÜ ayağı. ⚠️ Bu satır olmadan panelden
    // kaydedilen grid SESSİZCE ATILIR (kullanıcı ayarlar, kaydolmaz, sebebi
    // hiçbir yerde yazmaz). `gridRows`/`fields`/`placements` de aynı boşluktan
    // geçmişti — bekçi: `test_fason_ceki_html` §18 round-trip.
    const bg = sanitizeBlankGrid(o.blankGrid);
    if (bg) cfg.blankGrid = bg;
    out[docKey] = cfg;
  }
  return out;
}
