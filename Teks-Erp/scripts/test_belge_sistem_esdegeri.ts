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

import { renderInspectionReportHtml } from "../src/services/document-render/inspection-report.html";
import { renderPriceListHtml } from "../src/services/document-render/price-list.html";
import { renderSalesQuoteHtml } from "../src/services/document-render/sales-quote.html";
import { renderQualityCertificateHtml } from "../src/services/document-render/quality-certificate.html";
import { renderReturnDispatchHtml } from "../src/services/document-render/return-dispatch.html";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { renderKartelaCekiHtml } from "../src/services/document-render/kartela-ceki.html";
import { renderFasonCekiHtml } from "../src/services/document-render/fason-ceki.html";
import { renderFasonDirectShipHtml } from "../src/services/document-render/fason-direct-ship.html";
import { renderFasonReceiptHtml } from "../src/services/document-render/fason-receipt.html";
import {
  renderChequeDeliveryNoteHtml,
  renderInvoiceInternalHtml,
  renderPaymentReceiptHtml,
  renderReconciliationLetterHtml,
} from "../src/services/document-render/finance-doc.html";
import { renderGoodsReceiptHtml, renderStockCountHtml, renderWarehouseTransferHtml } from "../src/services/document-render/warehouse-doc.html";
import { fmtDateTime } from "../src/services/document-render/fmt-date";
import { tokenizeHtml, type HtmlToken } from "../src/services/document-render/template-html.tokenizer";
import { decodeAttrEntities } from "../src/services/document-render/template-html.entities";
import { renderTemplate, TemplateRenderError } from "../src/services/document-template/motor/render";
import { amountInWords } from "../src/services/document-template/motor/filtreler";
import { parseLiquid, renderLiquid } from "../src/services/document-template/motor/liquid";
import { docNum } from "../src/services/document-render/fmt-num";
import { CHEQUE_AMOUNT_IN_WORDS } from "../src/services/document-template/sozlesme/cheque-delivery-note";
import type { AmountInWordsSource } from "../src/services/document-template/sozlesme/finance-common";
import { INVOICE_AMOUNT_IN_WORDS } from "../src/services/document-template/sozlesme/invoice-internal";
import { PAYMENT_AMOUNT_IN_WORDS } from "../src/services/document-template/sozlesme/payment-receipt";
import { sampleDoc, sampleEnvelope } from "../src/services/document-template/sozlesme/senaryolar";
import { BASE_PRINT_CSS, normalizePageSettings } from "../src/services/document-template/motor/sayfa";
import { listSystemEquivalents, materializeEquivalent } from "../src/services/document-template/sistem/kayit";
import type { EquivalenceVariant, SystemEquivalent } from "../src/services/document-template/sistem/tipler";
import { getContract, shownToInternalFields } from "../src/services/document-template/sozlesme/kayit";
import type { PrintInput, Scenario } from "../src/services/document-template/sozlesme/tipler";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { normalizeTravelerCardConfig, type DocumentConfig } from "../src/services/system-setting.service";
import { renderTravelerCardHtml, type TravelerCardSnapshot } from "../src/services/document-render/traveler-card.html";
import { renderQrSvg } from "../src/services/helpers/barcode-svg.helper";
import { renderFreeDocumentHtml, type FreeDocumentSnapshot } from "../src/services/document-render/free-document.html";
import type { TravelerCardSource } from "../src/services/document-template/sozlesme/traveler-card";

/** Sistem renderer'ının baskı meta'sı — servis katmanının verdiği şekilde (canlı ayarlar + baskı girdisi). */
type SystemMeta = Record<string, unknown>;
type SystemRenderer = (snapshot: PrintedDocSnapshot, meta: SystemMeta) => string;

