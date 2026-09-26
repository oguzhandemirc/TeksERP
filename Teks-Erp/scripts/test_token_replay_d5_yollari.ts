// =============================================================================
// Bekçi: TOKEN REPLAY D5 — borç yolları tek boğazda; zorlanmış sıra + sıralı tekrar (DB'li)
// Çalıştır: npx tsx scripts/test_token_replay_d5_yollari.ts
// =============================================================================
// Plan `docs/design/TOKEN-REPLAY-KILIDI.md` §4 D5. Her yolda üç soru:
//   · eşzamanlı aynı token (zorlanmış sıra, `scripts/lib/zorlanmis-sira.ts`): ikisi de başarılı, tek kayıt;
//   · sıralı tekrar, arada master veri değişti: cevap TOKEN'DAN gelir, iş kuralından değil;
//   · 4. durum (iptal edilmiş kayıt) → yolun kodu · başka gövde → CLIENT_TOKEN_COLLISION · sahte 409 düzeltmeleri.
//   §1 tahsilat/ödeme · §2 çek/senet · §3 alış siparişi · §4 mal kabul fişi (D5a)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira, type KapiNoktasi, type ZorlanmisSiraSonucu } from "./lib/zorlanmis-sira";
import { paymentService } from "../src/services/payment.service";
import { chequeService } from "../src/services/cheque.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function kodu(fn: () => Promise<unknown>): Promise<string> {
  const [r] = await Promise.allSettled([fn()]);
  return sonucKodu(r);
}
const ozet = (s: ZorlanmisSiraSonucu) => `B | A = ${s.sonuclar.map(sonucKodu).join(" | ")} · kapı: ${s.kapi}`;
/** Aynı token, aynı gövde, zorlanmış sıra: sıra zorlandı + ikisi de başarılı + `tek()` doğru. */
async function ikisiBasarili(ad: string, nokta: KapiNoktasi, f: () => Promise<unknown>, tek: () => Promise<boolean>): Promise<void> {
  const s = await zorlanmisSira(nokta, f, f);
  check(`${ad}: sıra zorlandı (B kapıda bekledi)`, SIRA_ZORLANDI.has(s.kapi), s.kapi);
  check(`${ad} ⭐ aynı token eşzamanlı: ikisi de başarılı, tek kayıt`, s.sonuclar.every((r) => r.status === "fulfilled") && (await tek()), ozet(s));
}

const TAG = `TRD5${Date.now().toString(36).toUpperCase()}`;
const o = {
  customerIds: [] as string[], subIds: [] as string[], itemIds: [] as string[], cashBoxIds: [] as string[], warehouseIds: [] as string[],
  paymentIds: [] as string[], chequeIds: [] as string[], orderIds: [] as string[], receiptIds: [] as string[],
};

async function musteri(ek: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek}` }, select: { id: true } });
  o.customerIds.push(c.id);
  return c.id;
}
async function kumas(ek: string): Promise<string> {
  const i = await prisma.item.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} kumaş ${ek}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  o.itemIds.push(i.id);
  return i.id;
}
async function depo(ek: string): Promise<string> {
  const w = await prisma.warehouse.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek} deposu` }, select: { id: true } });
  o.warehouseIds.push(w.id);
  return w.id;
}

