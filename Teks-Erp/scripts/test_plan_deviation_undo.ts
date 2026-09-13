// =============================================================================
// PLAN-SAPMA GERİ ALMA DAMGASI bekçisi (2026-09-13)
// =============================================================================
// KUSUR: hiçbir geri alma yolu `RollPlanDeviation`a dokunmuyordu. Tümden geri
// alınmış bir kapanışın imzası karnede TAM AĞIRLIKLA duruyordu ve `finalize`
// kaynağında `qtyM` topun TAMAMI olduğu için geri alınıp yeniden finalize edilen
// bir top İKİ tam imza + İKİ tam metraj üretiyordu. İkinci yüz: fason kabulünde
// onaylanmış sapma satırı, kabul iptal edilip doğan top DİRİLTİLDİĞİNDE topa geri
// yapışıyor ve Tambur kapısı soruyu bir daha SORMUYORDU.
//
// ⚠️ TANECİK `confirmationId`, SATIR DEĞİL — bu bekçinin en kritik kontrolü (§1).
// Renk+en birlikte sapan bir geçiş İKİ satır ama BİR imzadır; tek satırı
// damgalamak imzayı YARIM geri alır ve yarım geri alınmış bir imza hiç geri
// alınmamıştan KÖTÜDÜR: karne onu `COUNT(DISTINCT confirmationId)` ile yine
// sayar, yani tutarlı GÖRÜNÜR.
//
// ⚠️ KAPSAM BEYANI — NE ÖLÇÜLÜYOR, NE ÖLÇÜLMÜYOR:
//   §1–§5 DAVRANIŞ ölçer: helper + karne + kapı, gerçek satırlarla.
//   §6 yalnız ŞEKİL ölçer (metin taraması): dört damgalayan dalın çağrıyı
//      İÇERDİĞİNİ ve dört okuyucunun süzgeci TAŞIDIĞINI. Bu bir davranış kanıtı
//      DEĞİLDİR — `applyFull`ın o satıra gerçekten GİRDİĞİNİ ölçmez (bunun için
//      tam bir WO+Tambur kurulumu gerekir; ayrı ve pahalı bir iş).
//      "Basılmayan dalın yeşili" sınıfı: §6 yeşili KAPSAM değil REGRESYON kanıtı.
//
// NEGATİF SONDALAR (yazılırken koşulmalı, dosya sha256 ile geri yüklenerek):
//   ① karnenin `where`inden `ACTIVE_DEVIATION` düşürülür → §3 KIRMIZI
//   ② ham SQL'den `revokedAt IS NULL` düşürülür → §3 gün serisi KIRMIZI
//   ③ kapının `findFirst`inden `ACTIVE_DEVIATION` düşürülür → §4 KIRMIZI
//   ④ `revokePlanDeviationsTx`ten `confirmationId: { in: … }` yerine satır id'si
//      verilir → §1 KIRMIZI (imza yarım damgalanır)
//   ⑤ `applyFull`dan damga çağrısı silinir → §6 KIRMIZI
//
// Koşum: npx tsx scripts/run-all-tests.ts plan_deviation_undo
// DB'YE YAZAR (TEST- damgalı fikstür, `finally`de FK sırasına göre silinir).
// =============================================================================
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import {
  revokePlanDeviationsTx,
  findPlanDeviationConfirmationsTx,
} from "../src/services/helpers/tambur-plan-gate.helper";
import { FASON_RECEIPT_DEVIATION_SOURCE } from "../src/constants/tambur-plan-gate";
import { getPlanDeviationScorecard } from "../src/services/reports/plan-deviation-scorecard.report.service";

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};

const rollIds: string[] = [];
const woIds: string[] = [];
const itemIds: string[] = [];
const colorIds: string[] = [];

