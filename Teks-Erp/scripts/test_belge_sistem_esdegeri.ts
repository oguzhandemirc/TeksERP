/**
 * Sistem şablonu ↔ Liquid eşleniği EŞİTLİK bekçisi (plan §3.4, D2).
 *
 * Her kayıtlı eşlenik (`document-template/sistem/index.ts`) × sözleşme senaryosu × {varsayılan
 * ayar + eşleniğin beyan ettiği varyantlar} için: Sistem `renderHtml(snapshot+config, meta)`
 * (ACTIVE, filigransız) ile Liquid render'ı (`ayar = ayarNormalize(config)`, `internalFields` =
 * config'in `shown` iç kolonları, üst katmansız) KANONİK biçimde eşit olmalı:
 *   belirteç dizisi · öznitelikler sıralı · metin varlıkları çözülü, boşluk sıkışık · CSS
 *   yorumsuz/boşluk normalize · `@page` yapısal (boyut + dört kenar mm) · motorun sabit baskı
 *   katmanı (`BASE_PRINT_CSS`) karşılaştırma dışı.
 * İmza etiketlerinin varsayılanı (Teslim Eden / Teslim Alan) varsayılan ayar koşusunda kilitlenir.
 * §0 körlük zemini: eşleniğin sınıf adı bozulunca kanonik karşılaştırma ayrışmayı GÖRMELİ.
 *
 * Yeni belge türü: sözleşme + `sistem/<doc>.ts` + iki index satırı + aşağıdaki RENDERERS satırı.
 * Çalıştır: npx tsx scripts/test_belge_sistem_esdegeri.ts   (DB'siz)
 */

import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { renderFasonReceiptHtml } from "../src/services/document-render/fason-receipt.html";
import { fmtDateTime } from "../src/services/document-render/fmt-date";
import { tokenizeHtml, type HtmlToken } from "../src/services/document-render/template-html.tokenizer";
import { decodeAttrEntities } from "../src/services/document-render/template-html.entities";
import { renderTemplate, TemplateRenderError } from "../src/services/document-template/motor/render";
import { BASE_PRINT_CSS, normalizePageSettings } from "../src/services/document-template/motor/sayfa";
import { listSystemEquivalents, materializeEquivalent } from "../src/services/document-template/sistem/kayit";
import type { EquivalenceVariant, SystemEquivalent } from "../src/services/document-template/sistem/tipler";
import { getContract, shownToInternalFields } from "../src/services/document-template/sozlesme/kayit";
import type { PrintInput, Scenario } from "../src/services/document-template/sozlesme/tipler";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import type { DocumentConfig } from "../src/services/system-setting.service";

/** Sistem renderer'ının baskı meta'sı — servis katmanının verdiği şekilde (canlı ayarlar + baskı girdisi). */
type SystemMeta = Record<string, unknown>;
type SystemRenderer = (snapshot: PrintedDocSnapshot, meta: SystemMeta) => string;

// docType başına TEK satır, alfabetik (port dilimleri ekler).
const RENDERERS: Readonly<Record<string, SystemRenderer>> = {
  SHIPMENT_DISPATCH: (s, m) => renderShipmentDispatchHtml(s, m as Parameters<typeof renderShipmentDispatchHtml>[1]),
  SUBCONTRACTOR_RECEIPT: (s, m) => renderFasonReceiptHtml(s, m as Parameters<typeof renderFasonReceiptHtml>[1]),
};

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
};

// ── Kanonik biçim ──────────────────────────────────────────────────────────────
interface PageRule {
  size: string;
  margin: string;
  boxes: string;
}
interface Canonical {
  lang: string;
  pages: PageRule[];
  css: string;
  body: string[];
}

const SPACE = /[ \t\n\r\f]+/g;
const decode = (s: string): string => decodeAttrEntities(s) ?? `<<çözülemedi:${s}>>`;

