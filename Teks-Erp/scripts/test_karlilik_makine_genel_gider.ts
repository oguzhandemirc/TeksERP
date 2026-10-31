// =============================================================================
// BEKÇİ — KÂRLILIK: MAKİNE-SAAT + GENEL GİDER / İŞÇİLİK HAVUZU (D4-G2b; DALGA4 §8.3, §8.9, §9, §12.1, §13 D4-G2b)
// =============================================================================
//   §0 statik — kârlılık dosyaları `work_sessions`e YAZMAZ, `work-session.helper`ı import etmez; tembel IDLE
//      kapanışı (`endedAt: new Date()` + IDLE) yazım yolunda AYNEN durur (düzeltme yalnız okumada, §8.9)
//   §1 OTURUM — IDLE oturum `lastActivityAt`ta kesilir (2 sa + 1 sa = 3 sa; endedAt'e göre 8 sa olurdu); gün süresi
//      o günün metresine bölünür (CUT > OUT önceliği, iki faz tek iş); makine maliyeti katkıya girer; metresiz gün
//      "boşta makine"; WorkSession satırları rapordan önce/sonra BAYT-AYNI
//   §2 NORM ve VARDIYA kipleri — metre ÷ norm; vardiya net saati (mola düşülür); norm yok → MAKINE_NORMU
//   §3 genel gider — varsayılan YOK + {} → her satırda net = katkı (bayt-aynı), havuz ay özetinde dağıtılmamış;
//      METRE + sınıflar → genel gider metre payıyla, işçilik makine saatiyle, HARIC dışarıda; Σ pay = havuz (tam)
//   §4 ayar yazımı — varsayılanlar OTURUM / YOK / {}; tanınmayan değer 400 (üç ayar); harita trim'lenir
//   §5 ayar paketi — makineSuresi + genelGiderAnahtari satırı var, kategoriSiniflari YOK (S14 cevabı bekleniyor)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; fikstür 2023-03'tedir (canlı veriyle karışmaz).
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Currency, InvoiceStatus, ItemType, ItemUnit, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, RollEntrySource, RollStatus, ServiceMeterBasis, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { computeProfitability, type ProfitabilityRow } from "../src/services/helpers/profitability.helper";
import { factoryDayStartOfKey } from "../src/constants/time";
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
const P = `TEST-KMG-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED,
  SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE, SETTING_KEYS.COST_PROFIT_CONSUMABLE_PRICE_SOURCE,
  SETTING_KEYS.COST_PROFIT_MACHINE_TIME, SETTING_KEYS.COST_PROFIT_OVERHEAD_KEY, SETTING_KEYS.COST_PROFIT_CATEGORY_CLASSES,
];
/** Fabrika günü `ymd` başı + `h` saat (dilim tek kaynaktan). */
const at = (ymd: string, h: number) => new Date(factoryDayStartOfKey(ymd).getTime() + h * 3_600_000);
const BEFORE = at("2022-12-01", 9);
const f2 = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? "null" : d.toFixed(2));
const ids = {
  items: [] as string[], customers: [] as string[], rolls: [] as string[], invoices: [] as string[], wos: [] as string[], steps: [] as string[],
  stations: [] as string[], machines: [] as string[], devices: [] as string[], users: [] as string[], sessions: [] as string[], boxes: [] as string[],
  shiftDefs: [] as string[],
};

// ── §0 statik ────────────────────────────────────────────────────────────────
function bolum0(): void {
  const profit = readdirSync(HELPERS).filter((f) => /^profitability.*\.helper\.ts$/.test(f));
  check("§0 zemin: kârlılık dosyaları ≥ 5 (çekirdek + maliyet + finans + makine + havuz)", profit.length >= 5, profit.join(", "));
  const ihlal: string[] = [];
  for (const f of profit) {
    const src = readFileSync(path.join(HELPERS, f), "utf8");
    if (/workSession\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src)) ihlal.push(`${f}: workSession yazımı`);
    if (/from\s+["'][^"']*work-session\.helper/.test(src)) ihlal.push(`${f}: work-session.helper import`);
  }
  check("§0a ⭐ kârlılık work_sessions'a YAZMAZ ve yazım helper'ını import etmez", ihlal.length === 0, ihlal.join(", ") || "temiz");
  const ws = readFileSync(path.join(HELPERS, "work-session.helper.ts"), "utf8");
  const idleWrites = ws.match(/endedAt: new Date\(\), endReason: "IDLE"/g)?.length ?? 0;
  check("§0b yazım yolu değişmedi: tembel IDLE kapanışı iki yerde `endedAt: new Date()` yazar (§8.9)", idleWrites === 2, `bulunan=${idleWrites}`);
}

async function item(code: string, itemType: ItemType, unit: ItemUnit): Promise<string> {
  const r = await prisma.item.create({ data: { code: `${P}-${code}`, name: `TEST kmg ${code} ${process.pid}`, itemType, unit }, select: { id: true } });
  ids.items.push(r.id);
  return r.id;
}
const mine = (rows: ProfitabilityRow[]) => rows.filter((r) => r.customerId !== null && ids.customers.includes(r.customerId));
async function report() {
  const r = await computeProfitability({ fromMonth: "2023-03", toMonth: "2023-03" });
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
    invalidateFeatureFlagsCache();
    const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
    if (!g) throw new Error("FIRST rollü kalite yok — seed'siz DB");

    // ── Fikstür: makine M (100 TL/sa, norm 50 m/sa), hizmet S (norm 0,01 kg/m × 10 TL), müşteri A ──
    const fabric = await item("K", ItemType.FABRIC, ItemUnit.MT);
    const S = await item("S", ItemType.SERVICE, ItemUnit.MT);
    const C = await item("C", ItemType.CONSUMABLE, ItemUnit.KG);
    await prisma.serviceConsumableNorm.create({ data: { serviceItemId: S, consumableItemId: C, qtyPerM: "0.010000", unit: "KG", clientToken: randomUUID(), createdAt: BEFORE } });
    await prisma.itemPrice.create({ data: { itemId: C, customerId: null, kind: PriceKind.PURCHASE, currency: Currency.TRY, price: "10.0000", createdAt: BEFORE } });
    const cust = await prisma.customer.create({ data: { code: `${P}-A`, name: `TEST kmg müşteri ${process.pid}` }, select: { id: true } });
    ids.customers.push(cust.id);
    const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust.id, subcontractorId: null }));
    const st = await prisma.station.create({ data: { code: `${P}-ST`, name: `TEST kmg ${process.pid}`, type: StationType.INTERNAL }, select: { id: true } });
    ids.stations.push(st.id);
    const M = (await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`, name: "TEST kmg makine" }, select: { id: true } })).id;
    ids.machines.push(M);
    await prisma.machineCostRate.create({ data: { machineId: M, hourRateTry: "100.0000", normMPerHour: "50.00", clientToken: randomUUID(), createdAt: BEFORE } });
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
    ids.wos.push(wo.id);
    const step = (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: st.id, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } })).id;
    ids.steps.push(step);
    const roll = async (qty: number) => {
      const r = await prisma.roll.create({ data: { barcode: null, itemId: fabric, width: 150, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: g.code, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, ownerCustomerId: cust.id }, select: { id: true } });
      ids.rolls.push(r.id);
      return r.id;
    };
    const RA = await roll(60);
    const RB = await roll(40);
    const reading = (rollId: string, phase: MeterPhase, meters: string, h: number) => prisma.rollMeterReading.create({
      data: { rollId, workOrderStepId: step, phase, meters, source: MachineDataSource.MACHINE, machineId: M,
        ...(phase === MeterPhase.CUT ? {} : { basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE }), clientToken: randomUUID(), createdAt: at("2023-03-10", h) },
      select: { id: true },
    });
    const rdA = await reading(RA, MeterPhase.CUT, "60", 9);
    await reading(RA, MeterPhase.OUT, "70", 9.5); // aynı top × adım: CUT önce gelir, OUT sayılmaz
    const rdB = await reading(RB, MeterPhase.CUT, "40", 10);

    // Oturumlar: 10 Mart LOGOUT 08–10 (2 sa) + IDLE 11'de başlar, son hareket 12, tembel kapanış 17 → etkin 1 sa.
    // 11 Mart: LOGOUT 1 sa, okuma kaydı yok → boşta makine.
    const user = await prisma.user.create({ data: { username: `test-kmg-${process.pid}`, passwordHash: "x", fullName: "TEST kmg" }, select: { id: true } });
    ids.users.push(user.id);
    const device = await prisma.device.create({ data: { deviceId: `test-kmg-${process.pid}`, name: "TEST kmg tablet", status: "APPROVED", kind: "TABLET" }, select: { id: true } });
    ids.devices.push(device.id);
    const session = async (startedAt: Date, endedAt: Date, endReason: "LOGOUT" | "IDLE", lastActivityAt: Date) => {
      const s = await prisma.workSession.create({ data: { userId: user.id, deviceId: device.id, machineId: M, stationId: st.id, startedAt, endedAt, endReason, lastActivityAt }, select: { id: true } });
      ids.sessions.push(s.id);
    };
    await session(at("2023-03-10", 8), at("2023-03-10", 10), "LOGOUT", at("2023-03-10", 10));
    await session(at("2023-03-10", 11), at("2023-03-10", 17), "IDLE", at("2023-03-10", 12));
    await session(at("2023-03-11", 8), at("2023-03-11", 9), "LOGOUT", at("2023-03-11", 9));

    // Fatura 20 Mart: S satırı 800 TL (A 500 + B 300 metre payıyla değil, satır tek; bağlar 60/40 → 480/320).
    const inv = await prisma.invoice.create({
      data: {
        docNo: `${P}-F1`, type: "SALES", status: InvoiceStatus.CONFIRMED, cariId: cari.id, currency: Currency.TRY, exchangeRate: "1",
        issueDate: at("2023-03-20", 9), confirmedAt: at("2023-03-20", 9),
        lines: { create: [{ lineNo: 1, itemId: S, description: "TEST", qty: "100", unitPrice: "8", lineTotal: "800.00", vatAmount: "0" }] },
      },
      select: { id: true },
    });
    ids.invoices.push(inv.id);
    for (const [rollId, readingId, m] of [[RA, rdA.id, "60"], [RB, rdB.id, "40"]] as const) {
      await prisma.serviceBillingLink.create({ data: {
        invoiceId: inv.id, rollId, workOrderStepId: step, serviceItemId: S, readingId, billedMeters: m, meterBasis: ServiceMeterBasis.CUT,
        unitPrice: "8", currency: Currency.TRY, serviceAt: at("2023-03-10", 9),
      } });
    }
    // Kasa masrafları (Mart): Kira 1000, Maaş 300, Vergi 50 — ad pid'li (başka veriyle karışmaz).
    const box = await prisma.cashBox.create({ data: { code: `${P}-K`, name: `${P} kasa`, currency: "TRY" }, select: { id: true } });
    ids.boxes.push(box.id);
    await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 100000, txnDate: at("2023-02-01", 12) });
    const KIRA = `${P} Kira`, MAAS = `${P} Maaş`, VERGI = `${P} Vergi`;
    for (const [amount, category] of [[1000, KIRA], [300, MAAS], [50, VERGI]] as const) {
      await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount, txnDate: at("2023-03-15", 12), category });
    }

    // ── §1 OTURUM ──
    const snap = async () => JSON.stringify(await prisma.workSession.findMany({ where: { id: { in: ids.sessions } }, orderBy: { startedAt: "asc" } }));
    const before = await snap();
    const r1 = await report();
    const after = await snap();
    check("§1a ⭐ WorkSession satırları kârlılıktan önce/sonra BAYT-AYNI (okuma yazmaz)", before === after, `${before.length} bayt`);
    const rows = mine(r1.rows);
    const ra = rows.find((r) => r.rollId === RA);
    const rb = rows.find((r) => r.rollId === RB);
    check("§1b ⭐ IDLE oturum lastActivityAt'te kesilir: gün 3 sa → A 1,80 sa / B 1,20 sa (endedAt'le 8 sa olurdu)",
      f2(ra?.machineHours) === "1.80" && f2(rb?.machineHours) === "1.20", `${f2(ra?.machineHours)}/${f2(rb?.machineHours)}`);
    check("§1c makine maliyeti A 180,00 / B 120,00 (as-of 100 TL/sa)", f2(ra?.machineTry) === "180.00" && f2(rb?.machineTry) === "120.00", `${f2(ra?.machineTry)}/${f2(rb?.machineTry)}`);
    check("§1d katkı = gelir − sarf − makine: A 480 − 6 − 180 = 294,00 · B 320 − 4 − 120 = 196,00",
      f2(ra?.contributionTry) === "294.00" && f2(rb?.contributionTry) === "196.00", `${f2(ra?.contributionTry)}/${f2(rb?.contributionTry)}`);
    const idle = r1.idleMachineDays.filter((d) => d.machineId === M);
    check("§1e metresiz gün (11 Mart, 1 sa) boşta makine satırı 100,00; ölçümlü gün boşta DEĞİL",
      idle.length === 1 && idle[0]!.day === "2023-03-11" && f2(idle[0]!.costTry) === "100.00", JSON.stringify(idle.map((d) => [d.day, f2(d.costTry)])));

    // ── §2 NORM / VARDIYA ──
    await setSetting(SETTING_KEYS.COST_PROFIT_MACHINE_TIME, "NORM");
    const nrm = mine((await report()).rows).find((r) => r.rollId === RA);
    check("§2a NORM: A 60 m ÷ 50 m/sa = 1,20 sa → 120,00", f2(nrm?.machineHours) === "1.20" && f2(nrm?.machineTry) === "120.00", `${f2(nrm?.machineHours)} ${f2(nrm?.machineTry)}`);
    await setSetting(SETTING_KEYS.COST_PROFIT_MACHINE_TIME, "VARDIYA");
    const noShift = mine((await report()).rows).find((r) => r.rollId === RA);
    check("§2b VARDIYA, takvim yok → VARDIYA_TAKVIMI eksik, makine ve katkı null", noShift?.missing.includes("VARDIYA_TAKVIMI") === true && noShift.machineTry === null && noShift.contributionTry === null, JSON.stringify(noShift?.missing));
    const def = await prisma.shiftDefinition.create({ data: { code: `K${String(process.pid).slice(-6)}`, name: `${P} vardiya`, startMinute: 480, durationMinutes: 480, plannedBreakMinutes: 60 }, select: { id: true } });
    ids.shiftDefs.push(def.id);
    await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: at("2023-03-10", 0), startsAt: at("2023-03-10", 8), endsAt: at("2023-03-10", 16) } });
    const vr = mine((await report()).rows).find((r) => r.rollId === RA);
    check("§2c VARDIYA: 8 sa − 1 sa mola = 7 sa → A 4,20 sa / 420,00", f2(vr?.machineHours) === "4.20" && f2(vr?.machineTry) === "420.00", `${f2(vr?.machineHours)} ${f2(vr?.machineTry)}`);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_PROFIT_MACHINE_TIME } });

    // ── §3 genel gider ──
    const month = r1.months.find((m) => m.month === "2023-03");
    check("§3a ⭐ varsayılan YOK + {}: her satırda net = katkı (bayt-aynı), pay 0",
      rows.length === 2 && rows.every((r) => r.netTry?.toString() === r.contributionTry?.toString() && r.overheadTry.isZero() && r.laborTry.isZero()),
      rows.map((r) => `${r.netTry?.toString()}=${r.contributionTry?.toString()}`).join(" "));
    check("§3b varsayılanda havuz ay özetinde dağıtılmamış: üç kategori genel gider, dağıtılan 0",
      month !== undefined && month.overheadDistributedTry.isZero() && month.overheadPoolTry.gte(1350) && [KIRA, MAAS, VERGI].every((c) => month.categories.some((x) => x.label === c && x.categoryClass === "GENEL_GIDER")),
      `havuz ${f2(month?.overheadPoolTry)}`);
    await setSetting(SETTING_KEYS.COST_PROFIT_OVERHEAD_KEY, "METRE");
    await setSetting(SETTING_KEYS.COST_PROFIT_CATEGORY_CLASSES, { [MAAS]: "ISCILIK", [VERGI]: "HARIC" });
    const r3 = await report();
    const m3 = r3.months.find((m) => m.month === "2023-03")!;
    const marchRows = r3.rows.filter((r) => r.month === "2023-03" && r.kind === "INVOICED");
    const a3 = mine(r3.rows).find((r) => r.rollId === RA)!;
    const b3 = mine(r3.rows).find((r) => r.rollId === RB)!;
    check("§3c sınıflar: Maaş işçilik 300, Vergi hariç 50", f2(m3.laborPoolTry) === "300.00" && f2(m3.excludedTry) === "50.00", `${f2(m3.laborPoolTry)} ${f2(m3.excludedTry)}`);
    const sumOver = marchRows.reduce((s, r) => s.plus(r.overheadTry), new Prisma.Decimal(0));
    check("§3d ⭐ METRE: Σ satır payı = havuz (kuruşu kuruşuna), dağıtılan = havuz", sumOver.eq(m3.overheadPoolTry) && m3.overheadDistributedTry.eq(m3.overheadPoolTry), `${sumOver} / ${m3.overheadPoolTry}`);
    const totalM = marchRows.reduce((s, r) => s.plus(r.meters), new Prisma.Decimal(0));
    check("§3e A payı = havuz × 60 / ayın metresi", a3.overheadTry.toFixed(2) === m3.overheadPoolTry.mul(60).div(totalM).toFixed(2), `${f2(a3.overheadTry)}`);
    check("§3f işçilik makine saatiyle: A 180,00 / B 120,00 (1,8 : 1,2 sa)", f2(a3.laborTry) === "180.00" && f2(b3.laborTry) === "120.00", `${f2(a3.laborTry)}/${f2(b3.laborTry)}`);
    check("§3g net = katkı − işçilik − genel gider", a3.netTry!.eq(a3.contributionTry!.minus(a3.laborTry).minus(a3.overheadTry)), `${f2(a3.netTry)}`);

    // ── §4 ayar yazımı ──
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR.slice(6) } } });
    invalidateFeatureFlagsCache();
    const ff = (await systemSettingService.getFeatureFlags()).data!;
    check("§4a varsayılanlar OTURUM / YOK / {}", ff.costProfitMachineTime === "OTURUM" && ff.costProfitOverheadKey === "YOK" && JSON.stringify(ff.costProfitCategoryClasses) === "{}",
      `${ff.costProfitMachineTime}/${ff.costProfitOverheadKey}/${JSON.stringify(ff.costProfitCategoryClasses)}`);
    const admin = (await ensureTestAdmin()).id;
    const is400 = async (input: Record<string, unknown>) => {
      try { await systemSettingService.setFeatureFlags(input as never, admin); return false; } catch (e) { return e instanceof AppError && e.statusCode === 400; }
    };
    check("§4b ⭐ tanınmayan değer 400 (makine süresi / anahtar / sınıf / boş kategori)",
      (await is400({ costProfitMachineTime: "SAAT" })) && (await is400({ costProfitOverheadKey: "ALAN" })) &&
      (await is400({ costProfitCategoryClasses: { Kira: "DIGER" } })) && (await is400({ costProfitCategoryClasses: { "  ": "HARIC" } })) && (await is400({ costProfitCategoryClasses: ["x"] })));
    await systemSettingService.setFeatureFlags({ costProfitCategoryClasses: { " Maaş ": "ISCILIK" }, costProfitOverheadKey: "GELIR" } as never, admin);
    invalidateFeatureFlagsCache();
    const ff2 = (await systemSettingService.getFeatureFlags()).data!;
    check("§4c geçerli değer yazılır, kategori adı trim'lenir", ff2.costProfitOverheadKey === "GELIR" && JSON.stringify(ff2.costProfitCategoryClasses) === JSON.stringify({ Maaş: "ISCILIK" }), JSON.stringify(ff2.costProfitCategoryClasses));

    // ── §5 ayar paketi ──
    const paket = readFileSync(path.join(ROOT, "scripts/hizmet-ayar-paketi.ts"), "utf8");
    check("§5 paket: makineSuresi + genelGiderAnahtari var, kategoriSiniflari satırı YOK (S14)",
      /anahtar: "maliyet\.karlilik\.makineSuresi"/.test(paket) && /anahtar: "maliyet\.karlilik\.genelGiderAnahtari"/.test(paket) && !/anahtar: "maliyet\.karlilik\.kategoriSiniflari"/.test(paket));
  } finally {
    await temizle(foto);
  }
}

