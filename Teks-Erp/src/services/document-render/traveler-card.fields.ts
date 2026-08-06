// =============================================================================
// Refakat kartı — ALAN BAZLI görünürlük + yazı ayarı kataloğu (tek kaynak)
// =============================================================================
// Kartın ayar yüzeyi 2026-08-05'te TEK TABLOYA indirildi (kullanıcı kararı):
// her satırda solda görünürlük kutusu, sağında SAYISAL punto ve kalınlık.
// Öncesinde görünürlük ve stil ayrı bölümlerdeydi ve aynı alan iki yerden
// aranıyordu; ayrıca boyut kimi alanda kademe (sm/md/lg), kimi alanda px'ti.
//
// Bu dosya, kartın CSS ile yönetilen yüzeylerini taşır. İKİ AYRI DEPO VAR ve
// karıştırılmamalı:
//
//   • BURASI (`config.fields`) → tekil yüzeyler (firma adı, İŞ EMRİ NO, bölüm
//     başlıkları, filigran…). CSS kuralı olarak basılır.
//   • `config.specFields` / `orderFields` / `batchFields` / `*Total` → TABLO
//     HÜCRELERİ. Onlar hücre-başına INLINE basılır (sütun sütun farklı olabilir)
//     ve CSS'i ezerler; bu yüzden buraya taşınamazlar. Panel ikisini tek listede
//     gösterir — kullanıcı ayrımı görmez, görmesi de gerekmez.
//
// ⚠️ DÖRT LOAD-BEARING KURAL:
//
// 1. OVERRIDE YOKSA TEK BAYT CSS BASILMAZ. `travelerFieldCss(undefined, d)` boş
//    string döner → ayara hiç dokunmamış kartın çıktısı bugünküyle birebir aynı
//    kalır (A4 parmak izi bekçisi bunu doğrular).
//
// 2. `calc()` / CSS DEĞİŞKENİ KULLANILMAZ. Renderer'ın sonundaki global ölçek
//    `font-size:\s*([\d.]+)px` regex'iyle çarpıyor; `calc(10px * var(--x))` bu
//    desene TAKILMAZ ve belge geneli "Yazı" ayarı tam da kullanıcının elle
//    ayarladığı alanlarda SESSİZCE çalışmaz olurdu. Nihai px burada hesaplanır.
//
// 3. SEÇİCİ ÖZGÜLLÜĞÜ TABAN CSS'İ GEÇMELİ. Her seçici `.sheet ` ile öneklenir
//    (taban kurallar öneksizdir) → alan kuralı CSS SIRASINDAN BAĞIMSIZ kazanır.
//    ⚠️ İSTİSNA: filigran (`.wm`) `.sheet`in KARDEŞİDİR, çocuğu değil —
//    `.sheet .wm` hiçbir şeyle eşleşmezdi. Onun için `root: true` ile `body `
//    öneki kullanılır. Yeni alan eklerken elemanın `.sheet` İÇİNDE olup
//    olmadığını renderer'dan doğrula; yanlış önek hata/log üretmeden ayarı ölü
//    doğurur.
//
// 4. GİZLEME `display: none` İLE YAPILIR, HTML'den silinerek DEĞİL. Sebep:
//    27 render noktasına koşul eklemek yerine tek bir kural yeter ve kartın
//    donmuş snapshot'ı ile canlı ayar arasındaki fark yalnız CSS'te kalır.
//    ⚠️ Gizlenen alan `font-size` kuralı ÜRETMEZ (gereksiz bayt) ama gizleme
//    kuralı `!important` de TAŞIMAZ — inline stil `display` yazmıyor, dolayısıyla
//    özgüllük yeter.
// =============================================================================

import { DOC_FIELD_WEIGHTS, type DocFieldStyle, type DocFieldWeight } from "./doc-style";
import type { TravelerDensity } from "./traveler-card.density";