// docType başına TEK satır, alfabetik (port dilimleri ekler).
const RENDERERS: Readonly<Record<string, SystemRenderer>> = {
  CHEQUE_DELIVERY_NOTE: (s, m) => renderChequeDeliveryNoteHtml(s, m as Parameters<typeof renderChequeDeliveryNoteHtml>[1]),
  FREE_DOCUMENT: (s, m) => renderFreeDocumentHtml({ ...(s as unknown as FreeDocumentSnapshot), config: (s.docConfigOverride ?? {}) as DocumentConfig }, m),
  GOODS_RECEIPT: (s, m) => renderGoodsReceiptHtml(s, m as Parameters<typeof renderGoodsReceiptHtml>[1]),
  INSPECTION_REPORT: (s, m) => renderInspectionReportHtml(s, m as Parameters<typeof renderInspectionReportHtml>[1]),
  INVOICE_INTERNAL: (s, m) => renderInvoiceInternalHtml(s, m as Parameters<typeof renderInvoiceInternalHtml>[1]),
  KARTELA_DISPATCH: (s, m) => renderKartelaCekiHtml(s, m as Parameters<typeof renderKartelaCekiHtml>[1]),
  PAYMENT_RECEIPT: (s, m) => renderPaymentReceiptHtml(s, m as Parameters<typeof renderPaymentReceiptHtml>[1]),
  PRICE_LIST: (s, m) => renderPriceListHtml(s, m as Parameters<typeof renderPriceListHtml>[1]),
  QUALITY_CERTIFICATE: (s, m) => renderQualityCertificateHtml(s, m as Parameters<typeof renderQualityCertificateHtml>[1]),
  RECONCILIATION_LETTER: (s, m) => renderReconciliationLetterHtml(s, m as Parameters<typeof renderReconciliationLetterHtml>[1]),
  RETURN_DISPATCH: (s, m) => renderReturnDispatchHtml(s, m as Parameters<typeof renderReturnDispatchHtml>[1]),
  SALES_QUOTE: (s, m) => renderSalesQuoteHtml(s, m as Parameters<typeof renderSalesQuoteHtml>[1]),
  SHIPMENT_DISPATCH: (s, m) => renderShipmentDispatchHtml(s, m as Parameters<typeof renderShipmentDispatchHtml>[1]),
  STOCK_COUNT: (s, m) => renderStockCountHtml(s, m as Parameters<typeof renderStockCountHtml>[1]),
  SUBCONTRACTOR_DIRECT_SHIP: (s, m) => renderFasonDirectShipHtml(s, m as Parameters<typeof renderFasonDirectShipHtml>[1]),
  SUBCONTRACTOR_DISPATCH: (s, m) => renderFasonCekiHtml(s, m as Parameters<typeof renderFasonCekiHtml>[1]),
  SUBCONTRACTOR_RECEIPT: (s, m) => renderFasonReceiptHtml(s, m as Parameters<typeof renderFasonReceiptHtml>[1]),
  TRANSFER_DISPATCH: (s, m) => renderWarehouseTransferHtml(s, m as Parameters<typeof renderWarehouseTransferHtml>[1]),
  TRAVELER_CARD: (s, m) => renderTravelerCardSystem(s as unknown as TravelerCardSource & { docConfigOverride: unknown }, m),
};

/** Refakat kartı: servis yolunun eşi — ayar `normalizeTravelerCardConfig`ten, QR `renderQrSvg`den (P-e, canlı). */
function renderTravelerCardSystem(s: TravelerCardSource & { docConfigOverride: unknown }, m: SystemMeta): string {
  const config = normalizeTravelerCardConfig((s.docConfigOverride ?? {}) as Record<string, unknown>);
  let qrSvg: string | null = null;
  try {
    qrSvg = renderQrSvg(s.meta.barcode);
  } catch {
    qrSvg = null;
  }
  void m;
  return renderTravelerCardHtml({ ...s.card, config } as TravelerCardSnapshot, { ...s.meta, qrSvg });
}

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
  const system = render({ ...(scn.snapshot as PrintedDocSnapshot), docConfigOverride: variant.config }, systemMeta(scn, print));

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

// ── §F Ön muhasebe (T10): para ≡ fmtMoney · yazıyla tablosu · `sayi: 2` sondası ────────────
// Para hücresi Sistem'in `fmtMoney`iyle BAYT-EŞİT olmalı: ölçü Sistem makbuzunun tutar hücresinden
// alınır (fmtMoney dışa açık değil; kopyası yazılmaz). Yazıyla kaynağı negatif olamaz.
console.log("\n── §F ön muhasebe: para · yazıyla · sayi sondası");
const FINANCE_TYPES = ["CHEQUE_DELIVERY_NOTE", "INVOICE_INTERNAL", "PAYMENT_RECEIPT", "RECONCILIATION_LETTER"] as const;
// Mutabakatta yazıyla kaynağı yok: para birimleri toplanmaz, tek tutar yoktur.
const WORDS_SOURCE: Readonly<Record<string, AmountInWordsSource>> = {
  CHEQUE_DELIVERY_NOTE: CHEQUE_AMOUNT_IN_WORDS,
  INVOICE_INTERNAL: INVOICE_AMOUNT_IN_WORDS,
  PAYMENT_RECEIPT: PAYMENT_AMOUNT_IN_WORDS,
};
const liquidNum = docNum({ numberRounding: "HALF_UP" });
const liquidOne = (src: string, ctx: Record<string, unknown>): string =>
  renderLiquid({ templates: parseLiquid(src), context: ctx, num: liquidNum, marker: (k) => k, svg: {} });
