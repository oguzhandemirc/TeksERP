// =============================================================================
// Test: HAYALET TOP TESPİTİ (mükerrer ham giriş) — panel v2 P3c, 2026-08-22
// Çalıştır: npx tsx scripts/test_duplicate_rolls.ts
// =============================================================================
// Kilitlenen sözleşmeler:
//   §1 SERT ELEME: hareket/operasyon görmüş top kümeye HİÇ girmez (üretime girmiş
//      mal fiziksel olarak vardı) · iptal/fire statüsü taranmaz · fason dönüşü ve
//      kesim çocuğu (parentRollId/parentReceiptId) taranmaz
//   §2 KİMLİK + PENCERE: aynı ürün/renk/metraj/en/operatör/makine VE ardışık kayıtlar
//      pencere içinde → tek küme; pencereyi aşan boşluk zinciri BÖLER; farklı metraj
//      ayrı kümedir
//   §3 "ASIL" ÖNERİSİ (kullanıcı kararı): etiketi BASILAN top asıldır (birden fazlaysa
//      en eskisi); hiçbirinde etiket yoksa en eski kayıt
//   §4 ENGEL: çuvaldaki/sevkiyata bağlı top `blockedReason` taşır (panel iptal ettirmez)
//   §5 SKOR/SEVİYE: saniyeler + farklı clientToken + giriş statüsü → 6/6 GÜÇLÜ
//   §6 SALT OKUNUR: tarama hiçbir kaydı değiştirmez
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { DuplicateRollsService } from "../src/services/duplicate-rolls.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `TDR${Date.now().toString().slice(-8)}`;
const createdRolls: string[] = [];
let itemId = "";
let userId = "";
let sackId: string | null = null;
let workOrderId: string | null = null;
let stepId: string | null = null;

const MIN = 60_000;

