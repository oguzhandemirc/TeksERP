// =============================================================================
// Fason sevk çeki — ALAN BAZLI yazı ayarı kataloğu (tek kaynak)
// =============================================================================
// Saha isteği: "her şeyin kalınlığı ve büyüklüğü ayrı ayrı değiştirilebilsin —
// şu an metre ve cm verilerinin büyüklüğü kalınlığı ayrıca belirlenemiyor."
// Belge geneli `fontScale`/`fontWeight` bu soruyu cevaplayamıyordu: tek kolu
// çevirince başlık da grid de birlikte büyüyordu.
//
// Katalog `key → (seçici, taban punto, taban kalınlık)` eşlemesidir. Taban değer
// YOĞUNLUK PROFİLİNDEN gelir (A4/A5 ayrı) — yani "varsayılan" sayfa boyutuna
// göre değişir, kullanıcı ayarı ise mutlak px'tir ve ikisini de ezer.
//
// ⚠️ ÜÇ LOAD-BEARING KURAL:
//
// 1. OVERRIDE YOKSA TEK BAYT CSS BASILMAZ. `fasonFieldCss({}, d)` boş string
//    döner → ayara hiç dokunmamış bir belgenin çıktısı bugünküyle birebir aynı
//    kalır. (`fason-ceki.html.ts`'teki `batchRow` disiplininin aynısı: koşullu
//    parça, kapalıyken çıktıya boşluk bile bırakmaz.)
//
// 2. `calc()` / CSS DEĞİŞKENİ KULLANILMAZ. `doc-style.scaleDocCss` yazı ölçeğini
//    `font-size:\s*([\d.]+)px` regex'iyle uyguluyor; `calc(10px * var(--x))` bu
//    desene takılmaz ve belge geneli ölçek ayarı tam da kullanıcının elle
//    ayarladığı alanlarda SESSİZCE çalışmaz olurdu. Nihai px burada hesaplanır.
//
// 3. SEÇİCİ ÖZGÜLLÜĞÜ TABAN CSS'İ GEÇMELİ. Örn. grid metre hücresi için
//    `.grid tbody .c-met` gerekir; düz `.c-met` (0,1,0) taban kuraldaki
//    `.grid th, .grid td` (0,1,1) tarafından ezilirdi ve ayar sessizce ölürdü.
//    Bu yüzden HER seçici `.sheet ` ile öneklenir: taban kurallar öneksizdir,
//    yani alan kuralı her zaman en az bir sınıf daha özgüldür ve CSS sırasından
//    BAĞIMSIZ olarak kazanır. (Yalnız "sonra basılıyor" güvencesine yaslanmak,
//    ileride biri blokları yer değiştirdiğinde hatasız/logsuz bozulurdu.)
// =============================================================================

import {
  DOC_FIELD_WEIGHTS,
  type DocFieldStyle,
  type DocFieldWeight,
} from "./doc-style";
import type { FasonDensity } from "./fason-ceki.density";
import { cssFixed } from "./fmt-num";

export interface FasonFieldDef {
  /** Config anahtarı — Electron paneli aynı anahtarı yazar. */
  key: string;
  /** Panelde görünen ad (Electron `documentConfig.ts` aynasında da yazılıdır). */
  label: string;
  /** Panelde gruplama başlığı. */
  group: "header" | "grid" | "totals" | "boxes" | "footer";
  /** Hedef CSS seçici(ler)i — `.sheet ` öneki `fasonFieldCss` tarafından eklenir. */
  selector: string;
  /** Taban punto (yoğunluk profilinden). */
  base: (d: FasonDensity) => number;
  /** Taban kalınlık. */
  weight: number;
}

/**
 * Alan kataloğu. Sıra panelde göründüğü sıradır.
 *
 * ⚠️ `gridMetre` gövde hücresidir, `gridHead` başlık satırı — BİLEREK AYRI
 * satırlardır. Taban CSS'te ikisi de `.grid th, .grid td` kuralından besleniyor;
 * ayrı ayrı ayarlanabilmeleri için gövde seçicisi `tbody` üzerinden
 * özgülleştirildi. (Üçüncü kardeş `gridCm` 2026-08-06'da düştü — aşağıya bak.)
 */