const pathValue = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

function systemMoney(v: unknown): string | null {
  const doc = sampleDoc("PAYMENT_RECEIPT");
  doc.amount = v;
  const html = renderPaymentReceiptHtml(sampleEnvelope(doc), {});
  return /<div class="row grand"><span>[^<]*<\/span><b>([^<]*)<\/b>/.exec(html)?.[1] ?? null;
}

const moneyValues = new Set<unknown>(["0", "0.5", "1", "-3400.00", "1234.565", "999999999999.99", "0.005", "", null]);
for (const t of FINANCE_TYPES) {
  const eq = equivalents.find((e) => e.docType === t);
  ok(eq !== undefined, `${t}: §F eşlenik kayıtlı değil`);
  if (!eq) continue;
  const contract = getContract(t);
  const scenarios = contract.senaryolar() as Scenario<unknown>[];
  const ayar = contract.ayarNormalize({}) as Record<string, unknown>;
  const moneyRoots = contract.kokler.filter((f) => f.tur === "para").map((f) => f.yol);
  const moneyCols = contract.tablolar.flatMap((tb) => tb.kolonlar.filter((k) => k.tur === "para").map((k) => [tb.anahtar, k.yol] as const));
  const src = WORDS_SOURCE[t];
  for (const scn of scenarios) {
    const ctx = contract.insa(scn.snapshot, ayar, [], scn.ek ?? {}) as unknown as Record<string, unknown>;
    for (const yol of moneyRoots) moneyValues.add(pathValue(ctx, yol));
    for (const [tb, yol] of moneyCols) for (const row of (pathValue(ctx, `tablolar.${tb}`) as unknown[]) ?? []) moneyValues.add(pathValue(row, yol));
    if (src) {
      const v = pathValue(ctx, src.tutar);
      const cur = src.paraBirimi ? pathValue(ctx, src.paraBirimi) : "TRY";
      ok(!(Number(v) < 0), `${t} · ${scn.ad}: §F yazıyla kaynağı (${src.tutar}) negatif: ${String(v)}`);
      if (v != null && typeof cur === "string" && /^[A-Z]{3}$/.test(cur)) {
        const got = liquidOne(`{{ ${src.tutar} | yaziyla: ${src.paraBirimi ?? '"TRY"'} }}`, ctx);
        ok(got === amountInWords(v, cur) && got.startsWith("Yalnız"), `${t} · ${scn.ad}: §F yazıyla ${JSON.stringify(got)}`);
      }
    }
  }
  // Sonda: `para` yerine `sayi: 2` — boş tutarın "—"su ve para birimi eki kaybolur, eşitlik kırılmalı.
  const asNumberFilter = eq.html.replace(/\|\s*para(?:\s*:\s*"[A-Z]{3}")?/g, "| sayi: 2");
  ok(asNumberFilter !== eq.html, `${t}: §F eşlenikte 'para' filtresi yok`);
  const broken = scenarios.filter((scn) => compare(eq, scn, DEFAULT_VARIANT, asNumberFilter) !== null).length;
  ok(broken > 0, `${t}: §F 'para' → 'sayi: 2' FARK ÜRETMEDİ (para biçimi körlüğü)`);
}

for (const v of moneyValues) {
  const sys = systemMoney(v);
  const liq = liquidOne(`{{ v | para: "TRY" }}`, { v });
  ok(sys !== null && sys === liq, `§F para ${JSON.stringify(v)}: Sistem fmtMoney ${JSON.stringify(sys)} ≠ Liquid ${JSON.stringify(liq)}`);
}

const WORDS_TABLE: ReadonlyArray<readonly [unknown, string]> = [
  [0, "Yalnız sıfır TL"],
  ["1", "Yalnız bir TL"],
  ["1000000.00", "Yalnız bir milyon TL"],
  ["1234.50", "Yalnız bin iki yüz otuz dört TL elli Kr"],
  ["0.05", "Yalnız beş Kr"],
];
for (const [v, want] of WORDS_TABLE) {
  const got = liquidOne(`{{ v | yaziyla: "TRY" }}`, { v });
  ok(got === want, `§F yazıyla ${JSON.stringify(v)}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail === 0 ? 0 : 1);
