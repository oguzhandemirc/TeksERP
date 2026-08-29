// =============================================================================
// AUDIT REPRO — S-3-01: Tambur "tek parça geri al" (applySingle, ÜRETİM dalı)
// EŞZAMANLI koşarsa aşım koruması boşa düşer → currentQty > initialQty ve
// sapma defterine (TAMBUR_UNDO_RESTORE) HİÇ satır yazılmaz.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//
// Beklenen (sağlıklı sistem):
//   3 paralel `applyUndo(mode:"SINGLE")` sonrası — sıralı koşumla BİREBİR aynı —
//     • currentQty <= initialQty  (test_consistency §13 invariantı)
//     • initialQty yukarı çekildiyse defterde TAMBUR_UNDO_RESTORE/OVERAGE satırı VAR
//
// Gözlenen: <çalıştırınca doldur — log audit/repro/S-3-01.log>
//
// NEDEN BU SENARYO (Tur 3, S3b):
//   `tambur-undo.applySingle` ÜRETİM dalı (satır 1124-1149) aşım korumasını
//   ŞÖYLE kuruyor:
//        parentRow = tx.roll.findUnique(parentId)         ← OKUMA  (kilitsiz)
//        newCurrent = parentRow.currentQty + len
//        initialBump = newCurrent > parentRow.initialQty ? fark : 0
//        tx.roll.updateMany({id, status, currentStepId}, {currentQty:{increment:len}})
//   Yani `initialBump` **okuma ile yazma arasında** hesaplanıyor; satır kilidi
//   ancak `updateMany`de alınıyor. İki/üç kardeş çocuk aynı anda geri alınırsa
//   hepsi AYNI bayat `currentQty`yi okur, hepsi `bump=0` hesaplar, ama
//   `increment` DB-side olduğu için hepsi birikir. Sonuç tam olarak 2026-08-22'de
//   kapatıldığı sanılan §13 ihlali: canlıda 2 satır bu şekilde doğmuştu.
//   Mevcut bekçi `scripts/test_tambur_undo.ts §11` aynı fixture'ı kurar ama
//   undo'ları `for … await` ile SIRALI koşar — kör noktası tam burası.
//
// Çalıştır:
//   cd Teks-Erp && npx tsx scripts/audit_repro_S-3-01.ts 2>&1 \
//     | tee ../audit/repro/S-3-01.log
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
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService, UNDO_FULL_PERMISSION } from "../src/services/tambur-undo.service";
import { readTamburOverQuantityEnabled } from "../src/services/system-setting.service";

const STAMP = `AUDITREPRO-S-3-01-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN = [UNDO_FULL_PERMISSION];

let fail = 0;
const ok = (m: string, x = "") => console.log(`✅ ${m}${x ? " — " + x : ""}`);
const bad = (m: string, x = "") => { fail++; console.log(`❌ ${m}${x ? " — " + x : ""}`); };
const info = (m: string) => console.log(`   ${m}`);

const tambur = new TamburService();
const undo = new TamburUndoService();

/** Bir tur: fixture kur → 3 kesim (aşımlı) → undo'ları verilen kipte koştur. */
async function runRound(
  round: number,
  parallel: boolean,
  itemId: string,
  stationId: string,
): Promise<{ cur: number; init: number; restoreRows: number; errors: string[] }> {
  const tag = `${STAMP}-R${round}${parallel ? "P" : "S"}`;
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${tag}-WO`.slice(0, 40), status: "IN_PROGRESS" },
    select: { id: true },
  });
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId, stepSequence: 1, status: StepStatus.ACTIVE },
    select: { id: true },
  });
  const parent = await prisma.roll.create({
    data: {
      barcode: null, // açık kumaş
      itemId,
      width: 150,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      currentStepId: step.id,
    },
    select: { id: true },
  });

  // 40+40+40 = 120 m → aşım (kayıtlı 100 m). Kaynak currentQty 0'a tıkanır.
  const kids: string[] = [];
  for (const len of [40, 40, 40]) {
    const r = await tambur.cutOpenFabric(parent.id, { lengthMeters: len, status: "WAREHOUSE" });
    kids.push((r.data as { childRoll: { id: string } }).childRoll.id);
  }
  const afterCut = await prisma.roll.findUnique({
    where: { id: parent.id },
    select: { currentQty: true, initialQty: true },
  });
  info(
    `tur ${round} (${parallel ? "PARALEL" : "SIRALI"}): kesim sonrası cur=${afterCut?.currentQty} init=${afterCut?.initialQty}`,
  );

  const errors: string[] = [];
  if (parallel) {
    // ⚠️ AYRI tx'ler paralel — beceri §9.2 meşru eşzamanlılık sondası.
    const res = await Promise.allSettled(
      kids.map((k) => undo.applyUndo(k, undefined, { mode: "SINGLE", permissions: ADMIN })),
    );
    for (const r of res) {
      if (r.status === "rejected") {
        errors.push((r.reason as { message?: string })?.message ?? String(r.reason));
      }
    }
  } else {
    for (const k of kids) {
      try {
        await undo.applyUndo(k, undefined, { mode: "SINGLE", permissions: ADMIN });
      } catch (e) {
        errors.push((e as { message?: string })?.message ?? String(e));
      }
    }
  }

  // ÖLÇÜM COMMIT SONRASI, DB'DEN (dönüş değerine güvenme).
  const after = await prisma.roll.findUnique({
    where: { id: parent.id },
    select: { currentQty: true, initialQty: true },
  });
  const restoreRows = await prisma.rollVariance.count({
    where: { rollId: parent.id, source: "TAMBUR_UNDO_RESTORE" },
  });

  return {
    cur: Number(after?.currentQty ?? 0),
    init: Number(after?.initialQty ?? 0),
    restoreRows,
    errors,
  };
}

