// =============================================================================
// AUDIT REPRO — KYY-1-01: Tambur geri alma (SINGLE_RESTORE) ile iş emri iptali
// yarışı → top, İPTAL EDİLMİŞ iş emrinin SKIPPED adımına IN_PRODUCTION olarak
// diriltilir ("canlı ama kimsenin okutamadığı top" çıkmazı).
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): iki eşzamanlı aktörden sonra HİÇBİR turda
//   (wo.status = CANCELLED  AND  parent.status = IN_PRODUCTION AND
//    parent.currentStepId = iptal edilen WO'nun adımı) oluşmamalı; geri alma
//   409 ("İş emri iptal/devredilmiş") ile reddedilmeli.
// Gözlenen: log audit/repro/KYY-1-01.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-1-01.ts
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

import {
  RollEntrySource,
  RollOperationType,
  RollStatus,
  StationKind,
  StationType,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { WorkOrderService } from "../src/services/workorder.service";

const STAMP = `AUDITREPRO-KYY-1-01-${Math.random().toString(36).slice(2, 8)}`;
const ROUNDS = 16;
const undoSvc = new TamburUndoService();
const woSvc = new WorkOrderService();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const created = {
  rollIds: [] as string[],
  stepIds: [] as string[],
  woIds: [] as string[],
  itemId: "",
  stationId: "",
};

interface Round {
  n: number;
  offsetMs: number;
  woId: string;
  stepId: string;
  parentId: string;
  childId: string;
}

async function buildRound(n: number, offsetMs: number): Promise<Round> {
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${STAMP}-WO${n}`, status: WorkOrderStatus.IN_PROGRESS },
    select: { id: true },
  });
  created.woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: {
      workOrderId: wo.id,
      stationId: created.stationId,
      stepSequence: 1,
      status: StepStatus.ACTIVE,
    },
    select: { id: true },
  });
  created.stepIds.push(step.id);

  // Kaynak: Tambur finalize'ı kapatmış açık kumaş (fason dönüşü) — ARŞİVDE.
  const parent = await prisma.roll.create({
    data: {
      barcode: null,
      itemId: created.itemId,
      initialQty: 100,
      currentQty: 0,
      status: RollStatus.TAMBUR_CONSUMED,
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      preTamburCloseQty: 100,
      preTamburCloseStatus: RollStatus.IN_PRODUCTION,
    },
    select: { id: true },
  });
  created.rollIds.push(parent.id);

  const child = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-C${n}`,
      itemId: created.itemId,
      initialQty: 40,
      currentQty: 40,
      status: RollStatus.WAREHOUSE,
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      parentRollId: parent.id,
      producedInStepId: step.id,
    },
    select: { id: true },
  });
  created.rollIds.push(child.id);

  // Kapanış izi — SINGLE_RESTORE adımı bundan çözer.
  await prisma.rollOperation.create({
    data: {
      rollId: parent.id,
      workOrderStepId: step.id,
      operationType: RollOperationType.TAMBUR_PROCESSED,
    },
  });
  // Kapanmış hareket — geri alma bunu yeniden AÇAR.
  await prisma.rollMovement.create({
    data: {
      rollId: parent.id,
      workOrderStepId: step.id,
      qtyIn: 100,
      qtyOut: 100,
      exitedAt: new Date(),
    },
  });

  return { n, offsetMs, woId: wo.id, stepId: step.id, parentId: parent.id, childId: child.id };
}

