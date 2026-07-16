// Option A doğrulama — Tambur'da BARKODLU top kesilebilir (barkod-reddi kaldırıldı).
// Konumu-Düzelt ile Tambur adımına gelmiş barkodlu bir TOP'u cutOpenFabric ile kes;
// eskiden "Bu Roll açık kumaş değil (barkodlu)" ile reddediliyordu (ölü rulo).
//
// Fixture hijyeni (2026-07-16): kesimde doğan çocuk top (TAMBUR_SPLIT) parent'ın
// partisini (P1507260092) kalıt alır — script sonrası DB'de kalırsa kardeş testlerin
// (backflush/qc-reversal) paylaşılan seed partisini kirletir (T160726F0087 vakası).
// finally cleanup çocuğu söker (rollOperation → rollMovement → rollProperty →
// systemLog → roll) + parent'ı ve step/WO durumunu ön-duruma döndürür → iz kalmaz.
import p from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const WO = "10b405e6-ff6f-4e80-9d6b-703f0cd1b315"; // IE1507260026
  const tambur = await p.workOrderStep.findFirstOrThrow({ where: { workOrderId: WO, station: { kind: "TAMBUR" } }, select: { id: true, status: true } });
  // Barkodlu bir top al (T150726H0044) — Tambur'a IN_PRODUCTION kur (Konumu-Düzelt senaryosu)
  const roll = await p.roll.findFirstOrThrow({
    where: { barcode: "T150726H0044" },
    select: { id: true, barcode: true, colorId: true, status: true, currentStepId: true, currentQty: true, initialQty: true, qualityGrade: true, parentRollId: true, sackId: true, shipmentId: true },
  });
  // Ön-durum anlık görüntüsü — finally'de geri yazılır (paylaşılan fixture bozulmasın).
  const preRoll = {
    status: roll.status, currentStepId: roll.currentStepId, currentQty: roll.currentQty,
    initialQty: roll.initialQty, qualityGrade: roll.qualityGrade, parentRollId: roll.parentRollId,
    sackId: roll.sackId, shipmentId: roll.shipmentId,
  };
  const preWoStatus = (await p.workOrder.findUniqueOrThrow({ where: { id: WO }, select: { status: true } })).status;
  let childId: string | null = null;

  try {
    await p.rollMovement.deleteMany({ where: { rollId: roll.id } });
    await p.roll.update({ where: { id: roll.id }, data: { status: "IN_PRODUCTION", currentStepId: tambur.id, currentQty: 300, initialQty: 300, sackId: null, shipmentId: null, parentRollId: null, qualityGrade: null } });
    await p.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: tambur.id, qtyIn: 300 } });
    await p.workOrderStep.update({ where: { id: tambur.id }, data: { status: "ACTIVE" } });
    await p.workOrder.update({ where: { id: WO }, data: { status: "IN_PROGRESS" } });
    console.log(`Barkodlu top ${roll.barcode} → Tambur'da IN_PRODUCTION, 300m. Kesiliyor (100m)...`);

    const svc = new TamburService();
    let threw: string | null = null;
    let res: { data?: { childRoll?: { id: string; barcode: string | null; entrySource: string; parentRollId: string | null }; parentRemainingQty?: number } } | null = null;
    try {
      res = await svc.cutOpenFabric(roll.id, { lengthMeters: 100, status: "WAREHOUSE" });
    } catch (e) { threw = (e as Error).message; }

    ok(threw === null, `kesim REDDEDİLMEDİ (eski hata yok) ${threw ? "→ " + threw.slice(0, 60) : ""}`);
    if (res) {
      const child = res.data?.childRoll;
      childId = child?.id ?? null;
      ok(!!child && child.barcode !== null && child.barcode !== roll.barcode, `çocuk taze barkodla doğdu (${child?.barcode})`);
      ok(child?.entrySource === "TAMBUR_SPLIT", "çocuk entrySource=TAMBUR_SPLIT");
      ok(child?.parentRollId === roll.id, "çocuk parent'a bağlı");
      ok(res.data?.parentRemainingQty === 200, `parent kalan metraj 200m (${res.data?.parentRemainingQty})`);
      const parent = await p.roll.findUniqueOrThrow({ where: { id: roll.id }, select: { barcode: true, currentQty: true, status: true } });
      ok(parent.barcode === roll.barcode, "parent barkodunu KORUDU");
      ok(Number(parent.currentQty) === 200, `parent metrajı düştü (${Number(parent.currentQty)}m)`);
    }
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      // Çocuk top söküm sırası: op → movement → property → log → roll.
      if (childId) {
        await p.rollOperation.deleteMany({ where: { rollId: childId } });
        await p.rollMovement.deleteMany({ where: { rollId: childId } });
        await p.rollProperty.deleteMany({ where: { rollId: childId } });
        await p.systemLog.deleteMany({ where: { recordId: childId } });
        await p.roll.delete({ where: { id: childId } });
      }
      // Parent'ı ve step/WO durumunu ön-duruma döndür; bu testin açtığı movement'ı sil.
      await p.rollMovement.deleteMany({ where: { rollId: roll.id, workOrderStepId: tambur.id, exitedAt: null } });
      await p.roll.update({ where: { id: roll.id }, data: preRoll });
      await p.workOrderStep.update({ where: { id: tambur.id }, data: { status: tambur.status } });
      await p.workOrder.update({ where: { id: WO }, data: { status: preWoStatus } });
      console.log("(temizlendi — çocuk top + parent ön-durumu geri yüklendi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await p.$disconnect();
  }

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  process.exit(fail > 0 ? 1 : 0);
})();
