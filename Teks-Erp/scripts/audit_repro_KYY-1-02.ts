// =============================================================================
// AUDIT REPRO — KYY-1-02: Fason KISMİ kabulde aynı `clientToken` ile eşzamanlı
// iki istek → idempotent "cached makbuz" yerine YANILTICI 409
// ("Barkod üretimi 5 denemede başarısız oldu") + 5 boşa tx.
//
// Kök: token kontrolü (`subcontractor.service.ts:2350`) tx DIŞINDA (havuz);
// `subcontractorReceipt.create` (clientToken @unique) roll claim'lerinden ÖNCE;
// tüm gövde `withBarcodeRetry` içinde ve o helper'a HİÇBİR çağrı yerinde
// `isRetryable` predicate'i verilmiyor (28/28) → kalıcı iş-anahtarı P2002'si
// 5 kez tekrarlanıp anlamsız bir barkod mesajına dönüşüyor.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): iki eşzamanlı istekten biri makbuzu yazar,
//   DİĞERİ AYNI makbuzu `success:true` ile döner (idempotent replay) — tam 1
//   aktif makbuz, mesajda "idempotent retry".
// Gözlenen: log audit/repro/KYY-1-02.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-1-02.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "node:crypto";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const STAMP = `AUDITREPRO-KYY-1-02-${Math.random().toString(36).slice(2, 8)}`;
const ROUNDS = 6;
const sub = new SubcontractorService();

const created = { woIds: [] as string[], rollIds: [] as string[] };

