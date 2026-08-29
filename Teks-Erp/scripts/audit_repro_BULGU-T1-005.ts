// =============================================================================
// AUDIT REPRO — BULGU-T1-005: Fason KISMİ kabulde aynı `clientToken` ile
// EŞZAMANLI N istek → idempotent "cached makbuz" yerine YANILTICI 409
// ("Barkod üretimi 5 denemede başarısız oldu") + N-1 kez 5 boşa tx.
//
// Kök neden (üç halka birlikte):
//   1) Token kontrolü `subcontractor.service.ts:2350` tx DIŞINDA (havuz) →
//      check-then-act: iki istek de "token yok" görüp geçer.
//   2) `subcontractorReceipt.create` (clientToken @unique) :2790 — roll
//      claim'lerinden ÖNCE; KISMİ kabulde top AT_SUBCONTRACTOR'da KALDIĞI için
//      :2723 `freshReturns` kapısı ikinci isteği ELEMEZ (tam kabulde elerdi).
//   3) Gövde `withBarcodeRetry(...)` :2677 — TEK argüman: ne `isRetryable`
//      predicate'i ne de dış `catch`. Kalıcı iş-anahtarı P2002'si 5 kez
//      tekrarlanıp anlamsız "Barkod üretimi ..." 409'una dönüşüyor.
//      (Aynı repoda DOĞRU desen var: workorder:988, order:1942, shipping:250,
//       shipping:1401, item:225 → `undefined, (err) => !isClientTokenP2002(err)`
//       + dış catch cached yanıt. Fason kabul o listede YOK.)
//
// SONUÇ ZİNCİRİ: 4xx alan tablet token'ı YAPIŞTIRMAZ (mobil sözleşme
// `mobil/src/offline/entryAttempt.ts`: yalnız sonucu BELİRSİZ bırakan hatada
// yapışır) → kuyruk denemeyi düşürür → operatör kabulü ELLE yeniden girer →
// YENİ token hiçbir guard'a takılmaz → AYNI teslimat İKİNCİ kez düşülür.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): N eşzamanlı istekten 1'i makbuzu yazar,
//   DİĞER N-1'i AYNI makbuzu `success:true` + "idempotent retry" ile döner.
// Gözlenen: log audit/repro/BULGU-T1-005.log
// Çalıştır: cd Teks-Erp && REPRO_N=2 REPRO_ROUNDS=10 \
//           npx tsx scripts/audit_repro_BULGU-T1-005.ts
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
import { ShippingService } from "../src/services/shipping.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const N = Math.max(2, Number(process.env.REPRO_N ?? 2));
const ROUNDS = Math.max(1, Number(process.env.REPRO_ROUNDS ?? 10));
const STAMP = `AUDITREPRO-T1005-${Math.random().toString(36).slice(2, 8)}`;
const sub = new SubcontractorService();

/** Fixture sabitleri — 300 m top, 120 m kısmi teslimat, kalan 180 m beklenir. */
const ROLL_QTY = 300;
const RECEIVED_QTY = 120;
const EXPECTED_REMAINDER = ROLL_QTY - RECEIVED_QTY;

