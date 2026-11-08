// =============================================================================
// FASON TERMİNİ BEKÇİSİ (F6) — `SubcontractorDispatch.expectedReturnAt` çözücüsü + sevk yazımı
// =============================================================================
// Ölçülenler:
//   §1 ⭐ hiçbir kaynak yok → NULL (bugünkü davranış; eski tablet alanı yollamaz)
//   §2 zincir: firma > süreç türü (adımın kategorisi) > genel ayar; gün FABRİKA GÜNÜYLE eklenir, o günün son anı
//   §3 gövde: açık `null` varsayılanı ezer (termin yok); gün-yalnız tarih o fabrika gününün sonu; geçmiş gün 400
//      EXPECTED_RETURN_IN_PAST; bozuk değer 400 EXPECTED_RETURN_INVALID
//   §4 ayar okuyucusu: kayıt yok / 0 / aralık dışı / tam sayı değil → 0 ("ayar yok")
//   §5 DB: gerçek `dispatch()` termini yazar + `expectedReturnSource` döner; toplu sevk gövdeyi iletir
//   §6 firma/kategori `expectedReturnDays` zod sınırı 1..365 (null = yok)
//   §7 kokpit durum yüklemi: OVERDUE / DUE_SOON / NO_DUE_DATE fabrika günü sınırları
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_fason_termin.ts
// NEGATİF SONDA — 2026-11-08: (a) çözücüde zincir sırası `cat ?? sub` çevrilince §2c ❌; (b) `body === null` dalı
//   silinince bekçi §3a'da çöker (kırmızı, çıkış 1); (c) `factoryDayEndOfKey(addDaysToDayKey(...))` yerine
//   `dispatchedAt + n×24h` → §2a–§2d, §5b ❌; (d) okuyucuda `parsed < 1` sınırı kaldırılınca §4c ❌. Hepsi geri alındı.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { SETTING_KEYS, readFasonExpectedReturnDays } from "../src/services/system-setting.service";
import {
  addDaysToDayKey,
  expectedReturnStateWhere,
  overdueDaysOf,
  parseExpectedReturnBody,
  resolveExpectedReturn,
} from "../src/services/helpers/fason-expected-return.helper";
import { factoryDayEndOfKey, factoryYmd } from "../src/constants/time";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { expectedReturnDaysSchema } from "../src/controllers/subcontractor-management.controller";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { testActorId } from "./fixture-test-user";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String(e.details?.code ?? "")}` : String(e);
  }
};
const KEY = SETTING_KEYS.FASON_EXPECTED_RETURN_DAYS;
const setSetting = async (v: Prisma.InputJsonValue | null): Promise<void> => {
  if (v === null) await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  else await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: v }, update: { value: v } });
};

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exitCode = 1;
    return;
  }
  assertGelistirmeVeritabani("test_fason_termin");
  const dye = await ensureTestDyeHouse();
  const subSnap = await prisma.subcontractor.findUniqueOrThrow({ where: { id: dye.id }, select: { expectedReturnDays: true } });
  const catSnap = await prisma.subcontractorCategory.findUniqueOrThrow({ where: { id: dye.categoryId }, select: { expectedReturnDays: true } });
  const settingSnap = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  const woIds: string[] = [];
  const stepIds: string[] = [];
  const TAG = `TST-FTR-${Date.now().toString(36).toUpperCase()}`;
  try {
    const now = new Date();
    const today = factoryYmd(now);
    const endIn = (n: number) => factoryDayEndOfKey(addDaysToDayKey(today, n)).getTime();
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { expectedReturnDays: null } });
    await prisma.subcontractorCategory.update({ where: { id: dye.categoryId }, data: { expectedReturnDays: null } });
    await setSetting(null);
    const r = (body: string | null | undefined, categoryId: string | null = dye.categoryId) =>
      resolveExpectedReturn({ body, subcontractorId: dye.id, categoryId, dispatchedAt: now });

    // ── §1 bugünkü davranış ───────────────────────────────────────────────────
    const none = await r(undefined);
    check("§1a ⭐ kaynak yok → NULL, kaynak NONE", none.at === null && none.source === "NONE");
    await setSetting(0);
    check("§1b ayar 0 (varsayılan) → yine NULL", (await r(undefined)).at === null);

    // ── §2 zincir ─────────────────────────────────────────────────────────────
    await setSetting(5);
    const s = await r(undefined);
    check("§2a genel ayar 5 → SETTING, +5 fabrika günü sonu", s.source === "SETTING" && s.at?.getTime() === endIn(5));
    await prisma.subcontractorCategory.update({ where: { id: dye.categoryId }, data: { expectedReturnDays: 3 } });
    const c = await r(undefined);
    check("§2b süreç türü 3 ayarı ezer → CATEGORY", c.source === "CATEGORY" && c.at?.getTime() === endIn(3));
    check("§2b2 adımın kategorisi yoksa (dokuma sevki) kategori okunmaz", (await r(undefined, null)).source === "SETTING");
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { expectedReturnDays: 7 } });
    const f = await r(undefined);
    check("§2c firma 7 her şeyi ezer → SUBCONTRACTOR", f.source === "SUBCONTRACTOR" && f.at?.getTime() === endIn(7));
    // İstanbul 23:30 sevki: fabrika günü + 1 = ertesi günün sonu (çıplak +24 saat değil).
    const late = new Date(`${today}T20:30:00Z`);
    const l = await resolveExpectedReturn({ body: undefined, subcontractorId: dye.id, categoryId: null, dispatchedAt: late });
    check("§2d gün fabrika gününe eklenir, terminin günü SON an", l.at?.getTime() === factoryDayEndOfKey(addDaysToDayKey(factoryYmd(late), 7)).getTime(), l.at?.toISOString());

    // ── §3 gövde ──────────────────────────────────────────────────────────────
    const nul = await r(null);
    check("§3a ⭐ açık null varsayılanı ezer → termin YOK, kaynak BODY", nul.at === null && nul.source === "BODY");
    const day = addDaysToDayKey(today, 4);
    const b = await r(day);
    check("§3b gün-yalnız tarih → o fabrika gününün sonu, BODY", b.source === "BODY" && b.at?.getTime() === factoryDayEndOfKey(day).getTime());
    check("§3c bugün geçerli (geçmiş değil)", (await codeOf(() => r(today))) === "OK");
    check("§3d geçmiş gün → 400 EXPECTED_RETURN_IN_PAST", (await codeOf(() => r(addDaysToDayKey(today, -1)))) === "400:EXPECTED_RETURN_IN_PAST");
    check("§3e bozuk değer → 400 EXPECTED_RETURN_INVALID", (await codeOf(async () => parseExpectedReturnBody("yarın", now))) === "400:EXPECTED_RETURN_INVALID");

    // ── §4 ayar okuyucusu ─────────────────────────────────────────────────────
    await setSetting(400);
    check("§4a aralık dışı (400) → 0", (await readFasonExpectedReturnDays()) === 0);
    await setSetting(2.5);
    check("§4b tam sayı değil → 0", (await readFasonExpectedReturnDays()) === 0);
    await setSetting(-3);
    check("§4c negatif → 0", (await readFasonExpectedReturnDays()) === 0);
    await setSetting(12);
    check("§4d geçerli 12 → 12", (await readFasonExpectedReturnDays()) === 12);

    // ── §5 gerçek sevk ────────────────────────────────────────────────────────
    const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
    const admin = { id: await testActorId() };
    const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
    if (!item || !boya) throw new Error("Seed fixture eksik — önce 'npm run seed'");
    const sub = new SubcontractorService();
    const cards = new TravelerCardService();
    const mkWo = async (n: string) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${TAG}-${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id,
          steps: { create: [{ stationId: boya.id, stepSequence: 1, status: "PENDING", requiredCategoryId: dye.categoryId }] },
        },
        include: { steps: true },
      });
      woIds.push(wo.id);
      stepIds.push(wo.steps[0]!.id);
      await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, admin.id));
      const roll = await prisma.roll.create({
        data: { barcode: `${TAG}-${n}-R`, itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), width: 250, createdById: admin.id },
        select: { id: true },
      });
      return { woId: wo.id, stepId: wo.steps[0]!.id, rollId: roll.id };
    };
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { expectedReturnDays: null } });
    await prisma.subcontractorCategory.update({ where: { id: dye.categoryId }, data: { expectedReturnDays: null } });
    await setSetting(null);
    const w1 = await mkWo("1");
    const d1 = await sub.dispatch({ workOrderId: w1.woId, stepId: w1.stepId, subcontractorId: dye.id, rollIds: [w1.rollId] }, admin.id);
    const d1Data = d1.data as { expectedReturnSource?: string };
    const row1 = await prisma.subcontractorDispatch.findFirstOrThrow({ where: { workOrderId: w1.woId }, select: { expectedReturnAt: true } });
    check("§5a ⭐ alansız sevk (eski tablet), kaynak yok → kolon NULL", row1.expectedReturnAt === null, String(d1Data.expectedReturnSource));
    check("§5a2 yanıt kaynağı NONE", d1Data.expectedReturnSource === "NONE");
    await prisma.subcontractorCategory.update({ where: { id: dye.categoryId }, data: { expectedReturnDays: 3 } });
    const w2 = await mkWo("2");
    const d2 = await sub.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: dye.id, rollIds: [w2.rollId] }, admin.id);
    const row2 = await prisma.subcontractorDispatch.findFirstOrThrow({ where: { workOrderId: w2.woId }, select: { expectedReturnAt: true } });
    const src2 = (d2.data as { expectedReturnSource?: string }).expectedReturnSource;
    check("§5b adımın süreç türü 3 gün → kolon yazıldı, kaynak CATEGORY", row2.expectedReturnAt?.getTime() === endIn(3) && src2 === "CATEGORY", `${row2.expectedReturnAt?.toISOString()} ${src2}`);
    const w3 = await mkWo("3");
    // Toplu sevk adımda BEKLEYEN topu toplar (konum tabanlı).
    await prisma.roll.update({ where: { id: w3.rollId }, data: { currentStepId: w3.stepId, status: RollStatus.IN_PRODUCTION } });
    const bodyDay = addDaysToDayKey(today, 9);
    await sub.bulkDispatchStep({ workOrderId: w3.woId, stepId: w3.stepId, subcontractorId: dye.id, expectedReturnAt: bodyDay }, admin.id);
    const row3 = await prisma.subcontractorDispatch.findFirstOrThrow({ where: { workOrderId: w3.woId }, select: { expectedReturnAt: true } });
    check("§5c toplu sevk gövdeyi iletir", row3.expectedReturnAt?.getTime() === factoryDayEndOfKey(bodyDay).getTime());
    const w4 = await mkWo("4");
    check("§5d geçmiş gün gövdesi → 400, sevk yazılmaz",
      (await codeOf(() => sub.dispatch({ workOrderId: w4.woId, stepId: w4.stepId, subcontractorId: dye.id, rollIds: [w4.rollId], expectedReturnAt: addDaysToDayKey(today, -2) }, admin.id))) === "400:EXPECTED_RETURN_IN_PAST"
        && (await prisma.subcontractorDispatch.count({ where: { workOrderId: w4.woId } })) === 0);

    // ── §6 zod ────────────────────────────────────────────────────────────────
    check("§6a 1..365 ve null geçer", [1, 365, null, undefined].every((v) => expectedReturnDaysSchema.safeParse(v).success));
    check("§6b 0 / 366 / 2.5 / \"5\" reddedilir", [0, 366, 2.5, "5"].every((v) => !expectedReturnDaysSchema.safeParse(v).success));

    // ── §7 kokpit durum yüklemi ───────────────────────────────────────────────
    const over = expectedReturnStateWhere("OVERDUE", now).expectedReturnAt as { lt: Date };
    const soon = expectedReturnStateWhere("DUE_SOON", now).expectedReturnAt as { gte: Date; lte: Date };
    check("§7a OVERDUE = termin bugünün başından önce", over.lt.getTime() === factoryDayEndOfKey(addDaysToDayKey(today, -1)).getTime() + 1);
    check("§7b DUE_SOON = bugün .. bugün+2 gün sonu", soon.gte.getTime() === over.lt.getTime() && soon.lte.getTime() === endIn(2));
    check("§7c NO_DUE_DATE = null", expectedReturnStateWhere("NO_DUE_DATE", now).expectedReturnAt === null);
    check("§7d gecikme günü: dünün terminine 1, bugününe 0, termin yok null",
      overdueDaysOf(new Date(endIn(-1)), now) === 1 && overdueDaysOf(new Date(endIn(0)), now) === 0 && overdueDaysOf(null, now) === null);
  } finally {
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { expectedReturnDays: subSnap.expectedReturnDays } });
    await prisma.subcontractorCategory.update({ where: { id: dye.categoryId }, data: { expectedReturnDays: catSnap.expectedReturnDays } });
    await setSetting(settingSnap ? (settingSnap.value as Prisma.InputJsonValue) : null);
    if (woIds.length > 0) {
      const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { barcode: { startsWith: TAG } }] }, select: { id: true } });
      const rollIds = rolls.map((x) => x.id);
      const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
      const dispatchIds = dispatches.map((d) => d.id);
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...woIds] } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
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
  .finally(() => prisma.$disconnect());