function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(SPACE, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/** `@page{...}` blokları (iç içe kenar kutularıyla) ayrılır; kalan CSS döner. */
function extractPages(css: string): { rest: string; pages: PageRule[] } {
  const pages: PageRule[] = [];
  let rest = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf("@page", i);
    if (at < 0) {
      rest += css.slice(i);
      break;
    }
    rest += css.slice(i, at);
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    pages.push(pageRule(css.slice(at, open).trim(), css.slice(open + 1, end)));
    i = end + 1;
  }
  return { rest, pages };
}

function pageRule(selector: string, body: string): PageRule {
  const boxes: string[] = [];
  const flat = body.replace(/@([a-z-]+)\s*\{([^}]*)\}/g, (_m, b: string, c: string) => {
    boxes.push(`${b}{${normalizeCss(c)}}`);
    return "";
  });
  const decls = new Map<string, string>();
  for (const d of flat.split(";")) {
    const k = d.indexOf(":");
    if (k > 0) decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim().replace(SPACE, " "));
  }
  const mm = (decls.get("margin") ?? "").split(" ").filter(Boolean).map((v) => Number(v.replace(/mm$/, "")));
  const [t, r = t, b = t, l = r] = mm;
  return {
    size: `${selector.replace(SPACE, "")}|${decls.get("size") ?? ""}`,
    margin: [t, r, b, l].map((n) => (n === undefined || Number.isNaN(n) ? "?" : String(n))).join(" "),
    boxes: boxes.sort().join(""),
  };
}

