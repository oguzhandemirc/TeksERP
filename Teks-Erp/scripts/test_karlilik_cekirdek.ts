// =============================================================================
// BEKÇİ — GERÇEKLEŞEN KÂRLILIK ÇEKİRDEĞİ (D4-G2a; tasarım DALGA4 §8.3, §8.5, §8.6, §12.1, §13 D4-G2a)
// =============================================================================
//   §0 statik — `profitability*.helper` ↔ `fabric-cost.helper` karşılıklı import YOK (statik + dinamik);
//      kârlılık dosyaları iş listesini yeniden yazmaz (rollProperty / rollMeterReading / rollOperation delegesi YOK)
//   §1 ALTIN fikstür (2 müşteri, 3 işlem, 1 iptal, 1 dış fason faturası; 2025-01) → müşteri başına gelir/sarf/
//      dış fason/katkı el hesabına kuruşu kuruşuna eşit; kalem satırının bağlara bölünmüş geliri toplamı = satır;
//      dış fason paydası donmuş metre (doğan kardeş top ya da kendisi dönen NULL kalemli top kesilince geçmiş ay değişmez)
//   §2 taslak fatura kâra GİRMEZ (`draftRows`ta, `rows`ta yok)
//   §3 iptal İPTAL AYINDA eksi; geçen ayın raporu iptalden sonra BAYT-AYNI; iki ay toplamı iptalsiz katkıya eşit
//   §4 eksik norm → SARF_NORMU, kur yok → FX_RATE_MISSING, gelir satırı yok → GELIR_SATIRI, RECEIVED işin makbuzu
//      çözülemez → DIS_FASON_MAKBUZU; değer ve katkı null (0 DEĞİL), özet katkısı null
//   §5 ayarlar — SON_ALIS_FATURASI sarf fiyatını faturadan; FATURA_ONCE faturasız fasonda tarife "tahmini";
//      YALNIZ_FATURA → DIS_FASON_FATURASI eksik; KG tabanlı tek tarife → DIS_FASON_TARIFESI eksik (SY-E1)
//   §6 ayar yazımı — iki ayar getFeatureFlags'te varsayılanla; tanınmayan değer 400; geçerli değer yazılır
//   §7 modül — maliyet KAPALI → null ve fatura/kur/fiyat tablolarına SIFIR sorgu; geçersiz ay 400 PROFIT_RANGE_INVALID
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; fikstür 2025 aylarındadır (canlı veriyle
//    karışmaz), satırlar yine de fikstür müşterilerine süzülür.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { Currency, InvoiceStatus, ItemType, ItemUnit, PriceKind, Prisma, RollEntrySource, RollStatus, ServiceMeterBasis, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestSander } from "./fixture-subcontractor";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { revokeServiceLinksTx } from "../src/services/helpers/service-billing.helper";
import { computeProfitability, summarizeProfitability, type ProfitabilityRow } from "../src/services/helpers/profitability.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const HELPERS = path.join(ROOT, "src/services/helpers");
const P = `TEST-KAR-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED,
  SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE, SETTING_KEYS.COST_PROFIT_CONSUMABLE_PRICE_SOURCE,
];
const T = (s: string) => new Date(`${s}T09:00:00+03:00`);
const BEFORE = T("2024-12-01");
const f2 = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? "null" : d.toFixed(2));

const ids = { customers: [] as string[], items: [] as string[], rolls: [] as string[], invoices: [] as string[], receipts: [] as string[], rates: [] as string[], caris: [] as string[], wos: [] as string[], steps: [] as string[], stations: [] as string[] };

// ── §0 statik ────────────────────────────────────────────────────────────────
function importsOf(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}
function delegatesOf(file: string, names: Set<string>): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && names.has(n.name.text)) out.push(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}
function bolum0(): void {
  const profit = readdirSync(HELPERS).filter((f) => /^profitability.*\.ts$/.test(f)).map((f) => path.join(HELPERS, f));
  const cost = path.join(HELPERS, "fabric-cost.helper.ts");
  check("§0 zemin: kârlılık dosyaları bulundu (≥ 3)", profit.length >= 3, profit.map((f) => path.basename(f)).join(", "));
  const ihlal: string[] = [];
  for (const f of profit) for (const m of importsOf(f)) if (/fabric-cost(\.helper)?$/.test(m)) ihlal.push(`${path.basename(f)} → ${m}`);
  for (const m of importsOf(cost)) if (/profitability/.test(m)) ihlal.push(`fabric-cost.helper.ts → ${m}`);
  check("§0a ⭐ profitability ↔ fabric-cost karşılıklı import YOK", ihlal.length === 0, ihlal.join(", ") || "temiz");
  const forbidden = new Set(["rollProperty", "rollMeterReading", "rollOperation"]);
  const ikinci = profit.flatMap((f) => delegatesOf(f, forbidden).map((d) => `${path.basename(f)}.${d}`));
  check("§0b ⭐ kârlılık iş listesini yeniden yazmaz (rollProperty/rollMeterReading/rollOperation okuması yok)", ikinci.length === 0, ikinci.join(", ") || "temiz");
}

// ── Fikstür ──────────────────────────────────────────────────────────────────
async function item(code: string, itemType: ItemType, unit: ItemUnit): Promise<string> {
  const r = await prisma.item.create({ data: { code: `${P}-${code}`, name: `TEST kârlılık ${code} ${process.pid}`, itemType, unit }, select: { id: true } });
  ids.items.push(r.id);
  return r.id;
}
async function customer(code: string): Promise<{ id: string; cariId: string }> {
  const c = await prisma.customer.create({ data: { code: `${P}-${code}`, name: `TEST kârlılık müşteri ${code} ${process.pid}` }, select: { id: true } });
  ids.customers.push(c.id);
  const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: c.id, subcontractorId: null }));
  return { id: c.id, cariId: cari.id };
}
let fabricId = "";
let gradeCode = "";
async function roll(owner: string, qty: number, parentReceiptId: string | null = null): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: null, itemId: fabricId, width: 150, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: gradeCode,
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, ownerCustomerId: owner, parentReceiptId,
    },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}
/** Fason adımı + makbuz (DB CHECK: makbuz iş emri + adım taşır). */
async function receipt(no: string, subcontractorId: string, at: Date): Promise<{ id: string; stepId: string }> {
  if (ids.stations.length === 0) {
    const st = await prisma.station.create({ data: { code: `${P}-ST`, name: `TEST kârlılık fason ${process.pid}`, type: StationType.EXTERNAL }, select: { id: true } });
    ids.stations.push(st.id);
  }
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO-${no}`, status: "IN_PROGRESS" }, select: { id: true } });
  ids.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: ids.stations[0]!, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
  ids.steps.push(step.id);
  const rc = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${P}-${no}`, subcontractorId, receivedAt: at, workOrderId: wo.id, stepId: step.id }, select: { id: true } });
  ids.receipts.push(rc.id);
  return { id: rc.id, stepId: step.id };
}
type LinkSpec = { rollId: string; item: string; meters: string; basis?: ServiceMeterBasis; serviceAt?: Date; stepId?: string };
async function invoice(spec: {
  cariId: string; docNo: string; issue: Date; status: InvoiceStatus; currency?: Currency; rate?: string; type?: "SALES" | "PURCHASE";
  lines: Array<{ item: string | null; qty: string; total: string }>; links?: LinkSpec[]; receiptId?: string;
}): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      docNo: `${P}-${spec.docNo}`, type: spec.type ?? "SALES", status: spec.status, cariId: spec.cariId, currency: spec.currency ?? Currency.TRY,
      exchangeRate: spec.rate ?? "1", issueDate: spec.issue, confirmedAt: spec.status === InvoiceStatus.DRAFT ? null : spec.issue,
      subcontractorReceiptId: spec.receiptId ?? null,
      lines: { create: spec.lines.map((l, i) => ({ lineNo: i + 1, itemId: l.item, description: "TEST", qty: l.qty, unitPrice: new Prisma.Decimal(l.total).div(l.qty), lineTotal: l.total, vatAmount: "0" })) },
    },
    select: { id: true },
  });
  ids.invoices.push(inv.id);
  for (const l of spec.links ?? []) {
    await prisma.serviceBillingLink.create({ data: {
      invoiceId: inv.id, rollId: l.rollId, workOrderStepId: l.stepId ?? null, serviceItemId: l.item, billedMeters: l.meters, meterBasis: l.basis ?? ServiceMeterBasis.OUT,
      unitPrice: "1", currency: spec.currency ?? Currency.TRY, serviceAt: l.serviceAt ?? T("2025-01-10"),
    } });
  }
  return inv.id;
}
async function norm(serviceItemId: string, consumableItemId: string, qtyPerM: string): Promise<void> {
  await prisma.serviceConsumableNorm.create({ data: { serviceItemId, consumableItemId, qtyPerM, unit: "KG", clientToken: crypto.randomUUID(), createdAt: BEFORE } });
}

const mine = (rows: ProfitabilityRow[]) => rows.filter((r) => r.customerId !== null && ids.customers.includes(r.customerId));
const byCustomer = (rows: ProfitabilityRow[], cid: string) => summarizeProfitability(mine(rows), "customer").find((s) => s.key === cid);
async function report(from: string, to = from) {
  const r = await computeProfitability({ fromMonth: from, toMonth: to });
  if (!r) throw new Error("kârlılık null döndü (modül kapalı?)");
  return r;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(engel); process.exitCode = 1; return; }
  bolum0();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  try {
    for (const k of AYARLAR.slice(0, 4)) await setSetting(k, true);
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR.slice(4) } } });
    const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
    if (!g) throw new Error("FIRST rollü kalite yok — seed'siz DB");
    gradeCode = g.code;
    fabricId = await item("K", ItemType.FABRIC, ItemUnit.MT);
    const S1 = await item("S1", ItemType.SERVICE, ItemUnit.MT); // kurşun
    const S2 = await item("S2", ItemType.SERVICE, ItemUnit.MT); // tambur
    const S3 = await item("S3", ItemType.SERVICE, ItemUnit.MT); // dış brode
    const S4 = await item("S4", ItemType.SERVICE, ItemUnit.MT); // normsuz
    const S5 = await item("S5", ItemType.SERVICE, ItemUnit.MT); // kursuz sarf
    const S6 = await item("S6", ItemType.SERVICE, ItemUnit.MT); // sıfır norm: "sarf kullanmaz" beyanı
    const C1 = await item("C1", ItemType.CONSUMABLE, ItemUnit.KG);
    const C2 = await item("C2", ItemType.CONSUMABLE, ItemUnit.KG);
    await norm(S1, C1, "0.010000");
    await norm(S2, C1, "0.002000");
    await norm(S3, C1, "0.001000");
    await norm(S5, C2, "0.010000");
    await norm(S6, C2, "0.000000"); // C2 kursuz: sıfır norm fiyat aramazsa eksik doğmaz
    await prisma.itemPrice.create({ data: { itemId: C1, customerId: null, kind: PriceKind.PURCHASE, currency: Currency.TRY, price: "200.0000", createdAt: BEFORE } });
    // §4b: ortamda 2025-03-01'e kadar kuru OLMAYAN döviz seçilir; yoksa §4b KIRMIZI (sessiz geçmez).
    let noFxCurrency: Currency | null = null;
    for (const c of [Currency.RUB, Currency.GBP, Currency.EUR, Currency.USD]) {
      if ((await prisma.exchangeRate.count({ where: { currency: c, rateDate: { lte: T("2025-03-01") } } })) === 0) { noFxCurrency = c; break; }
    }
    await prisma.itemPrice.create({ data: { itemId: C2, customerId: null, kind: PriceKind.PURCHASE, currency: noFxCurrency ?? Currency.GBP, price: "5.0000", createdAt: BEFORE } });
    const A = await customer("A");
    const B = await customer("B");
    const sander = await ensureTestSander();
    const supplierCari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: null, subcontractorId: sander.id }));

    // Rulolar + dış fason makbuzu (2 doğan top: 80 + 20 m → makbuz 100 m).
    const R1 = await roll(A.id, 100);
    const R2 = await roll(A.id, 200);
    const rc = await receipt("RC1", sander.id, T("2025-01-08"));
    const R3 = await roll(B.id, 80, rc.id);
    const R4 = await roll(B.id, 20, rc.id);
    const R5 = await roll(B.id, 50);
    const R6 = await roll(A.id, 40);

    // INV1 A: S1 600 TL (100 + 200 m) + S2 150 TL (100 m). INV2 B: S3 40 USD × 30 = 1200 TL, RECEIVED 80 m.
    await invoice({ cariId: A.cariId, docNo: "F1", issue: T("2025-01-15"), status: InvoiceStatus.CONFIRMED,
      lines: [{ item: S1, qty: "300", total: "600.00" }, { item: S2, qty: "100", total: "150.00" }],
      links: [{ rollId: R1, item: S1, meters: "100" }, { rollId: R2, item: S1, meters: "200" }, { rollId: R1, item: S2, meters: "100" }] });
    await invoice({ cariId: B.cariId, docNo: "F2", issue: T("2025-01-20"), status: InvoiceStatus.CONFIRMED, currency: Currency.USD, rate: "30",
      lines: [{ item: S3, qty: "80", total: "40.00" }], links: [{ rollId: R3, item: S3, meters: "80", basis: ServiceMeterBasis.RECEIVED, stepId: rc.stepId }] });
    await invoice({ cariId: supplierCari.id, docNo: "AF1", issue: T("2025-01-12"), status: InvoiceStatus.CONFIRMED, type: "PURCHASE", receiptId: rc.id,
      lines: [{ item: null, qty: "100", total: "500.00" }] });
    const inv3 = await invoice({ cariId: B.cariId, docNo: "F3", issue: T("2025-01-25"), status: InvoiceStatus.CONFIRMED,
      lines: [{ item: S2, qty: "50", total: "100.00" }], links: [{ rollId: R5, item: S2, meters: "50" }] });
    await invoice({ cariId: A.cariId, docNo: "F4", issue: T("2025-01-28"), status: InvoiceStatus.DRAFT,
      lines: [{ item: S2, qty: "40", total: "80.00" }], links: [{ rollId: R6, item: S2, meters: "40" }] });

    // ── §1 altın ──
    // A: gelir 600+150=750; sarf 100·.01·200 + 200·.01·200 + 100·.002·200 = 200+400+40 = 640; katkı 110,00
    // B: gelir 1200+100=1300; sarf 80·.001·200 + 50·.002·200 = 16+20 = 36; dış fason 500·80/100 = 400; katkı 864,00
    const jan = await report("2025-01");
    const a = byCustomer(jan.rows, A.id);
    const b = byCustomer(jan.rows, B.id);
    const fmt = (s: typeof a) => `${f2(s?.revenueTry)}/${f2(s?.consumableTry)}/${f2(s?.subcontractTry)}/${f2(s?.contributionTry)}`;
    check("§1a ⭐ A: gelir/sarf/dış fason/katkı = 750,00/640,00/0,00/110,00", fmt(a) === "750.00/640.00/0.00/110.00", fmt(a));
    check("§1b ⭐ B: gelir/sarf/dış fason/katkı = 1300,00/36,00/400,00/864,00", fmt(b) === "1300.00/36.00/400.00/864.00", fmt(b));
    const s1 = mine(jan.rows).filter((r) => r.serviceItemId === S1);
    const s1Sum = s1.reduce((x, r) => x.plus(r.revenueTry), new Prisma.Decimal(0));
    check("§1c S1 satırı bağlara metre payıyla bölünür (200 + 400), toplam satır = 600 tam", s1.map((r) => f2(r.revenueTry)).join("+") === "200.00+400.00" && s1Sum.eq(600), s1.map((r) => r.revenueTry.toString()).join("+"));
    const svc = summarizeProfitability(mine(jan.rows), "serviceItem");
    check("§1d işlem kırılımı 3 işlem (S1, S2, S3)", svc.length === 3 && [S1, S2, S3].every((s) => svc.some((x) => x.key === s)), String(svc.length));
    const r3 = mine(jan.rows).find((r) => r.rollId === R3);
    check("§1e dış fason faturadan (tahmini değil), 400,00", f2(r3?.subcontractTry) === "400.00" && r3?.subcontractEstimated === false, f2(r3?.subcontractTry));
    // Doğan kardeş top sonradan kesilir (currentQty 20 → 5): payda donmuş kabul metresi, geçmiş ay değişmez.
    await prisma.roll.update({ where: { id: R4 }, data: { currentQty: "5" } });
    const r3b = mine((await report("2025-01")).rows).find((r) => r.rollId === R3);
    check("§1f ⭐ dış fason paydası donmuş metre: kardeş top kesilince R3 yine 400,00", f2(r3b?.subcontractTry) === "400.00", f2(r3b?.subcontractTry));
    // Kendisi dönen top (doğan top yok), eski NULL receivedQty kalemi: payda topun DONMUŞ metresi (60), canlı currentQty değil.
    const rc3 = await receipt("RC3", sander.id, T("2025-05-03"));
    const R12 = await roll(B.id, 60);
    await prisma.subcontractorReceiptItem.create({ data: { receiptId: rc3.id, newRollId: R12, receivedQty: null } });
    await invoice({ cariId: supplierCari.id, docNo: "AF3", issue: T("2025-05-04"), status: InvoiceStatus.CONFIRMED, type: "PURCHASE", receiptId: rc3.id,
      lines: [{ item: null, qty: "60", total: "300.00" }] });
    await invoice({ cariId: B.cariId, docNo: "F7", issue: T("2025-05-10"), status: InvoiceStatus.CONFIRMED,
      lines: [{ item: S3, qty: "60", total: "360.00" }], links: [{ rollId: R12, item: S3, meters: "60", basis: ServiceMeterBasis.RECEIVED, serviceAt: T("2025-05-03"), stepId: rc3.stepId }] });
    await prisma.roll.update({ where: { id: R12 }, data: { currentQty: "30" } });
    const r12 = mine((await report("2025-05")).rows).find((r) => r.rollId === R12);
    check("§1g ⭐ kendisi dönen top (NULL kalem) kesilince dış fason yine 300 · 60/60 = 300,00", f2(r12?.subcontractTry) === "300.00", f2(r12?.subcontractTry));

    // ── §2 taslak ──
    const draftMine = mine(jan.draftRows);
    check("§2a ⭐ taslak fatura kâra GİRMEZ: rows'ta yok, draftRows'ta 80,00 gelirle, katkısı null",
      !mine(jan.rows).some((r) => r.rollId === R6) && draftMine.length === 1 && f2(draftMine[0]!.revenueTry) === "80.00" && draftMine[0]!.contributionTry === null,
      `draft=${draftMine.length}`);

    // ── §3 iptal ──
    // İptal anı geçmiş aya (Şubat) sabitlenmeli; servis iptali cancelledAt=now yazar → claim + bağ geri alma (aynı boğaz) elle.
    const janBefore = JSON.stringify(mine(jan.rows));
    await prisma.$transaction(async (tx) => {
      const n = await tx.invoice.updateMany({ where: { id: inv3, status: InvoiceStatus.CONFIRMED }, data: { status: InvoiceStatus.CANCELLED, cancelledAt: T("2025-02-10"), cancelReason: "TEST" } });
      if (n.count !== 1) throw new Error("iptal claim düştü");
      await revokeServiceLinksTx(tx, inv3, { userId: null, reason: "TEST iptal" });
    });
    const janAfter = JSON.stringify(mine((await report("2025-01")).rows));
    check("§3a ⭐ geçen ay (Ocak) raporu iptalden sonra BAYT-AYNI", janBefore === janAfter, `${janBefore.length}/${janAfter.length}`);
    const feb = await report("2025-02");
    const fb = mine(feb.rows);
    check("§3b ⭐ iptal İPTAL AYINDA (Şubat) eksi: gelir −100,00, sarf −20,00, katkı −80,00",
      fb.length === 1 && fb[0]!.kind === "CANCELLED" && fb[0]!.month === "2025-02" && f2(fb[0]!.revenueTry) === "-100.00" && f2(fb[0]!.consumableTry) === "-20.00" && f2(fb[0]!.contributionTry) === "-80.00",
      fb.map((r) => `${r.kind} ${f2(r.revenueTry)} ${f2(r.contributionTry)}`).join(";"));
    const both = await report("2025-01", "2025-02");
    check("§3c iki ay toplamı B katkısı = 784,00 (iptal netlenir)", f2(byCustomer(both.rows, B.id)?.contributionTry) === "784.00", f2(byCustomer(both.rows, B.id)?.contributionTry));

    // ── §4 eksik ──
    const R7 = await roll(A.id, 10);
    const R8 = await roll(A.id, 10);
    const R10 = await roll(A.id, 10); // S2 bağı, faturada S2 satırı yok → GELIR_SATIRI
    const R11 = await roll(A.id, 10); // RECEIVED bağ, makbuzu yok → DIS_FASON_MAKBUZU
    const RZ = await roll(A.id, 10); // S6 sıfır norm → ölçülmüş 0 sarf
    await invoice({ cariId: A.cariId, docNo: "F5", issue: T("2025-03-05"), status: InvoiceStatus.CONFIRMED,
      lines: [{ item: S4, qty: "10", total: "30.00" }, { item: S5, qty: "10", total: "40.00" }, { item: S3, qty: "10", total: "20.00" }, { item: S6, qty: "10", total: "25.00" }],
      links: [{ rollId: RZ, item: S6, meters: "10", serviceAt: T("2025-03-01") }, { rollId: R7, item: S4, meters: "10", serviceAt: T("2025-03-01") }, { rollId: R8, item: S5, meters: "10", serviceAt: T("2025-03-01") },
        { rollId: R10, item: S2, meters: "10", serviceAt: T("2025-03-01") },
        { rollId: R11, item: S3, meters: "10", basis: ServiceMeterBasis.RECEIVED, serviceAt: T("2025-03-01"), stepId: rc.stepId }] });
    const mar = mine((await report("2025-03")).rows);
    const r7 = mar.find((r) => r.rollId === R7);
    const r8 = mar.find((r) => r.rollId === R8);
    check("§4a ⭐ norm yok → SARF_NORMU, sarf ve katkı null (0 değil), gelir yine 30,00",
      r7?.missing.includes("SARF_NORMU") === true && r7.consumableTry === null && r7.contributionTry === null && f2(r7.revenueTry) === "30.00", JSON.stringify(r7?.missing));
    check("§4b ⭐ kur yok → FX_RATE_MISSING, sarf null", noFxCurrency !== null && r8?.missing.includes("FX_RATE_MISSING") === true && r8.consumableTry === null,
      noFxCurrency === null ? "ortamda kursuz döviz yok — §4b ölçülemedi (KIRMIZI)" : `${noFxCurrency} ${JSON.stringify(r8?.missing)}`);
    const r10 = mar.find((r) => r.rollId === R10);
    check("§4d ⭐ gelir satırı yok → GELIR_SATIRI, gelir 0 ama katkı null (sayı uydurulmaz)",
      r10?.missing.includes("GELIR_SATIRI") === true && f2(r10.revenueTry) === "0.00" && r10.contributionTry === null, `${JSON.stringify(r10?.missing)} ${f2(r10?.contributionTry)}`);
    const r11 = mar.find((r) => r.rollId === R11);
    check("§4e ⭐ RECEIVED iş, makbuz çözülemez → DIS_FASON_MAKBUZU, dış fason ve katkı null (0 değil)",
      r11?.missing.includes("DIS_FASON_MAKBUZU") === true && r11.subcontractTry === null && r11.contributionTry === null, `${JSON.stringify(r11?.missing)} ${f2(r11?.subcontractTry)}`);
    const rz = mar.find((r) => r.rollId === RZ);
    check("§4f ⭐ sıfır norm ('sarf kullanmaz' beyanı) → eksik YOK, sarf 0,00, katkı = gelir 25,00 (normsuz S4 yine SARF_NORMU)",
      rz?.missing.length === 0 && f2(rz.consumableTry) === "0.00" && f2(rz.contributionTry) === "25.00", `${JSON.stringify(rz?.missing)} ${f2(rz?.consumableTry)} ${f2(rz?.contributionTry)}`);
    check("§4c müşteri özeti katkısı null + eksik satır sayısı 4", (() => { const s = summarizeProfitability(mar, "customer")[0]; return s?.contributionTry === null && s.missingRows === 4; })());

    // ── §5 ayarlar ──
    await invoice({ cariId: supplierCari.id, docNo: "AF2", issue: T("2025-01-05"), status: InvoiceStatus.CONFIRMED, type: "PURCHASE",
      lines: [{ item: C1, qty: "10", total: "2500.00" }] });
    await systemSettingService.setFeatureFlags({ costProfitConsumablePriceSource: "SON_ALIS_FATURASI" }, (await ensureTestAdmin()).id);
    const r1 = mine((await report("2025-01")).rows).find((r) => r.rollId === R1 && r.serviceItemId === S1);
    check("§5a SON_ALIS_FATURASI: R1 sarf = 100 · 0,01 · 250 = 250,00", f2(r1?.consumableTry) === "250.00", f2(r1?.consumableTry));
    await systemSettingService.setFeatureFlags({ costProfitConsumablePriceSource: "ALIS_FIYATI" }, (await ensureTestAdmin()).id);
    const rc2 = await receipt("RC2", sander.id, T("2025-04-02"));
    const R9 = await roll(B.id, 50, rc2.id);
    const fr = await prisma.finishingRate.create({ data: { code: `${P}-FR`, name: "TEST kârlılık tarifesi", subcontractorId: sander.id, basis: "RAW_M", currency: Currency.TRY, pricePerM: "3.0000", createdAt: BEFORE }, select: { id: true } });
    ids.rates.push(fr.id);
    await invoice({ cariId: B.cariId, docNo: "F6", issue: T("2025-04-10"), status: InvoiceStatus.CONFIRMED,
      lines: [{ item: S3, qty: "50", total: "300.00" }], links: [{ rollId: R9, item: S3, meters: "50", basis: ServiceMeterBasis.RECEIVED, serviceAt: T("2025-04-02"), stepId: rc2.stepId }] });
    const r9a = mine((await report("2025-04")).rows).find((r) => r.rollId === R9);
    check("§5b FATURA_ONCE + faturasız fason → tarife tahmini 3 · 50 = 150,00 (tahmini)", f2(r9a?.subcontractTry) === "150.00" && r9a?.subcontractEstimated === true, `${f2(r9a?.subcontractTry)} ${r9a?.subcontractEstimated}`);
    await systemSettingService.setFeatureFlags({ costProfitSubcontractSource: "YALNIZ_FATURA" }, (await ensureTestAdmin()).id);
    const r9b = mine((await report("2025-04")).rows).find((r) => r.rollId === R9);
    check("§5c YALNIZ_FATURA → DIS_FASON_FATURASI eksik, dış fason ve katkı null",
      r9b?.missing.includes("DIS_FASON_FATURASI") === true && r9b.subcontractTry === null && r9b.contributionTry === null, JSON.stringify(r9b?.missing));
    // SY-E1: KG tabanlı tarife metreyle çarpılmaz → tahmin yok, DIS_FASON_TARIFESI eksik (fail-closed).
    await systemSettingService.setFeatureFlags({ costProfitSubcontractSource: "FATURA_ONCE" }, (await ensureTestAdmin()).id);
    await prisma.finishingRate.update({ where: { id: fr.id }, data: { basis: "KG" } });
    const r9c = mine((await report("2025-04")).rows).find((r) => r.rollId === R9);
    check("§5d FATURA_ONCE + tek geçerli tarife KG tabanlı → DIS_FASON_TARIFESI eksik, dış fason null (kg fiyatı × metre DEĞİL)",
      r9c?.missing.includes("DIS_FASON_TARIFESI") === true && r9c.subcontractTry === null && r9c.subcontractEstimated === false, `${JSON.stringify(r9c?.missing)} ${f2(r9c?.subcontractTry)}`);

    // ── §6 ayar yazımı ──
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR.slice(4) } } });
    invalidateFeatureFlagsCache();
    const ff = (await systemSettingService.getFeatureFlags()).data!;
    check("§6a varsayılanlar FATURA_ONCE / ALIS_FIYATI", ff.costProfitSubcontractSource === "FATURA_ONCE" && ff.costProfitConsumablePriceSource === "ALIS_FIYATI",
      `${ff.costProfitSubcontractSource}/${ff.costProfitConsumablePriceSource}`);
    let e400: unknown = null;
    try { await systemSettingService.setFeatureFlags({ costProfitSubcontractSource: "TAHMIN" as never }, (await ensureTestAdmin()).id); } catch (e) { e400 = e; }
    check("§6b tanınmayan değer 400", e400 instanceof AppError && e400.statusCode === 400);

    // ── §7 modül ──
    let eAy: unknown = null;
    try { await computeProfitability({ fromMonth: "2025-13", toMonth: "2025-01" }); } catch (e) { eAy = e; }
    check("§7a geçersiz ay 400 PROFIT_RANGE_INVALID", eAy instanceof AppError && eAy.statusCode === 400 && (eAy.details as { code?: string })?.code === "PROFIT_RANGE_INVALID");
    await setSetting(SETTING_KEYS.MALIYET_ENABLED, false);
    const client = prisma as unknown as Record<string, unknown>;
    const spied = ["invoice", "invoiceLine", "exchangeRate", "itemPrice", "serviceConsumableNorm", "finishingRate"];
    let n = 0;
    const originals = spied.map((m) => [m, client[m]] as const);
    for (const [m, orig] of originals) Object.defineProperty(client, m, { get: () => (n++, orig), configurable: true });
    let off: unknown = "x";
    try { off = await computeProfitability({ fromMonth: "2025-01", toMonth: "2025-01" }); } finally {
      originals.forEach(([m, orig]) => Object.defineProperty(client, m, { value: orig, configurable: true, writable: true }));
    }
    check("§7b ⭐ maliyet KAPALI → null ve fatura/kur/fiyat/norm tablolarına SIFIR sorgu", off === null && n === 0, `sorgu=${n}`);
  } finally {
    await temizle(foto);
  }
}

async function temizle(foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const q = (p: Promise<unknown>) => p.catch((e) => console.error("temizlik:", (e as Error).message));
  await q(prisma.serviceBillingLink.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
  await q(prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
  await q(prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } }));
  await q(prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
  await q(prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } }));
  await q(prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } }));
  await q(prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } }));
  await q(prisma.station.deleteMany({ where: { id: { in: ids.stations } } }));
  await q(prisma.finishingRate.deleteMany({ where: { id: { in: ids.rates } } }));
  await q(prisma.serviceConsumableNorm.deleteMany({ where: { serviceItemId: { in: ids.items } } }));
  await q(prisma.itemPrice.deleteMany({ where: { itemId: { in: ids.items } } }));
  await q(prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.customers } } }));
  await q(prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }));
  await q(prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await q(prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.items, ...ids.customers] } } }));
  for (const key of AYARLAR) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