async function odemeCek(): Promise<void> {
  console.log("§1 Tahsilat/ödeme · §2 çek/senet");
  const m = await musteri("M1");
  const m2 = await musteri("M2");
  const kasa = (await prisma.cashBox.create({ data: { code: `${TAG}-KS`.slice(0, 32), name: `${TAG} Kasa`, currency: "TRY" }, select: { id: true } })).id;
  o.cashBoxIds.push(kasa);
  {
    const t = randomUUID();
    const ode = (customerId = m) => () => paymentService.create({ direction: "IN", method: "CASH", customerId, currency: "TRY", amount: 150, cashBoxId: kasa, clientToken: t });
    // B ödeme satırını yazmadan hemen önce bekler; A kaydeder. Kaybeden token P2002'sini alır → cevap token'dan.
    await ikisiBasarili("①a tahsilat", { model: "payment", metod: "create" }, ode(), async () => (await prisma.payment.count({ where: { clientToken: t } })) === 1);
    const p = await prisma.payment.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (p) o.paymentIds.push(p.id);
    check("①b aynı token + başka cari → 409 CLIENT_TOKEN_COLLISION (eskiden taraf kıyaslanmıyordu: sessiz başarı)", (await kodu(ode(m2))) === "CLIENT_TOKEN_COLLISION");
    if (p) await paymentService.cancel(p.id, `${TAG} iptal`);
    check("①c iptal edilmiş tahsilatın token'ı → 409 PAYMENT_CANCELLED (eskiden 'zaten oluşturulmuş')", (await kodu(ode())) === "PAYMENT_CANCELLED");
  }
  {
    const t = randomUUID();
    const vade = new Date("2026-12-31T00:00:00.000Z");
    const al = (dueDate = vade) => () => chequeService.create({ kind: "RECEIVED", customerId: m, currency: "TRY", amount: 900, dueDate, serialNo: " 1234 ", clientToken: t });
    await ikisiBasarili("②a alınan çek", { model: "cheque", metod: "create" }, al(), async () => (await prisma.cheque.count({ where: { clientToken: t } })) === 1);
    const c = await prisma.cheque.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (c) o.chequeIds.push(c.id);
    check("②b aynı token + başka vade → 409 CLIENT_TOKEN_COLLISION (eskiden vade kıyaslanmıyordu)", (await kodu(al(new Date("2027-01-31T00:00:00.000Z")))) === "CLIENT_TOKEN_COLLISION");
    if (c) await chequeService.cancel(c.id, `${TAG} iptal`);
    check("②c iptal edilmiş çekin token'ı → 409 CHEQUE_CANCELLED", (await kodu(al())) === "CHEQUE_CANCELLED");
  }
}

