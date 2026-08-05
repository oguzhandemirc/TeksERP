// =============================================================================
// GERİYE DOLDURMA — Roll.entryStationId (giriş istasyonu)
// =============================================================================
// Çalıştır (ÖNİZLEME — hiçbir şey yazmaz):
//   npx tsx scripts/backfill_roll_entry_station.ts
// Uygula:
//   npx tsx scripts/backfill_roll_entry_station.ts --apply
//
// DRY-RUN VARSAYILAN (kök CLAUDE.md: toplu veri düzeltmesi yapan script
// dry-run başlar ve `--apply` öncesi etkilenecek HER kaydı somut listeler).
//
// -----------------------------------------------------------------------------
// KAYNAK ÖNCELİĞİ — SIRA LOAD-BEARING
// -----------------------------------------------------------------------------
//  1) ÇALIŞMA OTURUMU (`work_sessions`): topun `createdMachineId`i + `createdAt`i
//     hangi oturumun penceresine düşüyorsa o oturumun `stationId`i. En güvenilir
//     kaynak: oturum istasyonu açılışta DONDURULUR, makine taşınsa da değişmez.
//  2) FASON MAKBUZU (`parentReceiptId` → `subcontractor_receipts.stepId` →
//     `work_order_steps.stationId`). Yapısal ve kesin; `stepId` NOT NULL.
//  3) `producedInStepId` → **YALNIZ DAR KOŞULLA**.
//
// ⚠️ 3. KAYNAK NEDEN TEHLİKELİ: `producedInStepId` bir DOĞUM İZİ DEĞİLDİR.
// `attachRolls` onu iş emrinin İLK adımıyla EZER, `detachRolls` NULL'lar.
// Ölçüldü (dev DB): KK1'den ve Electron panelinden girilmiş 5 top, bu alan
// üzerinden bakılırsa "Boyahane (Fason)"da doğmuş görünüyor. Bu yüzden yalnız
// `entrySource ∈ {TAMBUR_SPLIT, SUBCONTRACTOR_RETURN}` VE hedef istasyonun
// türü beklenen değerse (TAMBUR / SUBCONTRACTOR) kullanılır.
//
// -----------------------------------------------------------------------------
// KULLANILMAYAN İKİ KAYNAK (bilinçli)
// -----------------------------------------------------------------------------
//  • EN ERKEN `RollMovement` — KK1 girişi hiç movement üretmez; bu zincir
//    "giriş istasyonu"nu değil "ilk ÜRETİM adımı"nı verir. Depoda duran ham bir
//    top yeni bir iş emrine sokulduğunda geçmişi yeniden yazardı.
//  • `Machine.stationId` — canlı FK; panelden değiştirilebilir ve geçmişi
//    geriye dönük bozar. Kolonun var olma sebebi tam olarak budur.
//
// -----------------------------------------------------------------------------
// GÜVENLİK
// -----------------------------------------------------------------------------
//  • DOLU kolonu ASLA ezmez (`entryStationId: null` süzgeci) → idempotent.
//  • Her yazım için audit kaydı bırakır: değerin KAYNAĞI da saklanır, yoksa
//    "bu istasyon ölçülmüş mü türetilmiş mi" sorusu bir daha cevaplanamaz.
//  • Chunk'lı çalışır (`statement_timeout=50s`).
//  • Vardiya dışında koşturun (canlı DB).
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";

const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

type Source = "SESSION" | "RECEIPT" | "PRODUCED_STEP";

interface Plan {
  rollId: string;
  barcode: string | null;
  entrySource: string;
  createdAt: Date;
  stationId: string;
  stationName: string;
  source: Source;
}

