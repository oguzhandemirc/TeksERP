// =============================================================================
// Test: TOP İPTALİ, TOPUN GEÇTİĞİ *KAPALI* HAREKETLİ ADIMLARI DA YENİDEN HESAPLAR
// Çalıştır: npx tsx scripts/test_roll_cancel_step_recompute.ts
// =============================================================================
// SAHA VAKASI (IE0608260004, canlı veride salt-okunur doğrulandı):
//   06 Ağu       T080826F0001 "Kurşun + KK2" adımından ÇIKTI → hareket KAPANDI,
//                adım COMPLETED oldu (o adımın tek canlı topuydu).
//   08 Ağu       iş emri kapanış dispozisyonu topu WAREHOUSE'a çekti →
//                currentStepId = null, açık hareket KALMADI.
//   08 Ağu +22sn top iptal edildi (softDelete).
//   Sonuç:       affectedStepIds = (açık hareketlerin adımları) ∪ (currentStepId)
//                = BOŞ → recomputeStepStatus HİÇ KOŞMADI → adım bayat COMPLETED
//                kaldı. Türetilen doğru değer PENDING idi. Hata yok, log yok;
//                drift'i yalnız test_consistency §20 gösteriyordu (1 satır).
//
// KÖK NEDEN: inventory.service.ts softDelete, kapsamı topun ŞU ANKİ konumundan
// kuruyordu. Oysa roll-step.helper.ts recomputeStepStatus topun statüsünü ÜÇ
// yerden okur: openCount (açık hareket) · closedCount (KAPALI hareket) ·
// pendingRolls (aynı iş emrinde bu adıma HENÜZ GELMEMİŞ canlı top). Doğru kapsam
// "hareketin adımı" değil "hareketin İŞ EMRİNİN SKIPPED-dışı tüm adımları"dır.
// Düzeltme: services/helpers/roll-step-scope.helper.ts (collectRollStepScopeTx),
// üç çağırana da uygulandı (softDelete · hardDelete · [restore = guard'lı, N/A]).
//
// Doğrulananlar:
//   1. ÖN KOŞUL / körlük zemini — senaryolar gerçekten "eski kapsam BOŞ" hâlini
//      kuruyor mu (kurmuyorsa asıl iddia vakumen yeşil kalır).
//   2. ASIL İDDİA — kapalı hareketli adım iptalde PENDING'e çekilir.
//   3. REGRESYON — açık hareketli adım yolu bozulmadı, hareket notu EZİLMEZ.
//   4. KAPSAM DAR — başka canlı topu olan adım DÜŞMEZ (fazladan iş yok).
//   5. TERMİNAL WO DİRİLTİLMEZ — ensureWorkOrderInProgress yalnız PLANNED'ı
//      hedefler; ayrıca iptal hiçbir adımı ACTIVE'e ÇEVİRMEZ.
//   6. hardDelete ("Arşivle") — aynı boşluğun daha kötü kopyası kapandı.
//   7. restoreCancelledRoll — hareketli top zaten REDDEDİLİYOR (boşluk yok);
//      guard gevşetilirse aynı hata sıfır kodla geri gelir, bu yüzden kilitli.
//   8. Yardımcının kendi sözleşmesi — dedup · SKIPPED dışlama · çok-WO · boş girdi.
//   9. DİSPOZİSYON MOTORU (`applyRollDispositionsTx`) — aynı §20 sınıfı üç ana
//      operatör akışında (WO kapatma · WO iptali · parti düşürme). 2026-08-15
//      denetiminde bu üç yol HİÇ recompute çağırmıyordu, yani saha vakası
//      "düzeltilmiş" sanılan yerin dışından üretilmeye devam ediyordu.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" ÖLÇÜLDÜ (2026-08-15; her sondadan
// sonra dosyalar md5 ile birebir geri yüklendi — e87817c0… / 1fe1614b…):
//   S1 softDelete kapsamı ESKİ hâline çevrildi (açık hareket + currentStepId)
//      → 5 kontrol KIRMIZI: [2] iki adım + completedAt + audit izi, [3] üst adım
//   S2 hardDelete recompute'u eski "if (existing.currentStepId)" dalına kondu
//      → 1 kontrol KIRMIZI: [6] "arşivleme kapalı hareketli adımı da düzeltti"
//      (⚠️ [6b] YEŞİL kalır — orada currentStepId dolu, yani eski dal koşuyor;
//       boşluğu gösteren tek senaryo currentStepId'si NULL olan STOCK toptur)
//   S3 hardDelete not koruması kaldırıldı (körlemesine "ARCHIVED")
//      → 1 kontrol KIRMIZI: [6b] "arşivlemede eski not korunuyor"
//   S4 kapsam yardımcısından SKIPPED dışlaması silindi
//      → 1 kontrol KIRMIZI: [1] "SKIPPED adımı DIŞLIYOR"
//   S5 kapsam "iş emrinin adımları" yerine "hareketin adımları"na daraltıldı
//      → 1 kontrol KIRMIZI: [8] "hareketi OLMAYAN kardeş adımı da içeriyor"
//   S6 (2026-08-15 denetim turu) `applyRollDispositionsTx` sonundaki recompute
//      döngüsü silindi → **2 kontrol KIRMIZI**: [9] üst adım COMPLETED kaldı,
//      [9] topun bulunduğu adım ACTIVE kaldı
//   S7 (aynı tur) softDelete kapsamı ESKİ hâline çevrildi (S1'in tekrarı, taze
//      ölçüm) → **5 kontrol KIRMIZI** — S1 ile birebir aynı beş kontrol
// Her sondadan sonra dosyalar md5 ile birebir geri yüklendi
// (roll-disposition.helper e869038b… · inventory.service 37adf2fa…).
// =============================================================================

