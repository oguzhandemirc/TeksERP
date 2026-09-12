// =============================================================================
// GERİYE DOLDURMA — Roll.finalizedAt + Roll.statusChangedAt
// Çalıştır: npx tsx scripts/backfill_roll_production_timestamps.ts          (DRY-RUN)
//           npx tsx scripts/backfill_roll_production_timestamps.ts --apply  (YAZAR)
// =============================================================================
// Migration 20260809090000 iki zaman çıpası ekledi ve bunları BİR TRIGGER yazıyor.
// Trigger yalnız BUNDAN SONRAKİ geçişleri görür → o ana kadar üretilmiş her top
// NULL kalır ve kalite/fire karnelerinde HİÇBİR DÖNEMDE görünmez. Bu script o
// geçmişi `system_logs`'tan geri kurar.
//
// ⚠️ KURAL TRIGGER İLE BİREBİR AYNI OLMAK ZORUNDA. İki taraf ayrışırsa geçmiş
// ile bugün farklı tanımlarla damgalanır ve rapor, tam da dönem sınırında
// (backfill'in bittiği gün) sessizce zıplar. Aynen kopyalanan kural:
//   finalizedAt  ← üretim tarafı statüden (IN_PRODUCTION / STOCK /
//                  AT_SUBCONTRACTOR / RETURNED_FROM_SUBCONTRACTOR) final statüye
//                  (WAREHOUSE / A1_STOCK / SCRAP) geçişin EN SONUNCUSU;
//                  ayrıca doğrudan final statüde DOĞAN top (CREATE).
//                  → SHIPPED→WAREHOUSE (storno/iade) ve CANCELLED→* SAYILMAZ.
//   statusChangedAt ← statünün gerçekten değiştiği EN SON olay.
// "EN SON" seçimi de trigger'ın "üzerine yazar" semantiğinin aynası: damga her
// zaman topun MEVCUT `qualityGradeId`'siyle aynı olaydan gelmeli.
//
// ⚠️ CANLI VERİ KURALI (kök CLAUDE.md): DRY-RUN varsayılan; `--apply` öncesi
// etkilenecek HER kayıt somut listelenir. "N kayıt güncellenecek" yetmez.
//
// ⚠️ ASLA ÜZERİNE YAZMAZ: kolonu zaten DOLU olan top atlanır (idempotent).
// Trigger'ın yazdığı değer her zaman kazanır — o birincil kaynak, bu telafi.
//
// ⚠️ YAZMA HAM SQL İLE YAPILIR, Prisma `update` ile DEĞİL. Sebep: `updatedAt`
// `@updatedAt` taşıyor ve Prisma her yazmada onu tazeler. Envanter sekmeleri
// "Son İşlem" sırasını tam olarak o kolondan çözüyor (kök CLAUDE.md "Buraya
// geliş ≠ oluşturma") → Prisma ile yazsaydık bu script SAHADAKİ HER LİSTEYİ
// yeniden sıralar ve operatör aradığı topu bulamazdı. Ham UPDATE `updatedAt`'e
// dokunmaz. (Trigger da tetiklenir ama `status` değişmediği için hiçbir şey
// yapmaz — `IS DISTINCT FROM` dalı; ölçüldü.)
//
// ⚠️ KAPSAM SINIRI — DÜRÜSTÇE: audit best-effort'tur ve 6 ayda bir
// `system_log_archives`'a TAŞINIR. Bu script yalnız `system_logs`'a bakar.
// İzi bulunamayan top NULL kalır ve raporlarda görünmez; script bunları
// SAYMAKLA KALMAZ, tek tek listeler — çünkü "kaç top rapor dışında kaldı"
// sorusunun cevabı, raporun kendisine güvenip güvenmeyeceğini belirler.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");

