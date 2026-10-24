// =============================================================================
// Belge şablonu Liquid motoru — KATI ayar, etiket/filtre İZİN LİSTESİ, Türkçe hata
// =============================================================================
// Kullanıcı şablonu JS çalıştıramaz (Liquid ifade dili JS değildir), dosya/başka şablon
// çağıramaz (include/render/layout silindi, `templates:{}` bellek-içi boş FS), prototip
// zincirine erişemez (ownPropertyOnly + düz JSON bağlam), tanımsız alan ve filtre
// parse/render'ı düşürür (strictVariables/strictFilters), süre/bellek/boyut sınırlıdır.
// Motor TEK örnektir ve kurulduktan sonra değişmez; render başına durum (sayı rejimi,
// SVG deposu) `Context` kaydındadır (filtreler.ts) → ayrıştırılmış şablon önbelleklenebilir.
// Plan: docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md §3.3, §3.9, §5.

import { Context, Liquid, toValueSync, type Emitter, type Parser, type Tag, type TagToken, type Template, type TopLevelToken } from "liquidjs";
import type { DocNum } from "../../document-render/fmt-num";
import { escapeOutput, SafeHtml, TemplateUserError } from "./cikti";
import { ALLOWED_BUILTIN_FILTERS, CUSTOM_FILTERS, REJECTED_FILTERS, RENDER_STATE_KEY, type RenderState } from "./filtreler";

export const LIQUID_LIMITS = {
  /** Şablon kaynağı, karakter. */
  parse: 200_000,
  /** Render süresi, ms. */
  renderMs: 2000,
  /** LiquidJS bellek sayacı (dize/dizi ayırma birimi). */
  memory: 32e6,
  /** Doldurulmuş HTML, bayt. */
  outputBytes: 4 * 1024 * 1024,
} as const;

export const ALLOWED_TAGS: readonly string[] = [
  "if", "unless", "case", "for", "break", "continue", "cycle", "assign", "capture", "comment", "raw", "echo", "liquid", "#",
];

const FILE_REJECT = "Şablon başka şablon ya da dosya çağıramaz";
/** Adıyla reddedilen etiketler (motordan silinir; parse "bulunamadı" hatası Türkçeye çevrilir). */
export const REJECTED_TAGS: Readonly<Record<string, string>> = {
  include: FILE_REJECT,
  render: FILE_REJECT,
  layout: FILE_REJECT,
  block: FILE_REJECT,
  tablerow: "'tablerow' kapalı; tablo satırı döngüsünü data-each ya da {% for %} ile kurun",
  increment: "Sayaç etiketleri kapalı; sıra numarası sözleşmeden ya da forloop.index ile gelir",
  decrement: "Sayaç etiketleri kapalı; sıra numarası sözleşmeden ya da forloop.index ile gelir",
};

/** Konumlu Türkçe şablon hatası; `offset` derlenmiş Liquid metnindeki konumdur (yönerge haritası kaynağa çevirir). */
export interface LiquidErrorRecord {
  readonly offset: number | null;
  readonly message: string;
}

export class LiquidTemplateError extends Error {
  constructor(readonly record: LiquidErrorRecord) {
    super(record.message);
    this.name = "LiquidTemplateError";
  }
}

type TagClass = new (token: TagToken, remain: TopLevelToken[], liquid: Liquid, parser: Parser) => Tag;

