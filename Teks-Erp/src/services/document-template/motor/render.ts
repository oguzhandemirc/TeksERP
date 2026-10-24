// =============================================================================
// Belge şablonu render hattı — derle → Liquid (katı) → sıkı temizleyici → üst katman
// =============================================================================
// Akış (plan §3.3): yönerge derleme (görsel kip) → parse (LRU 50, anahtar versionId) →
// `renderUserTemplate(strict)` içinde Liquid doldurma → izin listesi temizliği → SVG
// işaret yerleştirme → doğrulayıcı (`tekserp` adı, @bottom-left, sözde-işlevde #, @page
// kenarı — Liquid adı çalışma anında üretebildiği için RENDER ANINDA da) → `<html lang="tr">`
// + filigran/künye. Liquid kaynağı ön temizlikten GEÇMEZ (`<` karşılaştırması bozulurdu);
// güvenlik sınırı doldurma SONRASI temizliktir. Hata FAIL-CLOSED: konumlu Türkçe liste.

import { performance } from "node:perf_hooks";
import type { Template } from "liquidjs";
import { docNum } from "../../document-render/fmt-num";
import { renderUserTemplate, sanitizeUserHtml, stripRawMarkers } from "../../document-render/template-html.sanitize";
import { sanitizeCss } from "../../document-render/template-html.css";
import { tokenizeHtml } from "../../document-render/template-html.tokenizer";
import { LIQUID_LIMITS, LiquidTemplateError, parseLiquid, renderLiquid } from "./liquid";
import { cssViolations, htmlViolations, overlayBodyHtml, overlayHeadCss, ROOT_IDS, type OverlayInput } from "./overlay";
import { BASE_PRINT_CSS, normalizePageSettings, pageCss, PageSettingsError } from "./sayfa";
import { compileDirectives, formatIssue, textPosition, type SourcePosition } from "./yonerge";

/** Render'a giren şablon sürümü (DB satırı ya da önizleme gövdesi). */
export interface TemplateSource {
  /** Verilirse ayrıştırılmış şablon önbelleklenir (sürüm satırı DEĞİŞMEZ). */
  readonly versionId?: string;
  readonly editMode?: "VISUAL" | "CODE";
  /** Kaynak (görsel kipte data-* yönergeli HTML, kod kipinde ham Liquid). */
  readonly sourceHtml?: string;
  /** Kaynak yoksa hazır derlenmiş Liquid. */
  readonly compiledLiquid?: string;
  readonly css: string;
  readonly pageSettings: unknown;
}

export interface RenderOptions {
  /** Sözleşmenin düz JSON bağlamı (`belge`, `firma`, `tablolar`, `toplamlar`, `ayar` …). */
  readonly context: Readonly<Record<string, unknown>>;
  /** Damgalı snapshot zarfı; rejimi yalnız `docNum` okur (damganın tek okuru, `test_belge_ticari_yuvarlama` §6). */
  readonly snapshot?: Parameters<typeof docNum>[0];
  /** null/undefined → üst katman yok (yalnız Sistem eşdeğerlik bekçisi). */
  readonly overlay?: OverlayInput | null;
}

/** Konumlu Türkçe hata; konumu olmayan (sayfa ayarı, CSS) hata `null` satır/sütun taşır. */
export interface RenderIssue {
  readonly satir: number | null;
  readonly sutun: number | null;
  readonly mesaj: string;
}

export class TemplateRenderError extends Error {
  readonly code = "TEMPLATE_RENDER_FAILED";
  constructor(readonly issues: readonly RenderIssue[]) {
    super(issues.map((i) => (i.satir === null ? i.mesaj : formatIssue({ satir: i.satir, sutun: i.sutun ?? 0, mesaj: i.mesaj }))).join("\n"));
    this.name = "TemplateRenderError";
  }
}

export interface RenderResult {
  readonly html: string;
  /** Sıkı temizleyicinin kestiği kategoriler (önizleme uyarısı; yayında 400). */
  readonly removed: readonly string[];
  readonly warnings: readonly string[];
  readonly metrics: { readonly ms: number; readonly bytes: number };
}

interface ParsedTemplate {
  readonly templates: Template[];
  readonly position: (offset: number) => SourcePosition;
  readonly warnings: readonly string[];
}

// ── Ayrıştırma önbelleği (sürüm satırı değişmez → versionId yeterli anahtar) ─────────
const CACHE_MAX = 50;
const cache = new Map<string, ParsedTemplate>();

