// =============================================================================
// BEKÇİ — TOP OPERASYON İZİ GERİ ALINIR, SİLİNMEZ (B-4a, 2026-09-11)
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_operation_revoke
// =============================================================================
// NEDEN: `RollOperation` şema başlığında append-only'ydi ama kod YEDİ yerde
// `deleteMany` ile siliyordu. "Bu topa kurşun uygulandı mı / QC2'den geçti mi /
// fasona gitti mi" sorusunun cevabı geriye dönük DEĞİŞİYORDU — izlenebilirlik
// iddiası çürüktü.
//
// ÖLÇÜLENLER
//   §1 Geri alma satırı SİLMEZ; damga + sebep + aktör yazılır
//   §2 ⭐ PARTIAL UNIQUE: geri alınmış satır DURURKEN aynı (top, adım, tip)
//      üçlüsü YENİDEN yazılabilir — tam unique olsaydı top o adımı bir daha
//      işleyemezdi. Bu maddenin en kritik kontrolü budur.
//   §3 Aktif okuma geri alınmışı GÖRMEZ (ACTIVE_OPERATION tek kaynağı)
//   §4 ⭐ İKİ AKTİF SATIR YAZILAMAZ — partial unique hâlâ sed görevinde
//   §5 AST: `src/`de `rollOperation.deleteMany` KALMADI
//   §6 AST: okuma yüzeyleri `ACTIVE_OPERATION` kullanıyor; üç bilinçli istisna
//      gerekçesiyle işaretli
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RollOperationType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import {
  ACTIVE_OPERATION,
  revokeRollOperations,
} from "../src/services/helpers/roll-operation.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts = Date.now();
const TAG = `TST-ROR-${ts}`;
let rollId = "";
let stepId = "";
let woId = "";

async function main(): Promise<void> {
  console.log("\n=== Top operasyon izi: geri alınır, silinmez ===\n");

  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  const itemId = need(
    await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }),
    "PATOS",
  );
  // ⚠️ Seed kullanıcı adına HAM yaslanılmaz (ortam bağımlılığı tavanı) —
  // bekçi kendi yöneticisini fixture'dan çözer.
  const adminId = (await ensureTestAdmin()).id;
  const stationId = need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "KURSUN_KK2",
  );

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  woId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: "PENDING" },
    select: { id: true },
  });
  stepId = step.id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `${TAG}-R`,
      itemId,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: stepId,
    },
    select: { id: true },
  });
  rollId = roll.id;

  const yaz = () =>
    prisma.rollOperation.create({
      data: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        operatorId: adminId,
      },
      select: { id: true },
    });

  // ── §1 GERİ ALMA SİLMEZ ───────────────────────────────────────────────────
  const ilk = await yaz();
  const n = await prisma.$transaction((tx) =>
    revokeRollOperations(tx, {
      rollIds: [rollId],
      workOrderStepIds: [stepId],
      operationTypes: [RollOperationType.QC2_COMPLETED],
      reason: "BEKCI_TEST",
      userId: adminId,
    }),
  );
  check("§1a Geri alma 1 satır damgaladı (eski deleteMany.count ile aynı anlam)", n === 1, String(n));
  const sonra = await prisma.rollOperation.findUnique({
    where: { id: ilk.id },
    select: { revokedAt: true, revokedById: true, revokeReason: true },
  });
  check("§1b ⭐ Satır DURUYOR (silinmedi)", sonra != null);
  check(
    "§1c Damga sebep ve aktör taşıyor",
    sonra?.revokedAt != null && sonra.revokeReason === "BEKCI_TEST" && sonra.revokedById === adminId,
    String(sonra?.revokeReason),
  );

  // ── §2 PARTIAL UNIQUE — aynı üçlü YENİDEN yazılabilir ─────────────────────
  let ikinciId = "";
  let ikinciHata = "";
  try {
    ikinciId = (await yaz()).id;
  } catch (e) {
    ikinciHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§2 ⭐ Geri alınmış satır DURURKEN aynı (top, adım, tip) YENİDEN yazıldı",
    ikinciId !== "" && ikinciHata === "",
    ikinciHata.slice(0, 80),
  );

  // ── §3 AKTİF OKUMA geri alınmışı görmez ───────────────────────────────────
  const aktif = await prisma.rollOperation.findMany({
    where: { rollId, ...ACTIVE_OPERATION },
    select: { id: true },
  });
  const hepsi = await prisma.rollOperation.count({ where: { rollId } });
  check(
    "§3 Aktif okuma 1 satır görür, tabloda 2 satır var",
    aktif.length === 1 && aktif[0]?.id === ikinciId && hepsi === 2,
    `aktif=${aktif.length} toplam=${hepsi}`,
  );

  // ── §4 İKİ AKTİF SATIR YAZILAMAZ — sed hâlâ görevde ───────────────────────
  let ucuncuHata = "";
  try {
    await yaz();
  } catch (e) {
    ucuncuHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§4 ⭐ İkinci AKTİF satır REDDEDİLDİ (partial unique sed görevinde)",
    ucuncuHata !== "",
    ucuncuHata ? "P2002/unique" : "YAZILDI — sed düşmüş!",
  );

  // ── §5-§6 AST ─────────────────────────────────────────────────────────────
  {
    const SRC = join(__dirname, "..", "src");
    const say = (dizin: string, desen: RegExp): number => {
      let n = 0;
      const yur = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) yur(p);
          else if (e.name.endsWith(".ts") && desen.test(readFileSync(p, "utf8"))) n++;
        }
      };
      yur(dizin);
      return n;
    };
    check(
      "§5 ⭐ `src/`de `rollOperation.deleteMany` KALMADI",
      say(SRC, /rollOperation\.deleteMany\(/) === 0,
    );
    const guard = readFileSync(join(SRC, "services", "helpers", "guarded-hard-remove.ts"), "utf8");
    const backup = readFileSync(join(SRC, "services", "backup-impact.service.ts"), "utf8");
    check(
      "§6 Üç bilinçli istisna gerekçesiyle işaretli (sessiz muaf yok)",
      /revokedAt` SÜZÜLMEZ/.test(guard) && /revokedAt` SÜZÜLMEZ/.test(backup),
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollId) {
      await prisma.rollOperation.deleteMany({ where: { rollId } });
      await prisma.rollMovement.deleteMany({ where: { rollId } });
      await prisma.roll.deleteMany({ where: { id: rollId } });
    }
    if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
    if (woId) await prisma.workOrder.deleteMany({ where: { id: woId } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