async function main(): Promise<void> {
  console.log(`\n=== ${STAMP} — eşzamanlı tekil geri alma, aşım koruması ===\n`);

  const overEnabled = await readTamburOverQuantityEnabled();
  info(`tambur.overQuantityEnabled = ${overEnabled} (varsayılan AÇIK; DEĞİŞTİRİLMEDİ)`);
  if (!overEnabled) {
    bad("Aşım bayrağı KAPALI — bu senaryo bu ortamda koşamaz (bayrağa DOKUNULMAZ)");
    return;
  }

  const item = await prisma.item.create({
    data: { code: `${STAMP}-ITM`.slice(0, 40), name: `${STAMP} kumaş`, itemType: "FABRIC" },
    select: { id: true },
  });
  let ownStationId = "";
  let station = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR, isActive: true },
    select: { id: true },
  });
  if (!station) {
    station = await prisma.station.create({
      data: {
        code: `${STAMP}-T`.slice(0, 40),
        name: `${STAMP} Tambur`,
        type: StationType.INTERNAL,
        kind: StationKind.TAMBUR,
      },
      select: { id: true },
    });
    ownStationId = station.id;
  }

  try {
    // ── KONTROL TURU: sıralı koşumda koruma çalışıyor mu (bekçinin ölçtüğü hal) ──
    const seq = await runRound(0, false, item.id, station.id);
    if (seq.cur <= seq.init && seq.restoreRows === 1) {
      ok("SIRALI koşumda koruma çalışıyor (referans)", `cur=${seq.cur} init=${seq.init} defter=${seq.restoreRows}`);
    } else {
      bad("SIRALI koşumda beklenmedik sonuç — fixture/ortam şüpheli", `cur=${seq.cur} init=${seq.init} defter=${seq.restoreRows}`);
    }

    // ── ASIL SONDA: 10 paralel tur; kaç turda invariant bozuldu? ───────────────
    let broken = 0;
    let silentBroken = 0;
    for (let i = 1; i <= 10; i++) {
      const r = await runRound(i, true, item.id, station.id);
      const inv = r.cur <= r.init;
      const silent = !inv && r.restoreRows === 0;
      if (!inv) broken++;
      if (silent) silentBroken++;
      console.log(
        `   tur ${i}: cur=${r.cur} init=${r.init} defter=${r.restoreRows} ` +
          `hata=${r.errors.length}${inv ? "" : "  ⇐ İHLAL"}${silent ? " (SESSİZ — defterde satır yok)" : ""}`,
      );
    }

    if (broken > 0) {
      bad(
        `PARALEL koşumda ${broken}/10 turda currentQty > initialQty oluştu ` +
          `(${silentBroken} tanesi sapma defterine HİÇ satır yazmadan)`,
      );
    } else {
      ok("PARALEL koşumun 10 turunda invariant bozulmadı — bu ortamda TETİKLENEMEDİ (negatif sonuç)");
      info("Not: negatif sonuç kodun doğru olduğunu KANITLAMAZ; okuma↔yazma arasındaki");
      info("      kilitsiz pencere kodda durmaya devam ediyor (tambur-undo.service.ts:1124-1149).");
    }
  } finally {
    // ── TEMİZLİK — yalnız kendi damgamız, FK sırasına göre ────────────────────
    const wos = await prisma.workOrder.findMany({
      where: { workOrderNumber: { startsWith: STAMP } },
      select: { id: true },
    });
    const woIds = wos.map((w) => w.id);
    const steps = await prisma.workOrderStep.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { itemId: item.id },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    if (rollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (stepIds.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
    if (woIds.length) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (ownStationId) await prisma.station.deleteMany({ where: { id: ownStationId } });
    await prisma.item.deleteMany({ where: { id: item.id } });

    console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => { process.exitCode = fail > 0 ? 1 : 0; },
  (e) => { console.error(e); process.exitCode = 1; },
);