/**
 * Kartın alan ayarı — `DocFieldStyle`'a **görünürlük** ekler.
 *
 * ⚠️ `hidden` BİLEREK `doc-style.DocFieldStyle`'a EKLENMEDİ: orası altı belge
 * renderer'ının paylaştığı ortak tip ve o belgelerde gizleme zaten `sections`/
 * `columns` blocklist'leriyle çözülüyor. Ortak tipe eklemek, hiçbir yerinden
 * okunmayan bir alanı beş belgeye daha taşımak olurdu.
 */
export interface TravelerFieldStyle extends DocFieldStyle {
  /** true → alan basılmaz (`display: none`). Yoksa/false → basılır. */
  hidden?: boolean;
}

export type TravelerFieldGroup =
  | "header"
  | "identity"
  | "spec"
  | "properties"
  | "operations"
  | "orders"
  | "batches"
  | "notes"
  | "footer";

export interface TravelerFieldDef {
  /** Config anahtarı — Electron paneli aynı anahtarı yazar. */
  key: string;
  /** Panelde görünen ad (Electron aynasında da yazılıdır). */
  label: string;
  /** Panelde hangi grup başlığı altında çizilir. */
  group: TravelerFieldGroup;
  /** Hedef CSS seçici(ler)i — önek `travelerFieldCss` tarafından eklenir. */
  selector: string;
  /** Taban punto (yoğunluk profilinden — A4/A5 ayrı). */
  base: (d: TravelerDensity) => number;
  /** Taban kalınlık (bugünkü CSS'teki değer). */
  weight: number;
  /** Eleman `.sheet`in DIŞINDA mı (yalnız filigran) — önek `body ` olur. */
  root?: boolean;
}

/**
 * Alan kataloğu. Sıra panelde göründüğü sıradır.
 *
 * ⚠️ Burada TABLO HÜCRESİ YOKTUR (bkz. dosya başlığı) — özet tablonun
 * DEĞERLERİ, sipariş/parti SÜTUNLARI ve toplam satırları `specFields`/
 * `orderFields`/`batchFields`/`*Total` üzerinden inline basılır. Buraya
 * `.c-val` gibi bir "taban" satırı eklemek iki depoyu çakıştırır: inline her
 * zaman kazanır, kullanıcı ayarı yarım çalışıyor sanır.
 *
 * `specLabel` ise BURADADIR ve bilinçlidir: etiketler (RENK / EN / HEDEF
 * METRAJ) hücre-başına değil topluca yönetilir ve bugüne dek hiçbir yerden
 * ayarlanamıyordu — sahanın "şu yazı küçük kalıyor" şikayetinin en sık kaynağı.
 */
