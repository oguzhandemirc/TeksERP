// =============================================================================
// BEKÇİ — İŞ EMRİ TERMİNALE DÜŞERKEN YARIŞ (2026-08-29 / T1-003 + T1-004)
// Çalıştır: npx tsx scripts/test_wo_terminal_race.ts
// =============================================================================
// İki ayrı yol, AYNI kusur: iş emrinin durumu transaction DIŞINDA okunuyordu ve
// iş emri satırı hiç kilitlenmiyordu. Planlamacı iptal ederken (ölçülen pencere
// 6 ms) READ COMMITTED altında diğer istek hâlâ IN_PROGRESS görüyor, kapıyı
// geçiyor ve topu İPTAL EDİLMİŞ iş emrinin adımına canlı bırakıyordu:
//   • hiçbir istasyon okutamaz (refakat kartı VOIDED),
//   • envanter ve Üretim Akışı panosu topu üretimde sayar,
//   • depo ekranında görünmez, iş emri iptal göründüğü için kimse aramaz,
//   • çıkış yolu yalnız `roll:manual-adjust` yetkili "Kurtar".
// Her iki istek de 200 alıyordu — hiçbir alarm yok.
//
// §1 TAMBUR GERİ ALMA ∥ İPTAL   (T1-003)  — değişmez
// §3 PROTOKOL (metin)                      — kilit tx'in İLK işi
//    ⚠️ §1/§2 yarışı ZORLAYAMIYOR (ölçüldü). Gerçek tetikleyici ölçüm denetimin
//    repro'larıdır ve `npm test`'te koşmaz — pakette duran güvence §3'tür.
// §2 TOP BAĞLAMA ∥ İPTAL        (T1-004)
// Her ikisinde de ölçülen DEĞİŞMEZ aynı:
//   "IN_PRODUCTION top ⇒ bağlı olduğu iş emri TERMİNAL DEĞİL"
// Sonuç zamanlamaya bağlıdır (kim önce commit ederse) — o yüzden hangi isteğin
// kazandığı DEĞİL, değişmezin korunduğu ölçülür.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { RollStatus, WorkOrderStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts = Date.now();
const woIds: string[] = [];
const rollIds: string[] = [];
let itemId = "";
let stationId = "";
let userId = "";

