// =============================================================================
// Belge stil katmanı — 4 belge renderer'ının ORTAK stil çözücüsü (TEK KAYNAK)
// =============================================================================
// DocumentConfig.style (ham, kısmi) → ResolvedDocStyle (tam). Uygulama yöntemi
// refakat kartıyla (traveler-card.html.ts) aynı kanıtlanmış patern:
//   - @page boyut/margin CSS'i TS'te üretilir (docPageCss)
//   - tablo yoğunluk/stil override'ları taban CSS'ten SONRA basılır (docTableCss)
//   - fontScale/fontWeight, bitmiş CSS üzerinde regex ile ölçeklenir/kaydırılır
//     (scaleDocCss) — layout mm/px değerlerine DOKUNULMAZ, sadece yazı değişir.
// Stil, DocumentConfig'in parçası olduğu için freeze anında snapshot'a otomatik
// donar (docConfigOverride) — eski belge her zaman kendi görünümüyle basılır.
// =============================================================================

/** Ham (kısmi) stil ayarı — DocumentConfig.style. Tüm alanlar opsiyonel. */
export interface DocStyleConfig {
  /** Sayfa boyutu (default A4). */
  pageSize?: "A4" | "A5";
  /** Kenar boşlukları mm (verilmeyen kenar → belgenin kendi varsayılanı). */
  margins?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Yazı ölçeği 0.7–1.4 (default 1) — tüm font-size'lar çarpılır. */
  fontScale?: number;
  /** Yazı kalınlığı — tüm font-weight'lere ±100 delta. */
  fontWeight?: "light" | "normal" | "bold";
  /** Tablo hücre yoğunluğu (default normal). */
  tableDensity?: "compact" | "normal" | "relaxed";
  /** Tablo çizgi stili (default grid = tam çerçeve). */
  tableStyle?: "grid" | "zebra" | "plain";
}

/**
 * ALAN BAZLI yazı ayarı — `DocumentConfig.fields[<alanKey>]`.
 *
 * `DocStyleConfig.fontScale/fontWeight` BELGE GENELİNE uygulanır; bu ise tek bir
 * alanı ("grid metre değeri", "parti no", "imza etiketi") ayrı ayarlar. İkisi
 * çakışmaz: alan ayarı TABANI belirler, genel ayar onun ÜSTÜNE biner (renderer
 * nihai px'i yazar, `scaleDocCss` sonra çarpar).
 *
 * ⚠️ Alan kataloğu belgeye özeldir (bugün yalnız fason çeki —
 * `fason-ceki.fields.ts`); burada duran şey yalnız ORTAK tip + kayıt kapısıdır.
 */
export type DocFieldWeight = "light" | "normal" | "medium" | "bold" | "black";

export interface DocFieldStyle {
  /** Yazı boyu px. Verilmezse alanın yoğunluk profilindeki tabanı geçerlidir. */
  size?: number;
  /** Yazı kalınlığı. Verilmezse alanın taban kalınlığı geçerlidir. */
  weight?: DocFieldWeight;
}

/** Etiket → CSS font-weight. `scaleDocCss`'in ±100 kaydırması bunun üstüne biner. */
export const DOC_FIELD_WEIGHTS: Record<DocFieldWeight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  bold: 700,
  black: 800,
};

/** Alan yazı boyu sınırları — panel de aynı sınırı gösterir. */
export const DOC_FIELD_SIZE_MIN = 5;
export const DOC_FIELD_SIZE_MAX = 48;

/**
 * İstemciden gelen ham alan haritasını güvenli tipe indirger (saklama öncesi).
 * Boş/anlamsız girdi ATILIR — yarım bir `{}` kaydı, "ayarladım ama bir şey
 * olmadı" hissini kalıcılaştırırdı. Sonuç boşsa `undefined` döner.
 */
