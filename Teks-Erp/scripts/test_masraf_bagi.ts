// =============================================================================
// MASRAF BAĞI bekçisi (D4-H3; ister 5.3/4.3, DALGA4 §9.5–9.6, K19)
// =============================================================================
// §1 ayarlar: varsayılan OFF/ALLOW; OFF iken uç 409 EXPENSE_ALLOCATION_DISABLED; REQUIRED ve bilinmeyen değer 400
// §2 yarat + aynı token replay (tek satır) + aynı token başka yük → 409 CLIENT_TOKEN_COLLISION
// §3 ⭐ Σ pay > 100 → 409 EXPENSE_ALLOCATION_OVER (tam 100 geçer); paralel iki bağdan biri düşer
// §4 değiştir = damga + yeni satır (tek tx); damgalı bağ değiştirilemez (409 NOT_ACTIVE)
// §5 kaldır = damga (kaldıranı taşır); ikinci kaldırma 409
// §6 ⭐ iptal masrafa bağ 409 CASH_TXN_CANCELLED; masraf iptali bağı DAMGALAMAZ
// §7 ⭐ kapalı kasa dönemine düşen masrafa bağ 409
// §8 hedef kapıları: iki hedef 400 · pasif makine 409 · hizmet olmayan kalem 400 · kapanmış iş emri ayara göre
// §9 kasa formunda Bağla: masraf + bağ aynı tx; OFF'ta 409 ve masraf YAZILMAZ; gelir satırına bağ 400
// §10 ⭐ listExpenseAllocationsAsOf iki parça: dönem sonu geçerli bağlar + geç bağ olayları; geçmiş dönem bayt-aynı
// Fikstür 2019 aylarında; bağ olay anları (createdAt/revokedAt) fikstürde 2019'a taşınır (servis now() yazar).
// NEGATİF SONDA (2026-10-31): `assertShareWithinLimitTx` çağrısı `createExpenseAllocation`dan silindi → §3a/§3b/§3c/§3d ❌ (7/5);
// geri alındı → yeşil.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, StationType, type Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { cashPeriodCloseService } from "../src/services/cash-period-close.service";
import {
  changeExpenseAllocation,
  createExpenseAllocation,
  listExpenseAllocationsForTxn,
  revokeExpenseAllocation,
} from "../src/services/expense-allocation.service";
import { listExpenseAllocationsAsOf } from "../src/services/helpers/expense-allocation.helper";
import {
  readFinanceExpenseAllocationClosedWorkOrder,
  readFinanceExpenseAllocationField,
  SETTING_KEYS,
  systemSettingService,
} from "../src/services/system-setting.service";
import { factoryDayStartOfKey } from "../src/constants/time";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-MBG-${process.pid}`;
const AYARLAR = [SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_FIELD, SETTING_KEYS.FINANCE_EXPENSE_ALLOCATION_CLOSED_WORK_ORDER];
const ids = { boxes: [] as string[], machines: [] as string[], stations: [] as string[], items: [] as string[], wos: [] as string[] };
/** Fabrika gününün öğlesi. */
const day = (ymd: string): Date => new Date(factoryDayStartOfKey(ymd).getTime() + 12 * 3_600_000);

async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : (Object.assign(new AppError(String(e), 500), {}) as AppError);
  }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "hata yok");

const setSetting = (key: string, v: Prisma.InputJsonValue | null) =>
  v === null ? prisma.systemSetting.deleteMany({ where: { key } }) : prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });

async function temizle(): Promise<void> {
  if (ids.boxes.length) {
    await prisma.expenseAllocation.deleteMany({ where: { cashTransaction: { cashBoxId: { in: ids.boxes } } } });
    await prisma.cashPeriodClose.deleteMany({ where: { cashBoxId: { in: ids.boxes } } });
    await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: ids.boxes } } });
    await prisma.cashBox.deleteMany({ where: { id: { in: ids.boxes } } });
  }
  if (ids.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
  if (ids.machines.length) await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    check("hedef DB", false, engel);
    return;
  }
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin();
  const uid = admin.id;
  let sira = 0;
  const station = await prisma.station.create({ data: { code: `MBG-ST-${process.pid}`, name: `${TAG} istasyon`, type: StationType.INTERNAL }, select: { id: true } });
  ids.stations.push(station.id);
  const makine = async (isActive = true): Promise<string> => {
    const m = await prisma.machine.create({ data: { stationId: station.id, code: `MBG${process.pid % 100000}-${++sira}`, name: `${TAG} makine ${sira}`, isActive }, select: { id: true } });
    ids.machines.push(m.id);
    return m.id;
  };
  const kalem = async (itemType: ItemType): Promise<string> => {
    const it = await prisma.item.create({ data: { code: `MBG${process.pid % 100000}-${++sira}`, name: `${TAG} kalem ${sira}`, itemType, unit: "MT" }, select: { id: true } });
    ids.items.push(it.id);
    return it.id;
  };
  const isEmri = async (status: "IN_PROGRESS" | "COMPLETED"): Promise<string> => {
    const w = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO${++sira}`, status }, select: { id: true } });
    ids.wos.push(w.id);
    return w.id;
  };
  const box = await prisma.cashBox.create({ data: { code: `${TAG}-K`, name: `${TAG} kasa`, currency: "TRY" }, select: { id: true } });
  ids.boxes.push(box.id);
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 100000, txnDate: day("2018-11-01") });
  const masraf = async (amount: number, ymd: string): Promise<string> =>
    (await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount, txnDate: day(ymd), category: "Bakım" })).data!.id;
  const bagla = (txnId: string, hedef: { machineId?: string; workOrderId?: string; serviceItemId?: string }, sharePct: string, clientToken = randomUUID()) =>
    createExpenseAllocation(txnId, { ...hedef, sharePct, clientToken }, uid);

  try {
    console.log("\n── §1 ayarlar ──");
    for (const k of AYARLAR) await setSetting(k, null);
    check("§1a varsayılanlar OFF · ALLOW (bugünkü davranış: bağ yok, kural yok)",
      (await readFinanceExpenseAllocationField()) === "OFF" && (await readFinanceExpenseAllocationClosedWorkOrder()) === "ALLOW");
    const m1 = await makine();
    const e1 = await masraf(1000, "2019-04-10");
    const e1b = await hata(() => bagla(e1, { machineId: m1 }, "50"));
    check("§1b ⭐ OFF iken bağ ucu 409 EXPENSE_ALLOCATION_DISABLED", e1b?.statusCode === 409 && kod(e1b) === "EXPENSE_ALLOCATION_DISABLED", kod(e1b));
    const e1c = await hata(() => systemSettingService.setFeatureFlags({ financeExpenseAllocationField: "REQUIRED" }, uid));
    check("§1c REQUIRED seçilemez → 400 (çıkışsız kapı yasağı)", e1c?.statusCode === 400 && kod(e1c) === "EXPENSE_ALLOCATION_REQUIRED_UNAVAILABLE", kod(e1c));
    const e1d = await hata(() => systemSettingService.setFeatureFlags({ financeExpenseAllocationField: "ACIK" as never }, uid));
    check("§1d bilinmeyen değer → 400", e1d?.statusCode === 400, kod(e1d));
    await systemSettingService.setFeatureFlags({ financeExpenseAllocationField: "OPTIONAL" }, uid);
    check("§1e OPTIONAL yazılır ve okunur", (await readFinanceExpenseAllocationField()) === "OPTIONAL");

    console.log("\n── §2 yarat + replay ──");
    const tok = randomUUID();
    const r2 = await bagla(e1, { machineId: m1 }, "60", tok);
    const r2b = await bagla(e1, { machineId: m1 }, "60", tok);
    const n2 = await prisma.expenseAllocation.count({ where: { cashTransactionId: e1 } });
    check("§2a ⭐ aynı token → aynı bağ, tek satır (replay)", r2.data!.id === r2b.data!.id && n2 === 1, `satır ${n2}`);
    const e2c = await hata(() => bagla(e1, { machineId: m1 }, "30", tok));
    check("§2b aynı token başka pay → 409 CLIENT_TOKEN_COLLISION", e2c?.statusCode === 409 && kod(e2c) === "CLIENT_TOKEN_COLLISION", kod(e2c));

    console.log("\n── §3 Σ pay ──");
    const wo = await isEmri("IN_PROGRESS");
    const e3a = await hata(() => bagla(e1, { workOrderId: wo }, "50"));
    check("§3a ⭐ 60 + 50 > 100 → 409 EXPENSE_ALLOCATION_OVER", e3a?.statusCode === 409 && kod(e3a) === "EXPENSE_ALLOCATION_OVER" && e3a?.details?.remainingPct === "40", `${kod(e3a)} kalan=${String(e3a?.details?.remainingPct)}`);
    const r3b = await bagla(e1, { workOrderId: wo }, "40");
    check("§3b tam 100 geçer", !!r3b.data && (await listExpenseAllocationsForTxn(e1)).data!.remainingPct === "0");
    const e3c = await hata(() => bagla(e1, { machineId: m1 }, "0.01"));
    check("§3c ⭐ 100'ün üstüne 0.01 → 409 EXPENSE_ALLOCATION_OVER", kod(e3c) === "EXPENSE_ALLOCATION_OVER", kod(e3c));
    const e3 = await masraf(500, "2019-04-11");
    const yaris = await Promise.allSettled([bagla(e3, { machineId: m1 }, "60"), bagla(e3, { workOrderId: wo }, "60")]);
    const aktif3 = await prisma.expenseAllocation.count({ where: { cashTransactionId: e3, revokedAt: null } });
    check("§3d ⭐ paralel 60 + 60 → biri 409, tek aktif bağ (satır kilidi Σ'yı serileştirir)",
      yaris.filter((y) => y.status === "rejected").length === 1 && aktif3 === 1, `aktif ${aktif3}`);

    console.log("\n── §4 değiştir ──");
    const svc = await kalem(ItemType.SERVICE);
    const r4 = await changeExpenseAllocation(r2.data!.id, { serviceItemId: svc, sharePct: "30", clientToken: randomUUID(), reason: "yanlış makine" }, uid);
    const eski = await prisma.expenseAllocation.findUniqueOrThrow({ where: { id: r2.data!.id } });
    const l4 = (await listExpenseAllocationsForTxn(e1)).data!;
    check("§4a değişim: eski satır damgalı (silinmedi), yeni satır aktif, Σ = 70",
      !!eski.revokedAt && eski.revokedById === uid && r4.data!.serviceItemId === svc && l4.activePct === "70" && l4.rows.length === 3, `Σ ${l4.activePct} satır ${l4.rows.length}`);
    const e4b = await hata(() => changeExpenseAllocation(r2.data!.id, { machineId: m1, sharePct: "10", clientToken: randomUUID() }, uid));
    check("§4b damgalı bağ değiştirilemez → 409 EXPENSE_ALLOCATION_NOT_ACTIVE", kod(e4b) === "EXPENSE_ALLOCATION_NOT_ACTIVE", kod(e4b));

    console.log("\n── §5 kaldır ──");
    await revokeExpenseAllocation(r4.data!.id, "artık geçerli değil", uid);
    const k5 = await prisma.expenseAllocation.findUniqueOrThrow({ where: { id: r4.data!.id } });
    check("§5a kaldırma = damga (kaldıran + gerekçe)", !!k5.revokedAt && k5.revokedById === uid && k5.revokeReason === "artık geçerli değil");
    const e5b = await hata(() => revokeExpenseAllocation(r4.data!.id, "tekrar", uid));
    check("§5b ikinci kaldırma → 409", kod(e5b) === "EXPENSE_ALLOCATION_NOT_ACTIVE", kod(e5b));

    console.log("\n── §6 iptal masraf ──");
    const aktifOnce = await prisma.expenseAllocation.count({ where: { cashTransactionId: e1, revokedAt: null } });
    await cashTransactionService.cancel(e1, "test iptali");
    const aktifSonra = await prisma.expenseAllocation.count({ where: { cashTransactionId: e1, revokedAt: null } });
    check("§6a masraf iptali bağları damgalamaz", aktifOnce === aktifSonra && aktifOnce > 0, `${aktifOnce} → ${aktifSonra}`);
    const e6b = await hata(() => bagla(e1, { machineId: m1 }, "5"));
    check("§6b ⭐ iptal masrafa bağ → 409 CASH_TXN_CANCELLED", e6b?.statusCode === 409 && kod(e6b) === "CASH_TXN_CANCELLED", kod(e6b));

    console.log("\n── §7 kapalı dönem ──");
    const e7 = await masraf(300, "2019-05-05");
    await cashPeriodCloseService.close({ cashBoxId: box.id, periodEnd: new Date(Date.UTC(2019, 4, 31)) }, uid);
    const e7a = await hata(() => bagla(e7, { machineId: m1 }, "100"));
    check("§7a ⭐ kapalı kasa dönemine düşen masrafa bağ → 409", e7a?.statusCode === 409 && /KAPALI dönem/.test(e7a?.message ?? ""), e7a?.message?.slice(0, 80) ?? "hata yok");
    check("§7b kapalı dönemde bağ yazılmadı", (await prisma.expenseAllocation.count({ where: { cashTransactionId: e7 } })) === 0);

    console.log("\n── §8 hedef kapıları ──");
    const e8 = await masraf(200, "2019-06-05");
    const e8a = await hata(() => bagla(e8, { machineId: m1, workOrderId: wo }, "10"));
    check("§8a iki hedef → 400 EXPENSE_ALLOCATION_TARGET", kod(e8a) === "EXPENSE_ALLOCATION_TARGET", kod(e8a));
    const pasif = await makine(false);
    const e8b = await hata(() => bagla(e8, { machineId: pasif }, "10"));
    check("§8b pasif makine → 409 MACHINE_INACTIVE", kod(e8b) === "MACHINE_INACTIVE", kod(e8b));
    const kumas = await kalem(ItemType.FABRIC);
    const e8c = await hata(() => bagla(e8, { serviceItemId: kumas }, "10"));
    check("§8c hizmet olmayan kalem → 400", kod(e8c) === "EXPENSE_ALLOCATION_NOT_SERVICE_ITEM", kod(e8c));
    const bitti = await isEmri("COMPLETED");
    const r8d = await bagla(e8, { workOrderId: bitti }, "10");
    check("§8d ALLOW (varsayılan): kapanmış iş emrine bağ serbest", !!r8d.data);
    await systemSettingService.setFeatureFlags({ financeExpenseAllocationClosedWorkOrder: "DENY" }, uid);
    const e8e = await hata(() => bagla(e8, { workOrderId: bitti }, "10"));
    check("§8e DENY: kapanmış iş emrine bağ → 409 WORK_ORDER_CLOSED", kod(e8e) === "WORK_ORDER_CLOSED", kod(e8e));
    const e8f = await hata(() => bagla(e8, { machineId: m1 }, "150"));
    check("§8f pay > 100 → 400 EXPENSE_ALLOCATION_SHARE", kod(e8f) === "EXPENSE_ALLOCATION_SHARE", kod(e8f));

    console.log("\n── §9 formda Bağla ──");
    const tok9 = randomUUID();
    const r9 = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount: 750, txnDate: day("2019-06-10"), clientToken: tok9, allocation: { machineId: m1, sharePct: "100" } }, uid);
    const b9 = await prisma.expenseAllocation.findMany({ where: { cashTransactionId: r9.data!.id } });
    check("§9a masraf + bağ aynı istekte (bağ token'ı = masraf token'ı)", b9.length === 1 && b9[0].clientToken === tok9 && b9[0].sharePct.toString() === "100");
    const r9b = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount: 750, txnDate: day("2019-06-10"), clientToken: tok9, allocation: { machineId: m1, sharePct: "100" } }, uid);
    check("§9b form replay → aynı masraf, ikinci bağ yok", r9b.data!.id === r9.data!.id && (await prisma.expenseAllocation.count({ where: { cashTransactionId: r9.data!.id } })) === 1);
    await systemSettingService.setFeatureFlags({ financeExpenseAllocationField: "OFF" }, uid);
    const once9 = await prisma.cashTransaction.count({ where: { cashBoxId: box.id } });
    const e9c = await hata(() => cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount: 10, txnDate: day("2019-06-11"), clientToken: randomUUID(), allocation: { machineId: m1, sharePct: "100" } }, uid));
    check("§9c OFF'ta bağlı form → 409, masraf da YAZILMAZ", kod(e9c) === "EXPENSE_ALLOCATION_DISABLED" && (await prisma.cashTransaction.count({ where: { cashBoxId: box.id } })) === once9, kod(e9c));
    await systemSettingService.setFeatureFlags({ financeExpenseAllocationField: "OPTIONAL" }, uid);
    const e9d = await hata(() => cashTransactionService.create({ kind: "INCOME", cashBoxId: box.id, amount: 10, txnDate: day("2019-06-11"), clientToken: randomUUID(), allocation: { machineId: m1, sharePct: "100" } }, uid));
    check("§9d gelir satırına bağ → 400", kod(e9d) === "EXPENSE_ALLOCATION_NOT_EXPENSE", kod(e9d));
    const r9e = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box.id, amount: 20, txnDate: day("2019-06-12"), clientToken: randomUUID() }, uid);
    check("§9e allocation'sız form (eski istemci) bugünkü gibi yazar, bağ yok", !!r9e.data && (await prisma.expenseAllocation.count({ where: { cashTransactionId: r9e.data!.id } })) === 0);

    console.log("\n── §10 as-of okuyucu ──");
    const jan = { start: factoryDayStartOfKey("2019-01-01"), end: factoryDayStartOfKey("2019-02-01") };
    const feb = { start: factoryDayStartOfKey("2019-02-01"), end: factoryDayStartOfKey("2019-03-01") };
    const m2 = await makine();
    // §7'nin kapanışı birinci kasayı kilitledi; as-of fikstürü ayrı kasada.
    const box2 = await prisma.cashBox.create({ data: { code: `${TAG}-K2`, name: `${TAG} kasa 2`, currency: "TRY" }, select: { id: true } });
    ids.boxes.push(box2.id);
    await cashTransactionService.create({ kind: "OPENING", cashBoxId: box2.id, amount: 100000, txnDate: day("2018-11-01") });
    const eA = (await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: box2.id, amount: 1000, txnDate: day("2019-01-10") })).data!.id;
    // bC Ocak içinde kuruldu ve kaldırıldı → Ocak sonunda geçerli değil.
    const bC = await bagla(eA, { machineId: m2 }, "50");
    await revokeExpenseAllocation(bC.data!.id, "yanlış giriş", uid);
    const bA = await bagla(eA, { machineId: m1 }, "100");
    await prisma.expenseAllocation.update({ where: { id: bC.data!.id }, data: { createdAt: day("2019-01-16"), revokedAt: day("2019-01-20") } });
    await prisma.expenseAllocation.update({ where: { id: bA.data!.id }, data: { createdAt: day("2019-01-15") } });
    const onceJan = JSON.stringify(await listExpenseAllocationsAsOf(prisma, jan));
    // Şubat'ta Ocak masrafının bağı değişir: m1 %100 → m2 %50.
    const bB = await changeExpenseAllocation(bA.data!.id, { machineId: m2, sharePct: "50", clientToken: randomUUID() }, uid);
    await prisma.expenseAllocation.update({ where: { id: bA.data!.id }, data: { revokedAt: day("2019-02-10") } });
    await prisma.expenseAllocation.update({ where: { id: bB.data!.id }, data: { createdAt: day("2019-02-10") } });
    const sJan = await listExpenseAllocationsAsOf(prisma, jan);
    const sFeb = await listExpenseAllocationsAsOf(prisma, feb);
    const janRows = sJan.atPeriodEnd.filter((r) => r.cashTransactionId === eA);
    check("§10a ⭐ parça 1: Ocak sonunda geçerli bağ = m1 %100 → 1000 TL (Ocak içinde kurulup kaldırılan bağ yok)",
      janRows.length === 1 && janRows[0].machineId === m1 && janRows[0].allocatedTry.toString() === "1000", janRows.map((r) => `${r.machineId === m1 ? "m1" : "m2"}:${r.allocatedTry.toString()}`).join(","));
    check("§10b ⭐ geçmiş dönem (Ocak) sonradan bağ değişiminden sonra bayt-aynı", JSON.stringify(sJan) === onceJan);
    const lateA = sFeb.lateEvents.filter((r) => r.cashTransactionId === eA);
    const net = lateA.reduce((s, r) => s + Number(r.allocatedTry), 0);
    check("§10c ⭐ parça 2: Şubat geç bağ olayları = m1 −1000 (REVOKED) + m2 +500 (LINKED)",
      lateA.length === 2 && lateA.some((r) => r.event === "REVOKED" && r.machineId === m1 && r.allocatedTry.toString() === "-1000") &&
        lateA.some((r) => r.event === "LINKED" && r.machineId === m2 && r.allocatedTry.toString() === "500") && net === -500,
      lateA.map((r) => `${r.event}:${r.allocatedTry.toString()}`).join(","));
    check("§10d Şubat parça 1'de Ocak masrafı yok (masraf ayı Ocak)", sFeb.atPeriodEnd.every((r) => r.cashTransactionId !== eA));
    const e10 = await hata(() => listExpenseAllocationsAsOf(prisma, { start: feb.end, end: feb.start }));
    check("§10e ters aralık → 400", e10?.statusCode === 400);
  } finally {
    await temizle().catch((e) => check("temizlik", false, String(e)));
    for (const k of AYARLAR) {
      const f = foto.find((x) => x.key === k);
      await setSetting(k, f ? (f.value as Prisma.InputJsonValue) : null);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