/** `{% echo %}` (emitter'a) ve `{% cycle %}` (dönüş değeriyle) veriyi `outputEscape`ten GEÇİRMEDEN yazar (LiquidJS 10.30 ölçüldü) — aynı kaçışa bağlanır. */
function escapedTag(baseTag: TagClass): TagClass {
  return class EscapedTag extends (baseTag as unknown as new (...a: ConstructorParameters<TagClass>) => Tag) {
    *render(ctx: Context, emitter: Emitter): Generator<unknown, unknown, unknown> {
      const wrapped: Emitter = {
        write: (html: unknown) => emitter.write(escapeOutput.call({ context: ctx }, html)),
        get buffer() {
          return emitter.buffer;
        },
        set buffer(v: string) {
          emitter.buffer = v;
        },
      };
      const inner = baseTag.prototype.render.call(this, ctx, wrapped) as Generator<unknown, unknown, unknown>;
      // Döndürülen değeri de koşucu ham yazar (cycle böyle basar).
      const result = yield* inner;
      return result === undefined || result === null || result === "" ? result : escapeOutput.call({ context: ctx }, result);
    }
  } as unknown as TagClass;
}

/** Boyut sınırlı yazıcı: döngüdeki düz HTML de sayılır (LiquidJS bellek sayacı yalnız filtre/aralık ayırmasını sayar). */
class BoundedEmitter implements Emitter {
  buffer = "";
  write(html: unknown): void {
    const s = html === null || html === undefined ? "" : String(html);
    if (this.buffer.length + s.length > LIQUID_LIMITS.outputBytes) {
      throw new TemplateUserError("Şablon çıktısı 4 MB sınırını aştı");
    }
    this.buffer += s;
  }
}

interface CaptureInternals {
  liquid: Liquid;
  templates: Template[];
  variable: string;
}

/** `{% capture %}` kendi sınırsız yazıcısıyla render eder — sınırlı yazıcıyla yeniden kurulur. */
function boundedCapture(baseTag: TagClass): TagClass {
  return class BoundedCapture extends (baseTag as unknown as new (...a: ConstructorParameters<TagClass>) => Tag) {
    *render(ctx: Context): Generator<unknown, unknown, unknown> {
      const self = this as unknown as CaptureInternals;
      const em = new BoundedEmitter();
      yield self.liquid.renderer.renderTemplates(self.templates, ctx, em);
      ctx.memoryLimit.use(em.buffer.length);
      // Yakalanan metin zaten kaçışlı → yeniden basılırken çift kaçışlanmasın.
      (ctx.bottom() as Record<string, unknown>)[self.variable] = new SafeHtml(em.buffer);
      return undefined;
    }
  } as unknown as TagClass;
}

function buildEngine(): Liquid {
  const engine = new Liquid({
    strictVariables: true,
    strictFilters: true,
    ownPropertyOnly: true,
    outputEscape: escapeOutput,
    dynamicPartials: false,
    templates: {},
    cache: false,
    jsTruthy: false,
    lenientIf: false,
    parseLimit: LIQUID_LIMITS.parse,
    renderLimit: LIQUID_LIMITS.renderMs,
    memoryLimit: LIQUID_LIMITS.memory,
  });
  const tags = engine.tags as Record<string, unknown>;
  for (const name of Object.keys(tags)) if (!ALLOWED_TAGS.includes(name)) delete tags[name];
  for (const name of ["echo", "cycle"]) engine.registerTag(name, escapedTag(tags[name] as TagClass));
  engine.registerTag("capture", boundedCapture(tags.capture as TagClass));

  const filters = engine.filters as Record<string, unknown>;
  for (const name of Object.keys(filters)) if (!ALLOWED_BUILTIN_FILTERS.includes(name)) delete filters[name];
  for (const [name, impl] of Object.entries(CUSTOM_FILTERS)) engine.registerFilter(name, impl);
  return engine;
}

const ENGINE = buildEngine();

/** Motorun kayıtlı etiket/filtre adları (bekçi izin listesini bunlardan ölçer). */
export function engineRegistry(): { tags: string[]; filters: string[] } {
  return { tags: Object.keys(ENGINE.tags).sort(), filters: Object.keys(ENGINE.filters).sort() };
}

// ── Hata çevirisi ─────────────────────────────────────────────────────────────────
interface RawLiquidError {
  message?: string;
  originalError?: unknown;
  token?: { begin?: number };
}