async function main(): Promise<void> {
  console.log(`REPRO KYY-1-02 · damga=${STAMP} · tur=${ROUNDS}`);

  const need = <T extends { id: string }>(v: T | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label}`);
    return v.id;
  };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  const SUB = (await ensureTestDyeHouse()).id;

  let misleading409 = 0;
  let idempotentOk = 0;
  let otherErr = 0;
  let duplicateReceipt = 0;
  let doubleCounted = 0;

  try {
    for (let i = 1; i <= ROUNDS; i++) {
      // ── Fixture: WO + 2 adım + 1 top (300 m) fasona sevk edilmiş ─────────
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${STAMP}-WO${i}`,
          type: "STOCK_PRODUCTION",
          status: "IN_PROGRESS",
          width: 250,
          targetQuantity: 1000,
          targetItemId: ITEM,
          steps: {
            create: [
              { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
              { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
            ],
          },
        },
        include: { steps: { orderBy: { stepSequence: "asc" } } },
      });
      created.woIds.push(wo.id);
      const boyaStep = wo.steps[0]!.id;

      const roll = await prisma.roll.create({
        data: {
          barcode: `${STAMP}-R${i}`,
          itemId: ITEM,
          initialQty: 300,
          currentQty: 300,
          status: RollStatus.STOCK,
          qualityGrade: "1.KALITE",
          qualityGradeId: GRADE,
          width: 250,
          createdById: ADMIN,
        },
        select: { id: true },
      });
      created.rollIds.push(roll.id);

      await sub.dispatch(
        { workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB, rollIds: [roll.id] },
        ADMIN,
      );

      // ── KISMİ kabul payload'ı — TEK ve AYNI clientToken ──────────────────
      // Sahadaki karşılığı: tablet gönderdi, ağ zaman aşımına düştü (sonuç
      // BELİRSİZ), çevrimdışı kuyruk AYNI token'la yeniden gönderdi; ilk istek
      // hâlâ sunucuda (fason kabul en uzun tx). Token sözleşmesinin tam da
      // korumak için var olduğu durum.
      const token = randomUUID();
      const payload = {
        workOrderId: wo.id,
        stepId: boyaStep,
        subcontractorId: SUB,
        clientToken: token,
        remainderStays: true,
        returns: [{ rollId: roll.id, receivedQty: 120 }],
        newRolls: [{ qty: 120 }],
      };

      const results = await Promise.allSettled([
        sub.receive({ ...payload }, ADMIN),
        sub.receive({ ...payload }, ADMIN),
      ]);

      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const msgs = results.map((r) =>
        r.status === "fulfilled"
          ? `OK:${String((r.value as { message?: string }).message ?? "").slice(0, 48)}`
          : `ERR(${(r.reason as { statusCode?: number })?.statusCode ?? "?"}):${String((r.reason as Error)?.message ?? "").slice(0, 60)}`,
      );

      const receipts = await prisma.subcontractorReceipt.count({
        where: { workOrderId: wo.id, cancelledAt: null },
      });
      if (receipts > 1) duplicateReceipt++;

      // ── SONUÇ ZİNCİRİ: 4xx alan tablet token'ı YAPIŞTIRMAZ (mobil sözleşme:
      //    yalnız BELİRSİZ sonuçta yapışır) → kuyruk denemeyi düşürür, operatör
      //    kabulü ELLE yeniden girer. O deneme YENİ token taşır ve guard'lara
      //    takılmaz: aynı fiziksel teslimat İKİNCİ kez düşülür.
      let secondQty: number | null = null;
      let secondReceipts = 0;
      let secondBorn = 0;
      const rejectedForChain = results.find((r) => r.status === "rejected");
      if (rejectedForChain) {
        try {
          await sub.receive({ ...payload, clientToken: randomUUID() }, ADMIN);
        } catch {
          /* elle yeniden giriş de reddedilirse zincir kırılır — ölçüm aşağıda */
        }
        const after = await prisma.roll.findUnique({
          where: { id: roll.id },
          select: { currentQty: true },
        });
        secondQty = Number(after?.currentQty ?? -1);
        secondReceipts = await prisma.subcontractorReceipt.count({
          where: { workOrderId: wo.id, cancelledAt: null },
        });
        secondBorn = await prisma.roll.count({
          where: { parentReceipt: { workOrderId: wo.id } },
        });
      }

      const rejected = results.find((r) => r.status === "rejected");
      const rejMsg = rejected ? String((rejected.reason as Error)?.message ?? "") : "";
      const isMisleading = /Barkod üretimi \d+ denemede başarısız/.test(rejMsg);
      const isIdempotent =
        okCount === 2 &&
        results.some(
          (r) =>
            r.status === "fulfilled" &&
            /idempotent retry/i.test(String((r.value as { message?: string }).message ?? "")),
        );

      if (isMisleading) {
        misleading409++;
        console.log(
          `❌ tur ${i} YANILTICI 409 — makbuz=${receipts} | ${msgs.join(" || ")}`,
        );
        console.log(
          `   ↳ ELLE yeniden giriş (yeni token): kalan=${secondQty} m (beklenen 180), aktif makbuz=${secondReceipts}, doğan top=${secondBorn}`,
        );
        if (secondQty !== null && secondQty < 180) doubleCounted++;
      } else if (isIdempotent) {
        idempotentOk++;
        console.log(`✅ tur ${i} idempotent replay — makbuz=${receipts} | ${msgs.join(" || ")}`);
      } else {
        otherErr++;
        console.log(`⚠️ tur ${i} başka sonuç — makbuz=${receipts} | ${msgs.join(" || ")}`);
      }
    }

    console.log("\n──────── ÖZET ────────");
    console.log(`tur                     : ${ROUNDS}`);
    console.log(`YANILTICI barkod-409'u  : ${misleading409}`);
    console.log(`doğru idempotent replay : ${idempotentOk}`);
    console.log(`diğer sonuç             : ${otherErr}`);
    console.log(`mükerrer aktif makbuz   : ${duplicateReceipt}`);
    console.log(`ÇİFT DÜŞÜLEN teslimat   : ${doubleCounted}  (elle yeniden girişten sonra kalan < 180 m)`);
    if (misleading409 > 0) {
      console.log(
        "\n❌ KYY-1-02 DOĞRULANDI: clientToken'ın TEK amacı olan eşzamanlı replay\n" +
          "   yolunda idempotent cevap yerine 'Barkod üretimi 5 denemede başarısız\n" +
          "   oldu' 409'u dönüyor (kalıcı iş-anahtarı P2002'si predicate'siz\n" +
          "   withBarcodeRetry tarafından 5 kez boşuna tekrarlanıyor).",
      );
    }
    process.exitCode = misleading409 > 0 ? 1 : 0;
  } finally {
    try {
      const woIds = created.woIds;
      const stepRows = await prisma.workOrderStep.findMany({
        where: { workOrderId: { in: woIds } },
        select: { id: true },
      });
      const stepIds = stepRows.map((s) => s.id);
      const bornRows = await prisma.roll.findMany({
        where: { parentReceipt: { workOrderId: { in: woIds } } },
        select: { id: true },
      });
      const allRollIds = [...created.rollIds, ...bornRows.map((b) => b.id)];

      await prisma.rollVariance.deleteMany({ where: { rollId: { in: allRollIds } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: allRollIds } } });
      await prisma.subcontractorReceiptItem.deleteMany({
        where: { receipt: { workOrderId: { in: woIds } } },
      });
      await prisma.subcontractorReceiptProperty.deleteMany({
        where: { receipt: { workOrderId: { in: woIds } } },
      });
      await prisma.subcontractorDispatchItem.deleteMany({
        where: { dispatch: { workOrderId: { in: woIds } } },
      });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } });
      await prisma.roll.updateMany({
        where: { id: { in: allRollIds } },
        data: { currentStepId: null, producedInStepId: null, parentRollId: null, batchId: null },
      });
      await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: woIds } } });
      await prisma.travelerCardScan.deleteMany({ where: { workOrderStepId: { in: stepIds } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...allRollIds] } } });
    } catch (e) {
      console.log(`⚠️ temizlik uyarısı: ${(e as Error).message}`);
    }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

void main();