function canonical(html: string, side: "system" | "liquid"): Canonical {
  const toks = tokenizeHtml(html);
  let lang = "";
  const styles: string[] = [];
  const body: string[] = [];
  let inBody = false;
  let text = "";
  const flushText = () => {
    // Yalnız boşluktan oluşan metin düşer; içerikli metnin kenar boşluğu tek boşluk olarak KALIR
    // ("Tarih: <b>" ile "Tarih:<b>" ayrışsın).
    const t = decode(text).replace(SPACE, " ");
    if (t.trim()) body.push(`#${t}`);
    text = "";
  };
  for (let i = 0; i < toks.length; i++) {
    const tk: HtmlToken = toks[i]!;
    if (tk.kind === "start" && tk.name === "html") lang = tk.attrs.find((a) => a.name === "lang")?.value ?? "";
    if (tk.kind === "start" && tk.name === "style") {
      const raw = toks[i + 1];
      if (raw && (raw.kind === "raw" || raw.kind === "text")) styles.push(raw.text);
      continue;
    }
    if (tk.kind === "start" && tk.name === "body") {
      inBody = true;
      continue;
    }
    if (tk.kind === "end" && (tk.name === "body" || tk.name === "html")) {
      flushText();
      inBody = false;
      continue;
    }
    if (!inBody) continue;
    if (tk.kind === "text") {
      text += tk.text;
      continue;
    }
    flushText();
    if (tk.kind === "start") {
      const attrs = [...tk.attrs]
        .map((a) => {
          const v = decode(a.value);
          const val = a.name === "style" ? normalizeCss(v) : a.name === "class" ? v.replace(SPACE, " ").trim() : v;
          return `${a.name}="${val}"`;
        })
        .sort();
      body.push(`<${tk.name}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    } else if (tk.kind === "end") body.push(`</${tk.name}>`);
    else if (tk.kind === "raw") body.push(`raw:${tk.text}`);
  }
  let css = styles.join("\n");
  if (side === "liquid") {
    // Motorun sabit baskı katmanı her şablonda aynıdır; Sistem'deki eşdeğeri chrome CSS'indedir.
    if (!css.includes(BASE_PRINT_CSS)) throw new Error("Liquid çıktısında motorun baskı katmanı yok");
    css = css.replace(BASE_PRINT_CSS, "");
  }
  const { rest, pages } = extractPages(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return { lang, pages, css: normalizeCss(rest), body };
}

// ── Ölü kural toleransı (T7) ──────────────────────────────────────────────────
// Sistem bazı kuralları VERİYE bağlı basar (fason çekide `.cmd` yalnız talimat kutusu varken);
// Liquid CSS'i yalnız ayardan üretilir. Liquid'in gövdede hiçbir öğeye değmeyen ve Sistem'de
// birebir bulunmayan fazladan kuralı yok sayılır; Sistem'deki her kural iki tarafta aynı sırada kalır.
function splitRules(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      out.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < css.length) out.push(css.slice(start));
  return out;
}

function bodyClasses(body: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of body) for (const m of t.matchAll(/ class="([^"]*)"/g)) for (const c of m[1]!.split(" ")) if (c) out.add(c);
  return out;
}

function ruleIsDead(rule: string, classes: ReadonlySet<string>): boolean {
  const open = rule.indexOf("{");
  if (open < 0) return false;
  const prelude = rule.slice(0, open);
  if (prelude.startsWith("@")) {
    const inner = splitRules(rule.slice(open + 1, -1));
    return inner.length > 0 && inner.every((r) => ruleIsDead(r, classes));
  }
  return prelude.split(",").every((sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].some((m) => !classes.has(m[1]!)));
}

function pruneDeadExtras(liquid: Canonical, system: Canonical): Canonical {
  const systemRules = new Set(splitRules(system.css));
  const classes = bodyClasses(liquid.body);
  const css = splitRules(liquid.css)
    .filter((r) => systemRules.has(r) || !ruleIsDead(r, classes))
    .join("");
  return { ...liquid, css };
}

/** İlk ayrışan nokta ±80 karakter bağlamla; eşitse null. */
function firstDiff(a: Canonical, b: Canonical): string | null {
  if (a.lang !== b.lang) return `html lang: Sistem '${a.lang}' ≠ Liquid '${b.lang}'`;
  const pa = JSON.stringify(a.pages);
  const pb = JSON.stringify(b.pages);
  if (pa !== pb) return `@page: Sistem ${pa} ≠ Liquid ${pb}`;
  const ctx = (s: string, i: number) => s.slice(Math.max(0, i - 80), i + 80);
  if (a.css !== b.css) {
    let i = 0;
    while (i < a.css.length && a.css[i] === b.css[i]) i++;
    return `CSS @${i}\n      Sistem: …${ctx(a.css, i)}…\n      Liquid: …${ctx(b.css, i)}…`;
  }
  const n = Math.max(a.body.length, b.body.length);
  for (let i = 0; i < n; i++) {
    if (a.body[i] === b.body[i]) continue;
    const sa = a.body.join("");
    const at = a.body.slice(0, i).join("").length;
    const sb = b.body.join("");
    return (
      `gövde belirteci #${i}: Sistem ${JSON.stringify(a.body[i] ?? "<yok>")} ≠ Liquid ${JSON.stringify(b.body[i] ?? "<yok>")}\n` +
      `      Sistem: …${ctx(sa, at)}…\n      Liquid: …${ctx(sb, b.body.slice(0, i).join("").length)}…`
    );
  }
  return null;
}

// ── Render iki yolu ────────────────────────────────────────────────────────────
function systemMeta(scn: Scenario<unknown>, print: PrintInput): SystemMeta {
  return {
    ...((scn.ek?.canli as object | undefined) ?? {}),
    logoDataUrl: print.logo ?? null,
    qrDataUrl: print.qr ?? null,
    printedAtText: print.zaman ? fmtDateTime(print.zaman) : undefined,
    printedBy: print.basan ?? null,
    printNote: print.not ?? null,
  };
}

function renderBoth(eq: SystemEquivalent, scn: Scenario<unknown>, variant: EquivalenceVariant, html = eq.html) {
  const render = RENDERERS[eq.docType];
  if (!render) throw new Error(`${eq.docType}: bekçide Sistem renderer satırı yok (RENDERERS)`);
  const contract = getContract(eq.docType);
  // Durum/filigran üst katmandır (Sistem'de de ACTIVE koşulur); eşlenik yalnız gövdeyi taşır.
  const print: PrintInput = { ...(scn.ek?.baski ?? {}), ...(variant.print ?? {}) };
  const system = render({ ...scn.snapshot, docConfigOverride: variant.config }, systemMeta(scn, print));

  const ayar = contract.ayarNormalize(variant.config) as Record<string, unknown>;
  const internalFields = shownToInternalFields(contract, variant.config);
  const context = contract.insa(scn.snapshot, ayar, internalFields, { ...(scn.ek ?? {}), baski: print });
  const m = materializeEquivalent({ ...eq, html }, ayar);
  const out = renderTemplate(
    { editMode: m.editMode, sourceHtml: m.html, css: m.css, pageSettings: m.pageSettings },
    { context: context as unknown as Record<string, unknown>, snapshot: scn.snapshot, overlay: null },
  );
  return { system, liquid: out.html, removed: out.removed, warnings: out.warnings };
}

function compare(eq: SystemEquivalent, scn: Scenario<unknown>, variant: EquivalenceVariant, html?: string): string | null {
  let r: ReturnType<typeof renderBoth>;
  try {
    r = renderBoth(eq, scn, variant, html);
  } catch (e) {
    return `render hatası: ${e instanceof TemplateRenderError ? e.issues.map((i) => i.mesaj).join(" | ") : String(e)}`;
  }
  if (r.removed.length) return `sıkı temizleyici eşlenikten parça kesti: ${r.removed.join(", ")}`;
  const system = canonical(r.system, "system");
  return firstDiff(system, pruneDeadExtras(canonical(r.liquid, "liquid"), system));
}

const DEFAULT_VARIANT: EquivalenceVariant = { name: "varsayilan", config: {} as DocumentConfig };

// ── Koşu ───────────────────────────────────────────────────────────────────────
const equivalents = listSystemEquivalents();
console.log(`\n🧪 Sistem ↔ Liquid eşitliği — ${equivalents.length} eşlenik\n`);
ok(equivalents.length > 0, "kayıtta hiç eşlenik yok");

for (const eq of equivalents) {
  const contract = getContract(eq.docType);
  const scenarios = contract.senaryolar() as Scenario<unknown>[];
  const variants = [DEFAULT_VARIANT, ...(eq.variants ?? [])];
  console.log(`── ${eq.docType} (${eq.editMode}) — ${scenarios.length} senaryo × ${variants.length} ayar`);

  // §0 körlük zemini — ilk sınıf adı bozulunca kanonik karşılaştırma ayrışmalı.
  const cls = /class="([a-z-]+)"/.exec(eq.html);
  ok(cls !== null, `${eq.docType}: §0 eşlenikte sınıf adı bulunamadı`);
  if (cls) {
    const broken = eq.html.replace(cls[0], `class="${cls[1]}-bozuk"`);
    ok(compare(eq, scenarios[0]!, DEFAULT_VARIANT, broken) !== null, `${eq.docType}: §0 bozuk sınıf adı FARK ÜRETMEDİ (karşılaştırma kör)`);
  }

  // §1 kopya içeriği tel JSON'udur: düz CSS + motorun kabul ettiği sayfa ayarı, ayar stilini taşır.
  for (const variant of variants) {
    const m = materializeEquivalent(eq, contract.ayarNormalize(variant.config) as Record<string, unknown>);
    ok(typeof m.css === "string" && m.css.length > 0, `${eq.docType} · ${variant.name}: §1 CSS boş/metin değil`);
    let pageOk = true;
    try {
      normalizePageSettings(m.pageSettings);
    } catch {
      pageOk = false;
    }
    ok(pageOk, `${eq.docType} · ${variant.name}: §1 sayfa ayarı motor tarafından reddedildi`);
    ok(JSON.stringify(JSON.parse(JSON.stringify(m))) === JSON.stringify(m), `${eq.docType} · ${variant.name}: §1 içerik düz JSON değil`);
  }

  for (const variant of variants) {
    for (const scn of scenarios) {
      const diff = compare(eq, scn, variant);
      ok(diff === null, `${eq.docType} · ${scn.ad} · ${variant.name}: ${diff}`);
    }
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail === 0 ? 0 : 1);