function rootMessage(e: RawLiquidError): string {
  const m = (e.originalError as { message?: string } | undefined)?.message ?? e.message ?? String(e);
  // LiquidJS mesajın sonuna ", line:L, col:C" ekler — konum ayrıca taşınıyor.
  return m.replace(/, line:\d+, col:\d+$/, "");
}

function translate(m: string): string {
  let x: RegExpExecArray | null;
  if ((x = /^undefined variable: (.+)$/.exec(m))) return `Tanımsız alan: ${x[1]}`;
  if ((x = /^undefined filter: (.+)$/.exec(m))) return REJECTED_FILTERS[x[1]!] ?? `Bilinmeyen ya da izinsiz filtre: ${x[1]}`;
  if ((x = /^tag "(.+)" not found$/.exec(m))) return REJECTED_TAGS[x[1]!] ?? `Bilinmeyen ya da izinsiz etiket: ${x[1]}`;
  if (/^template render limit exceeded$/.test(m)) return `Şablon işleme süresi sınırı aşıldı (${LIQUID_LIMITS.renderMs} ms)`;
  if (/^memory alloc limit exceeded$/.test(m)) return "Şablon bellek sınırı aşıldı (32 MB)";
  if (/^parse length limit exceeded$/.test(m)) return `Şablon çok büyük (${LIQUID_LIMITS.parse.toLocaleString("tr-TR")} karakter sınırı)`;
  if ((x = /^tag (.+) not closed$/.exec(m))) return `Kapatılmamış etiket: ${x[1]}`;
  if ((x = /^output (.+) not closed$/.exec(m))) return `Kapatılmamış çıktı: ${x[1]}`;
  return `Şablon sözdizimi hatası: ${m}`;
}

function toLiquidError(e: unknown): LiquidTemplateError {
  if (e instanceof LiquidTemplateError) return e;
  const raw = (e ?? {}) as RawLiquidError;
  const offset = typeof raw.token?.begin === "number" ? raw.token.begin : null;
  const userFacing = raw.originalError instanceof TemplateUserError || e instanceof TemplateUserError;
  return new LiquidTemplateError({ offset, message: userFacing ? rootMessage(raw) : translate(rootMessage(raw)) });
}

// ── Parse + render ────────────────────────────────────────────────────────────────
export function parseLiquid(source: string): Template[] {
  try {
    return ENGINE.parse(source);
  } catch (e) {
    throw toLiquidError(e);
  }
}

export interface LiquidRenderInput {
  readonly templates: Template[];
  /** Düz JSON bağlam (sözleşme `insa` çıktısı); burada JSON gidiş-dönüşüyle sınıf/getter'dan arındırılır. */
  readonly context: Readonly<Record<string, unknown>>;
  readonly num: DocNum;
  readonly marker: (key: string) => string;
  /** Filtrelerin ürettiği SVG'ler buraya yazılır (temizlik SONRASI işaret yerine konur). */
  readonly svg: Record<string, string>;
}

export function renderLiquid(input: LiquidRenderInput): string {
  const scope = JSON.parse(JSON.stringify(input.context ?? {})) as Record<string, unknown>;
  const ctx = new Context(scope, ENGINE.options, { sync: true }, { liquid: ENGINE });
  const state: RenderState = { num: input.num, marker: input.marker, svg: input.svg, counter: 0 };
  ctx.setRegister(RENDER_STATE_KEY, state);
  const em = new BoundedEmitter();
  try {
    toValueSync(ENGINE.renderer.renderTemplates(input.templates, ctx, em));
  } catch (e) {
    throw toLiquidError(e);
  }
  const html = em.buffer;
  if (Buffer.byteLength(html, "utf8") > LIQUID_LIMITS.outputBytes) {
    throw new LiquidTemplateError({ offset: null, message: "Şablon çıktısı 4 MB sınırını aştı" });
  }
  return html;
}