const created = { woIds: [] as string[], rollIds: [] as string[], sackIds: [] as string[] };

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`REPRO BULGU-T1-005 · damga=${STAMP} · N=${N} · tur=${ROUNDS}`);

  const need = <T extends { id: string }>(v: T | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label}`);
    return v.id;
  };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  const SUB = (await ensureTestDyeHouse()).id;

  let misleading409 = 0;   // en az bir kaybeden "Barkod üretimi ..." 409'u aldı
  let idempotentOk = 0;    // N-1 kaybeden cached makbuzu aldı (SAĞLIKLI davranış)
  let otherResult = 0;
  let duplicateReceipt = 0; // aynı adımda >1 aktif makbuz (token çakışması sonrası)
  let doubleCounted = 0;    // elle yeniden girişten sonra kalan < 180 m
  let wastedTxTotal = 0;    // yanıltıcı 409 alan istek sayısı × 5 boşa tx denemesi

  try {
    for (let i = 1; i <= ROUNDS; i++) {
      // ── Fixture: WO + 2 adım + 1 top (300 m) fasona sevk edilmiş ──────────
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
          initialQty: ROLL_QTY,
          currentQty: ROLL_QTY,
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

      // ── KISMİ kabul payload'ı — N istek, TEK ve AYNI clientToken ──────────
      // Sahadaki karşılığı: tablet gönderdi, ağ zaman aşımına düştü (sonuç
      // BELİRSİZ), çevrimdışı kuyruk AYNI token'la yeniden gönderdi; ilk istek
      // hâlâ sunucuda (fason kabul sistemin en uzun tx'i). Token sözleşmesinin
      // tam da korumak için var olduğu durum.
      const token = randomUUID();
      const payload = {
        workOrderId: wo.id,
        stepId: boyaStep,
        subcontractorId: SUB,
        clientToken: token,
        remainderStays: true,
        returns: [{ rollId: roll.id, receivedQty: RECEIVED_QTY }],
        newRolls: [{ qty: RECEIVED_QTY }],
      };

      const results = await Promise.allSettled(
        Array.from({ length: N }, () => sub.receive({ ...payload }, ADMIN)),
      );

      const okMsgs = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => String((r as PromiseFulfilledResult<{ message?: string }>).value.message ?? ""));
      const errs = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String((r.reason as Error)?.message ?? ""));

      const misleadingCount = errs.filter((m) => /Barkod üretimi \d+ denemede başarısız/.test(m)).length;
      const idempotentCount = okMsgs.filter((m) => /idempotent retry/i.test(m)).length;
      wastedTxTotal += misleadingCount * 5;

      // ÖLÇÜM COMMIT SONRASI, DB'DEN (bellekteki dönüş değerine güvenme)
      const receipts = await prisma.subcontractorReceipt.count({
        where: { workOrderId: wo.id, cancelledAt: null },
      });
      if (receipts > 1) duplicateReceipt++;

      // ── SONUÇ ZİNCİRİ: kesin 4xx → token YAPIŞMAZ → operatör ELLE yeniden
      //    girer (YENİ token). Guard'lara takılmaz: teslimat İKİNCİ kez düşülür.
      let secondQty: number | null = null;
      let secondReceipts = 0;
      let secondBorn = 0;
      if (misleadingCount > 0) {
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
        secondBorn = await prisma.roll.count({ where: { parentReceipt: { workOrderId: wo.id } } });
        if (secondQty < EXPECTED_REMAINDER) doubleCounted++;
      }

      if (misleadingCount > 0) {
        misleading409++;
        console.log(
          `❌ tur ${i} YANILTICI 409 ×${misleadingCount}/${N - 1} kaybeden — aktif makbuz=${receipts}, idempotent cevap=${idempotentCount}`,
        );
        console.log(
          `   ↳ ELLE yeniden giriş (yeni token): kalan=${secondQty} m (beklenen ${EXPECTED_REMAINDER}), aktif makbuz=${secondReceipts}, doğan top=${secondBorn}`,
        );
      } else if (idempotentCount === N - 1 && receipts === 1) {
        idempotentOk++;
        console.log(`✅ tur ${i} idempotent replay ×${idempotentCount}/${N - 1} — aktif makbuz=${receipts}`);
      } else {
        otherResult++;
        console.log(
          `⚠️ tur ${i} başka sonuç — makbuz=${receipts}, ok=${okMsgs.length}, err=${errs.length} | ${[...okMsgs, ...errs].map((m) => m.slice(0, 60)).join(" || ")}`,
        );
      }
    }

    // ── KONTROL SONDASI (negatif sonda) ──────────────────────────────────
    // Bu harness'ın "her koşulda kırmızı" olmadığını ispatlar. AYNI eşzamanlılık
    // şekli, AYNI token sözleşmesi — ama predicate'i VE dış catch'i OLAN bir yol:
    // `shipping.openSack` (shipping.service.ts:250 `undefined, (err) => …` +
    // :288 catch → readOpenSackReplay). Sağlıklı davranış: N istekten hepsi
    // başarılı ve HEPSİ AYNI çuvalı döner; "Barkod üretimi ..." 409'u YOK.
    let controlOk = 0;
    let controlBad = 0;
    const shipping = new ShippingService();
    for (let i = 1; i <= 3; i++) {
      const ctoken = randomUUID();
      const res = await Promise.allSettled(
        Array.from({ length: N }, () => shipping.openSack({ clientToken: ctoken }, ADMIN)),
      );
      const sackNos = new Set(
        res
          .filter((r) => r.status === "fulfilled")
          .map((r) => String(((r as PromiseFulfilledResult<{ data?: unknown }>).value.data as { sackNo?: string })?.sackNo ?? "?")),
      );
      const misleading = res.some(
        (r) => r.status === "rejected" && /Barkod üretimi \d+ denemede başarısız/.test(String((r.reason as Error)?.message ?? "")),
      );
      const rows = await prisma.sack.findMany({ where: { clientToken: ctoken }, select: { id: true } });
      created.sackIds.push(...rows.map((x) => x.id));
      const healthy = !misleading && sackNos.size === 1 && rows.length === 1 && res.every((r) => r.status === "fulfilled");
      if (healthy) controlOk++;
      else controlBad++;
      console.log(
        `${healthy ? "✅" : "❌"} KONTROL tur ${i} (openSack — predicate'li yol): başarılı=${res.filter((r) => r.status === "fulfilled").length}/${N}, farklı çuval=${sackNos.size}, DB satır=${rows.length}, yanıltıcı409=${misleading}`,
      );
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n──────── ÖZET (N=${N}, tur=${ROUNDS}, ${secs} sn) ────────`);
    console.log(`YANILTICI barkod-409'lu tur : ${misleading409}/${ROUNDS}`);
    console.log(`doğru idempotent replay tur : ${idempotentOk}/${ROUNDS}`);
    console.log(`diğer sonuç                 : ${otherResult}/${ROUNDS}`);
    console.log(`mükerrer AKTİF makbuz       : ${duplicateReceipt}/${ROUNDS}  (DB @unique tutuyor — beklenen 0)`);
    console.log(`ÇİFT DÜŞÜLEN teslimat       : ${doubleCounted}/${ROUNDS}  (elle yeniden girişten sonra kalan < ${EXPECTED_REMAINDER} m)`);
    console.log(`boşa koşan tx denemesi      : ${wastedTxTotal}  (yanıltıcı 409 başına 5 tam tx + WO kilidi)`);
    console.log(`KONTROL SONDASI (openSack)  : sağlıklı ${controlOk}/3, bozuk ${controlBad}/3  (harness körlük testi)`);
    if (misleading409 > 0) {
      console.log(
        `\n❌ BULGU-T1-005 DOĞRULANDI (N=${N}): clientToken'ın TEK amacı olan\n` +
          "   eşzamanlı replay yolunda idempotent cevap yerine 'Barkod üretimi 5\n" +
          "   denemede başarısız oldu' 409'u dönüyor; kalıcı iş-anahtarı P2002'si\n" +
          "   predicate'siz withBarcodeRetry tarafından 5 kez boşuna tekrarlanıyor.",
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
      await prisma.sackAllocation.deleteMany({ where: { sackId: { in: created.sackIds } } });
      await prisma.sack.deleteMany({ where: { id: { in: created.sackIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...allRollIds, ...created.sackIds] } } });
      console.log("temizlik tamam");
    } catch (e) {
      console.log(`⚠️ temizlik uyarısı: ${(e as Error).message}`);
    }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

void main();
