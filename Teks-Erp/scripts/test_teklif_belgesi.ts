// =============================================================================
// test_teklif_belgesi — satış teklifi + fiyat listesi BASILI BELGESİ (MAL-6, DB)
// =============================================================================
// §1 DRAFT teklif donmaz (TASLAK önizleme, satır yok) · §2 SENT → ilk basım v1 donar; kaynak
// değişse/revize edilse de v1 snapshot'ı aynı · §3 iptal → VOIDED + İPTAL filigranı · §4 sızıntı:
// maliyet/kâr/iç not sonda değerleri HTML'de, /tables'ta, snapshot'ta, sözleşme bağlamında ve
// özetinde YOK · §5 PDF = Excel (HTML hücreleri ↔ /tables satırları) · §6 fiyat listesi
// PUBLISHED donar, DRAFT donmaz, ARCHIVED VOID etmez · §7 modül kapalı → yeni basım 403
// MODULE_DISABLED, donmuş belgenin yeniden basımı açık.
// =============================================================================
import { Prisma, PrintedDocType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { printedDocumentService, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import "../src/services/quote-documents.service";
import { cancelQuote, reviseQuote } from "../src/services/sales-quote-transitions.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { docNum } from "../src/services/document-render/fmt-num";
import type { DocTablesPayload } from "../src/services/document-render/doc-model";
import { sameCell } from "./lib/belge-excel-karsilastir";
import { contractPaths, getContract } from "../src/services/document-template/sozlesme/kayit";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz, type TeklifFikstur } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return { status: err.statusCode, code: err.details?.code };
  }
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const SQ = PrintedDocType.SALES_QUOTE;
const PL = PrintedDocType.PRICE_LIST;