export function sanitizeDocFields(raw: unknown): Record<string, DocFieldStyle> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, DocFieldStyle> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const entry: DocFieldStyle = {};
    if (typeof o.size === "number" && Number.isFinite(o.size)) {
      entry.size = Math.min(DOC_FIELD_SIZE_MAX, Math.max(DOC_FIELD_SIZE_MIN, o.size));
    }
    if (typeof o.weight === "string" && o.weight in DOC_FIELD_WEIGHTS) {
      entry.weight = o.weight as DocFieldWeight;
    }
    if (entry.size != null || entry.weight != null) out[key.slice(0, 40)] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface ResolvedDocStyle {
  pageSize: "A4" | "A5";
  margins: { top: number; right: number; bottom: number; left: number };
  fontScale: number;
  /** font-weight kaydırması: light=-100, bold=+100, normal=0. */
  weightDelta: number;
  tableDensity: "compact" | "normal" | "relaxed";
  tableStyle: "grid" | "zebra" | "plain";
}

const clampMm = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(40, Math.max(0, v)) : fallback;

/**
 * İstemciden gelen ham stil objesini güvenli tipe indirger (saklama öncesi) —
 * bilinmeyen alan atılır, tip uymayan değer yok sayılır. Boş sonuç → undefined
 * (JSON'da gereksiz `style: {}` birikmesin).
 */
