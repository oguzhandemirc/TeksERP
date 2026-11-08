// =============================================================================
// BEKÇİ — KDV + TEVKİFAT AYARI: genel ayar + müşteri bazında (D4-V1k; B-1 kullanıcı kararı 2026-10-31)
// =============================================================================
//   §1 SAF çözüm: müşteri cari ?? genel ayar ?? bugünkü (KDV genel, tevkifat 0); ALIŞ geçersiz kılmayı okumaz
//   §2 DB çözümü (cariId + kart yolu): ayar/müşteri yok ⇒ bugünkü satır şekli bayt-aynı; genel ⇒ genelden;
//      müşteri ⇒ ondan; müşteri "uygulanmaz" genel açığı ezer
//   §3 tutar el hesabı: 1000 TL, KDV %20 ⇒ 200; tevkifat 5/10 ⇒ 100 (alıcı öder); ödenecek 1100
//   §4 genel ayar kapısı: Zod (tam sayı, aralık, bilinmeyen anahtar) + servis (açıkken oran, pay ≤ payda) ⇒ 400
//   §5 cari kapısı: KDV aralığı, yarım oran, pay > payda, pay 0 ⇒ 400 CARI_TAX_OVERRIDE_INVALID; kolon değişmez
//   §6 AST TEK ÇÖZÜMLEYİCİ: KDV/tevkifat ayar okuyucuları (ince okuyucular dahil), getFeatureFlags'in finance*
//      alanları, carinin tevkifat alanları ve `cari.vatRate` yalnız beyanlı dosyalarda; üç taslak yolu `resolveInvoiceTaxDefaults` çağırır
//   §7 ALIŞ KOLU (F7, fason planı FK4): kapalı ⇒ 0 = bugünkü (satır şekli bayt-aynı); açık ⇒ yalnız fason rolüne;
//      fason carisi > genel; "uygulanmaz" genel açığı ezer; tarafsız/fason olmayan ⇒ 0; çöp ayar ⇒ bugünküne düşer;
//      ayar + cari kapısı (Zod/servis/DB seddi) satış üçlüsünün ikizi
// Dönem taslağı uçtan ucu (müşteri %10 + 5/10 ⇒ satır) `test_hizmet_fatura` §14/§19v'de.
// Negatif sondalar (2026-10-31): `computeInvoiceTaxDefaults` geçersiz kılmayı yok sayınca §1/§2 kırmızı ·
// `service-period-invoice.service`e ikinci `readFinanceDefaultVatRate()` yazılınca §6 kırmızı (geri alındı) ·
// bitirici: dönem taslağına `readFinanceWithholdingEnabled()` / `flags.financeWithholdingEnabled` / `cari.vatRate` ⇒ §6 kırmızı.
// F7 sondaları (2026-11-08): alış rol süzgeci silinince §7 4 ❌ · alış kolu bugünküne döndürülünce §7 3 ❌ ·
// okuyucunun çöp düşmesi kapatılınca §7 "payda 200" ❌ · `invoice.service`e `readFinancePurchaseWithholdingFlags()` ⇒ §6 ❌.
// İnceleme #630: `isSubcontractorParty` `kind` kolunu düşürünce §7 2 ❌ (yüklem + kartsız eski fason hesabı).
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
import { computeInvoiceTaxDefaults, isSubcontractorParty, resolveInvoiceTaxDefaults, taxLineFields } from "../src/services/helpers/invoice-tax-defaults.helper";
import { computeInvoiceTotals, ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { cariService } from "../src/services/cari.service";
import { testActorId } from "./fixture-test-user";
import { checkConstraintMessage, extractCheckConstraint } from "../src/middlewares/error.middleware";
import { ayarServisEtiketi } from "./lib/ayar-servis-kaynak";

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
// Ayar servisi ailesi (cephe + services/system-setting/) tek etiket (2026-11-08 bölmesi).
const rel = (f: string) => ayarServisEtiketi(path.relative(SRC, f).split(path.sep).join("/"));
const RESOLVER = "services/helpers/invoice-tax-defaults.helper.ts";
const SETTING_READERS = new Set([
  "readFinanceDefaultVatRate",
  "readFinanceWithholdingFlags",
  "readFinanceWithholdingEnabled",
  "readFinanceWithholdingNumerator",
  "readFinanceWithholdingDenominator",
  "readFinancePurchaseWithholdingFlags",
  "readFinancePurchaseWithholdingEnabled",
  "readFinancePurchaseWithholdingNumerator",
  "readFinancePurchaseWithholdingDenominator",
]);
// getFeatureFlags() sonucundaki ayar alanları da bir okuma kapısıdır: beyanlı dosya (okuyucu · sözleşme · çözümleyici) dışında okunmaz.
const FLAG_FIELDS = new Set([
  "financeDefaultVatRate", "financeWithholdingEnabled", "financeWithholdingNumerator", "financeWithholdingDenominator",
  "financePurchaseWithholdingEnabled", "financePurchaseWithholdingNumerator", "financePurchaseWithholdingDenominator",
]);
const FLAG_FIELD_FILES = new Set(["services/system-setting.service.ts", "routes/feature-flag.routes.ts", RESOLVER]);
const SETTING_READER_FILES = new Set(["services/system-setting.service.ts", RESOLVER]);
const CARI_FIELDS = new Set([
  "withholdingEnabled", "withholdingNumerator", "withholdingDenominator",
  "purchaseWithholdingEnabled", "purchaseWithholdingNumerator", "purchaseWithholdingDenominator",
]);
// Cari geçersiz kılmasını YAZAN (doğrulama) ve sözleşmeyi taşıyan (Zod) yüzeyler; okuyup karar veren yalnız RESOLVER.
// cari-merge.helper (D4-K3d): birleştirmede kaynak terimini boş hedefe KOPYALAR (çatışmada durur) — çözümlemez.
const CARI_FIELD_FILES = new Set([RESOLVER, "services/helpers/cari-tax-override.helper.ts", "routes/finance.routes.ts", "services/helpers/cari-merge.helper.ts"]);
const DRAFT_PATHS = ["services/helpers/shipment-auto-draft.helper.ts", "services/service-period-invoice.service.ts", "services/invoice.service.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const PURCHASE_KEYS = [SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED, SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR, SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR];
const KEYS = [SETTING_KEYS.FINANCE_DEFAULT_VAT_RATE, SETTING_KEYS.FINANCE_WITHHOLDING_ENABLED, SETTING_KEYS.FINANCE_WITHHOLDING_NUMERATOR, SETTING_KEYS.FINANCE_WITHHOLDING_DENOMINATOR, ...PURCHASE_KEYS];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const actor = await testActorId();
  const prior = new Map<string, Prisma.JsonValue | undefined>();
  for (const k of KEYS) prior.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  const STAMP = randomUUID().slice(0, 8);
  let customerId: string | null = null;
  let cariId: string | null = null;
  let fasonCustomerId: string | null = null;
  let fasonCariId: string | null = null;
  let legacySubId: string | null = null;
  let legacyCariId: string | null = null;
  let dualCustomerId: string | null = null;
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
    const vatBefore = (await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: null })).vatRate;
    const s3 = await errOf(() => systemSettingService.setFeatureFlags({ financeDefaultVatRate: vatBefore === 1 ? 8 : 1, financeWithholdingEnabled: true, financeWithholdingNumerator: 0 }, actor));
    const vatAfter = (await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: null })).vatRate;
    check("geçersiz tevkifatlı gövde KDV'yi de YAZMAZ (doğrulama her yazmadan önce)", s3.status === 400 && vatAfter === vatBefore, JSON.stringify({ s3, vatBefore, vatAfter }));
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
    // Eşzamanlı iki PATCH uygulama doğrulamasını aşarsa DB seddi (23514 → 409 INTEGRITY_RULE) iş dilinde konuşur.
    let sedName: string | null = null;
    try {
      await prisma.cariAccount.update({ where: { id: cariId }, data: { withholdingNumerator: 9, withholdingDenominator: 3 } });
    } catch (e) {
      sedName = extractCheckConstraint(e);
    }
    check("DB seddi pay > paydayı reddeder ve Türkçe mesajı var", sedName === "cari_accounts_withholding_ck" && Boolean(checkConstraintMessage(sedName)), String(sedName));
    check("KDV seddinin Türkçe mesajı var", Boolean(checkConstraintMessage("cari_accounts_vat_override_ck")));

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
        // Takma adla içe aktarım (`import { readFinance… as x }`) çağrı adını gizler — belirteç adından yakala.
        if (ts.isImportSpecifier(n) && SETTING_READERS.has((n.propertyName ?? n.name).text) && !SETTING_READER_FILES.has(r)) {
          offenders.push(`${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} import ${(n.propertyName ?? n.name).text}`);
        }
        let name: string | null = null;
        if (ts.isPropertyAccessExpression(n)) name = n.name.text;
        else if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isBindingElement(n)) && n.name && ts.isIdentifier(n.name)) name = n.name.text;
        const at = () => `${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} .${name}`;
        if (name && CARI_FIELDS.has(name) && !CARI_FIELD_FILES.has(r)) offenders.push(at());
        if (name && FLAG_FIELDS.has(name) && !FLAG_FIELD_FILES.has(r)) offenders.push(at());
        // `vatRate` fatura satırında da var; yalnız cari nesnesinden (`cari.vatRate`, `cariAccount?.vatRate`) okunuşu yasak.
        if (name === "vatRate" && ts.isPropertyAccessExpression(n) && /cari/i.test(n.expression.getText(sf)) && !CARI_FIELD_FILES.has(r)) offenders.push(at());
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    check("ikinci çözümleyici yok (ayar okuyucusu / cari tevkifat alanı beyanlı dosya dışında okunmaz)", offenders.length === 0, offenders.join(" · "));
    const missing = DRAFT_PATHS.filter((p) => !draftCalls.has(p));
    check("üç taslak yolu (sevk · dönem · mal kabul) çözümleyiciyi çağırır", missing.length === 0, missing.join(", "));

    // ── §7 ──
    section("§7 ALIŞ kolu — saf çözüm");
    const pOff = { ...gOn, financePurchaseWithholdingEnabled: false, financePurchaseWithholdingNumerator: 0, financePurchaseWithholdingDenominator: 10 };
    const pOn = { ...gOn, financePurchaseWithholdingEnabled: true, financePurchaseWithholdingNumerator: 7, financePurchaseWithholdingDenominator: 10 };
    const pNone = { purchaseWithholdingEnabled: null, purchaseWithholdingNumerator: null, purchaseWithholdingDenominator: null };
    const fason = { override: pNone, isSubcontractor: true };
    const p1 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOff, fason);
    check("alış kapalı + fason ⇒ tevkifat 0 (bugünkü)", p1.withholdingRate === 0 && p1.vatRate === 20, JSON.stringify(p1));
    const p2 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOn, fason);
    check("alış genel 7/10 + fason ⇒ 70, kaynak GENERAL", p2.withholdingRate === 70 && p2.source.withholding === "GENERAL", JSON.stringify(p2));
    const p3 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOn, { override: pNone, isSubcontractor: false });
    check("alış genel açık ama taraf fason DEĞİL ⇒ 0 (iplik tedarikçisine uydurulmaz)", p3.withholdingRate === 0, JSON.stringify(p3));
    const p4 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOn, null);
    check("alış genel açık ama taraf yok ⇒ 0", p4.withholdingRate === 0, JSON.stringify(p4));
    const p5 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOn, { override: { purchaseWithholdingEnabled: null, purchaseWithholdingNumerator: 5, purchaseWithholdingDenominator: 10 }, isSubcontractor: true });
    check("fason carisi 5/10 genel 7/10'u ezer ⇒ 50, kaynak CARI", p5.withholdingRate === 50 && p5.source.withholding === "CARI", JSON.stringify(p5));
    const p6 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOn, { override: { ...pNone, purchaseWithholdingEnabled: false }, isSubcontractor: true });
    check("fason carisi 'uygulanmaz' genel açığı ezer ⇒ 0", p6.withholdingRate === 0, JSON.stringify(p6));
    const p7 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, null, pOff, { override: { ...pNone, purchaseWithholdingEnabled: true }, isSubcontractor: false });
    check("cari 'uygulanır' ama oran hiçbir yerde yok ⇒ UYDURULMAZ (0)", p7.withholdingRate === 0, JSON.stringify(p7));
    const p8 = computeInvoiceTaxDefaults(InvoiceType.PURCHASE, cust, gOn, fason);
    check("alış satış geçersiz kılmasını ve satış genel tevkifatını OKUMAZ (alış üçlüsü yok ⇒ 0, KDV genel)", p8.withholdingRate === 0 && p8.vatRate === 20, JSON.stringify(p8));

    section("§7 ALIŞ kolu — DB çözümü");
    for (const k of PURCHASE_KEYS) await prisma.systemSetting.deleteMany({ where: { key: k } });
    const fc = await prisma.customer.create({ data: { code: `TEST-KDVF-${STAMP}`, name: `TEST KDV fason ${STAMP}`, isSubcontractorRole: true }, select: { id: true } });
    fasonCustomerId = fc.id;
    fasonCariId = (await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: fc.id, subcontractorId: null }))).id;
    const genVat = (await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, customerId: null })).vatRate;
    const q0 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("alış ayar satırı yok + fason ⇒ satır alanları bayt-aynı { vatRate }", JSON.stringify(taxLineFields(q0)) === JSON.stringify({ vatRate: genVat }), JSON.stringify(taxLineFields(q0)));
    const flags0 = (await systemSettingService.getFeatureFlags()).data!;
    check("getFeatureFlags: alış üçlüsü varsayılanı KAPALI · 0 · 10", flags0.financePurchaseWithholdingEnabled === false && flags0.financePurchaseWithholdingNumerator === 0 && flags0.financePurchaseWithholdingDenominator === 10, JSON.stringify({ e: flags0.financePurchaseWithholdingEnabled, n: flags0.financePurchaseWithholdingNumerator, d: flags0.financePurchaseWithholdingDenominator }));
    await systemSettingService.setFeatureFlags({ financePurchaseWithholdingEnabled: true, financePurchaseWithholdingNumerator: 7, financePurchaseWithholdingDenominator: 10 }, actor);
    const q1 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    const q1Card = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: fc.id });
    check("alış genel 7/10 ⇒ fason taslağı 70 (cariId ve kart yolu aynı)", q1.withholdingRate === 70 && JSON.stringify(q1) === JSON.stringify(q1Card), JSON.stringify({ q1, q1Card }));
    const q2 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: cu.id });
    check("fason rolü olmayan kart ⇒ alışta 0", q2.withholdingRate === 0, JSON.stringify(q2));
    const q3 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE });
    check("tarafsız alış (mal kabul taslağı) ⇒ 0 = bugünkü", q3.withholdingRate === 0 && !("withholdingRate" in taxLineFields(q3)), JSON.stringify(q3));
    await cariService.update(fasonCariId, { purchaseWithholdingNumerator: 5, purchaseWithholdingDenominator: 10 }, actor);
    const q4 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("fason carisi 5/10 > genel 7/10 ⇒ 50, kaynak CARI", q4.withholdingRate === 50 && q4.source.withholding === "CARI", JSON.stringify(q4));
    const q4s = await resolveInvoiceTaxDefaults({ type: InvoiceType.SALES, cariId: fasonCariId });
    check("alış geçersiz kılması SATIŞ çözümüne sızmaz", q4s.source.withholding === "GENERAL", JSON.stringify(q4s));
    await cariService.update(fasonCariId, { purchaseWithholdingEnabled: false }, actor);
    const q5 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("fason carisi 'uygulanmaz' ⇒ 0", q5.withholdingRate === 0, JSON.stringify(q5));
    await cariService.update(cariId, { purchaseWithholdingEnabled: true, purchaseWithholdingNumerator: 2, purchaseWithholdingDenominator: 10 }, actor);
    const q6 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId });
    check("fason rolü olmayan cari de açık geçersiz kılmayla tevkifat alır (cari > rol süzgeci) ⇒ 20", q6.withholdingRate === 20, JSON.stringify(q6));
    // Rol yüklemi tek yardımcıda: kart rolü ya da kartsız eski fason hesabı (kind SUBCONTRACTOR).
    check("isSubcontractorParty: kind SUBCONTRACTOR · kart rolü ⇒ fason; CUSTOMER rolsüz / bilinmeyen ⇒ değil",
      isSubcontractorParty({ kind: "SUBCONTRACTOR", isSubcontractorRole: null }) && isSubcontractorParty({ kind: "CUSTOMER", isSubcontractorRole: true })
      && isSubcontractorParty({ kind: null, isSubcontractorRole: true }) && !isSubcontractorParty({ kind: "CUSTOMER", isSubcontractorRole: false }) && !isSubcontractorParty({ kind: null, isSubcontractorRole: null }));
    const ls = await prisma.subcontractor.create({ data: { code: `TKF${STAMP}`, name: `TEST KDV eski fason ${STAMP}` }, select: { id: true } });
    legacySubId = ls.id;
    legacyCariId = (await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: null, subcontractorId: ls.id }))).id;
    const legacyKind = (await prisma.cariAccount.findUniqueOrThrow({ where: { id: legacyCariId }, select: { kind: true, customerId: true } }));
    const q6l = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: legacyCariId });
    check("kartsız eski fason hesabı (kind SUBCONTRACTOR) genel alış ayarını alır ⇒ 70", legacyKind.kind === "SUBCONTRACTOR" && legacyKind.customerId === null && q6l.withholdingRate === 70, JSON.stringify({ legacyKind, q6l }));
    // BİLİNEN SINIR (inceleme #630): süzgeç kart düzeyinde — hem tedarikçi hem fason kartın iplik faturası da önerilir (satırda düzeltilir).
    const dc = await prisma.customer.create({ data: { code: `TEST-KDVD-${STAMP}`, name: `TEST KDV çift rol ${STAMP}`, isSupplierRole: true, isSubcontractorRole: true }, select: { id: true } });
    dualCustomerId = dc.id;
    const q6d = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: dc.id });
    check("çift rollü kart (tedarikçi + fason) ⇒ 70 önerilir (fatura içeriği ayrılmaz — bilinen sınır, F6)", q6d.withholdingRate === 70, JSON.stringify(q6d));
    const frow = (await cariService.findById(fasonCariId)).data!;
    check("cari satırı alış geçersiz kılmasını taşır", frow.purchaseWithholdingEnabled === false && frow.purchaseWithholdingNumerator === 5 && frow.purchaseWithholdingDenominator === 10, JSON.stringify(frow));
    // Çöp ayar (elle yazılmış pay > payda / metin bayrak) ⇒ okuyucu KAPALIYA düşer = bugünkü.
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR }, data: { value: 15 } });
    await cariService.update(fasonCariId, { purchaseWithholdingEnabled: null, purchaseWithholdingNumerator: null, purchaseWithholdingDenominator: null }, actor);
    const q7 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("çöp genel ayar (pay 15 > payda 10) ⇒ 0 = bugünkü", q7.withholdingRate === 0, JSON.stringify(q7));
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR }, data: { value: 7 } });
    // Payda 200 (> 99 tavanı) saf çözümün pay ≤ payda sigortasını GEÇER — yalnız okuyucunun kapalıya düşmesi yakalar.
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR }, data: { value: 200 } });
    const q7b = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("çöp genel ayar (payda 200 > tavan 99) ⇒ 0 = bugünkü", q7b.withholdingRate === 0, JSON.stringify(q7b));
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR }, data: { value: 10 } });
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED }, data: { value: "evet" } });
    const q8 = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, cariId: fasonCariId });
    check("çöp açık/kapalı ('evet') ⇒ 0 = bugünkü", q8.withholdingRate === 0, JSON.stringify(q8));

    section("§7 ALIŞ kolu — ayar + cari kapısı");
    check("Zod: alış pay 1.5 RED", !updateSchema.safeParse({ financePurchaseWithholdingNumerator: 1.5 }).success);
    check("Zod: alış payda 0 RED", !updateSchema.safeParse({ financePurchaseWithholdingDenominator: 0 }).success);
    check("Zod: alış açık/kapalı 'evet' RED", !updateSchema.safeParse({ financePurchaseWithholdingEnabled: "evet" }).success);
    check("Zod: geçerli alış üçlüsü kabul", updateSchema.safeParse({ financePurchaseWithholdingEnabled: true, financePurchaseWithholdingNumerator: 7, financePurchaseWithholdingDenominator: 10 }).success);
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED }, data: { value: true } });
    const ps1 = await errOf(() => systemSettingService.setFeatureFlags({ financePurchaseWithholdingNumerator: 0 }, actor));
    check("servis: alış açıkken pay 0 ⇒ 400 WITHHOLDING_SETTING_INVALID", ps1.status === 400 && ps1.code === "WITHHOLDING_SETTING_INVALID", JSON.stringify(ps1));
    const salesBefore = (await systemSettingService.getFeatureFlags()).data!.financeWithholdingNumerator;
    const ps2 = await errOf(() => systemSettingService.setFeatureFlags({ financeWithholdingNumerator: salesBefore === 3 ? 4 : 3, financePurchaseWithholdingNumerator: 11 }, actor));
    const salesAfter = (await systemSettingService.getFeatureFlags()).data!.financeWithholdingNumerator;
    check("geçersiz alış üçlülü gövde satış oranını da YAZMAZ", ps2.status === 400 && salesAfter === salesBefore, JSON.stringify({ ps2, salesBefore, salesAfter }));
    // 400'ün alış üçlüsünden geldiği: satış kısmı tek başına geçerli; kod WITHHOLDING_SETTING_INVALID.
    const ps2Sales = updateSchema.safeParse({ financeWithholdingNumerator: salesBefore === 3 ? 4 : 3 }).success;
    check("ps2 400 kodu WITHHOLDING_SETTING_INVALID ve kaynağı alış üçlüsü (satış parçası tek başına geçerli)", ps2.code === "WITHHOLDING_SETTING_INVALID" && ps2Sales, JSON.stringify({ ps2, ps2Sales }));
    const pbads: Array<[string, Parameters<typeof cariService.update>[1]]> = [
      ["alış yalnız pay", { purchaseWithholdingNumerator: 5 }],
      ["alış pay > payda", { purchaseWithholdingNumerator: 11, purchaseWithholdingDenominator: 10 }],
      ["alış pay 0", { purchaseWithholdingNumerator: 0, purchaseWithholdingDenominator: 10 }],
    ];
    for (const [label, input] of pbads) {
      const r = await errOf(() => cariService.update(fasonCariId as string, input, actor));
      check(`${label} ⇒ 400 CARI_TAX_OVERRIDE_INVALID`, r.status === 400 && r.code === "CARI_TAX_OVERRIDE_INVALID", JSON.stringify(r));
    }
    let psed: string | null = null;
    try {
      await prisma.cariAccount.update({ where: { id: fasonCariId }, data: { purchaseWithholdingNumerator: 9, purchaseWithholdingDenominator: 3 } });
    } catch (e) {
      psed = extractCheckConstraint(e);
    }
    check("DB seddi alış pay > paydayı reddeder ve Türkçe mesajı var", psed === "cari_accounts_purchase_withholding_ck" && Boolean(checkConstraintMessage(psed)), String(psed));
  } finally {
    for (const id of [fasonCariId, legacyCariId]) {
      if (!id) continue;
      await prisma.cariBalance.deleteMany({ where: { cariId: id } });
      await prisma.cariAccount.deleteMany({ where: { id } });
    }
    if (fasonCustomerId) await prisma.customer.deleteMany({ where: { id: fasonCustomerId } });
    if (dualCustomerId) {
      await prisma.cariAccount.deleteMany({ where: { customerId: dualCustomerId } });
      await prisma.customer.deleteMany({ where: { id: dualCustomerId } });
    }
    if (legacySubId) await prisma.subcontractor.deleteMany({ where: { id: legacySubId } });
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