async function alisSiparisi(): Promise<void> {
  console.log("§3 Alış siparişi");
  const item = await kumas("PO");
  const tedarikci = await musteri("T1");
  const satir = [{ itemId: item, qty: 500, unitPrice: 12 }];
  {
    const t = randomUUID();
    const ac = () => purchaseOrderService.create({ supplierId: tedarikci, currency: "TRY", lines: satir, clientToken: t });
    await ikisiBasarili("③a alış siparişi", { model: "purchaseOrder", metod: "create" }, ac, async () => (await prisma.purchaseOrder.count({ where: { clientToken: t } })) === 1);
    const po = await prisma.purchaseOrder.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (po) o.orderIds.push(po.id);
    // Tedarikçi sonradan pasife alındı: eski kodda tedarikçi kapısı ön-okumadan ÖNCE koşardı → 400 "pasif durumda".
    await prisma.customer.update({ where: { id: tedarikci }, data: { isActive: false } });
    check("③b ⭐ sıralı tekrar, tedarikçi arada pasif → cevap token'dan (replay), iş kuralından değil", (await kodu(ac)) === "ok");
    await prisma.customer.update({ where: { id: tedarikci }, data: { isActive: true } });
    if (po) await purchaseOrderService.cancel(po.id, `${TAG} iptal`);
    check("③c iptal edilmiş siparişin token'ı → 409 PURCHASE_ORDER_CANCELLED", (await kodu(ac)) === "PURCHASE_ORDER_CANCELLED");
  }
  {
    // Fasoncu profili bir karta bağlı: saklanan taraf KART kimliğidir. Eski kod gelen fasoncu id'sini saklanan
    // kartla kıyaslayıp meşru tekrarı 409'a düşürüyordu.
    const kart = await musteri("KB");
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-FS`, name: `${TAG} Fason`, customerId: kart }, select: { id: true } });
    o.subIds.push(sub.id);
    const t = randomUUID();
    const ac = () => purchaseOrderService.create({ subcontractorId: sub.id, currency: "TRY", lines: satir, clientToken: t });
    check("③d karta bağlı fasoncuyla ilk sipariş", (await kodu(ac)) === "ok");
    const po = await prisma.purchaseOrder.findUnique({ where: { clientToken: t }, select: { id: true, supplierId: true } });
    if (po) o.orderIds.push(po.id);
    check("③e ⭐ aynı gövdeyle tekrar → replay (eskiden sahte CLIENT_TOKEN_COLLISION)", po?.supplierId === kart && (await kodu(ac)) === "ok");
  }
}

async function malKabul(): Promise<void> {
  console.log("§4 Mal kabul fişi");
  const w = await depo("GR");
  {
    const t = randomUUID();
    const ac = () => goodsReceiptService.create({ warehouseId: w, deliveryNoteNo: `  ${TAG}-IRS `, clientToken: t });
    // B başlığı yazmadan hemen önce bekler; A açar. Eski kod token P2002'sini yüklemsiz 5 kez yeniden dener ve
    // B'ye "Barkod üretimi 5 denemede başarısız" 409'u verirdi (panel bunu kesin 4xx sayıp token'ı yeniler).
    await ikisiBasarili("④a mal kabul", { model: "goodsReceipt", metod: "create" }, ac, async () => (await prisma.goodsReceipt.count({ where: { clientToken: t } })) === 1);
    const gr = await prisma.goodsReceipt.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (gr) o.receiptIds.push(gr.id);
    const [r] = await Promise.allSettled([ac()]);
    const veri = r.status === "fulfilled" ? ((r.value as { data?: { failed?: unknown; purchaseOrder?: unknown } }).data ?? {}) : {};
    check("④b ⭐ boşluklu irsaliye no ile sıralı tekrar → replay (eskiden sahte 409); yanıt ilk başarının biçiminde",
      r.status === "fulfilled" && Array.isArray(veri.failed) && veri.purchaseOrder === null, sonucKodu(r));
    await prisma.warehouse.update({ where: { id: w }, data: { isActive: false } });
    check("④c ⭐ sıralı tekrar, depo arada pasif → cevap token'dan (eskiden 400 'deposu pasif')", (await kodu(ac)) === "ok");
    await prisma.warehouse.update({ where: { id: w }, data: { isActive: true } });
    if (gr) await goodsReceiptService.cancel(gr.id, `${TAG} iptal`);
    check("④d iptal edilmiş fişin token'ı → 409 GOODS_RECEIPT_CANCELLED", (await kodu(ac)) === "GOODS_RECEIPT_CANCELLED");
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Token replay — D5 yolları ===\n");
  await odemeCek();
  await alisSiparisi();
  await malKabul();
}

async function temizlik(): Promise<void> {
  const adim = async (ad: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      fail++;
      console.error(`  ❌ temizlik "${ad}" düştü: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const kartlar = [...o.customerIds];
  const cariler = (await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: kartlar } }, { subcontractorId: { in: o.subIds } }] }, select: { id: true } })).map((c) => c.id);
  await adim("belgeler", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...o.paymentIds, ...o.chequeIds, ...o.receiptIds] } } }));
  await adim("kasa hareketleri", () => prisma.cashTransaction.deleteMany({ where: { OR: [{ paymentId: { in: o.paymentIds } }, { cashBoxId: { in: o.cashBoxIds } }] } }));
  await adim("çek olayları", () => prisma.chequeEvent.deleteMany({ where: { chequeId: { in: o.chequeIds } } }));
  await adim("cari satırları", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariler } } }));
  await adim("ödemeler", () => prisma.payment.deleteMany({ where: { id: { in: o.paymentIds } } }));
  await adim("çekler", () => prisma.cheque.deleteMany({ where: { id: { in: o.chequeIds } } }));
  await adim("fişler", () => prisma.goodsReceipt.deleteMany({ where: { id: { in: o.receiptIds } } }));
  await adim("siparişler", async () => {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: o.orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: o.orderIds } } });
  });
  await adim("cari", async () => {
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: cariler } } });
  });
  await adim("kasa", () => prisma.cashBox.deleteMany({ where: { id: { in: o.cashBoxIds } } }));
  await adim("depolar", () => prisma.warehouse.deleteMany({ where: { id: { in: o.warehouseIds } } }));
  await adim("kartlar", () => prisma.item.deleteMany({ where: { id: { in: o.itemIds } } }));
  await adim("fasoncu", () => prisma.subcontractor.deleteMany({ where: { id: { in: o.subIds } } }));
  await adim("müşteriler", () => prisma.customer.deleteMany({ where: { id: { in: kartlar } } }));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