export function sanitizeDocStyleConfig(raw: unknown): DocStyleConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: DocStyleConfig = {};
  if (o.pageSize === "A4" || o.pageSize === "A5") out.pageSize = o.pageSize;
  if (o.margins && typeof o.margins === "object" && !Array.isArray(o.margins)) {
    const m = o.margins as Record<string, unknown>;
    const margins: NonNullable<DocStyleConfig["margins"]> = {};
    for (const k of ["top", "right", "bottom", "left"] as const) {
      if (typeof m[k] === "number" && Number.isFinite(m[k])) {
        margins[k] = Math.min(40, Math.max(0, m[k] as number));
      }
    }
    if (Object.keys(margins).length) out.margins = margins;
  }
  if (typeof o.fontScale === "number" && Number.isFinite(o.fontScale)) {
    out.fontScale = Math.min(1.4, Math.max(0.7, o.fontScale));
  }
  if (o.fontWeight === "light" || o.fontWeight === "normal" || o.fontWeight === "bold") {
    out.fontWeight = o.fontWeight;
  }
  if (o.tableDensity === "compact" || o.tableDensity === "normal" || o.tableDensity === "relaxed") {
    out.tableDensity = o.tableDensity;
  }
  if (o.tableStyle === "grid" || o.tableStyle === "zebra" || o.tableStyle === "plain") {
    out.tableStyle = o.tableStyle;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Ham stil + belge varsayılan margin'i → tam stil. Renderer'lar bunu çağırır;
 * eski snapshot'larda style alanı yok → tümü varsayılana düşer (görünüm değişmez).
 */
export function resolveDocStyle(
  raw: DocStyleConfig | undefined,
  defaults: { marginMm: number },
): ResolvedDocStyle {
  const m = raw?.margins;
  return {
    pageSize: raw?.pageSize === "A5" ? "A5" : "A4",
    margins: {
      top: clampMm(m?.top, defaults.marginMm),
      right: clampMm(m?.right, defaults.marginMm),
      bottom: clampMm(m?.bottom, defaults.marginMm),
      left: clampMm(m?.left, defaults.marginMm),
    },
    fontScale:
      typeof raw?.fontScale === "number" && raw.fontScale > 0
        ? Math.min(1.4, Math.max(0.7, raw.fontScale))
        : 1,
    weightDelta: raw?.fontWeight === "light" ? -100 : raw?.fontWeight === "bold" ? 100 : 0,
    tableDensity:
      raw?.tableDensity === "compact" || raw?.tableDensity === "relaxed"
        ? raw.tableDensity
        : "normal",
    tableStyle:
      raw?.tableStyle === "zebra" || raw?.tableStyle === "plain" ? raw.tableStyle : "grid",
  };
}

/** `@page` kuralı — boyut + mm kenar boşlukları. */
export function docPageCss(s: ResolvedDocStyle): string {
  const { top, right, bottom, left } = s.margins;
  return `@page { size: ${s.pageSize}; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`;
}

/**
 * Tablo yoğunluk + çizgi stili override'ları. Taban CSS'ten SONRA basılmalı.
 * `selectors`: veri tablosu sınıf seçicileri (örn. [".sec"], [".sec", ".totals"]).
 * Toplam satırı (.tot) zebra dışında tutulur (kendi arka planı korunur).
 */
export function docTableCss(s: ResolvedDocStyle, selectors: string[]): string {
  const rules: string[] = [];
  const pad =
    s.tableDensity === "compact" ? "2px 4px" : s.tableDensity === "relaxed" ? "5px 9px" : null;
  for (const sel of selectors) {
    if (pad) rules.push(`${sel} th, ${sel} td { padding: ${pad}; }`);
    if (s.tableStyle === "zebra") {
      rules.push(`${sel} tbody tr:nth-child(even):not(.tot) td { background: #eef2f7; }`);
    } else if (s.tableStyle === "plain") {
      rules.push(
        `${sel} th, ${sel} td { border-left: none; border-right: none; }`,
        `${sel} { border-bottom: 1px solid #000; }`,
      );
    }
  }
  return rules.join("\n  ");
}

/**
 * Çok sayfaya taşan tablolar için sayfalama hijyeni. HER belgede geçerli, ayara
 * bağlı değil — bunlar tercih değil, doğru baskının koşulu.
 *
 *  • `thead { table-header-group }` — tablo sayfa sınırını aşınca başlık satırı
 *    (ve `buildDocTable`'ın thead'e bastığı BAŞLIK hücresi, ör. "ÇUVAL LİSTESİ")
 *    devam sayfasında TEKRAR eder. Bu kural yokken 1,5 sayfalık çuval listesinin
 *    ikinci sayfası başlıksız, kolon adları olmayan çıplak sayı bloğu olarak
 *    basılıyordu — okuyan hangi kolonun ne olduğunu bilmiyordu.
 *  • `tr { break-inside: avoid }` — bir satır iki sayfaya BÖLÜNMEZ.
 *  • `.tot` (toplam satırı) tbody'nin sonunda; kendi başına sayfa açmasın diye
 *    üstündeki satırla birlikte tutulur.
 *
 * `page-break-*` eşlenikleri eski WebKit yolu için birlikte basılır (Chromium
 * ikisini de tanır; expo-print ve Electron aynı motoru kullanır).
 */
export const DOC_PAGINATION_CSS = `
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tr.tot { break-before: avoid; page-break-before: avoid; }`;

/** Logo CSS'i — her belgenin taban CSS'ine eklenir (logo yoksa da zararsız). */
export const DOC_LOGO_CSS = `
  .doc-logo { display: block; max-height: 44px; max-width: 170px; object-fit: contain; margin-bottom: 4px; }
  .hr .doc-logo { margin-left: auto; }`;

/**
 * Başlık logo parçaları — sol blok (.hl, firma adının üstü) veya sağ blok (.hr,
 * başlığın üstü). dataUrl setDocumentsLogo'da doğrulanmış base64 data-url'dir.
 */
export function docLogoHtml(
  logoDataUrl: string | null | undefined,
  cfg: { showLogo?: boolean; logoPosition?: "left" | "right" },
): { left: string; right: string } {
  if (!logoDataUrl || cfg.showLogo === false) return { left: "", right: "" };
  const img = `<img class="doc-logo" src="${logoDataUrl}" alt="">`;
  return cfg.logoPosition === "right" ? { left: "", right: img } : { left: img, right: "" };
}

// ── Damgalar / bloklar / baskı notu (2c + 3) ─────────────────────────────────

type EscFn = (v: unknown) => string;

/** Damga + blok + not CSS'i — her belgenin taban CSS'ine eklenir. */
export const DOC_STAMPS_CSS = `
  .copy-badge { display: inline-block; border: 1.5px solid #000; padding: 1px 8px; font-weight: 700; font-size: 11px; letter-spacing: 1px; margin-top: 3px; }
  .stamps { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-top: 10px; }
  .stamps-l { font-size: 9px; color: #555; }
  .stamps img { width: 62px; height: 62px; }
  .doc-block { margin-top: 8px; font-size: 11px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; }`;

interface StampsCfg {
  stamps?: { printedAt?: boolean; printedBy?: boolean; copyLabel?: string };
  blocks?: { position: "afterHeader" | "beforeSignatures"; text: string }[];
}

/** Nüsha rozeti (ASIL/KOPYA...) — başlığın altına. Boş etiket → basılmaz. */
export function docCopyBadge(cfg: StampsCfg, esc: EscFn): string {
  const label = cfg.stamps?.copyLabel?.trim();
  return label ? `<div class="copy-badge">${esc(label)}</div>` : "";
}

/** Konumlu serbest metin blokları. */
export function docBlocksHtml(
  cfg: StampsCfg,
  position: "afterHeader" | "beforeSignatures",
  esc: EscFn,
): string {
  return (cfg.blocks ?? [])
    .filter((b) => b.position === position && b.text.trim())
    .map((b) => `<div class="doc-block">${esc(b.text)}</div>`)
    .join("");
}

/** Tek seferlik baskı notu (?printNote=) — kalıcı ayara girmez, bu render'a özeldir. */
export function docPrintNoteHtml(printNote: string | null | undefined, esc: EscFn): string {
  return printNote?.trim() ? `<div class="doc-block">${esc(printNote)}</div>` : "";
}

/**
 * Sayfa altı damga çubuğu: solda basım zamanı/basan, sağda doğrulama QR'ı.
 * Hepsi kapalı/boşsa hiç basılmaz.
 */
export function docStampsBar(
  cfg: StampsCfg & { qr?: boolean },
  meta: { qrDataUrl?: string | null; printedAtText?: string; printedBy?: string | null },
  esc: EscFn,
  labels: { printedAt: string; printedBy: string },
): string {
  const bits: string[] = [];
  if (cfg.stamps?.printedAt && meta.printedAtText) {
    bits.push(`${esc(labels.printedAt)}: ${esc(meta.printedAtText)}`);
  }
  if (cfg.stamps?.printedBy && meta.printedBy) {
    bits.push(`${esc(labels.printedBy)}: ${esc(meta.printedBy)}`);
  }
  const qrImg = cfg.qr && meta.qrDataUrl ? `<img src="${meta.qrDataUrl}" alt="">` : "";
  if (!bits.length && !qrImg) return "";
  return `<div class="stamps"><div class="stamps-l">${bits.join(" &nbsp;·&nbsp; ")}</div>${qrImg}</div>`;
}

/**
 * Bitmiş CSS üzerinde yazı ölçeği + kalınlık kaydırması (refakat kartı paterni).
 * Yalnız `font-size: Npx` ve `font-weight: N` değerlerine dokunur; mm/padding
 * gibi layout değerleri korunur → oran bozulmaz.
 *
 * ⚠️ BU REGEX BİR SÖZLEŞMEDİR: yazı boyu üreten her yol düz `font-size: 13.2px`
 * basmalı. `calc(10px * var(--x))` ya da `font-size: 1.2em` yazan bir yol bu
 * desene TAKILMAZ → belge geneli "Yazı ölçeği" ayarı o alanlarda SESSİZCE
 * çalışmaz (hata yok, log yok; sahadan gelen tek belirti "ölçeği değiştiriyorum,
 * bazı yazılar büyümüyor" olur). Alan bazlı ayar (`DocFieldStyle`) bu yüzden
 * nihai px'i TS'te hesaplar. Bekçi: `test_fason_ceki_html.ts` §13.
 */
export function scaleDocCss(css: string, s: ResolvedDocStyle): string {
  let out = css;
  if (s.fontScale !== 1) {
    out = out.replace(
      /font-size:\s*([\d.]+)px/g,
      (_m, n: string) => `font-size: ${Number((Number(n) * s.fontScale).toFixed(2))}px`,
    );
  }
  if (s.weightDelta !== 0) {
    out = out.replace(/font-weight:\s*(\d{3})\b/g, (_m, n: string) => {
      const w = Math.min(900, Math.max(100, Number(n) + s.weightDelta));
      return `font-weight: ${w}`;
    });
  }
  return out;
}