/** `producedInStepId` yalnız bu eşleşmelerde güvenilir sayılır. */
const PRODUCED_OK: Record<string, string[]> = {
  TAMBUR_SPLIT: ["TAMBUR"],
  SUBCONTRACTOR_RETURN: ["SUBCONTRACTOR"],
};

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "⚠️  UYGULAMA MODU — kayıtlar YAZILACAK\n"
      : "ÖNİZLEME (dry-run) — hiçbir şey yazılmayacak. Uygulamak için: --apply\n",
  );

  const targets = await prisma.roll.findMany({
    where: { entryStationId: null },
    select: {
      id: true,
      barcode: true,
      entrySource: true,
      createdAt: true,
      createdMachineId: true,
      parentReceiptId: true,
      producedInStepId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Kolonu BOŞ olan top sayısı: ${targets.length}\n`);
  if (targets.length === 0) {
    console.log("Yapılacak iş yok.");
    return;
  }

  const plans: Plan[] = [];
  const unresolved: Array<{ barcode: string | null; entrySource: string; why: string }> = [];

  for (const r of targets) {
    let stationId: string | null = null;
    let source: Source | null = null;

    // ── 1) OTURUM ────────────────────────────────────────────────────────────
    if (r.createdMachineId) {
      const ws = await prisma.workSession.findFirst({
        where: {
          machineId: r.createdMachineId,
          startedAt: { lte: r.createdAt },
          OR: [{ endedAt: null }, { endedAt: { gte: r.createdAt } }],
        },
        select: { stationId: true },
        orderBy: { startedAt: "desc" },
      });
      if (ws) {
        stationId = ws.stationId;
        source = "SESSION";
      }
    }

    // ── 2) FASON MAKBUZU ─────────────────────────────────────────────────────
    if (!stationId && r.parentReceiptId) {
      const rec = await prisma.subcontractorReceipt.findUnique({
        where: { id: r.parentReceiptId },
        select: { step: { select: { stationId: true } } },
      });
      if (rec?.step?.stationId) {
        stationId = rec.step.stationId;
        source = "RECEIPT";
      }
    }

    // ── 3) producedInStepId — DAR KOŞUL ──────────────────────────────────────
    if (!stationId && r.producedInStepId) {
      const allowedKinds = PRODUCED_OK[r.entrySource];
      if (allowedKinds) {
        const st = await prisma.workOrderStep.findUnique({
          where: { id: r.producedInStepId },
          select: { stationId: true, station: { select: { kind: true } } },
        });
        // Tür beklenen değilse ATLA: bu, alanın `attachRolls` ile ezilmiş
        // olduğunun işaretidir ve yazmak yanlış istasyon damgalamaktır.
        if (st?.station?.kind && allowedKinds.includes(st.station.kind)) {
          stationId = st.stationId;
          source = "PRODUCED_STEP";
        }
      }
    }

    if (!stationId || !source) {
      unresolved.push({
        barcode: r.barcode,
        entrySource: r.entrySource,
        why:
          r.entrySource === "MANUAL_ENTRY"
            ? "panelden giriş — NULL doğru cevap"
            : "izlenebilir kaynak yok",
      });
      continue;
    }

    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: { name: true },
    });
    plans.push({
      rollId: r.id,
      barcode: r.barcode,
      entrySource: r.entrySource,
      createdAt: r.createdAt,
      stationId,
      stationName: station?.name ?? "?",
      source,
    });
  }

  // ── RAPOR — her kayıt SOMUT listelenir ─────────────────────────────────────
  console.log(`ÇÖZÜLEN: ${plans.length} · ÇÖZÜLEMEYEN: ${unresolved.length}\n`);
  console.log("── Yazılacak kayıtlar ──");
  for (const p of plans) {
    console.log(
      `  ${(p.barcode ?? "(barkodsuz)").padEnd(18)} ${p.entrySource.padEnd(22)} ` +
        `${p.createdAt.toISOString().slice(0, 16)}  →  ${p.stationName}  [${p.source}]`,
    );
  }
  if (unresolved.length > 0) {
    console.log("\n── Çözülemeyen (NULL kalacak) ──");
    const byWhy = new Map<string, number>();
    for (const u of unresolved) byWhy.set(u.why, (byWhy.get(u.why) ?? 0) + 1);
    for (const [why, n] of byWhy) console.log(`  ${n} top — ${why}`);
  }

  const bySource = new Map<Source, number>();
  for (const p of plans) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);
  console.log("\n── Kaynak dağılımı ──");
  for (const [src, n] of bySource) console.log(`  ${src}: ${n}`);

  if (!APPLY) {
    console.log("\nÖNİZLEME bitti — hiçbir şey yazılmadı. Uygulamak için --apply ekleyin.");
    return;
  }

  // ── UYGULA ────────────────────────────────────────────────────────────────
  console.log("\nYazılıyor...");
  let written = 0;
  for (let i = 0; i < plans.length; i += CHUNK) {
    const slice = plans.slice(i, i + CHUNK);
    for (const p of slice) {
      // `entryStationId: null` koşulu İDEMPOTANS güvencesi: script iki kez
      // koşarsa ikinci turda hiçbir satır güncellenmez ve dolu değer EZİLMEZ.
      const res = await prisma.roll.updateMany({
        where: { id: p.rollId, entryStationId: null },
        data: { entryStationId: p.stationId },
      });
      if (res.count > 0) {
        written += res.count;
        // Değerin KAYNAĞI da saklanır — "bu istasyon ölçülmüş mü türetilmiş mi"
        // sorusu sonradan sorulacak ve kolon tek başına cevaplayamaz.
        await AuditService.log({
          // Script bir KULLANICI adına koşmuyor — sistem işlemi.
          userId: undefined,
          action: "UPDATE",
          tableName: "ROLL",
          recordId: p.rollId,
          newData: {
            event: "BACKFILL_ENTRY_STATION",
            entryStationId: p.stationId,
            stationName: p.stationName,
            source: p.source,
            entrySource: p.entrySource,
          },
        });
      }
    }
    console.log(`  ${Math.min(i + CHUNK, plans.length)}/${plans.length}`);
  }
  console.log(`\n✅ ${written} kayıt güncellendi.`);
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