function cacheGet(key: string): ParsedTemplate | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, value: ParsedTemplate): void {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Bekçi/test için: önbellekteki sürüm sayısı. */
export function parseCacheSize(): number {
  return cache.size;
}

const unpositioned = (mesaj: string): RenderIssue => ({ satir: null, sutun: null, mesaj });

function parseSource(t: TemplateSource): ParsedTemplate {
  if (t.versionId) {
    const hit = cacheGet(t.versionId);
    if (hit) return hit;
  }
  let liquid: string;
  let position: (offset: number) => SourcePosition;
  let warnings: readonly string[] = [];
  if (t.sourceHtml !== undefined && t.editMode !== "CODE") {
    // Sunucu işaret karakterleri kaynaktan da ayıklanır (sahte SVG yeri üretilemesin).
    const compiled = compileDirectives(stripRawMarkers(t.sourceHtml), "VISUAL");
    if (compiled.errors.length) throw new TemplateRenderError(compiled.errors);
    liquid = compiled.liquid;
    position = compiled.sourcePosition;
    warnings = compiled.warnings;
  } else {
    const text = stripRawMarkers(t.sourceHtml ?? t.compiledLiquid ?? "");
    liquid = text;
    position = (o) => textPosition(text, o);
  }
  let templates: Template[];
  try {
    templates = parseLiquid(liquid);
  } catch (e) {
    throw toRenderError(e, position);
  }
  const parsed: ParsedTemplate = { templates, position, warnings };
  if (t.versionId) cachePut(t.versionId, parsed);
  return parsed;
}

function toRenderError(e: unknown, position: (offset: number) => SourcePosition): unknown {
  if (!(e instanceof LiquidTemplateError)) return e;
  const { offset, message } = e.record;
  if (offset === null) return new TemplateRenderError([unpositioned(message)]);
  const p = position(offset);
  return new TemplateRenderError([{ satir: p.satir, sutun: p.sutun, mesaj: message }]);
}

const MARKER_CHARS = /[]/;

/** Barkod/QR işareti yalnız düz metinde durabilir: öznitelikte ya da ham içerikte SVG HTML'i kırar. */
function assertMarkersInText(filled: string): void {
  if (!MARKER_CHARS.test(filled)) return;
  for (const tok of tokenizeHtml(filled)) {
    if (tok.kind === "text") continue;
    const inAttr = tok.kind === "start" && tok.attrs.some((a) => MARKER_CHARS.test(a.value) || MARKER_CHARS.test(a.name));
    const inOther = tok.kind !== "start" && tok.kind !== "end" && MARKER_CHARS.test(tok.text);
    if (inAttr || inOther) {
      throw new TemplateRenderError([unpositioned("Barkod ve QR yalnız metin içinde kullanılabilir (öznitelikte, stilde ya da başlıkta kullanılamaz)")]);
    }
  }
}

/** Şablon sürümünü bağlamla doldurur; hata `TemplateRenderError` (422/400 `TEMPLATE_RENDER_FAILED`). */
export function renderTemplate(t: TemplateSource, opts: RenderOptions): RenderResult {
  const started = performance.now();
  const issues: RenderIssue[] = [];

  let pageSettings = null;
  try {
    pageSettings = normalizePageSettings(t.pageSettings);
  } catch (e) {
    if (!(e instanceof PageSettingsError)) throw e;
    e.messages.forEach((m) => issues.push(unpositioned(m)));
  }
  cssViolations(t.css).forEach((m) => issues.push(unpositioned(`CSS: ${m}`)));
  if (issues.length) throw new TemplateRenderError(issues);

  const parsed = parseSource(t);
  const num = docNum(opts.snapshot ?? {});
  const svg: Record<string, string> = {};
  let filled = "";
  let body: string;
  try {
    body = renderUserTemplate(
      "",
      (_safe, marker) => {
        filled = renderLiquid({ templates: parsed.templates, context: opts.context, num, marker, svg });
        assertMarkersInText(filled);
        return filled;
      },
      svg,
      { strict: true },
    );
  } catch (e) {
    throw toRenderError(e, parsed.position);
  }
  const removed = new Set(sanitizeUserHtml(filled, { strict: true }).removed);
  htmlViolations(body).forEach((m) => issues.push(unpositioned(m)));

  // Şablon CSS'i ayrı alandır: `</style` ile HTML'e taşamasın diye kaçışı temizleyicideki gibi.
  const style = sanitizeCss(stripRawMarkers(t.css), { strict: true });
  style.removed.forEach((r) => removed.add(r));
  const templateCss = style.css.replace(/<\/(style)/gi, "\\3c /$1");
  if (issues.length) throw new TemplateRenderError(issues);

  const overlay = opts.overlay ?? null;
  const ps = pageSettings!;
  const systemCss = (overlay ? overlayHeadCss(overlay, ps.kenar.alt) : "") + BASE_PRINT_CSS + pageCss(ps);
  const html =
    `<!DOCTYPE html><html lang="tr" id="${ROOT_IDS.html}" class="" style=""><head><meta charset="utf-8">` +
    `<style>${systemCss}</style><style>${templateCss}</style></head>` +
    `<body id="${ROOT_IDS.body}" class="" style="">${body}${overlay ? overlayBodyHtml(overlay) : ""}</body></html>`;
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > LIQUID_LIMITS.outputBytes) throw new TemplateRenderError([unpositioned("Belge çıktısı 4 MB sınırını aştı")]);
  return { html, removed: [...removed], warnings: parsed.warnings, metrics: { ms: Math.round(performance.now() - started), bytes } };
}
