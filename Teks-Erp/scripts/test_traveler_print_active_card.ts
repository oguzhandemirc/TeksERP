// =============================================================================
// TEST: TravelerCard tek-ACTIVE-kart invariant'ı (partial unique)
// Çalıştır: npx tsx scripts/test_traveler_print_active_card.ts
// =============================================================================
// migration 20260623110000: traveler_cards(workOrderId) WHERE status='ACTIVE'
// PARTIAL UNIQUE. print() check-then-act'i EŞZAMANLI çift-tıkta iki ACTIVE kart
// üretebiliyordu. withBarcodeRetry workOrderId-active P2002'yi propagate eder,
// print/reprint 409'a çevirir.
//   A) happy: print → 1 ACTIVE; B) sıralı tekrar → 409;
//   C) FLAGSHIP: 2 paralel print → tam 1 başarı + tam 1×409 VE DB'de 1 ACTIVE
//      (unique olmadan ikisi de pre-check'i geçip 2 ACTIVE kart yazardı → count===1 kanıt);
//   D) reprint → eski REPRINTED + yeni ACTIVE (yine tek ACTIVE);
//   E) barkod retry REGRESYON YOK (ardışık print'ler benzersiz barkod üretir).
// =============================================================================

import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const cards = new TravelerCardService();
let ITEM = "",
  ADMIN = "",
  STATION = "";
const woIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
}

async function makeWo(): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-TC-WO-${woIds.length}-${Date.now().toString().slice(-5)}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetQuantity: 100,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
  });
  woIds.push(wo.id);
  return wo.id;
}

const activeCount = (woId: string) =>
  prisma.travelerCard.count({ where: { workOrderId: woId, status: "ACTIVE" } });

async function run(): Promise<void> {
  console.log("\n=== TravelerCard tek-ACTIVE-kart invariant ===");

  // A) happy
  const w1 = await makeWo();
  const r = await cards.print(w1, ADMIN);
  check("print happy: success", r.success === true);
  check("print happy: 1 ACTIVE kart", (await activeCount(w1)) === 1);

  // A2) getCardHtml — gerçek kart → donmuş snapshot → tek-kaynak HTML + SUNUCU QR.
  // (Elle-kurulu unit fixture'ın yakalayamadığı snapshot-şekli + bwip wiring'i.)
  const card1 = need(r.data, "print card");
  const wo1 = need(
    await prisma.workOrder.findUnique({ where: { id: w1 }, select: { workOrderNumber: true } }),
    "wo1",
  );
  const html1 = await cards.getCardHtml(card1.id);
  check("getCardHtml: HTML döndü", html1.length > 500, `len=${html1.length}`);
  check("getCardHtml: REFAKAT KARTI başlık", html1.includes("REFAKAT KARTI"));
  check("getCardHtml: kart no + barkod (cardMeta)", html1.includes(card1.cardNumber) && html1.includes(card1.barcode));
  check("getCardHtml: workOrderNumber snapshot'tan", html1.includes(wo1.workOrderNumber));
  check("getCardHtml: gömülü QR (svg)", html1.includes("<svg"));

  // B) sıralı tekrar print → İDEMPOTENT (kart-iş-emriyle: print artık ensure;
  //    aynı kartı 200 ile döner, 409 ATMAZ — idempotency work'ü print'i idempotent yaptı).
  const seq = await cards.print(w1, ADMIN);
  check("sıralı tekrar print → idempotent (aynı kart, 200)", seq.success === true && seq.data?.id === card1.id, `${seq.data?.id?.slice(0, 8)} vs ${card1.id.slice(0, 8)}`);
  check("sıralı tekrar: hâlâ 1 ACTIVE", (await activeCount(w1)) === 1);

  // C) FLAGSHIP eşzamanlı — ikisi de idempotent başarılı, İKİSİ DE AYNI kartı döner
  //    (kaybeden P2002 → tx bir kez retry → mevcut kart; kart-yarışı 409'a çevrilMEZ).
  const w2 = await makeWo();
  const settled = await Promise.allSettled([cards.print(w2, ADMIN), cards.print(w2, ADMIN)]);
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  const cardIds = settled
    .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof cards.print>>> => s.status === "fulfilled")
    .map((s) => s.value.data?.id);
  check("paralel print: ikisi de başarılı (idempotent)", ok === 2, `ok=${ok}`);
  check("paralel print: ikisi de AYNI kartı döndü", !!cardIds[0] && cardIds[0] === cardIds[1], `${cardIds[0]?.slice(0, 8)} vs ${cardIds[1]?.slice(0, 8)}`);
  check("paralel print: DB'de TEK ACTIVE kart (workOrderId @unique kanıtı)", (await activeCount(w2)) === 1, `count=${await activeCount(w2)}`);

  // D) reprint → AYNI kart in-place, version++ (kart WO'ya bağlı; REPRINTED yok,
  //    ACTIVE kalır — barkod=İE sabit).
  const beforeRp = need(await prisma.travelerCard.findUnique({ where: { id: card1.id }, select: { version: true } }), "kart (reprint öncesi)");
  const rp = await cards.reprint(w1, "test reprint", ADMIN);
  check("reprint: success", rp.success === true);
  check("reprint sonrası: yine TEK ACTIVE", (await activeCount(w1)) === 1);
  const afterRp = need(await prisma.travelerCard.findUnique({ where: { id: card1.id }, select: { version: true, status: true } }), "kart (reprint sonrası)");
  check("reprint: AYNI kart in-place version++ (REPRINTED yok, ACTIVE kalır)", afterRp.status === "ACTIVE" && afterRp.version === beforeRp.version + 1, `v${beforeRp.version}→v${afterRp.version}`);

  // E) kart-iş-emriyle: WO başına TEK kart (barkod=İE sabit; reprint yeni kart yaratmaz).
  const cardsOfW1 = await prisma.travelerCard.findMany({ where: { workOrderId: w1 }, select: { barcode: true } });
  check("WO başına TEK kart (barkod=İE, in-place reprint yeni kart yaratmadı)", cardsOfW1.length === 1, `count=${cardsOfW1.length}`);
}

async function cleanup(): Promise<void> {
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await run();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