async function isEmri(tag: string): Promise<{ id: string; stepId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TEST-WTR-${tag}-${ts}`,
      status: WorkOrderStatus.IN_PROGRESS,
      type: "STOCK_PRODUCTION",
      targetItemId: itemId,
      steps: { create: [{ stationId, stepSequence: 1, status: "ACTIVE" }] },
    },
    select: { id: true, steps: { select: { id: true } } },
  });
  woIds.push(wo.id);
  return { id: wo.id, stepId: wo.steps[0].id };
}

/** Bağlı iş emri terminal olan CANLI top — ihlalin tanımı. */
async function ihlalSayisi(woId: string): Promise<number> {
  return prisma.roll.count({
    where: {
      status: RollStatus.IN_PRODUCTION,
      currentStep: { workOrderId: woId },
    },
  });
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `TST-WTR-${ts}`, name: `Test WO Yarış ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;
  // ⚠️ TAMBUR istasyonu ŞART: `cutOpenFabric` topun Tambur adımında olmasını
  // arar (ilk yazımda herhangi bir INTERNAL istasyon seçilmişti ve fixture
  // "Roll Tambur step'inde değil (RAW_QC)" ile düşüyordu — bekçi ürünü değil
  // kendi kurulumunu ölçmüş olurdu).
  const st = await prisma.station.findFirst({
    where: { isActive: true, kind: "TAMBUR" },
    select: { id: true },
  });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  check("fixture hazır (TAMBUR istasyonu + admin)", Boolean(st && admin));
  if (!st || !admin) return;
  stationId = st.id;
  userId = admin.id;

  const svc = new WorkOrderService();

  // ═══ §1 — Tambur geri alma ∥ iş emri iptali ═══
  console.log("\n=== §1: geri alma ∥ iptal (T1-003) ===");
  {
    const wo = await isEmri("A");
    const kaynak = await prisma.roll.create({
      data: {
        barcode: `TST-WTR-A-${ts}`,
        itemId,
        initialQty: 100,
        currentQty: 100,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: wo.stepId,
      },
      select: { id: true },
    });
    rollIds.push(kaynak.id);
    // Kesim → geri alınabilir bir çocuk doğsun.
    const kesim = await new TamburService().cutOpenFabric(
      kaynak.id,
      { lengthMeters: 40, status: "WAREHOUSE" },
      userId,
    ).catch((e) => { console.log("   kesim hatası:", (e as Error).message.slice(0, 90)); return null; });
    if (!kesim) {
      check("§1: kesim fixture'ı kuruldu", false, "cutOpenFabric düştü — senaryo kurulamadı");
    } else {
      const cocuk = (kesim.data as { childRoll: { id: string } }).childRoll;
      rollIds.push(cocuk.id);
      check("§1: kesim fixture'ı kuruldu", true, "çocuk doğdu");

      const sonuc = await Promise.allSettled([
        new TamburUndoService().applyUndo(cocuk.id, userId, { mode: "SINGLE_RESTORE" }),
        svc.softDelete(wo.id, userId, { reason: "yarış sondası" }),
      ]);
      const basarili = sonuc.filter((r) => r.status === "fulfilled").length;
      check("§1: en az biri sonuçlandı", basarili >= 1, `${basarili}/2 başarılı`);
      const woSon = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } });
      const ihlal = await ihlalSayisi(wo.id);
      check(
        "§1: DEĞİŞMEZ korundu — terminal iş emrinde CANLI top yok",
        woSon?.status !== WorkOrderStatus.CANCELLED || ihlal === 0,
        `WO ${woSon?.status} · canlı top ${ihlal}`,
      );
    }
  }

  // ═══ §2 — top bağlama ∥ iş emri iptali ═══
  console.log("\n=== §2: top bağlama ∥ iptal (T1-004) ===");
  {
    const wo = await isEmri("B");
    const depoToplari = await Promise.all(
      [1, 2, 3].map((i) =>
        prisma.roll.create({
          data: {
            barcode: `TST-WTR-B${i}-${ts}`,
            itemId,
            initialQty: 50,
            currentQty: 50,
            status: RollStatus.WAREHOUSE,
            finalizedAt: new Date(),
          },
          select: { id: true },
        }),
      ),
    );
    depoToplari.forEach((r) => rollIds.push(r.id));

    const sonuc = await Promise.allSettled([
      svc.attachRolls(wo.id, depoToplari.map((r) => r.id), userId),
      svc.softDelete(wo.id, userId, { reason: "yarış sondası" }),
    ]);
    const basarili = sonuc.filter((r) => r.status === "fulfilled").length;
    check("§2: en az biri sonuçlandı", basarili >= 1, `${basarili}/2 başarılı`);
    const woSon = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } });
    const ihlal = await ihlalSayisi(wo.id);
    check(
      "§2: DEĞİŞMEZ korundu — terminal iş emrinde CANLI top yok",
      woSon?.status !== WorkOrderStatus.CANCELLED || ihlal === 0,
      `WO ${woSon?.status} · canlı top ${ihlal}`,
    );
    // İptal kazandıysa toplar depoda kalmalı (bağlanmamış olmalı).
    if (woSon?.status === WorkOrderStatus.CANCELLED) {
      const depodaKalan = await prisma.roll.count({
        where: { id: { in: depoToplari.map((r) => r.id) }, currentStepId: null },
      });
      check(
        "§2: iptal kazandıysa toplar DEPODA kaldı",
        depodaKalan === 3,
        `${depodaKalan}/3 top serbest`,
      );
    } else {
      check("§2: bağlama kazandı — iş emri canlı, top bağlı (meşru)", true, woSon?.status ?? "");
    }
  }

  // ═══ §3 — PROTOKOL: kilit tx'in İLK işi mi (metin) ═══
  // ⚠️ NEDEN METİN: yukarıdaki iki bölüm DEĞİŞMEZİ ölçüyor ama yarışı ZORLAYAMIYOR
  // (ölçüldü: kilit kaldırılınca da yeşil kaldılar — `Promise.allSettled` iki
  // tx'i doğru anda çakıştıramıyor). Yarışı gerçekten tetikleyen ölçüm denetimin
  // repro script'leridir ve onlar `npm test`'te KOŞMAZ:
  //     npx tsx scripts/audit_repro_KYY-1-01.ts   → kilitsiz 7/16 ihlal, kilitli 0
  //     npx tsx scripts/audit_repro_KYY-3-04.ts   → kilitsiz 1 ihlal,   kilitli 0
  // Bu yüzden pakette duran güvence PROTOKOLDÜR: kilit, tx'in ilk işi olmalı.
  // Sıra bozulursa (kilit aşağı kayarsa) pencere geri açılır ve hiçbir davranış
  // testi bunu göremez.
  console.log("\n=== §3: protokol — kilit tx'in İLK işi mi ===");
  const hedefler: Array<{ dosya: string; txMarker: string; kilit: string }> = [
    {
      dosya: "../src/services/tambur-undo.service.ts",
      txMarker: "const result = await prisma.$transaction(async (tx) => {",
      kilit: "await this.lockAndAssertWorkOrderLive(",
    },
    {
      dosya: "../src/services/workorder.service.ts",
      txMarker: "const { attached, errorMessages, batchRes } = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {",
      kilit: "await touchWorkOrderTx(",
    },
    {
      dosya: "../src/services/workorder-manual-move.service.ts",
      txMarker: "prisma.$transaction(async (tx) => {",
      kilit: "await touchWorkOrderTx(",
    },
  ];
  for (const h of hedefler) {
    const src = readFileSync(join(__dirname, h.dosya), "utf8");
    const adi = h.dosya.split("/").pop();
    let i = src.indexOf(h.txMarker);
    // KÖRLÜK ZEMİNİ: işaret bulunamazsa "ihlal yok" ile "hiçbir şeye bakılmadı"
    // aynı yeşile çıkardı.
    check(`§3: ${adi} tx açılışı bulundu (körlük zemini)`, i >= 0);
    let tumIyi = i >= 0;
    let sayac = 0;
    while (i >= 0) {
      sayac++;
      const govde = src.slice(i + h.txMarker.length, i + h.txMarker.length + 1400);
      const kilitIdx = govde.indexOf(h.kilit);
      // İlk "tx." kullanımı — kilit ondan ÖNCE gelmeli.
      const ilkTx = govde.search(/await\s+tx\./);
      if (kilitIdx < 0 || (ilkTx >= 0 && kilitIdx > ilkTx)) tumIyi = false;
      i = src.indexOf(h.txMarker, i + 1);
    }
    check(
      `§3: ${adi} — ${sayac} tx'in HEPSİNDE kilit ilk iş`,
      tumIyi,
      tumIyi ? `${sayac} tx` : "kilit ilk iş DEĞİL ya da hiç yok",
    );
  }
}

async function cleanup(): Promise<void> {
  const hepsi = await prisma.roll.findMany({ where: { itemId }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...rollIds, ...hepsi.map((r) => r.id)])];
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