async function temizle(foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const q = (p: Promise<unknown>) => p.catch((e) => console.error("temizlik:", (e as Error).message));
  await q(prisma.serviceBillingLink.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
  await q(prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
  await q(prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } }));
  await q(prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids.rolls } } }));
  await q(prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
  await q(prisma.workSession.deleteMany({ where: { id: { in: ids.sessions } } }));
  await q(prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: { in: ids.shiftDefs } } }));
  await q(prisma.shiftDefinition.deleteMany({ where: { id: { in: ids.shiftDefs } } }));
  await q(prisma.machineCostRate.deleteMany({ where: { machineId: { in: ids.machines } } }));
  await q(prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } }));
  await q(prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } }));
  await q(prisma.machine.deleteMany({ where: { id: { in: ids.machines } } }));
  await q(prisma.station.deleteMany({ where: { id: { in: ids.stations } } }));
  await q(prisma.device.deleteMany({ where: { id: { in: ids.devices } } }));
  await q(prisma.user.deleteMany({ where: { id: { in: ids.users } } }));
  await q(prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: ids.boxes } } }));
  await q(prisma.cashBox.deleteMany({ where: { id: { in: ids.boxes } } }));
  await q(prisma.serviceConsumableNorm.deleteMany({ where: { serviceItemId: { in: ids.items } } }));
  await q(prisma.itemPrice.deleteMany({ where: { itemId: { in: ids.items } } }));
  await q(prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.customers } } }));
  await q(prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }));
  await q(prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await q(prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.items, ...ids.customers, ...ids.boxes] } } }));
  for (const key of AYARLAR) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
  invalidateFeatureFlagsCache();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