/** Trigger'daki kaynak statü kümesi — ayrışırsa geçmiş/bugün farklı damgalanır. */
const PRODUCTION_SOURCE = ["IN_PRODUCTION", "STOCK", "AT_SUBCONTRACTOR", "RETURNED_FROM_SUBCONTRACTOR"];
/** Trigger'daki hedef (final) statü kümesi. */
const FINAL_TARGET = ["WAREHOUSE", "A1_STOCK", "SCRAP"];

interface PlanRow {
  rollId: string;
  barcode: string | null;
  status: string;
  at: Date;
  action: string;
  fromStatus: string | null;
}

async function main(): Promise<void> {
  console.log(`\n=== Roll üretim zaman çıpaları — geriye doldurma ${APPLY ? "(APPLY)" : "(DRY-RUN)"} ===\n`);

  // ── 1) finalizedAt planı ────────────────────────────────────────────────────
  // DISTINCT ON + createdAt DESC = "en son finalize olayı" (trigger'ın üzerine
  // yazma semantiğinin aynası).
  const finalizePlan = await prisma.$queryRawUnsafe<PlanRow[]>(
    `
    SELECT DISTINCT ON (l."recordId")
      r.id                     AS "rollId",
      r.barcode                AS "barcode",
      r.status::text           AS "status",
      l."createdAt"            AS "at",
      l.action::text           AS "action",
      l."oldData"->>'status'   AS "fromStatus"
    FROM system_logs l
    JOIN rolls r ON r.id::text = l."recordId"
    WHERE l."tableName" = 'ROLL'
      AND r."finalizedAt" IS NULL
      AND l."newData"->>'status' = ANY($1::text[])
      AND (
            l.action::text = 'CREATE'
         OR l."oldData"->>'status' = ANY($2::text[])
      )
    ORDER BY l."recordId", l."createdAt" DESC
    `,
    FINAL_TARGET,
    PRODUCTION_SOURCE,
  );

  // ── 2) statusChangedAt planı ────────────────────────────────────────────────
  const statusPlan = await prisma.$queryRawUnsafe<PlanRow[]>(
    `
    SELECT DISTINCT ON (l."recordId")
      r.id                     AS "rollId",
      r.barcode                AS "barcode",
      r.status::text           AS "status",
      l."createdAt"            AS "at",
      l.action::text           AS "action",
      l."oldData"->>'status'   AS "fromStatus"
    FROM system_logs l
    JOIN rolls r ON r.id::text = l."recordId"
    WHERE l."tableName" = 'ROLL'
      AND r."statusChangedAt" IS NULL
      AND l."newData"->>'status' IS NOT NULL
      AND (
            l.action::text = 'CREATE'
         OR l."oldData"->>'status' IS DISTINCT FROM l."newData"->>'status'
      )
    ORDER BY l."recordId", l."createdAt" DESC
    `,
  );

  // ── 3) KAPSAM DIŞI KALANLAR — raporun güvenilirliğini bu sayı belirler ──────
  // Statüsü final ama audit izi bulunamayan toplar. Bunlar backfill sonrası da
  // NULL kalır → hiçbir dönem raporunda görünmezler.
  const planned = new Set(finalizePlan.map((p) => p.rollId));
  const orphans = await prisma.$queryRawUnsafe<
    Array<{ rollId: string; barcode: string | null; status: string; createdAt: Date }>
  >(
    `
    SELECT r.id AS "rollId", r.barcode, r.status::text AS "status", r."createdAt"
    FROM rolls r
    WHERE r."finalizedAt" IS NULL
      AND r.status::text = ANY($1::text[])
    ORDER BY r."createdAt"
    `,
    FINAL_TARGET,
  );
  const trulyOrphan = orphans.filter((o) => !planned.has(o.rollId));

  // ── RAPOR ───────────────────────────────────────────────────────────────────
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

  console.log(`── finalizedAt: ${finalizePlan.length} top damgalanacak ──`);
  for (const p of finalizePlan) {
    console.log(
      `   ${p.barcode ?? "(barkodsuz)"}  ${fmt(p.at)}  ` +
        `${p.action === "CREATE" ? "DOĞUŞ" : `${p.fromStatus} → `}${p.status}  [${p.rollId}]`,
    );
  }

  console.log(`\n── statusChangedAt: ${statusPlan.length} top damgalanacak ──`);
  for (const p of statusPlan) {
    console.log(`   ${p.barcode ?? "(barkodsuz)"}  ${fmt(p.at)}  → ${p.status}  [${p.rollId}]`);
  }

  if (trulyOrphan.length > 0) {
    console.log(
      `\n⚠️  KAPSAM DIŞI: ${trulyOrphan.length} top final statüde ama audit izi YOK →\n` +
        `    bu toplar backfill sonrası da NULL kalır ve HİÇBİR dönem raporunda görünmez.\n` +
        `    (Sebep: audit best-effort + 6 aylık arşivleme. Elle damgalamak isterseniz\n` +
        `     UPDATE rolls SET "finalizedAt" = '<tarih>' WHERE id = '<id>';)`,
    );
    for (const o of trulyOrphan) {
      console.log(`   ${o.barcode ?? "(barkodsuz)"}  ${o.status}  oluşturma=${fmt(o.createdAt)}  [${o.rollId}]`);
    }
  } else {
    console.log(`\n✅ Kapsam dışı top yok — final statüdeki her topun audit izi bulundu.`);
  }

  if (!APPLY) {
    console.log(
      `\n=== DRY-RUN — hiçbir şey yazılmadı. Yazmak için: --apply ===\n` +
        `    finalizedAt: ${finalizePlan.length} · statusChangedAt: ${statusPlan.length} · kapsam dışı: ${trulyOrphan.length}\n`,
    );
    return;
  }

  // ── YAZ ─────────────────────────────────────────────────────────────────────
  // Ham SQL (yukarıdaki `updatedAt` gerekçesi). Tek tek değil toplu: VALUES
  // listesiyle tek UPDATE (perf kuralı 9'un okuma tarafındaki karşılığı).
  let finalizeWritten = 0;
  if (finalizePlan.length > 0) {
    const values = finalizePlan.map((p) => `('${p.rollId}'::uuid, '${p.at.toISOString()}'::timestamptz)`).join(",");
    const res = await prisma.$executeRawUnsafe(
      `UPDATE rolls r SET "finalizedAt" = v.at
       FROM (VALUES ${values}) AS v(id, at)
       WHERE r.id = v.id AND r."finalizedAt" IS NULL`,
    );
    finalizeWritten = res;
  }

  let statusWritten = 0;
  if (statusPlan.length > 0) {
    const values = statusPlan.map((p) => `('${p.rollId}'::uuid, '${p.at.toISOString()}'::timestamptz)`).join(",");
    const res = await prisma.$executeRawUnsafe(
      `UPDATE rolls r SET "statusChangedAt" = v.at
       FROM (VALUES ${values}) AS v(id, at)
       WHERE r.id = v.id AND r."statusChangedAt" IS NULL`,
    );
    statusWritten = res;
  }

  console.log(
    `\n=== YAZILDI — finalizedAt: ${finalizeWritten} · statusChangedAt: ${statusWritten} ===\n` +
      `    Kapsam dışı kalan: ${trulyOrphan.length} top (yukarıda listelendi).\n`,
  );

  const SCRIPT = "scripts/backfill_roll_production_timestamps.ts";
  const yazildi = await onarimIziYaz({
    script: SCRIPT,
    action: "ROLL_PRODUCTION_TIMESTAMPS_BACKFILL",
    tableName: "ROLL",
    hamSql: true,
    olcum: {
      finalizedAtYazilan: finalizeWritten,
      statusChangedAtYazilan: statusWritten,
      finalizePlani: finalizePlan.length,
      statusPlani: statusPlan.length,
      kapsamDisiOksuz: trulyOrphan.length,
    },
  });
  if (!yazildi) {
    console.error(izDustuUyarisi(SCRIPT, true));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
