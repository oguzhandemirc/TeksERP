// =============================================================================
// BEKÇİ — D4-E3 Tambur finalize çocuk top en kaynağı (`tambur.childWidthSource`)
// Çalıştır: npx tsx scripts/test_tambur_cocuk_en_kaynagi.ts · DALGA4 §6.5, §12.1, §13
// =============================================================================
// §1 ⭐ ayar yazılmamış (WO_TARGET_FIRST): ölçülmüş ana topta bile çocuk eni = iş emri
//    eni (bugünkü `wo.width ?? roll.width`, bayt-aynı).
// §2 ⭐ MEASURED_FIRST + aktif en izi: çocuklara ana topun ölçülmüş eni geçer.
// §3 MEASURED_FIRST + iz yok: bugünkü kaynak (iş emri eni).
// §4 MEASURED_FIRST + iz GERİ ALINMIŞ (revokedAt): bugünkü kaynak.
// §5 MEASURED_FIRST + iş emri eni yok + iz yok: ana top eni (bugünkü yedek).
// §6 açık WO_TARGET_FIRST + iz: iş emri eni.
// §7 ⭐ dört kapı: Zod iki değeri kabul / bilinmeyeni red; servis sanitize bilinmeyeni 400;
//    yazılan değer okunur; DB'de çöp → varsayılan; getFeatureFlags alanı döner.
// Negatif sonda (2026-10-31, elle; PR gövdesinde): pickFinalizeChildWidthTx'te ayar okunmadan
// sabit WO_TARGET_FIRST koluna dönülünce §2 ❌.
// Ayar YAZAR: ilk iş `hedefDbEngeli()`; ayar satırı başta silinir, `finally`de birebir geri yüklenir.
// =============================================================================
import { Prisma, RollOperationType, RollStatus, StationKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { TamburService } from "../src/services/tambur.service";
import { AppError } from "../src/utils/app-error";
import {
  SETTING_KEYS,
  readTamburChildWidthSource,
  systemSettingService,
} from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const rollIds: string[] = [];
const woIds: string[] = [];
const itemIds: string[] = [];

async function writeSetting(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function expectAppError(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}

(async () => {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`✗ ${engel}`);
    process.exitCode = 1;
    return;
  }
  const svc = new TamburService();
  const saved = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE }, select: { value: true } });
  await writeSetting(SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, null);
  const runTag = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  try {
    const station = await prisma.station.findFirstOrThrow({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
    const item = await prisma.item.create({
      data: { code: `TEST-CE-ITM-${runTag}`, name: `TEST CE PERDE ${runTag}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(item.id);
    const gradeCode = (await roleGrade("FIRST")).code;

    /** İş emri + aktif TAMBUR adımı + adımda 1 top; `trace` → ana topa D4-E2a en izi (QC2 satırı). */
    const makeRoll = async (opts: {
      woWidth: number | null;
      rollWidth: number;
      trace?: "ACTIVE" | "REVOKED";
    }) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-CE-IE-${runTag}-${woIds.length}`,
          status: "IN_PROGRESS",
          targetItemId: item.id,
          width: opts.woWidth,
        },
        select: { id: true },
      });
      woIds.push(wo.id);
      const step = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
        select: { id: true },
      });
      const roll = await prisma.roll.create({
        data: {
          barcode: `TEST-CE-R-${runTag}-${rollIds.length}`,
          itemId: item.id,
          width: opts.rollWidth,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: step.id,
          entrySource: "SUPPLIER_RECEIPT",
          qualityGrade: gradeCode,
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: 100 } });
      if (opts.trace) {
        await prisma.rollOperation.create({
          data: {
            rollId: roll.id,
            workOrderStepId: step.id,
            operationType: RollOperationType.QC2_COMPLETED,
            metadata: { widthBefore: opts.rollWidth + 5, widthAfter: opts.rollWidth },
            ...(opts.trace === "REVOKED" ? { revokedAt: new Date(), revokeReason: "TEST-CE geri alındı" } : {}),
          },
        });
      }
      return roll.id;
    };
    const finalize = async (rollId: string) => {
      const res = await svc.finalize({
        rollId,
        decisions: [],
        cuts: [{ length: 40, qualityGrade: gradeCode, relatedErrorIds: [] as string[] }],
      });
      return res.data.splitRolls.map((r) => (r.width == null ? null : Number(r.width)));
    };
    const allEq = (ws: (number | null)[], want: number) => ws.length > 0 && ws.every((w) => w === want);

    // §1 — ayar yok: bugünkü kaynak (iş emri eni), ölçülmüş ana topta bile.
    const r1 = await makeRoll({ woWidth: 300, rollWidth: 295, trace: "ACTIVE" });
    const w1 = await finalize(r1);
    check("§1 ⭐ ayar yazılmamış → çocuk eni iş emri eni (300)", allEq(w1, 300), JSON.stringify(w1));

    // §2 — MEASURED_FIRST + aktif iz → ölçülmüş en.
    await writeSetting(SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, "MEASURED_FIRST");
    const r2 = await makeRoll({ woWidth: 300, rollWidth: 295, trace: "ACTIVE" });
    const w2 = await finalize(r2);
    check("§2 ⭐ MEASURED_FIRST + en izi → çocuk eni ölçülen en (295)", allEq(w2, 295), JSON.stringify(w2));

    // §3 — MEASURED_FIRST + iz yok → iş emri eni.
    const r3 = await makeRoll({ woWidth: 300, rollWidth: 295 });
    const w3 = await finalize(r3);
    check("§3 MEASURED_FIRST + ölçülmemiş ana top → iş emri eni (300)", allEq(w3, 300), JSON.stringify(w3));

    // §4 — MEASURED_FIRST + geri alınmış iz → iş emri eni.
    const r4 = await makeRoll({ woWidth: 300, rollWidth: 295, trace: "REVOKED" });
    const w4 = await finalize(r4);
    check("§4 MEASURED_FIRST + geri alınmış iz → iş emri eni (300)", allEq(w4, 300), JSON.stringify(w4));

    // §5 — MEASURED_FIRST + iş emri eni yok + iz yok → ana top eni.
    const r5 = await makeRoll({ woWidth: null, rollWidth: 290 });
    const w5 = await finalize(r5);
    check("§5 MEASURED_FIRST + iş emri ensiz → ana top eni (290)", allEq(w5, 290), JSON.stringify(w5));

    // §6 — açık WO_TARGET_FIRST + iz → iş emri eni.
    await writeSetting(SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, "WO_TARGET_FIRST");
    const r6 = await makeRoll({ woWidth: 300, rollWidth: 295, trace: "ACTIVE" });
    const w6 = await finalize(r6);
    check("§6 WO_TARGET_FIRST + en izi → iş emri eni (300)", allEq(w6, 300), JSON.stringify(w6));

    // §7 — dört kapı.
    const actorId = await testActorId();
    const zOk = ["WO_TARGET_FIRST", "MEASURED_FIRST"].every(
      (v) => updateSchema.safeParse({ tamburChildWidthSource: v }).success,
    );
    const zBad = updateSchema.safeParse({ tamburChildWidthSource: "MEASURED" }).success;
    check("§7a Zod iki değeri kabul, bilinmeyeni reddeder", zOk && !zBad);
    const eBad = await expectAppError(() =>
      systemSettingService.setFeatureFlags({ tamburChildWidthSource: "MEASURED" as never }, actorId),
    );
    check("§7b ⭐ servis sanitize bilinmeyen değere 400", eBad?.statusCode === 400, `${eBad?.statusCode} ${eBad?.message}`);
    await systemSettingService.setFeatureFlags({ tamburChildWidthSource: "MEASURED_FIRST" }, actorId);
    const flags = (await systemSettingService.getFeatureFlags()).data!;
    check(
      "§7c yazılan değer okunur + getFeatureFlags alanı döner",
      (await readTamburChildWidthSource()) === "MEASURED_FIRST" && flags.tamburChildWidthSource === "MEASURED_FIRST",
      String(flags.tamburChildWidthSource),
    );
    await writeSetting(SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, "SOMETHING");
    check("§7d DB'de çöp değer → varsayılan WO_TARGET_FIRST", (await readTamburChildWidthSource()) === "WO_TARGET_FIRST");
    await writeSetting(SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, null);
    check("§7e kayıt yok → varsayılan WO_TARGET_FIRST", (await readTamburChildWidthSource()) === "WO_TARGET_FIRST");
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      // Anahtar AÇIKÇA yazılır — test_bekci_ayar_geri_alma §1b geri almayı anahtar düzeyinde eşler.
      if (saved) {
        const value = saved.value as Prisma.InputJsonValue;
        await prisma.systemSetting.upsert({
          where: { key: SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE },
          create: { key: SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE, value },
          update: { value },
        });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE } });
      }
    } catch (e) {
      fail++;
      console.error("ayar geri yükleme hatası:", e instanceof Error ? e.message : e);
    }
    try {
      const children = await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } });
      const all = [...rollIds, ...children.map((c) => c.id)];
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...all, ...woIds] } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { OR: [{ rollId: { in: all } }, { childRollId: { in: all } }] } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: all } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: all } } });
      await prisma.roll.deleteMany({ where: { id: { in: children.map((c) => c.id) } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      console.log("(temizlendi — TEST-CE fixture silindi)");
    } catch (e) {
      fail++;
      console.error("temizlik hatası:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