export const TRAVELER_FIELDS: TravelerFieldDef[] = [
  // ── antet ─────────────────────────────────────────────────────────────────
  { key: "company", label: "Firma adı", group: "header", selector: ".company", base: (d) => d.company, weight: 800 },
  { key: "companyMeta", label: "Adres / telefon satırı", group: "header", selector: ".company-meta", base: (d) => d.companyMeta, weight: 400 },
  { key: "docTitle", label: "Belge başlığı (REFAKAT KARTI)", group: "header", selector: ".doc-title", base: (d) => d.docTitle, weight: 800 },
  { key: "smallLabel", label: "Küçük etiketler (KART NO / ÖZELLİKLER)", group: "header", selector: ".lbl, .p-lbl", base: (d) => d.lbl, weight: 700 },
  { key: "cardNo", label: "Kart no", group: "header", selector: ".card-no", base: (d) => d.cardNo, weight: 800 },
  { key: "cardMeta", label: "Basım bilgisi (tarih · versiyon)", group: "header", selector: ".card-meta", base: (d) => d.cardMeta, weight: 400 },

  // ── kimlik satırı ─────────────────────────────────────────────────────────
  { key: "woNo", label: "İŞ EMRİ NO", group: "identity", selector: ".batch", base: (d) => d.woNo, weight: 800 },
  { key: "typeText", label: "Tür · rota satırı", group: "identity", selector: ".type-text", base: (d) => d.typeText, weight: 400 },
  { key: "productCode", label: "Ürün kodu rozeti", group: "identity", selector: ".product-code", base: (d) => d.productCode, weight: 800 },
  { key: "productName", label: "Ürün adı", group: "identity", selector: ".product-name", base: (d) => d.productName, weight: 800 },
  { key: "qrBlock", label: "Karekod kutusu", group: "identity", selector: ".qr-block", base: (d) => d.base, weight: 400 },
  { key: "barcodeText", label: "Karekod altındaki kod metni", group: "identity", selector: ".barcode", base: (d) => d.barcode, weight: 800 },
  { key: "qrHint", label: "Karekod ipucu yazısı", group: "identity", selector: ".qr-hint", base: (d) => d.qrHint, weight: 400 },

  // ── özet tablo (yalnız ETİKETLER; değerler hücre-başına) ──────────────────
  { key: "specLabel", label: "Etiketler (RENK / EN / HEDEF METRAJ)", group: "spec", selector: ".c-lbl", base: (d) => d.cLbl, weight: 700 },

  // ── özellikler ────────────────────────────────────────────────────────────
  { key: "chip", label: "Özellik rozetleri", group: "properties", selector: ".chip", base: (d) => d.chip, weight: 600 },

  // ── operasyon kaydı ───────────────────────────────────────────────────────
  { key: "opHead", label: "Başlık satırı", group: "operations", selector: ".op th", base: (d) => d.opHead, weight: 700 },
  { key: "opStation", label: "İstasyon adı", group: "operations", selector: ".op-st-n", base: (d) => d.opStN, weight: 600 },
  { key: "opSub", label: "İstasyon alt satırı (fason firma)", group: "operations", selector: ".op-sub", base: (d) => d.opSub, weight: 400 },

  // ── tablo başlıkları ──────────────────────────────────────────────────────
  { key: "orderHead", label: "Başlık satırı", group: "orders", selector: ".ord th", base: (d) => d.ord, weight: 400 },
  { key: "batchHead", label: "Başlık satırı", group: "batches", selector: ".bat th", base: (d) => d.bat, weight: 400 },

  // ── talimatlar ────────────────────────────────────────────────────────────
  { key: "notesText", label: "Talimat metni", group: "notes", selector: ".notes-t", base: (d) => d.notes, weight: 400 },

  // ── alt bant ──────────────────────────────────────────────────────────────
  { key: "sectionTitle", label: "Bölüm başlıkları (OPERASYON KAYDI …)", group: "footer", selector: ".sec-t", base: (d) => d.secT, weight: 700 },
  { key: "emptyText", label: '"Kayıt yok" metni', group: "footer", selector: ".empty", base: (d) => d.empty, weight: 400 },
  { key: "footNote", label: "Alt not", group: "footer", selector: ".foot-note", base: (d) => d.footNote, weight: 400 },
  { key: "watermark", label: "Filigran (İPTAL / TASLAK)", group: "footer", selector: ".wm", base: (d) => d.watermark, weight: 800, root: true },
];

const BY_KEY = new Map(TRAVELER_FIELDS.map((f) => [f.key, f]));

/** Panel de aynı sınırı gösterir (Electron aynası `travelerCardFields.ts`). */
export const TRAVELER_FIELD_SIZE_MIN = 5;
export const TRAVELER_FIELD_SIZE_MAX = 48;

/** px'i 2 haneye yuvarla; tam sayıysa ".00" ekleme (parmak izi gürültüsü olmasın). */
const px = (n: number): number => Number(n.toFixed(2));

