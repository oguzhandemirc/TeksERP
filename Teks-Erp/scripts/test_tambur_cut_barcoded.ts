// Option A doğrulama — Tambur'da BARKODLU top kesilebilir (barkod-reddi kaldırıldı).
// Konumu-Düzelt ile Tambur adımına gelmiş barkodlu bir TOP'u cutOpenFabric ile kes;
// eskiden "Bu Roll açık kumaş değil (barkodlu)" ile reddediliyordu (ölü rulo).
import p from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const WO = "10b405e6-ff6f-4e80-9d6b-703f0cd1b315"; // IE1507260026
  const tambur = await p.workOrderStep.findFirstOrThrow({ where: { workOrderId: WO, station: { kind: "TAMBUR" } }, select: { id: true } });
  // Barkodlu bir top al (T150726H0044) — Tambur'a IN_PRODUCTION kur (Konumu-Düzelt senaryosu)
  const roll = await p.roll.findFirstOrThrow({ where: { barcode: "T150726H0044" }, select: { id: true, barcode: true, colorId: true } });
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
    ok(!!child && child.barcode !== null && child.barcode !== roll.barcode, `çocuk taze barkodla doğdu (${child?.barcode})`);
    ok(child?.entrySource === "TAMBUR_SPLIT", "çocuk entrySource=TAMBUR_SPLIT");
    ok(child?.parentRollId === roll.id, "çocuk parent'a bağlı");
    ok(res.data?.parentRemainingQty === 200, `parent kalan metraj 200m (${res.data?.parentRemainingQty})`);
    const parent = await p.roll.findUniqueOrThrow({ where: { id: roll.id }, select: { barcode: true, currentQty: true, status: true } });
    ok(parent.barcode === roll.barcode, "parent barkodunu KORUDU");
    ok(Number(parent.currentQty) === 200, `parent metrajı düştü (${Number(parent.currentQty)}m)`);
  }

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  await p.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