const SRC = path.resolve(__dirname, "../src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

(async () => {
  const ts = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  // Dar ve GEÇMİŞ bir pencere: karnenin tek süzgeci tarihtir, "bugün" demek
  // DB'deki her satırı sayıma sokar (mevcut karne bekçisinin öğrendiği ders).
  const base = new Date("2031-04-07T09:00:00.000Z");
  const range = { from: new Date("2031-04-07T00:00:00.000Z"), to: new Date("2031-04-07T23:59:59.999Z") };

  try {
    // ── FİKSTÜR ──────────────────────────────────────────────────────────────
    const item = await prisma.item.create({
      data: { code: `TEST-PDU-I-${ts}`, name: `TEST-PDU Kumaş ${ts}`, itemType: "FABRIC" },
    });
    itemIds.push(item.id);
    const color = await prisma.color.create({
      data: { code: `TEST-PDU-C-${ts}`, name: `TEST-PDU Renk ${ts}` },
    });
    colorIds.push(color.id);
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-PDU-WO-${ts}`, type: "STOCK_PRODUCTION", targetItemId: item.id },
    });
    woIds.push(wo.id);
    const mkRoll = async (suffix: string) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-PDU-${ts}-${suffix}`,
          itemId: item.id,
          colorId: color.id,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.WAREHOUSE,
        },
      });
      rollIds.push(r.id);
      return r;
    };
    const parent = await mkRoll("P");
    const child = await mkRoll("C");

    // İMZA A — renk+en birlikte sapmış: İKİ satır, BİR imza (taneciğin kalbi).
    const confA = randomUUID();
    // İMZA B — çocuğa bağlı tek satır (SINGLE senaryosu).
    const confB = randomUUID();
    // İMZA C — fason kabul onayı (kapı bastırması senaryosu).
    const confC = randomUUID();

    const mkDev = (confirmationId: string, extra: Record<string, unknown>) => ({
      confirmationId,
      rollId: parent.id,
      workOrderId: wo.id,
      qtyM: 100,
      createdAt: base,
      ...extra,
    });
    await prisma.rollPlanDeviation.createMany({
      data: [
        mkDev(confA, { field: "color", rollValue: "A", planValue: "B", source: "finalize" }),
        mkDev(confA, { field: "width", rollValue: "150", planValue: "160", source: "finalize" }),
        mkDev(confB, { field: "color", rollValue: "A", planValue: "B", source: "cut", childRollId: child.id }),
        mkDev(confC, {
          field: "color",
          rollValue: "A",
          planValue: "B",
          source: FASON_RECEIPT_DEVIATION_SOURCE,
        }),
      ],
    });

    // ── §0 POZİTİF KONTROL — senaryo GERÇEKTEN kuruldu mu ────────────────────
    // Vakumda yeşil veren bir kurulum vakumda yeşil verir. Yüklem yeşilinden
    // ÖNCE kurulumun kendisi ölçülür.
    console.log("\n=== 0) Pozitif kontrol: fikstür kuruldu mu ===");
    const built = await prisma.rollPlanDeviation.findMany({
      where: { workOrderId: wo.id },
      select: { confirmationId: true, revokedAt: true },
    });
    ok(built.length === 4, "dört sapma satırı yazıldı", `${built.length}`);
    ok(new Set(built.map((b) => b.confirmationId)).size === 3, "üç ayrı imza", `${new Set(built.map((b) => b.confirmationId)).size}`);
    ok(built.every((b) => b.revokedAt === null), "hepsi yürürlükte doğdu");
    const sc0 = await getPlanDeviationScorecard(range, null);
    ok(sc0.summary.confirmations === 3, "karne kurulumu görüyor (3 imza)", `${sc0.summary.confirmations}`);

    // ── §1 TANECİK: imza bütünlüğü ───────────────────────────────────────────
    console.log("\n=== 1) Tanecik confirmationId — imza BÜTÜN damgalanır ===");
    const foundA = await findPlanDeviationConfirmationsTx(prisma, {
      rollId: parent.id,
      source: "finalize",
    });
    ok(foundA.length === 1 && foundA[0] === confA, "iki satırlı imza TEK confirmationId olarak bulunur", `${foundA.length}`);
    const stampedA = await revokePlanDeviationsTx(prisma, { confirmationIds: foundA, reason: "TAMBUR_UNDO" });
    ok(stampedA === 2, "imza damgalanınca İKİ satır birden damgalandı", `${stampedA}`);
    const rowsA = await prisma.rollPlanDeviation.findMany({ where: { confirmationId: confA } });
    ok(rowsA.length === 2, "⚠️ satırlar SİLİNMEDİ — ileri kayıt ne silinir ne değişir", `${rowsA.length}`);
    ok(rowsA.every((r) => r.revokedAt !== null), "iki satırın İKİSİ de damgalı (yarım imza yok)");
    ok(rowsA.every((r) => r.revokeReason === "TAMBUR_UNDO"), "sebep satıra yazıldı");
    ok(rowsA.every((r) => Number(r.qtyM) === 100 && r.field !== null), "içerik DEĞİŞMEDİ (yalnız damga)");

    // ── §2 İDEMPOTENCY: revokedAt:null yüklemi ───────────────────────────────
    console.log("\n=== 2) Çift geri alma ikinci kez damgalamaz ===");
    const again = await revokePlanDeviationsTx(prisma, { confirmationIds: [confA], reason: "TAMBUR_UNDO" });
    ok(again === 0, "ikinci damga 0 satır etkiler (revokedAt:null yüklemi)", `${again}`);
    const reFound = await findPlanDeviationConfirmationsTx(prisma, { rollId: parent.id, source: "finalize" });
    ok(reFound.length === 0, "damgalı imza bir daha kümeye GİRMEZ (undo→refinalize→undo döngüsü)", `${reFound.length}`);

    // ── §3 KARNE damgalıyı saymaz — ÜÇ sorgunun ÜÇÜ de ───────────────────────
    console.log("\n=== 3) Karne: damgalı imza sayılmaz (üç sorgu) ===");
    const sc = await getPlanDeviationScorecard(range, range);
    ok(sc.summary.confirmations === 2, "imza sayısı 3 → 2 düştü", `${sc.summary.confirmations}`);
    ok(sc.summary.deviatedQtyM === 200, "metraj imza başına tek ve damgalı hariç", `${sc.summary.deviatedQtyM}`);
    ok(sc.summary.byField.color.events === 2 && sc.summary.byField.width.events === 0,
      "alan kırılımı da temizlendi (damgalı 'width' satırı düştü)",
      `color=${sc.summary.byField.color.events} width=${sc.summary.byField.width.events}`);
    const dayTotal = sc.daily.reduce((a, d) => a + d.confirmations, 0);
    ok(dayTotal === 2, "GÜN SERİSİ (ham SQL) da damgalıyı saymıyor", `${dayTotal}`);
    ok(sc.previous?.confirmations === 2, "KARŞILAŞTIRMA dönemi sorgusu da süzüyor", `${sc.previous?.confirmations}`);

    // ── §4 KAPI: damgalı fason onayı soruyu BASTIRMAZ ────────────────────────
    console.log("\n=== 4) Tambur kapısı: damgalı fason onayı bastırmaz ===");
    const beforeSuppress = await prisma.rollPlanDeviation.findFirst({
      where: { revokedAt: null, rollId: parent.id, source: FASON_RECEIPT_DEVIATION_SOURCE },
      select: { id: true },
    });
    ok(beforeSuppress !== null, "damgadan ÖNCE kapı onayı buluyor (pozitif kontrol)");
    await revokePlanDeviationsTx(prisma, { confirmationIds: [confC], reason: "FASON_KABUL_IPTAL" });
    const afterSuppress = await prisma.rollPlanDeviation.findFirst({
      where: { revokedAt: null, rollId: parent.id, source: FASON_RECEIPT_DEVIATION_SOURCE },
      select: { id: true },
    });
    ok(afterSuppress === null, "damgadan SONRA bulamıyor ⇒ soru yeniden sorulur");

    // ── §5 SINGLE: çocuğa bağlı imza damgalanır, finalize imzası DOKUNULMAZ ──
    console.log("\n=== 5) SINGLE: yalnız çocuğa bağlı imza ===");
    const childConfs = await findPlanDeviationConfirmationsTx(prisma, { childRollId: child.id });
    ok(childConfs.length === 1 && childConfs[0] === confB, "çocuk yüklemi yalnız kendi imzasını bulur", `${childConfs.length}`);
    ok(!childConfs.includes(confA), "⛔ finalize imzası (childRollId NULL) kümeye GİRMEZ — topun geri kalanı hâlâ sapan kimlikle depoda");

    // ── §6 ŞEKİL: dört dal çağırıyor, dört okuyucu süzüyor ───────────────────
    console.log("\n=== 6) Şekil taraması (⚠️ davranış kanıtı DEĞİL) ===");
    const undoSrc = read("services/tambur-undo.service.ts");
    const subSrc = read("services/subcontractor.service.ts");
    const stampCalls =
      (undoSrc.match(/revokePlanDeviationsTx\(/g) ?? []).length +
      (subSrc.match(/revokePlanDeviationsTx\(/g) ?? []).length;
    ok(stampCalls >= 4, "dört damgalayan dal çağrıyı içeriyor (FULL · SINGLE · SINGLE_RESTORE · cancelReceipt)", `${stampCalls}`);
    const scoreSrc = read("services/reports/plan-deviation-scorecard.report.service.ts");
    ok((scoreSrc.match(/ACTIVE_DEVIATION/g) ?? []).length >= 2, "karnenin iki Prisma sorgusu süzgeci taşıyor");
    ok(/revokedAt"?\s+IS NULL/.test(scoreSrc), "karnenin HAM SQL'i de süzüyor");
    ok(/ACTIVE_DEVIATION/.test(read("services/helpers/tambur-plan-gate.helper.ts")), "kapı süzgeci taşıyor");

    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  } finally {
    // FK sırası: sapma → top → iş emri → katalog.
    await prisma.rollPlanDeviation.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.$disconnect();
  }
  process.exit(fail > 0 ? 1 : 0);
})();
