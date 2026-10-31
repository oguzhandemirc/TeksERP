// =============================================================================
// BEKÇİ — KDV + TEVKİFAT AYARI: genel ayar + müşteri bazında (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
//   §1 SAF çözüm: müşteri cari ?? genel ayar ?? bugünkü (KDV genel, tevkifat 0); ALIŞ geçersiz kılmayı okumaz
//   §2 DB çözümü (cariId + kart yolu): ayar/müşteri yok ⇒ bugünkü satır şekli bayt-aynı; genel ⇒ genelden;
//      müşteri ⇒ ondan; müşteri "uygulanmaz" genel açığı ezer
//   §3 tutar el hesabı: 1000 TL, KDV %20 ⇒ 200; tevkifat 5/10 ⇒ 100 (alıcı öder); ödenecek 1100
//   §4 genel ayar kapısı: Zod (tam sayı, aralık, bilinmeyen anahtar) + servis (açıkken oran, pay ≤ payda) ⇒ 400
//   §5 cari kapısı: KDV aralığı, yarım oran, pay > payda, pay 0 ⇒ 400 CARI_TAX_OVERRIDE_INVALID; kolon değişmez
//   §6 AST TEK ÇÖZÜMLEYİCİ: `readFinanceDefaultVatRate` / `readFinanceWithholdingFlags` çağrısı ve carinin
//      tevkifat alanlarına erişim yalnız beyanlı dosyalarda; üç taslak yolu `resolveInvoiceTaxDefaults` çağırır
// Dönem taslağı uçtan ucu (müşteri %10 + 5/10 ⇒ satır) `test_hizmet_fatura` §14/§19v'de.
// Negatif sondalar (2026-10-31): `computeInvoiceTaxDefaults` geçersiz kılmayı yok sayınca §1/§2 kırmızı ·
// `service-period-invoice.service`e ikinci `readFinanceDefaultVatRate()` yazılınca §6 kırmızı (geri alındı).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { InvoiceType, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { computeInvoiceTaxDefaults, resolveInvoiceTaxDefaults, taxLineFields } from "../src/services/helpers/invoice-tax-defaults.helper";
import { computeInvoiceTotals, ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { cariService } from "../src/services/cari.service";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && extra ? ` — ${extra}` : ""}`);
}
function section(t: string): void {
  console.log(`\n── ${t} ──`);
}
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try {
    await fn();
    return { status: 200, code: null };
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}

const SRC = path.resolve(__dirname, "../src");
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const RESOLVER = "services/helpers/invoice-tax-defaults.helper.ts";
const SETTING_READERS = new Set(["readFinanceDefaultVatRate", "readFinanceWithholdingFlags"]);
const SETTING_READER_FILES = new Set(["services/system-setting.service.ts", RESOLVER]);
const CARI_FIELDS = new Set(["withholdingEnabled", "withholdingNumerator", "withholdingDenominator"]);
// Cari geçersiz kılmasını YAZAN (doğrulama) ve sözleşmeyi taşıyan (Zod) yüzeyler; okuyup karar veren yalnız RESOLVER.
const CARI_FIELD_FILES = new Set([RESOLVER, "services/helpers/cari-tax-override.helper.ts", "routes/finance.routes.ts"]);
const DRAFT_PATHS = ["services/helpers/shipment-auto-draft.helper.ts", "services/service-period-invoice.service.ts", "services/invoice.service.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const KEYS = [SETTING_KEYS.FINANCE_DEFAULT_VAT_RATE, SETTING_KEYS.FINANCE_WITHHOLDING_ENABLED, SETTING_KEYS.FINANCE_WITHHOLDING_NUMERATOR, SETTING_KEYS.FINANCE_WITHHOLDING_DENOMINATOR];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const actor = await testActorId();
  const prior = new Map<string, Prisma.JsonValue | undefined>();
  for (const k of KEYS) prior.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  const STAMP = randomUUID().slice(0, 8);
  let customerId: string | null = null;
  let cariId: string | null = null;
  try {
    // ── §1 ──
    section("§1 saf çözüm zinciri");
    const gOff = { vatRate: 20, financeWithholdingEnabled: false, financeWithholdingNumerator: 0, financeWithholdingDenominator: 10 };
    const gOn = { vatRate: 20, financeWithholdingEnabled: true, financeWithholdingNumerator: 9, financeWithholdingDenominator: 10 };
    const none = { vatRate: null, withholdingEnabled: null, withholdingNumerator: null, withholdingDenominator: null };
    const cust = { vatRate: 10, withholdingEnabled: true, withholdingNumerator: 5, withholdingDenominator: 10 };
    const a = computeInvoiceTaxDefaults(InvoiceType.SALES, none, gOff);
    check("ayar + müşteri yok ⇒ KDV genel 20, tevkifat 0", a.vatRate === 20 && a.withholdingRate === 0 && a.withholdingRatio === null, JSON.stringify(a));
    const b = computeInvoiceTaxDefaults(InvoiceType.SALES, none, gOn);
    check("genel tevkifat 9/10 ⇒ 90 (KDV'nin %'si), kaynak GENERAL", b.withholdingRate === 90 && b.source.withholding === "GENERAL", JSON.stringify(b));
    const c = computeInvoiceTaxDefaults(InvoiceType.SALES, cust, gOn);
    check("müşteri %10 + 5/10 genel 20 + 9/10'u ezer", c.vatRate === 10 && c.withholdingRate === 50 && c.source.vat === "CARI" && c.source.withholding === "CARI", JSON.stringify(c));
    const d = computeInvoiceTaxDefaults(InvoiceType.SALES, { ...none, withholdingEnabled: false }, gOn);
    check("müşteri 'uygulanmaz' genel açığı ezer ⇒ 0", d.withholdingRate === 0 && d.vatRate === 20, JSON.stringify(d));
    const e = computeInvoiceTaxDefaults(InvoiceType.SALES, { ...none, withholdingEnabled: true }, { ...gOff, financeWithholdingNumerator: 0 });
    check("müşteri açık ama oran hiçbir yerde yok ⇒ tevkifat UYDURULMAZ (0)", e.withholdingRate === 0, JSON.stringify(e));
    const f = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, cust, gOn);
    check("ALIŞ: müşteri geçersiz kılması ve genel tevkifat okunmaz (bugünkü)", f.vatRate === 20 && f.withholdingRate === 0, JSON.stringify(f));
    check("7/10 ⇒ 70, 2/10 ⇒ 20, 1/3 ⇒ 33.33", computeInvoiceTaxDefaults(InvoiceType.SALES, { ...none, withholdingEnabled: true, withholdingNumerator: 7, withholdingDenominator: 10 }, gOff).withholdingRate === 70
      && computeInvoiceTaxDefaults(InvoiceType.SALES, { ...none, withholdingEnabled: true, withholdingNumerator: 2, withholdingDenominator: 10 }, gOff).withholdingRate === 20
      && computeInvoiceTaxDefaults(InvoiceType.SALES, { ...none, withholdingEnabled: true, withholdingNumerator: 1, withholdingDenominator: 3 }, gOff).withholdingRate === 33.33);

    // ── §2 ──
    section("§2 DB çözümü (cariId + kart yolu)");
    for (const k of KEYS) await prisma.systemSetting.deleteMany({ where: { key: k } });
    const cu = await prisma.customer.create({ data: { code: `TEST-KDV-${STAMP}`, name: `TEST KDV tevkifat ${STAMP}` }, select: { id: true } });
    customerId = cu.id;
    cariId = (await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cu.id, subcontractorId: null }))).id;
    const base = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, cariId });
    check("ayar satırı + müşteri değeri yok ⇒ taslak satır alanları bayt-aynı { vatRate: 20 }", JSON.stringify(taxLineFields(base)) === JSON.stringify({ vatRate: 20 }), JSON.stringify(taxLineFields(base)));
    await systemSettingService.setFeatureFlags({ financeDefaultVatRate: 18, financeWithholdingEnabled: true, financeWithholdingNumerator: 5, financeWithholdingDenominator: 10 }, actor);
    const gen = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: cu.id });
    check("genel 18 + 5/10 ⇒ taslak genelden (kart yolu)", gen.vatRate === 18 && gen.withholdingRate === 50 && gen.source.withholding === "GENERAL", JSON.stringify(gen));
    await cariService.update(cariId, { vatRate: "10", withholdingNumerator: 7, withholdingDenominator: 10 }, actor);
    const own = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, cariId });
    const ownCard = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: cu.id });
    check("müşteri %10 + 7/10 (açıklık genelden) ⇒ taslak müşteriden; iki yol aynı", own.vatRate === 10 && own.withholdingRate === 70 && JSON.stringify(own) === JSON.stringify(ownCard), JSON.stringify(own));
    await cariService.update(cariId, { withholdingEnabled: false }, actor);
    const off = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, cariId });
    check("müşteri 'uygulanmaz' ⇒ tevkifat 0, satır alanı eklenmez", off.withholdingRate === 0 && !("withholdingRate" in taxLineFields(off)), JSON.stringify(off));
    const pur = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: cu.id });
    check("ALIŞ ⇒ genel KDV 18, tevkifat 0", pur.vatRate === 18 && pur.withholdingRate === 0, JSON.stringify(pur));
    const row = (await cariService.findById(cariId)).data!;
    check("cari satırı geçersiz kılmayı taşır (panel formu buradan okur)", Number(row.vatRate) === 10 && row.withholdingEnabled === false && row.withholdingNumerator === 7 && row.withholdingDenominator === 10, JSON.stringify(row));

    // ── §3 ──
    section("§3 tutar el hesabı");
    const t = computeInvoiceTotals([{ qty: 100, unitPrice: 10, vatRate: 20, withholdingRate: 50 }]);
    check("1000 TL · KDV 200 · tevkifat 100 · ödenecek 1100", t.subtotal.eq(1000) && t.vatTotal.eq(200) && t.withholdingTotal.eq(100) && t.grandTotal.eq(1100), JSON.stringify(t));
    const t2 = computeInvoiceTotals([{ qty: 3, unitPrice: "33.33", vatRate: 20, withholdingRate: 70 }]);
    check("99,99 · KDV 20,00 · tevkifat 7/10 = 14,00 · ödenecek 105,99", t2.subtotal.eq("99.99") && t2.vatTotal.eq("20") && t2.withholdingTotal.eq("14") && t2.grandTotal.eq("105.99"), JSON.stringify(t2));

    // ── §4 ──
    section("§4 genel ayar kapısı (bilinmeyen değer 400)");
    check("Zod: pay 1.5 RED", !updateSchema.safeParse({ financeWithholdingNumerator: 1.5 }).success);
    check("Zod: payda 0 RED", !updateSchema.safeParse({ financeWithholdingDenominator: 0 }).success);
    check("Zod: açık/kapalı 'evet' RED", !updateSchema.safeParse({ financeWithholdingEnabled: "evet" }).success);
    check("Zod: bilinmeyen anahtar RED", !updateSchema.safeParse({ financeWithholdingRate: 50 }).success);
    check("Zod: geçerli üçlü kabul", updateSchema.safeParse({ financeWithholdingEnabled: true, financeWithholdingNumerator: 5, financeWithholdingDenominator: 10 }).success);
    const s1 = await errOf(() => systemSettingService.setFeatureFlags({ financeWithholdingNumerator: 0 }, actor));
    check("servis: genel açıkken pay 0 ⇒ 400 WITHHOLDING_SETTING_INVALID", s1.status === 400 && s1.code === "WITHHOLDING_SETTING_INVALID", JSON.stringify(s1));
    const s2 = await errOf(() => systemSettingService.setFeatureFlags({ financeWithholdingNumerator: 11 }, actor));
    check("servis: pay > payda ⇒ 400", s2.status === 400, JSON.stringify(s2));
    const kept = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: null });
    check("reddedilen yazım ayarı değiştirmez (5/10 kalır)", kept.withholdingRate === 50, JSON.stringify(kept));

    // ── §5 ──
    section("§5 cari kapısı");
    const before = await prisma.cariAccount.findUniqueOrThrow({ where: { id: cariId }, select: { vatRate: true, withholdingNumerator: true, withholdingDenominator: true } });
    const bads: Array<[string, Parameters<typeof cariService.update>[1]]> = [
      ["KDV 150", { vatRate: 150 }],
      ["KDV 'yirmi'", { vatRate: "yirmi" }],
      ["yalnız pay (payda boşaltılır)", { withholdingDenominator: null }],
      ["pay > payda", { withholdingNumerator: 11, withholdingDenominator: 10 }],
      ["pay 0", { withholdingNumerator: 0, withholdingDenominator: 10 }],
    ];
    for (const [label, input] of bads) {
      const r = await errOf(() => cariService.update(cariId as string, input, actor));
      check(`${label} ⇒ 400 CARI_TAX_OVERRIDE_INVALID`, r.status === 400 && r.code === "CARI_TAX_OVERRIDE_INVALID", JSON.stringify(r));
    }
    const after = await prisma.cariAccount.findUniqueOrThrow({ where: { id: cariId }, select: { vatRate: true, withholdingNumerator: true, withholdingDenominator: true } });
    check("reddedilen yazımlar kolonu değiştirmez", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));

    // ── §6 ──
    section("§6 AST tek çözümleyici");
    const offenders: string[] = [];
    const draftCalls = new Set<string>();
    for (const file of walk(SRC)) {
      const r = rel(file);
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
          if (SETTING_READERS.has(callee) && !SETTING_READER_FILES.has(r)) offenders.push(`${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${callee}()`);
          if (callee === "resolveInvoiceTaxDefaults") draftCalls.add(r);
        }
        let name: string | null = null;
        if (ts.isPropertyAccessExpression(n)) name = n.name.text;
        else if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isBindingElement(n)) && n.name && ts.isIdentifier(n.name)) name = n.name.text;
        if (name && CARI_FIELDS.has(name) && !CARI_FIELD_FILES.has(r)) offenders.push(`${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} .${name}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    check("ikinci çözümleyici yok (ayar okuyucusu / cari tevkifat alanı beyanlı dosya dışında okunmaz)", offenders.length === 0, offenders.join(" · "));
    const missing = DRAFT_PATHS.filter((p) => !draftCalls.has(p));
    check("üç taslak yolu (sevk · dönem · mal kabul) çözümleyiciyi çağırır", missing.length === 0, missing.join(", "));
  } finally {
    if (cariId) {
      await prisma.cariBalance.deleteMany({ where: { cariId } });
      await prisma.cariAccount.deleteMany({ where: { id: cariId } });
    }
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    for (const [k, v] of prior) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
      else await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v as never }, update: { value: v as never } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