async function main(): Promise<void> {
  console.log(`REPRO KYY-1-01 · damga=${STAMP} · tur=${ROUNDS}`);
  let violations = 0;
  let undoRejected = 0;
  let cancelRejected = 0;
  let orphanMovements = 0;

  try {
    const item = await prisma.item.create({
      data: { code: `${STAMP}-IT`, name: `${STAMP} Kumas`, itemType: "FABRIC" },
      select: { id: true },
    });
    created.itemId = item.id;

    let station = await prisma.station.findFirst({
      where: { kind: StationKind.TAMBUR, isActive: true },
      select: { id: true },
    });
    if (!station) {
      station = await prisma.station.create({
        data: {
          code: `${STAMP}-ST`.slice(0, 32),
          name: `${STAMP} Tambur`.slice(0, 100),
          type: StationType.INTERNAL,
          kind: StationKind.TAMBUR,
        },
        select: { id: true },
      });
      created.stationId = station.id;
    }
    const stationId = station.id;
    created.stationId = created.stationId || stationId;

    // Fixture'lar bu id ile yaratılır (station paylaşılıyorsa da sorun yok).
    created.stationId = stationId;

    const offsets = [0, 1, 2, 4, 6, 9, 12, 18];
    for (let i = 1; i <= ROUNDS; i++) {
      const offsetMs = offsets[(i - 1) % offsets.length]!;
      const r = await buildRound(i, offsetMs);

      // ⚠️ ÇİZELGE: T1 (geri alma) ÖNCE başlar, T2 (iş emri iptali) offsetMs sonra.
      // T1'in tx içi guard'ı (`step.workOrder.status`) T2 henüz COMMIT etmediği
      // için IN_PROGRESS okur → kapıyı geçer. T2 commit ettikten sonra T1'in
      // `workOrder.updateMany {status: COMPLETED}` claim'i 0 satır bulur ve
      // SESSİZCE geçer — top yine de adıma diriltilmiş olarak COMMIT edilir.
      const undoP = undoSvc
        .applyUndo(r.childId, undefined, { mode: "SINGLE_RESTORE" })
        .then(() => "ok" as const)
        .catch((e: unknown) => {
          undoRejected++;
          return `err:${(e as Error)?.message?.slice(0, 60)}` as const;
        });
      await sleep(offsetMs);
      const cancelP = woSvc
        .softDelete(r.woId, undefined, { reason: `${STAMP} repro iptali` })
        .then(() => "ok" as const)
        .catch((e: unknown) => {
          cancelRejected++;
          return `err:${(e as Error)?.message?.slice(0, 60)}` as const;
        });

      const [cRes, uRes] = await Promise.all([cancelP, undoP]);

      // ── ÖLÇÜM COMMIT SONRASI, DB'DEN ──────────────────────────────────────
      const rows = await prisma.$queryRaw<
        Array<{ wostatus: string; rollstatus: string; curstep: string | null; stepstatus: string }>
      >`
        SELECT w.status::text AS wostatus,
               r.status::text AS rollstatus,
               r."currentStepId"::text AS curstep,
               s.status::text AS stepstatus
          FROM rolls r
          CROSS JOIN work_orders w
          JOIN work_order_steps s ON s.id = ${r.stepId}::uuid
         WHERE r.id = ${r.parentId}::uuid AND w.id = ${r.woId}::uuid
      `;
      const row = rows[0]!;
      const broken =
        row.wostatus === "CANCELLED" &&
        row.rollstatus === "IN_PRODUCTION" &&
        row.curstep === r.stepId;
      if (broken) {
        violations++;
        const openMove = await prisma.rollMovement.count({
          where: { workOrderStepId: r.stepId, exitedAt: null },
        });
        orphanMovements += openMove;
        console.log(
          `❌ tur ${i} (offset ${offsetMs}ms) DEĞİŞMEZ BOZULDU — wo=${row.wostatus} step=${row.stepstatus} top=${row.rollstatus} currentStep=ADIM açıkHareket=${openMove} | iptal=${cRes} geriAl=${uRes}`,
        );
      } else {
        console.log(
          `✅ tur ${i} (offset ${offsetMs}ms) temiz — wo=${row.wostatus} step=${row.stepstatus} top=${row.rollstatus} | iptal=${cRes} geriAl=${uRes}`,
        );
      }
    }

    console.log("\n──────── ÖZET ────────");
    console.log(`tur           : ${ROUNDS}`);
    console.log(`ihlal         : ${violations}`);
    console.log(`geri alma 409 : ${undoRejected}`);
    console.log(`iptal reddi   : ${cancelRejected}`);
    console.log(`yetim açık hareket (ihlalli turlarda toplam): ${orphanMovements}`);
    if (violations > 0) {
      console.log(
        "\n❌ KYY-1-01 DOĞRULANDI: `tambur-undo` üç modunda da WO satır kilidi YOK;\n" +
          "   `step.workOrder.status` okuması check-then-act'tir ve tx boyunca pin'lenmez.\n" +
          "   Sonuç: iptal edilmiş iş emrinin SKIPPED adımına IN_PRODUCTION top + açık hareket.",
      );
    } else {
      console.log(
        "\n⚠️ Bu koşumda tetiklenmedi (negatif sonuç da kanıttır) — pencere dar;\n" +
          "   offset değerlerini artırıp tekrar koşun.",
      );
    }
    process.exitCode = violations > 0 ? 1 : 0;
  } finally {
    // ── TEMİZLİK (FK sırası) — yalnız kendi damgamız ──────────────────────
    const woIds = created.woIds;
    const stepIds = created.stepIds;
    const rollIds = created.rollIds;
    try {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { currentStepId: null, producedInStepId: null, parentRollId: null },
      });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.systemLog.deleteMany({
        where: { recordId: { in: [...rollIds, ...woIds] } },
      });
      if (created.itemId) {
        await prisma.systemLog.deleteMany({ where: { recordId: created.itemId } });
        await prisma.item.deleteMany({ where: { id: created.itemId } });
      }
      await prisma.station.deleteMany({ where: { code: { startsWith: STAMP } } });
    } catch (e) {
      console.log(`⚠️ temizlik uyarısı: ${(e as Error).message}`);
    }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

void main();
