// =============================================================================
// TeksERP - Sipariş iptal sebebi bekçisi
// =============================================================================
// ÖLÇÜMLE DOĞAN ÖZELLİK: 2026-08-26'ya kadar sipariş iptalinde sebep HİÇBİR
// yerde tutulmuyordu — `Order`'da kolon yoktu, uç parametre almıyordu, audit
// kaydı bile yalnız {"status":"CANCELLED","actions":[]} yazıyordu. "Müşteriler
// neden vazgeçiyor" sorusu veri yokluğundan cevapsızdı.
//
// Dört iddia:
// ① KOD RAPOR ANAHTARIDIR ve sunucu türetir. İstemciden gelen açık kod
//    katalogda DOĞRULANIR; geçersizse iptal hiç başlamadan 400 ile durur.
// ② SERBEST METİNDE KOD UYDURULMAZ → NULL kalır. Uydurulmuş bir kod raporun en
//    çok güvendiği alanı sessizce kirletirdi ("Diğer" kovası şişer, gerçek
//    dağılım kaybolur).
// ③ METİNDEN KOD TÜRETİLİR: katalog metniyle eşleşen serbest metin koda çözülür
//    (eski istemciler ve elle girişler rapordan düşmesin).
// ④ `cancelledAt` HER iptal yolunda damgalanır — sebep verilmese de. Damgasız
//    satır "dönemde kaç iptal" sorusundan sessizce düşerdi.
// =============================================================================

import prisma from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-OCR-${ts}`;

  try {
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });
    let seq = 0;
    const mkOrder = async () =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId: customer.id,
          status: "APPROVED",
          lines: { create: [{ itemId: item.id, quantity: 100 }] },
        },
        select: { id: true },
      });
    const read = (id: string) =>
      prisma.order.findUniqueOrThrow({
        where: { id },
        select: { status: true, cancelledAt: true, cancelReason: true, cancelReasonCode: true },
      });

    console.log("\n── 1) Katalog kodu ile iptal ──");
    const o1 = await mkOrder();
    await orderService.cancelWithActions(o1.id, [], undefined, {
      reasonCode: "MUSTERI_VAZGECTI",
      reasonText: "Müşteri siparişten vazgeçti",
    });
    const r1 = await read(o1.id);
    check("statü CANCELLED", r1.status === "CANCELLED", r1.status);
    check("kod yazıldı", r1.cancelReasonCode === "MUSTERI_VAZGECTI", `${r1.cancelReasonCode}`);
    check("görünen metin yazıldı", (r1.cancelReason ?? "").length > 0, `${r1.cancelReason}`);
    check("cancelledAt damgalandı", r1.cancelledAt !== null, `${r1.cancelledAt}`);

    console.log("\n── 2) Serbest metin: kod UYDURULMAZ ──");
    const o2 = await mkOrder();
    await orderService.cancelWithActions(o2.id, [], undefined, {
      reasonText: `${TAG} tamamen özgün bir gerekçe, katalogda yok`,
    });
    const r2 = await read(o2.id);
    check("metin yazıldı", (r2.cancelReason ?? "").includes("özgün"), `${r2.cancelReason}`);
    check(
      "kod NULL kaldı (uydurulmadı)",
      r2.cancelReasonCode === null,
      `${r2.cancelReasonCode} — dolu ise serbest metne kod atanıyor`,
    );

    console.log("\n── 3) Metinden kod TÜRETİLİR ──");
    const o3 = await mkOrder();
    // Kod GÖNDERİLMİYOR; yalnız katalogdaki tam metin.
    await orderService.cancelWithActions(o3.id, [], undefined, {
      reasonText: "Fiyatta anlaşılamadı",
    });
    const r3 = await read(o3.id);
    check("sunucu kodu metinden çözdü", r3.cancelReasonCode === "FIYAT", `${r3.cancelReasonCode}`);

    console.log("\n── 4) Geçersiz kod iptali BAŞLATMADAN reddeder ──");
    const o4 = await mkOrder();
    let rejected = false;
    let detailsCode: string | undefined;
    try {
      await orderService.cancelWithActions(o4.id, [], undefined, { reasonCode: "BOYLE_BIR_KOD_YOK" });
    } catch (e) {
      rejected = true;
      detailsCode = (e as { details?: { code?: string } }).details?.code;
    }
    const r4 = await read(o4.id);
    check("geçersiz kod reddedildi", rejected);
    check("hata kodu REASON_CODE_INVALID", detailsCode === "REASON_CODE_INVALID", `${detailsCode}`);
    check(
      "sipariş İPTAL EDİLMEDİ (doğrulama tx'ten ÖNCE)",
      r4.status === "APPROVED",
      `${r4.status} — CANCELLED ise sebep doğrulaması iptalden SONRA koşuyor`,
    );

    console.log("\n── 5) Sebepsiz iptal: damga yine var ──");
    const o5 = await mkOrder();
    await orderService.cancelWithActions(o5.id, []);
    const r5 = await read(o5.id);
    check("statü CANCELLED", r5.status === "CANCELLED", r5.status);
    check("sebep NULL", r5.cancelReason === null && r5.cancelReasonCode === null);
    check("cancelledAt yine damgalandı", r5.cancelledAt !== null, `${r5.cancelledAt}`);
  } finally {
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