async function mkRoll(opts: {
  n: number;
  minutesAgo: number;
  qty?: number;
  status?: RollStatus;
  labelPrinted?: boolean;
  token?: string | null;
}): Promise<string> {
  const at = new Date(Date.now() - opts.minutesAgo * MIN);
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}${String(opts.n).padStart(2, "0")}`,
      itemId,
      status: opts.status ?? RollStatus.STOCK,
      initialQty: opts.qty ?? 100,
      currentQty: opts.qty ?? 100,
      entrySource: "SUPPLIER_RECEIPT",
      createdById: userId,
      createdAt: at,
      clientToken: opts.token === null ? null : (opts.token ?? crypto.randomUUID()),
      labelPrintedAt: opts.labelPrinted ? at : null,
    },
    select: { id: true },
  });
  createdRolls.push(r.id);
  return r.id;
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `${TAG}-ITM`, name: `${TAG} Test Kumaş`, itemType: "FABRIC" },
    select: { id: true },
  });
  itemId = item.id;
  const user = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  userId = user.id;

  // Küme A — 3 top, saniyeler arayla (dakika cinsinden yakın), ikisinde etiket basılı.
  // (Zaman farkları: 60 dk, 59.98 dk, 59.95 dk önce → aralarında ~1-2 sn.)
  const a1 = await mkRoll({ n: 1, minutesAgo: 60, labelPrinted: false });
  const a2 = await mkRoll({ n: 2, minutesAgo: 60 - 0.02, labelPrinted: true });
  const a3 = await mkRoll({ n: 3, minutesAgo: 60 - 0.05, labelPrinted: true });
  // Küme B — aynı kimlik ama PENCEREYİ AŞAN boşluk (10 dk sonra) → ayrı zincir,
  // tek başına kaldığı için küme OLUŞMAZ.
  const b1 = await mkRoll({ n: 4, minutesAgo: 45 });
  // Hareket görmüş top — aynı kimlikte ama SERT ELEMEYE takılmalı.
  const touched = await mkRoll({ n: 5, minutesAgo: 60 - 0.08 });
  // Hareket yaratmak için minimal WO + adım gerekiyor (RollMovement zorunlu alanı).
  const station = await prisma.station.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", targetItemId: itemId },
    select: { id: true },
  });
  workOrderId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  stepId = step.id;
  await prisma.rollMovement.create({
    data: { rollId: touched, workOrderStepId: step.id, qtyIn: 100, enteredAt: new Date() },
  });
  // İptal edilmiş top — hiç taranmamalı.
  const cancelled = await mkRoll({ n: 6, minutesAgo: 60 - 0.03, status: RollStatus.CANCELLED });
  // Farklı metraj — ayrı kimlik, küme kurmaz.
  await mkRoll({ n: 7, minutesAgo: 60 - 0.04, qty: 250 });

  const scan = await DuplicateRollsService.scan({ days: 2, windowSec: 120 });
  const clusterOf = (id: string) => scan.clusters.find((c) => c.rolls.some((r) => r.id === id));

  console.log("\n── §1 Sert eleme ──");
  const ca = clusterOf(a1);
  check("aynı kimlikli 3 top TEK küme oldu", Boolean(ca) && ca!.rolls.length === 3, `${ca?.rolls.length ?? 0} top`);
  check("hareket görmüş top kümeye GİRMEDİ", !ca!.rolls.some((r) => r.id === touched));
  check("iptal edilmiş top hiç taranmadı", !scan.clusters.some((c) => c.rolls.some((r) => r.id === cancelled)));
  check("toplam sayaç: hareket görmüş elendi olarak raporlanıyor", scan.totals.touched >= 1, `${scan.totals.touched}`);

  console.log("\n── §2 Kimlik + pencere ──");
  check("pencereyi aşan top AYRI zincir → küme kurmadı", !clusterOf(b1));
  check("farklı metrajlı top kümeye girmedi", ca!.rolls.every((r) => r.id !== createdRolls[createdRolls.length - 1]));
  check("küme kimliği taşıyor (ürün/metraj/operatör)", ca!.itemId === itemId && ca!.initialQty === 100);

  console.log("\n── §3 'Asıl' önerisi ──");
  check("etiketi BASILAN top asıl önerildi (a2 — basılıların en eskisi)", ca!.suggestedKeepId === a2, `önerilen=${ca!.suggestedKeepId === a2 ? "a2" : ca!.suggestedKeepId === a3 ? "a3" : "a1"}`);
  check("etiketsiz ilk kayıt (a1) asıl DEĞİL — kâğıt a2/a3'te", ca!.suggestedKeepId !== a1);
  check("etiket bayrağı satırlarda görünüyor", ca!.rolls.filter((r) => r.labelPrinted).length === 2);

  // Etiketi olmayan bir küme: en eski kayıt asıl olmalı.
  const c1 = await mkRoll({ n: 8, minutesAgo: 30, qty: 77 });
  await mkRoll({ n: 9, minutesAgo: 30 - 0.02, qty: 77 });
  const scan2 = await DuplicateRollsService.scan({ days: 2, windowSec: 120 });
  const cc = scan2.clusters.find((c) => c.rolls.some((r) => r.id === c1));
  check("etiket yoksa EN ESKİ kayıt asıl önerilir", cc?.suggestedKeepId === c1);

  console.log("\n── §4 Engel (çuval) ──");
  const cust = await prisma.customer.create({ data: { code: `${TAG}-CST`, name: `${TAG} Müşteri` }, select: { id: true } });
  const sack = await prisma.sack.create({
    data: { sackNo: `${TAG}-SCK`, customerId: cust.id },
    select: { id: true },
  });
  sackId = sack.id;
  await prisma.roll.update({ where: { id: a3 }, data: { sackId: sack.id, status: RollStatus.WAREHOUSE } });
  const scan3 = await DuplicateRollsService.scan({ days: 2, windowSec: 120 });
  const ca3 = scan3.clusters.find((c) => c.rolls.some((r) => r.id === a3));
  const blocked = ca3?.rolls.find((r) => r.id === a3);
  check("çuvaldaki top blockedReason taşıyor", Boolean(blocked?.blockedReason?.includes("Çuval")), String(blocked?.blockedReason));
  check("engelli top listede KALIR (gizlenmez — operatör görsün)", Boolean(ca3));
  await prisma.roll.update({ where: { id: a3 }, data: { sackId: null, status: RollStatus.STOCK } });
  await prisma.sack.delete({ where: { id: sack.id } });
  sackId = null;
  await prisma.customer.delete({ where: { id: cust.id } });

  console.log("\n── §5 Skor / seviye ──");
  const ca5 = (await DuplicateRollsService.scan({ days: 2, windowSec: 120 })).clusters.find((c) =>
    c.rolls.some((r) => r.id === a1),
  )!;
  check("skor 6/6 ve seviye GÜÇLÜ", ca5.score === 6 && ca5.level === "STRONG", `${ca5.score}/${ca5.level}`);
  check("gerekçeler okunur (süre + token + statü)", ca5.reasons.length === 3 && ca5.reasons.some((r) => r.includes("clientToken")), ca5.reasons.join(" · "));

  console.log("\n── §6 Salt okunur ──");
  const before = await prisma.roll.findUniqueOrThrow({ where: { id: a1 }, select: { status: true, updatedAt: true } });
  await DuplicateRollsService.scan({ days: 2, windowSec: 120 });
  const after = await prisma.roll.findUniqueOrThrow({ where: { id: a1 }, select: { status: true, updatedAt: true } });
  check("tarama hiçbir kaydı değiştirmedi", before.status === after.status && before.updatedAt.getTime() === after.updatedAt.getTime());

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    try {
      if (sackId) {
        await prisma.roll.updateMany({ where: { sackId }, data: { sackId: null } });
        await prisma.sack.delete({ where: { id: sackId } }).catch(() => {});
      }
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } });
      await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
      if (stepId) await prisma.workOrderStep.delete({ where: { id: stepId } }).catch(() => {});
      if (workOrderId) await prisma.workOrder.delete({ where: { id: workOrderId } }).catch(() => {});
      if (itemId) await prisma.item.delete({ where: { id: itemId } }).catch(() => {});
      await prisma.customer.deleteMany({ where: { code: `${TAG}-CST` } });
    } catch (err) {
      console.error("cleanup hatası:", err);
    }
    if (fail > 0) console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