async function withSettings<T>(values: Record<string, boolean>, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(values);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    for (const [key, value] of Object.entries(values)) await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return await fn();
  } finally {
    for (const key of keys) {
      const b = before.find((x) => x.key === key);
      if (b) await prisma.systemSetting.update({ where: { key }, data: { value: b.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
}

const docs = (docType: PrintedDocType, sourceId: string) =>
  prisma.printedDocument.findMany({ where: { docType, sourceId }, orderBy: { version: "asc" }, select: { version: true, status: true, snapshot: true } });
const html = async (docType: PrintedDocType, id: string, allowDraft = false) =>
  (await printedDocumentService.getHtml(docType, id, undefined, { allowDraft })).data?.html ?? null;
const tables = async (docType: PrintedDocType, id: string) =>
  (await printedDocumentService.getTables(docType, id)).data as DocTablesPayload | null;

// Sonda değerleri — sayı/metin tekil: belgede herhangi bir biçimde görünmeleri sızıntıdır.
const LEAK = { cost: "91357.2468", suggested: "8642.1357", markup: "37.91", totalCost: "55443.21", note: `SIZINTI-SONDA-${randomUUID().slice(0, 8)}`, plCost: "73519.8642", plMarkup: "29.37" };
const leakForms = (v: string): string[] => {
  if (!/^\d+\.\d+$/.test(v)) return [v];
  const [i, d] = v.split(".") as [string, string];
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return [v, `${i},${d}`, `${grouped},${d}`, `${grouped},${d.slice(0, 2)}`, `${i},${d.slice(0, 2)}`, i.length >= 4 ? i : `${i},${d}`];
};
function noLeak(label: string, text: string, keys: Array<keyof typeof LEAK>): void {
  const hits = keys.flatMap((k) => leakForms(LEAK[k]).filter((f) => text.includes(f)).map((f) => `${k}:${f}`));
  check(label, hits.length === 0, hits.join(", "));
}

/** Sistem HTML'inin kalem tablosu hücreleri (tbody satırları + toplam satırı). */
function htmlCells(h: string): { rows: string[][]; head: string[] } {
  const t = /<table class="sec">([\s\S]*?)<\/table>/.exec(h)?.[1] ?? "";
  const txt = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const head = [...(/<thead>([\s\S]*?)<\/thead>/.exec(t)?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => txt(m[1]!));
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(t)?.[1] ?? t;
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => txt(m[1]!)));
  return { rows, head };
}

function pdfEqualsExcel(label: string, h: string, t: DocTablesPayload | null, snapshot: PrintedDocSnapshot): void {
  const table = t?.tables[0];
  const cells = htmlCells(h);
  const num = docNum(snapshot);
  const excelRows = [...(table?.rows ?? []), ...(table?.foot ? [table.foot] : [])];
  const headOk = !!table && JSON.stringify(table.columns.map((c) => c.label)) === JSON.stringify(cells.head);
  const bodyOk =
    !!table && excelRows.length === cells.rows.length &&
    excelRows.every((r, i) => r.length === cells.rows[i]!.length && r.every((v, j) => sameCell(v, cells.rows[i]![j]!, (i < table.rows.length ? table.columns[j]!.kind : table.footKinds?.[j] ?? table.columns[j]!.kind), num)));
  check(label, headOk && bodyOk, headOk ? `${excelRows.length} Excel satırı ↔ ${cells.rows.length} HTML satırı` : `başlık ${JSON.stringify(table?.columns.map((c) => c.label))} ↔ ${JSON.stringify(cells.head)}`);
}

async function seedLeak(quoteId: string): Promise<void> {
  await prisma.salesQuote.update({ where: { id: quoteId }, data: { internalNote: LEAK.note, totalCostTry: D(LEAK.totalCost), notes: "Müşteri notu görünür." } });
  await prisma.salesQuoteLine.updateMany({ where: { quoteId }, data: { costPerMTry: D(LEAK.cost), suggestedUnitPrice: D(LEAK.suggested), markupPct: D(LEAK.markup) } });
}

async function quoteSections(t: TeklifFikstur, m: MaliyetFikstur): Promise<void> {
  // §1 DRAFT
  const draft = await teklifYaz(t, "DRAFT", { itemId: m.fabricId });
  const cur = await printedDocumentService.getCurrent(SQ, draft);
  const dh = await html(SQ, draft, true);
  check("§1a DRAFT: güncel belge yok (donmaz)", cur.data === null);
  check("§1b DRAFT: önizleme TASLAK filigranlı", !!dh && dh.includes(">TASLAK<"));
  check("§1c DRAFT: önizleme defter satırı yazmaz", (await docs(SQ, draft)).length === 0);

  // §2 SENT → ilk basım v1; kaynak değişse de v1 aynı; revizyon v1'i VOID eder, snapshot'ı değiştirmez
  const sent = await teklifYaz(t, "SENT", { itemId: m.fabricId, lines: 2 });
  await seedLeak(sent);
  const h1 = await html(SQ, sent);
  const d1 = await docs(SQ, sent);
  check("§2a SENT ilk basım → v1 ACTIVE doğar", d1.length === 1 && d1[0]!.version === 1 && d1[0]!.status === "ACTIVE");
  check("§2b belge no = teklif no/R<revizyon>", !!h1 && h1.includes(`${t.tag}-2/R1`));
  await prisma.salesQuoteLine.updateMany({ where: { quoteId: sent }, data: { unitPrice: D("9.99"), lineTotal: D("999") } });
  const h1b = await html(SQ, sent);
  check("§2c kaynak değişince yeniden baskı DONMUŞ snapshot'tan (canlı fiyat yok)", h1b === h1 && !h1b!.includes("9,99"));
  const before = JSON.stringify(d1[0]!.snapshot);
  const rev = await reviseQuote(sent, { clientToken: randomUUID() }, undefined);
  const d1r = await docs(SQ, sent);
  check("§2d revizyon → eski v1 VOIDED", d1r.length === 1 && d1r[0]!.status === "VOIDED");
  check("§2e revizyon v1 snapshot'ını DEĞİŞTİRMEZ", JSON.stringify(d1r[0]!.snapshot) === before);
  check("§2f yeni revizyon (DRAFT) donmaz", (await printedDocumentService.getCurrent(SQ, rev.id)).data === null);
  t.quoteIds.push(rev.id);

  // §4 sızıntı (SENT teklifin HTML/tables/snapshot'ı + sözleşme bağlamı/özeti)
  const LKEYS: Array<keyof typeof LEAK> = ["cost", "suggested", "markup", "totalCost", "note"];
  noLeak("§4a teklif HTML'inde maliyet/kâr/iç not yok", h1 ?? "", LKEYS);
  const tb = await tables(SQ, sent);
  noLeak("§4b teklif /tables çıktısında maliyet/kâr/iç not yok", JSON.stringify(tb), LKEYS);
  noLeak("§4c donmuş snapshot'ta maliyet/kâr/iç not yok", before, LKEYS);
  const ctx = getContract("SALES_QUOTE").insa(d1[0]!.snapshot as never, null, []);
  noLeak("§4d sözleşme bağlamında maliyet/kâr/iç not yok", JSON.stringify(ctx), LKEYS);
  const paths = Object.keys(contractPaths(getContract("SALES_QUOTE"))).join(" ");
  check("§4e sözleşme özetinde iç alan yolu yok (maliyet/kar/oneri/ic_not)", !/maliyet|kar_|markup|oneri|ic_not|internal|cost/i.test(paths), paths.slice(0, 80));
  check("§4f sözleşmede `ic` sınıflı alan yok", !Object.values(contractPaths(getContract("SALES_QUOTE"))).some((e) => e.sinif === "ic"));

  // §5 PDF = Excel (2 kalem + toplam)
  pdfEqualsExcel("§5a teklif: HTML tablo hücreleri ↔ /tables satırları birebir", h1 ?? "", tb, d1[0]!.snapshot as unknown as PrintedDocSnapshot);

  // §3 iptal → VOIDED + İPTAL
  const toCancel = await teklifYaz(t, "SENT", { itemId: m.fabricId });
  await html(SQ, toCancel);
  await cancelQuote(toCancel, { reason: "Müşteri vazgeçti" }, undefined);
  const dc = await docs(SQ, toCancel);
  const hc = await html(SQ, toCancel);
  check("§3a iptal → v1 VOIDED", dc.length === 1 && dc[0]!.status === "VOIDED");
  check("§3b iptal belgesi HTML'inde İPTAL filigranı", !!hc && hc.includes(">İPTAL<"));
  const neverPrinted = await teklifYaz(t, "SENT", { itemId: m.fabricId });
  await cancelQuote(neverPrinted, { reason: "Basılmadan iptal" }, undefined);
  await html(SQ, neverPrinted);
  const dn = await docs(SQ, neverPrinted);
  check("§3c basılmadan iptal edilen teklifin ilk basımı VOIDED doğar", dn.length === 1 && dn[0]!.status === "VOIDED");

  // §7 modül kapalı
  const fresh = await teklifYaz(t, "SENT", { itemId: m.fabricId });
  await withSettings({ [SETTING_KEYS.MALIYET_ENABLED]: false }, async () => {
    const e = await hata(() => html(SQ, fresh));
    check("§7a maliyet kapalı → yeni basım 403 MODULE_DISABLED", e?.status === 403 && e.code === "MODULE_DISABLED", JSON.stringify(e));
    const e2 = await hata(() => html(SQ, draft, true));
    check("§7b maliyet kapalı → TASLAK önizleme 403 MODULE_DISABLED", e2?.status === 403 && e2.code === "MODULE_DISABLED");
    const re = await html(SQ, toCancel);
    check("§7c maliyet kapalı → DONMUŞ belgenin yeniden basımı açık (veri erişimi)", !!re && re.includes(">İPTAL<"));
  });
  check("§7d kapalı modülde yeni belge satırı doğmadı", (await docs(SQ, fresh)).length === 0);
}

async function priceListSections(t: TeklifFikstur, m: MaliyetFikstur): Promise<string[]> {
  const mk = async (status: "DRAFT" | "PUBLISHED", currency: "USD" | "EUR") =>
    prisma.priceList.create({
      data: {
        listNo: `${t.tag}-FL-${currency}`.slice(0, 32), clientToken: randomUUID(), name: `${t.tag} liste`, customerId: t.customerId, currency, status,
        ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}), notes: "Liste notu",
        lines: { create: [{ lineNo: 1, itemId: m.fabricId, unitPrice: D("3.40"), minQty: D(500), costPerMTry: D(LEAK.plCost), markupPct: D(LEAK.plMarkup) }] },
      },
      select: { id: true },
    });
  const draft = await mk("DRAFT", "USD");
  const pub = await mk("PUBLISHED", "EUR");
  check("§6a fiyat listesi DRAFT donmaz (önizleme TASLAK)", (await printedDocumentService.getCurrent(PL, draft.id)).data === null && !!(await html(PL, draft.id, true))?.includes(">TASLAK<"));
  const ph = await html(PL, pub.id);
  const pd = await docs(PL, pub.id);
  check("§6b PUBLISHED ilk basım → v1 ACTIVE", pd.length === 1 && pd[0]!.status === "ACTIVE");
  await prisma.priceList.update({ where: { id: pub.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  await html(PL, pub.id);
  const pa = await docs(PL, pub.id);
  check("§6c ARCHIVED belgeyi VOID etmez (arşiv yalnız ekranda)", pa.length === 1 && pa[0]!.status === "ACTIVE");
  const pt = await tables(PL, pub.id);
  noLeak("§4g fiyat listesi HTML'inde maliyet/kâr yok", ph ?? "", ["plCost", "plMarkup"]);
  noLeak("§4h fiyat listesi /tables çıktısında maliyet/kâr yok", JSON.stringify(pt), ["plCost", "plMarkup"]);
  noLeak("§4i fiyat listesi snapshot'ında maliyet/kâr yok", JSON.stringify(pd[0]!.snapshot), ["plCost", "plMarkup"]);
  check("§4j fiyat listesi sözleşmesinde `ic` alan yok", !Object.values(contractPaths(getContract("PRICE_LIST"))).some((e) => e.sinif === "ic"));
  pdfEqualsExcel("§5b fiyat listesi: HTML tablo hücreleri ↔ /tables satırları birebir", ph ?? "", pt, pd[0]!.snapshot as unknown as PrintedDocSnapshot);
  return [draft.id, pub.id];
}

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_teklif_belgesi");
  const m = await fiksturKur("TB");
  const t = await teklifFiksturKur("TB");
  let listIds: string[] = [];
  try {
    await withSettings({ [SETTING_KEYS.PRODUCTION_ENABLED]: true, [SETTING_KEYS.MALIYET_ENABLED]: true }, async () => {
      await quoteSections(t, m);
      listIds = await priceListSections(t, m);
    });
  } finally {
    // Yalnız test DB: bekçinin doğurduğu belge satırları fikstürle birlikte gider.
    await prisma.printedDocument.deleteMany({ where: { OR: [{ docType: SQ, sourceId: { in: t.quoteIds } }, { docType: PL, sourceId: { in: listIds } }] } });
    await teklifFiksturSil(t);
    await fiksturSil(m);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