export const FASON_FIELDS: FasonFieldDef[] = [
  // ── başlık bandı ───────────────────────────────────────────────────────────
  { key: "company", label: "Firma adı", group: "header", selector: ".company", base: (d) => d.company, weight: 800 },
  { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header", selector: ".lh-line", base: (d) => d.lhLine, weight: 400 },
  { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header", selector: ".sayin", base: (d) => d.sayin, weight: 400 },
  { key: "sayin", label: "Fason firma adı", group: "header", selector: ".sayin b", base: (d) => d.sayinB, weight: 700 },
  { key: "subLine", label: "İstasyon · iş emri satırı", group: "header", selector: ".sub", base: (d) => d.sub, weight: 400 },
  { key: "title", label: "Belge başlığı", group: "header", selector: ".title", base: (d) => d.title, weight: 800 },
  { key: "docNo", label: "İrsaliye no", group: "header", selector: ".ln.ln-docno b", base: (d) => d.lnB, weight: 700 },
  { key: "docDate", label: "Tarih", group: "header", selector: ".ln.ln-date b", base: (d) => d.lnB, weight: 700 },
  { key: "batchNo", label: "Parti no", group: "header", selector: ".ln.ln-batch b", base: (d) => d.lnB, weight: 700 },
  { key: "lnLabel", label: "Satır etiketleri (İrsaliye No: / Tarih: / Parti No:)", group: "header", selector: ".ln", base: (d) => d.ln, weight: 400 },
  { key: "vehicle", label: "Plaka / şoför satırı", group: "header", selector: ".meta-row", base: (d) => d.metaRow, weight: 400 },
  { key: "fabricLine", label: "Cins / En / Renk satırları (parti no altı)", group: "header", selector: ".ln.ln-fabric, .ln.ln-fabric b", base: (d) => d.lnB, weight: 700 },

  // ── grid ───────────────────────────────────────────────────────────────────
  { key: "gridHead", label: "Grid başlıkları (Top / Metre / Cm)", group: "grid", selector: ".grid thead th", base: (d) => d.gridCell, weight: 700 },
  { key: "gridTop", label: "Grid — top sıra no", group: "grid", selector: ".grid tbody .c-top", base: (d) => d.gridCell, weight: 700 },
  { key: "gridMetre", label: "Grid — METRE değeri", group: "grid", selector: ".grid tbody .c-met", base: (d) => d.gridCell, weight: 400 },
  // ⚠️ `gridCm` 2026-08-06'da KALDIRILDI: grid'de top başına EN sütunu artık yok
  // (belgede tek EN var, iş emrinden gelir). Katalogda bırakmak, panelde hiçbir
  // şeyi değiştirmeyen bir punto kutusu çizerdi — bu dosyanın "ölü toggle" yasağı.
  // Eski kayıtlardaki `fields.gridCm` sessizce atlanır (fasonFieldCss kuralı).

  // ── alt toplam tablosu ─────────────────────────────────────────────────────
  { key: "totalsHead", label: "Alt tablo başlıkları (CİNSİ / EN / TOP …)", group: "totals", selector: ".totals thead th", base: (d) => d.totalsHead, weight: 700 },
  { key: "totalsCell", label: "Alt tablo değerleri", group: "totals", selector: ".totals tbody td", base: (d) => d.totalsCell, weight: 400 },
  { key: "totalsFoot", label: "TOPLAM satırı", group: "totals", selector: ".totals tbody tr.tot td", base: (d) => d.totalsCell, weight: 800 },

  // ── kutular ────────────────────────────────────────────────────────────────
  // ⚠️ TALİMAT KUTUSU AYRI ANAHTARLAR TAŞIR (`cmdLabel`/`cmdValue`), mevcut
  // `boxLabel`/`boxText` ile PAYLAŞMAZ. Sebep bu dosyanın var oluş sebebiyle
  // aynı: o ikisi `.instr-lbl`/`.instr-txt`e bağlıdır ve İKİ kutuyu birden
  // yönetir — talimat kutusu onlara bağlansaydı saha "boyanacak rengi büyüttüm,
  // FASON TALİMATI da büyüdü" derdi.
  // Renk ile işlemler için AYRI punto anahtarı bilinçli AÇILMADI (tek `cmdValue`):
  // kullanıcı ikisini de eşit derecede "net" istedi.
  { key: "cmdLabel", label: "Talimat kutusu etiketi (BOYANACAK RENK / YAPILACAK İŞLEMLER)", group: "boxes", selector: ".cmd-lbl, .cmd-sep", base: (d) => d.cmdLbl, weight: 700 },
  { key: "cmdValue", label: "Talimat kutusu değeri (renk / işlemler)", group: "boxes", selector: ".cmd-val", base: (d) => d.cmdVal, weight: 800 },
  { key: "boxLabel", label: "Kutu etiketi (İSTENEN ÖZELLİKLER / FASON TALİMATI)", group: "boxes", selector: ".instr-lbl", base: (d) => d.instrLbl, weight: 700 },
  { key: "boxText", label: "Kutu metni", group: "boxes", selector: ".instr-txt", base: (d) => d.instrTxt, weight: 600 },
  { key: "note", label: "Not / alt bilgi", group: "boxes", selector: ".note", base: (d) => d.note, weight: 400 },

  // ── alt bant ───────────────────────────────────────────────────────────────
  { key: "signLabel", label: "İmza etiketleri", group: "footer", selector: ".sign-lbl", base: (d) => d.signLbl, weight: 400 },
  { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer", selector: ".stamps-l", base: () => 9, weight: 400 },
];

const BY_KEY = new Map(FASON_FIELDS.map((f) => [f.key, f]));

/**
 * Alan override'larından CSS üretir. Override yoksa **boş string** döner (kural 1).
 * Bilinmeyen anahtar sessizce atlanır — eski bir ayar kaydı yeni sürümde baskıyı
 * düşürmemeli (belge basmak vardiyayı durdurmayacak kadar kritik).
 */
export function fasonFieldCss(
  fields: Record<string, DocFieldStyle> | undefined,
  d: FasonDensity,
): string {
  if (!fields) return "";
  const rules: string[] = [];
  // Katalog sırasında dolaş (nesne anahtar sırası değil) — çıktı deterministik
  // olmalı, yoksa aynı ayar iki kayıtta farklı CSS üretir ve `isTemplateStale`
  // gibi karşılaştırmalar yanlış "değişmiş" der.
  for (const def of FASON_FIELDS) {
    const cfg = fields[def.key];
    if (!cfg) continue;
    const decls: string[] = [];
    if (cfg.size != null) {
      // Düz px — calc()/var() YASAK (kural 2).
      decls.push(`font-size: ${Number(cssFixed(cfg.size, 2))}px`);
    }
    if (cfg.weight != null) {
      decls.push(`font-weight: ${DOC_FIELD_WEIGHTS[cfg.weight]}`);
    }
    if (!decls.length) continue;
    // `.sheet ` öneki (kural 3) — çok seçicili tanımlarda HER parçaya ayrı ayrı.
    const sel = def.selector
      .split(",")
      .map((s) => `.sheet ${s.trim()}`)
      .join(", ");
    rules.push(`${sel} { ${decls.join("; ")}; }`);
  }
  // `d` bugün yalnız taban çözümünde (panel önizlemesi) kullanılıyor; imza
  // buradan geçiyor ki ileride "taban + delta" moduna geçmek istenirse üretim
  // kodu değil yalnız bu fonksiyon değişsin.
  void d;
  return rules.join("\n  ");
}

/** Bir alanın çözülmüş (nihai) punto/kalınlığı — bekçi ve panel önizlemesi için. */
export function resolveFasonField(
  key: string,
  fields: Record<string, DocFieldStyle> | undefined,
  d: FasonDensity,
): { size: number; weight: number } | null {
  const def = BY_KEY.get(key);
  if (!def) return null;
  const cfg = fields?.[key];
  return {
    size: cfg?.size ?? def.base(d),
    weight: cfg?.weight != null ? DOC_FIELD_WEIGHTS[cfg.weight] : def.weight,
  };
}

export type { DocFieldStyle, DocFieldWeight };