/**
 * İstemciden gelen ham alan haritasını güvenli tipe indirger (saklama öncesi).
 *
 * ⚠️ `doc-style.sanitizeDocFields` KULLANILMAZ: o `hidden`'ı tanımaz ve yalnız
 * görünürlüğü değiştirilmiş bir alanı ("punto varsayılan kalsın, sadece
 * gizlensin") SESSİZCE düşürürdü — kullanıcı kutuyu kapatır, kaydeder, alan
 * basılmaya devam eder ve sebebi hiçbir yerde yazmaz.
 *
 * Boş/anlamsız girdi ATILIR; sonuç boşsa `undefined` döner (renderer'ın "override
 * yoksa tek bayt CSS basılmaz" kuralının ön koşulu).
 */
export function sanitizeTravelerFields(
  raw: unknown,
): Record<string, TravelerFieldStyle> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, TravelerFieldStyle> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const entry: TravelerFieldStyle = {};
    if (typeof o.size === "number" && Number.isFinite(o.size)) {
      entry.size = px(Math.min(TRAVELER_FIELD_SIZE_MAX, Math.max(TRAVELER_FIELD_SIZE_MIN, o.size)));
    }
    if (typeof o.weight === "string" && o.weight in DOC_FIELD_WEIGHTS) {
      entry.weight = o.weight as DocFieldWeight;
    }
    // `hidden: false` YAZILMAZ — varsayılan zaten "görünür". Yazılsaydı kutuyu
    // açıp kapatan her kullanıcı config'e ölü bir kayıt bırakırdı.
    if (o.hidden === true) entry.hidden = true;
    if (entry.size != null || entry.weight != null || entry.hidden) out[key.slice(0, 40)] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Alan override'larından CSS üretir. Override yoksa **boş string** (kural 1).
 * Bilinmeyen anahtar sessizce atlanır — eski bir ayar kaydı yeni sürümde baskıyı
 * DÜŞÜRMEMELİ.
 */
export function travelerFieldCss(
  fields: Record<string, TravelerFieldStyle> | undefined,
  d: TravelerDensity,
): string {
  if (!fields) return "";
  const rules: string[] = [];
  // Katalog sırasında dolaş (nesne anahtar sırası değil) — çıktı deterministik
  // olmalı, yoksa aynı ayar iki kayıtta farklı CSS üretir ve snapshot
  // karşılaştırmaları ("içerik değişti mi") yanlış pozitif verir.
  for (const def of TRAVELER_FIELDS) {
    const cfg = fields[def.key];
    if (!cfg) continue;
    const prefix = def.root ? "body " : ".sheet ";
    const sel = def.selector
      .split(",")
      .map((s) => `${prefix}${s.trim()}`)
      .join(", ");
    // Gizli alanda punto/kalınlık basmak ölü bayttır — görünmeyen şeyin boyu yok.
    if (cfg.hidden) {
      rules.push(`${sel} { display: none; }`);
      continue;
    }
    const decls: string[] = [];
    if (cfg.size != null) decls.push(`font-size: ${px(cfg.size)}px`);
    if (cfg.weight != null) decls.push(`font-weight: ${DOC_FIELD_WEIGHTS[cfg.weight]}`);
    if (!decls.length) continue;
    rules.push(`${sel} { ${decls.join("; ")}; }`);
  }
  void d; // taban çözümü `resolveTravelerField`te; imza simetri için burada da
  return rules.join("\n  ");
}

/** Bir alanın çözülmüş (nihai) punto/kalınlığı — bekçi ve panel önizlemesi için. */
export function resolveTravelerField(
  key: string,
  fields: Record<string, TravelerFieldStyle> | undefined,
  d: TravelerDensity,
): { size: number; weight: number; hidden: boolean } | null {
  const def = BY_KEY.get(key);
  if (!def) return null;
  const cfg = fields?.[key];
  return {
    size: cfg?.size ?? def.base(d),
    weight: cfg?.weight != null ? DOC_FIELD_WEIGHTS[cfg.weight] : def.weight,
    hidden: cfg?.hidden === true,
  };
}

export type { DocFieldStyle, DocFieldWeight };