import { randomUUID } from "crypto";
import {
  RollStatus,
  StepStatus,
  WorkOrderStatus,
  type Prisma,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { collectRollStepScopeTx } from "../src/services/helpers/roll-step-scope.helper";
import { ensureWorkOrderInProgress } from "../src/services/helpers/roll-step.helper";
import { applyRollDispositionsTx } from "../src/services/helpers/roll-disposition.helper";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Fixture yoksa SESSİZ ATLAMA yok — açıkça patla. */
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

/** Mesaj-parçası eşleşmeli reddetme kontrolü. */
async function expectErr(label: string, part: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu, geçti");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, m.includes(part), m.slice(0, 90));
  }
}

const inventory = new InventoryService();

// ── Fixture defteri (finally'de FK sırasına göre sökülür) ────────────────────
const woIds: string[] = [];
const rollIds: string[] = [];
const itemIds: string[] = [];
const stamp = `${process.pid}${randomUUID().slice(0, 6)}`;
let seq = 0;

interface StepSpec {
  seq: number;
  status: StepStatus;
}

async function makeWo(
  woStatus: WorkOrderStatus,
  steps: StepSpec[],
  stationIds: string[],
  itemId: string,
): Promise<{ id: string; stepIdBySeq: Record<number, string> }> {
  seq += 1;
  const now = new Date();
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TEST-RCSR-${stamp}-${seq}`,
      type: "STOCK_PRODUCTION",
      status: woStatus,
      targetItemId: itemId,
      steps: {
        create: steps.map((s, i) => ({
          stationId: need(stationIds[i % stationIds.length], "istasyon"),
          stepSequence: s.seq,
          status: s.status,
          // CHECK work_order_steps_time_order: completedAt >= startedAt.
          startedAt: s.status === StepStatus.PENDING ? null : now,
          completedAt: s.status === StepStatus.COMPLETED ? now : null,
        })),
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  woIds.push(wo.id);
  const stepIdBySeq: Record<number, string> = {};
  for (const s of wo.steps) stepIdBySeq[s.stepSequence] = s.id;
  return { id: wo.id, stepIdBySeq };
}

async function makeRoll(
  itemId: string,
  status: RollStatus,
  currentStepId: string | null = null,
): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      // Stok kumesinden cikabilmek icin deposu DOLU olmali (K6 kapisi):
      // uretimde deposuz top dogamaz, fikstur de uretmemeli.
      warehouseId: await fixtureWarehouseId(),
      barcode: `TEST-RCSR-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`,
      itemId,
      initialQty: 100,
      currentQty: 100,
      status,
      entrySource: "SUPPLIER_RECEIPT",
      currentStepId,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function addMovement(
  rollId: string,
  stepId: string,
  opts: { closed: boolean; notes?: string },
): Promise<void> {
  await prisma.rollMovement.create({
    data: {
      rollId,
      workOrderStepId: stepId,
      qtyIn: 100,
      qtyOut: opts.closed ? 100 : null,
      exitedAt: opts.closed ? new Date() : null,
      notes: opts.notes ?? null,
    },
  });
}

async function stepStatus(stepId: string): Promise<StepStatus> {
  const s = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: stepId },
    select: { status: true },
  });
  return s.status;
}

async function woStatus(id: string): Promise<WorkOrderStatus> {
  const w = await prisma.workOrder.findUniqueOrThrow({
    where: { id },
    select: { status: true },
  });
  return w.status;
}

/** ESKİ (hatalı) kapsam: açık hareketlerin adımları + currentStepId. */
async function legacyScopeSize(rollId: string): Promise<number> {
  const roll = await prisma.roll.findUniqueOrThrow({
    where: { id: rollId },
    select: { currentStepId: true },
  });
  const open = await prisma.rollMovement.findMany({
    where: { rollId, exitedAt: null },
    select: { workOrderStepId: true },
  });
  const s = new Set<string>(open.map((m) => m.workOrderStepId));
  if (roll.currentStepId) s.add(roll.currentStepId);
  return s.size;
}

/** İptalin hiçbir adımı ACTIVE'e çevirmediğini toplu doğrulamak için iz. */
const activationWatch: string[] = [];
async function snapshotSteps(stepIds: string[]): Promise<Record<string, StepStatus>> {
  const out: Record<string, StepStatus> = {};
  for (const id of stepIds) out[id] = await stepStatus(id);
  return out;
}
async function noteActivations(
  before: Record<string, StepStatus>,
  stepIds: string[],
  where: string,
): Promise<void> {
  for (const id of stepIds) {
    const after = await stepStatus(id);
    if (after === StepStatus.ACTIVE && before[id] !== StepStatus.ACTIVE) {
      activationWatch.push(`${where}:${id}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("=== TOP İPTALİ → ADIM DURUMU YENİDEN HESAPLAMA ===");

  // ⚠️ ÜRÜN FİXTURE'I TEST TARAFINDAN ÜRETİLİR, ortamdan SEÇİLMEZ.
  // İlk hâli `item.findFirst({ where: { isActive: true } })` idi — CLAUDE.md'nin
  // (Test Scriptleri) açıkça yasakladığı "herhangi bir aktif kayıt bul" deseni.
  // Bugün zararsız görünüyor (Item yalnız FK), ama ürün-bağımlı bir doğrulama
  // eklendiği gün test yanlış şeyi doğrulayarak GEÇERDİ; istasyonlar aynı dosyada
  // zaten business-key ile çözülüyor, ürün tarafı gevşek bırakılmıştı.
  const fixtureItem = await prisma.item.create({
    data: {
      code: `TEST-RCSR-ITEM-${stamp}`,
      name: `TEST RCSR URUN ${stamp}`,
      itemType: "FABRIC",
      unit: "MT",
    },
    select: { id: true },
  });
  itemIds.push(fixtureItem.id);
  const itemId = fixtureItem.id;
  const stationIds: string[] = [];
  for (const code of ["ZIMPARA_FASON", "KURSUN_KK2", "TAMBUR_1"]) {
    stationIds.push(
      need(
        await prisma.station.findFirst({ where: { code }, select: { id: true } }),
        `Station ${code} (önce 'npm run seed')`,
      ).id,
    );
  }

  try {
    // ══ [1] SAHA VAKASI — ön koşul (körlük zemini) ═════════════════════════
    console.log("\n[1] Saha vakası zemini: adım COMPLETED, hareket KAPALI, konum YOK");
    const A = await makeWo(
      WorkOrderStatus.COMPLETED,
      [
        { seq: 1, status: StepStatus.COMPLETED },
        { seq: 2, status: StepStatus.COMPLETED },
        { seq: 3, status: StepStatus.SKIPPED },
      ],
      stationIds,
      itemId,
    );
    const a1 = A.stepIdBySeq[1]!;
    const a2 = A.stepIdBySeq[2]!;
    const a3 = A.stepIdBySeq[3]!;
    // Top iş emrinden geçti (iki adımda KAPALI hareket), sonra dispozisyonla
    // WAREHOUSE'a çekildi: currentStepId = null, açık hareket YOK.
    const rA = await makeRoll(itemId, RollStatus.WAREHOUSE, null);
    await addMovement(rA, a1, { closed: true });
    await addMovement(rA, a2, { closed: true });

    check("ön koşul: 2. adım kayıtlı COMPLETED", (await stepStatus(a2)) === StepStatus.COMPLETED);
    check("ön koşul: topun açık hareketi ve konumu YOK (ESKİ kapsam BOŞ)",
      (await legacyScopeSize(rA)) === 0, `eski kapsam boyutu=${await legacyScopeSize(rA)}`);
    check("ön koşul: iş emri COMPLETED", (await woStatus(A.id)) === WorkOrderStatus.COMPLETED);

    // Yeni kapsam gerçekten ADIMLARI görüyor mu (yardımcının sözleşmesi).
    const scopeA = await prisma.$transaction((tx) => collectRollStepScopeTx(tx, [rA], [null]));
    const scopeAIds = scopeA.steps.map((s) => s.id);
    check("yeni kapsam kapalı-hareketli iki adımı da içeriyor",
      scopeAIds.includes(a1) && scopeAIds.includes(a2), `n=${scopeAIds.length}`);
    check("yeni kapsam SKIPPED adımı DIŞLIYOR (terminal, recompute dokunmaz)",
      !scopeAIds.includes(a3));
    check("yeni kapsam adımı TEKRARLAMIYOR (dedup)",
      new Set(scopeAIds).size === scopeAIds.length, `${scopeAIds.length} satır`);

    // ══ [2] ASIL İDDİA ════════════════════════════════════════════════════
    console.log("\n[2] ASIL İDDİA: iptal, kapalı hareketli adımları da düzeltir");
    const beforeA = await snapshotSteps([a1, a2, a3]);
    await inventory.softDelete(rA);
    await noteActivations(beforeA, [a1, a2, a3], "senaryoA");

    check("top CANCELLED oldu", (await prisma.roll.findUniqueOrThrow({
      where: { id: rA }, select: { status: true },
    })).status === RollStatus.CANCELLED);
    check("1. adım türetilen değere çekildi (bayat COMPLETED kalmadı)",
      (await stepStatus(a1)) === StepStatus.PENDING, await stepStatus(a1));
    check("2. adım (saha vakasının adımı) PENDING'e düştü",
      (await stepStatus(a2)) === StepStatus.PENDING, await stepStatus(a2));
    check("SKIPPED adım DEĞİŞMEDİ (terminal)",
      (await stepStatus(a3)) === StepStatus.SKIPPED, await stepStatus(a3));
    check("COMPLETED iş emri diriltilmedi",
      (await woStatus(A.id)) === WorkOrderStatus.COMPLETED, await woStatus(A.id));
    check("COMPLETED'tan düşen adımın completedAt damgası temizlendi (bilinen bedel)",
      (await prisma.workOrderStep.findUniqueOrThrow({
        where: { id: a2 }, select: { completedAt: true },
      })).completedAt === null);

    // İz AUDIT'te: completedAt satırdan silindi, tek kaydı bu.
    const auditA = await prisma.systemLog.findFirst({
      where: { tableName: "ROLL", recordId: rA },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const changes = (auditA?.newData as Prisma.JsonObject | null)?.["stepStatusChanges"];
    check("audit adım geçişlerini kaydetti (completedAt'in tek izi)",
      Array.isArray(changes) && changes.length === 2, JSON.stringify(changes)?.slice(0, 120));

    // ══ [3] REGRESYON — açık hareketli yol + not koruması ══════════════════
    console.log("\n[3] REGRESYON: açık hareketli adım yolu + hareket notu");
    const B = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [
        { seq: 1, status: StepStatus.COMPLETED },
        { seq: 2, status: StepStatus.ACTIVE },
      ],
      stationIds,
      itemId,
    );
    const b1 = B.stepIdBySeq[1]!;
    const b2 = B.stepIdBySeq[2]!;
    const rB = await makeRoll(itemId, RollStatus.IN_PRODUCTION, b2);
    await addMovement(rB, b1, { closed: true, notes: "KK1 girisi" });
    await addMovement(rB, b2, { closed: false, notes: "TAMBUR_MANUAL_ROLL: sehven" });

    check("ön koşul: ESKİ kapsam yalnız AÇIK adımı görüyordu (1 adım)",
      (await legacyScopeSize(rB)) === 1, `eski kapsam boyutu=${await legacyScopeSize(rB)}`);

    const beforeB = await snapshotSteps([b1, b2]);
    await inventory.softDelete(rB, undefined, { confirmActive: true });
    await noteActivations(beforeB, [b1, b2], "senaryoB");

    check("açık hareketli adım PENDING'e düştü (eski davranış korundu)",
      (await stepStatus(b2)) === StepStatus.PENDING, await stepStatus(b2));
    check("kapalı hareketli ÜST adım da düzeldi (düzeltmenin eklediği)",
      (await stepStatus(b1)) === StepStatus.PENDING, await stepStatus(b1));

    const mvB = await prisma.rollMovement.findFirstOrThrow({
      where: { rollId: rB, workOrderStepId: b2 },
      select: { exitedAt: true, qtyOut: true, notes: true },
    });
    check("açık hareket kapatıldı", mvB.exitedAt !== null);
    check("qtyOut = 0 (storno semantiği — mal bu istasyondan HİÇ geçmedi)",
      Number(mvB.qtyOut) === 0, String(mvB.qtyOut));
    check("hareket notu EZİLMEDİ (2026-08-04 kuralı)",
      mvB.notes === "CANCELLED (TAMBUR_MANUAL_ROLL: sehven)", String(mvB.notes));

    // ══ [4] KAPSAM DAR — canlı topu olan adım DÜŞMEZ ══════════════════════
    console.log("\n[4] TERS YÖN: hâlâ canlı topu olan adım COMPLETED/ACTIVE kalır");
    const C = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [
        { seq: 1, status: StepStatus.COMPLETED },
        { seq: 2, status: StepStatus.ACTIVE },
      ],
      stationIds,
      itemId,
    );
    const c1 = C.stepIdBySeq[1]!;
    const c2 = C.stepIdBySeq[2]!;
    const rC1 = await makeRoll(itemId, RollStatus.WAREHOUSE, null); // iptal edilecek
    await addMovement(rC1, c1, { closed: true });
    const rC2 = await makeRoll(itemId, RollStatus.IN_PRODUCTION, c2); // canlı kalacak
    await addMovement(rC2, c1, { closed: true });
    await addMovement(rC2, c2, { closed: false });

    const beforeC = await snapshotSteps([c1, c2]);
    await inventory.softDelete(rC1);
    await noteActivations(beforeC, [c1, c2], "senaryoC");

    check("1. adım COMPLETED KALDI (başka topun kapalı hareketi var)",
      (await stepStatus(c1)) === StepStatus.COMPLETED, await stepStatus(c1));
    check("2. adım ACTIVE KALDI (canlı topun açık hareketi var)",
      (await stepStatus(c2)) === StepStatus.ACTIVE, await stepStatus(c2));
    check("iş emri IN_PROGRESS kaldı",
      (await woStatus(C.id)) === WorkOrderStatus.IN_PROGRESS, await woStatus(C.id));

    // ══ [5] TERMİNAL WO DİRİLTİLMEZ ═══════════════════════════════════════
    console.log("\n[5] TERMİNAL WO: ensureWorkOrderInProgress yalnız PLANNED'ı hedefler");
    const D = await makeWo(
      WorkOrderStatus.PLANNED,
      [{ seq: 1, status: StepStatus.PENDING }],
      stationIds,
      itemId,
    );
    // Körlük zemini: fonksiyon gerçekten yazıyor mu?
    await prisma.$transaction((tx) => ensureWorkOrderInProgress(tx, D.id));
    check("körlük zemini: PLANNED → IN_PROGRESS (fonksiyon ölü değil)",
      (await woStatus(D.id)) === WorkOrderStatus.IN_PROGRESS, await woStatus(D.id));

    for (const term of [
      WorkOrderStatus.COMPLETED,
      WorkOrderStatus.CANCELLED,
      WorkOrderStatus.SUPERSEDED,
    ]) {
      const T = await makeWo(term, [{ seq: 1, status: StepStatus.PENDING }], stationIds, itemId);
      await prisma.$transaction((tx) => ensureWorkOrderInProgress(tx, T.id));
      check(`terminal iş emri diriltilmedi (${term})`, (await woStatus(T.id)) === term,
        await woStatus(T.id));
    }

    check("iptal hiçbir adımı ACTIVE'e ÇEVİRMEDİ (sayaçlar yalnız küçülür)",
      activationWatch.length === 0, activationWatch.join(", "));

    // ══ [6] hardDelete ("Arşivle") — aynı boşluğun daha kötü kopyası ═══════
    console.log("\n[6] hardDelete: recompute artık 'if (currentStepId)' dalında DEĞİL");
    const E = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [
        { seq: 1, status: StepStatus.COMPLETED },
        { seq: 2, status: StepStatus.ACTIVE },
      ],
      stationIds,
      itemId,
    );
    const e1 = E.stepIdBySeq[1]!;
    const e2 = E.stepIdBySeq[2]!;
    // STOCK top KAPALI hareket taşıyabilir (detach → renksiz top STOCK'a döner).
    const rE = await makeRoll(itemId, RollStatus.STOCK, null);
    await addMovement(rE, e1, { closed: true });

    check("ön koşul: STOCK topun currentStepId'si NULL (eski dal hiç koşmazdı)",
      (await legacyScopeSize(rE)) === 0);
    await inventory.hardDelete(rE);
    check("arşivleme kapalı hareketli adımı da düzeltti",
      (await stepStatus(e1)) === StepStatus.PENDING, await stepStatus(e1));

    console.log("\n[6b] hardDelete: hareket notu EZİLMİYOR (softDelete ile hizalı)");
    const rE2 = await makeRoll(itemId, RollStatus.STOCK, e2);
    await addMovement(rE2, e2, { closed: false, notes: "TAMBUR_MANUAL_ROLL: hatali" });
    await inventory.hardDelete(rE2);
    const mvE = await prisma.rollMovement.findFirstOrThrow({
      where: { rollId: rE2, workOrderStepId: e2 },
      select: { notes: true, qtyOut: true, exitedAt: true },
    });
    check("arşivlemede eski not korunuyor",
      mvE.notes === "ARCHIVED (TAMBUR_MANUAL_ROLL: hatali)", String(mvE.notes));
    check("arşivlemede de qtyOut = 0", Number(mvE.qtyOut) === 0, String(mvE.qtyOut));
    check("arşivlemede açık hareket kapatıldı", mvE.exitedAt !== null);
    check("arşivleme sonrası adım yeniden hesaplandı",
      (await stepStatus(e2)) === StepStatus.PENDING, await stepStatus(e2));

    // ══ [7] restoreCancelledRoll — boşluk YOK, çünkü kapsam guard'ı reddediyor
    console.log("\n[7] restoreCancelledRoll: hareketli top REDDEDİLİR (boşluk kapalı)");
    const beforeRestore = await snapshotSteps([a1, a2]);
    await expectErr(
      "hareket kaydı olan topun iptali geri ALINAMAZ",
      "hareket kaydı var",
      () => inventory.restoreCancelledRoll(rA),
    );
    check("reddedilen geri alma adım durumlarına DOKUNMADI",
      (await stepStatus(a1)) === beforeRestore[a1] &&
        (await stepStatus(a2)) === beforeRestore[a2]);
    // Hareketsiz top geri alınabilir — ve hiçbir adım sayacına girmediği için
    // recompute GEREKMEZ (bu, guard'ın taşıdığı yapısal güvence).
    const rF = await makeRoll(itemId, RollStatus.A1_STOCK, null);
    await inventory.softDelete(rF);
    const restored = await inventory.restoreCancelledRoll(rF);
    check("hareketsiz topun iptali geri alınır", restored.success === true);
    check("geri alma iptalden ÖNCEKİ rafa döner (A1_STOCK)",
      (await prisma.roll.findUniqueOrThrow({
        where: { id: rF }, select: { status: true },
      })).status === RollStatus.A1_STOCK);

    // ══ [8] Yardımcının sözleşmesi: çok-WO · boş girdi · deterministik sıra ═
    console.log("\n[8] collectRollStepScopeTx sözleşmesi");
    const G1 = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [{ seq: 1, status: StepStatus.COMPLETED }, { seq: 2, status: StepStatus.PENDING }],
      stationIds,
      itemId,
    );
    const G2 = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [{ seq: 1, status: StepStatus.COMPLETED }],
      stationIds,
      itemId,
    );
    const rG = await makeRoll(itemId, RollStatus.WAREHOUSE, null);
    await addMovement(rG, G1.stepIdBySeq[1]!, { closed: true });
    await addMovement(rG, G2.stepIdBySeq[1]!, { closed: true });

    const scopeG = await prisma.$transaction((tx) =>
      // Aynı topu İKİ kez veriyoruz: dedup gerçekten çalışıyor mu.
      collectRollStepScopeTx(tx, [rG, rG], []),
    );
    check("çok iş emrinde hareketi olan top İKİ iş emrini de kapsıyor",
      scopeG.workOrderIds.length === 2, scopeG.workOrderIds.join(","));
    check("iş emri id'leri ASC sıralı (deterministik kilit sırası)",
      [...scopeG.workOrderIds].sort().join(",") === scopeG.workOrderIds.join(","));
    check("kapsam, topun HAREKETİ OLMAYAN kardeş adımı da içeriyor (pendingRolls sayacı)",
      scopeG.steps.some((s) => s.id === G1.stepIdBySeq[2]));
    check("mükerrer girdi dedup edildi",
      new Set(scopeG.steps.map((s) => s.id)).size === scopeG.steps.length,
      `${scopeG.steps.length} satır`);
    check("kapsam kayıtlı durumu (recompute ÖNCESİ) taşıyor",
      scopeG.steps.find((s) => s.id === G1.stepIdBySeq[1])?.status === StepStatus.COMPLETED);

    const scopeEmpty = await prisma.$transaction((tx) => collectRollStepScopeTx(tx, [], []));
    check("boş girdi → boş kapsam (sorgu koşmaz)",
      scopeEmpty.steps.length === 0 && scopeEmpty.workOrderIds.length === 0);

    // ══ [9] DİSPOZİSYON MOTORU — aynı §20 sınıfı, ÜÇ ana operatör akışı ═════
    // 2026-08-15 denetim bulgusu: düzeltme yalnız `softDelete`/`hardDelete`'e
    // uygulanmıştı; `applyRollDispositionsTx` (WO kapatma · WO iptali · parti
    // düşürme) HİÇ recompute çağırmıyordu → saha vakasının birebir aynısı bu üç
    // yoldan ÜRETİLMEYE DEVAM EDİYORDU. (Ölçülen IE0608260004 zaten kapanış
    // dispozisyonundan geçmişti.) Motor tek kaynak olduğu için tek bölüm üçünü
    // birden kilitler.
    console.log("\n[9] Kapanış/iptal dispozisyonu da adım durumunu düzeltir");
    const H = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [
        { seq: 1, status: StepStatus.COMPLETED }, // top buradan ÇIKTI (kapalı hareket)
        { seq: 2, status: StepStatus.ACTIVE },    // top hâlâ burada (açık hareket)
      ],
      stationIds,
      itemId,
    );
    const rH = await makeRoll(itemId, RollStatus.IN_PRODUCTION, H.stepIdBySeq[2]!);
    await addMovement(rH, H.stepIdBySeq[1]!, { closed: true });
    await addMovement(rH, H.stepIdBySeq[2]!, { closed: false, notes: "TAMBUR_MANUAL_ROLL: sehven" });

    // Körlük zemini: dispozisyon ÖNCESİ 1. adım gerçekten COMPLETED.
    check("[9] zemin: üst adım dispozisyon öncesi COMPLETED",
      (await stepStatus(H.stepIdBySeq[1]!)) === StepStatus.COMPLETED);

    await prisma.$transaction(async (tx) => {
      const snap = await tx.roll.findUniqueOrThrow({
        where: { id: rH },
        select: { id: true, barcode: true, status: true, currentQty: true, weightKg: true },
      });
      await applyRollDispositionsTx(tx, {
        origin: "WO_CLOSE",
        reason: "TEST-RCSR hatalı kayıt",
        rolls: [snap],
        dispositions: [{ rollId: rH, action: "CANCELLED" }],
      });
    });

    check("[9] iptal dispozisyonu ÜST (kapalı hareketli) adımı PENDING'e çekti",
      (await stepStatus(H.stepIdBySeq[1]!)) === StepStatus.PENDING,
      await stepStatus(H.stepIdBySeq[1]!));
    check("[9] topun BULUNDUĞU adım da PENDING'e düştü",
      (await stepStatus(H.stepIdBySeq[2]!)) === StepStatus.PENDING,
      await stepStatus(H.stepIdBySeq[2]!));
    check("[9] top gerçekten CANCELLED",
      (await prisma.roll.findUniqueOrThrow({ where: { id: rH }, select: { status: true } }))
        .status === RollStatus.CANCELLED);
    const hMove = await prisma.rollMovement.findFirstOrThrow({
      where: { rollId: rH, workOrderStepId: H.stepIdBySeq[2]! },
      select: { qtyOut: true, notes: true },
    });
    check("[9] storno semantiği korundu (qtyOut = 0)", Number(hMove.qtyOut) === 0,
      String(hMove.qtyOut));
    check("[9] eski hareket notu EZİLMEDİ (parantez içinde korunuyor)",
      (hMove.notes ?? "").includes("TAMBUR_MANUAL_ROLL: sehven"), hMove.notes ?? "-");

    // TERS YÖN — dispozisyon canlı topu olan adımı DÜŞÜRMEZ (kapsam dar).
    const I = await makeWo(
      WorkOrderStatus.IN_PROGRESS,
      [{ seq: 1, status: StepStatus.COMPLETED }, { seq: 2, status: StepStatus.ACTIVE }],
      stationIds,
      itemId,
    );
    const iKeep = await makeRoll(itemId, RollStatus.IN_PRODUCTION, I.stepIdBySeq[2]!);
    const iDrop = await makeRoll(itemId, RollStatus.IN_PRODUCTION, I.stepIdBySeq[2]!);
    for (const r of [iKeep, iDrop]) {
      await addMovement(r, I.stepIdBySeq[1]!, { closed: true });
      await addMovement(r, I.stepIdBySeq[2]!, { closed: false });
    }
    await prisma.$transaction(async (tx) => {
      const snap = await tx.roll.findUniqueOrThrow({
        where: { id: iDrop },
        select: { id: true, barcode: true, status: true, currentQty: true, weightKg: true },
      });
      await applyRollDispositionsTx(tx, {
        origin: "BATCH_DROP",
        reason: "TEST-RCSR parti düşürme",
        rolls: [snap],
        dispositions: [{ rollId: iDrop, action: "CANCELLED" }],
      });
    });
    check("[9] hâlâ canlı topu olan üst adım COMPLETED KALDI (kapsam dar)",
      (await stepStatus(I.stepIdBySeq[1]!)) === StepStatus.COMPLETED,
      await stepStatus(I.stepIdBySeq[1]!));
    check("[9] canlı topun bulunduğu adım ACTIVE kaldı",
      (await stepStatus(I.stepIdBySeq[2]!)) === StepStatus.ACTIVE,
      await stepStatus(I.stepIdBySeq[2]!));
  } finally {
    // Söküm sırası FK'ya göre: hareket/işlem/log → top → adım → kart → WO.
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: woIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
    console.log("\n(temizlendi — TEST-RCSR fixture'ları silindi)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
