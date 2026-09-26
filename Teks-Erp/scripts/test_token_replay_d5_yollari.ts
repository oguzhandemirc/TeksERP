// =============================================================================
// Bekçi: TOKEN REPLAY D5 — borç yolları tek boğazda; zorlanmış sıra + sıralı tekrar (DB'li)
// Çalıştır: npx tsx scripts/test_token_replay_d5_yollari.ts
// =============================================================================
// Plan `docs/design/TOKEN-REPLAY-KILIDI.md` §4 D5. Her yolda üç soru:
//   · eşzamanlı aynı token (zorlanmış sıra, `scripts/lib/zorlanmis-sira.ts`): ikisi de başarılı, tek kayıt;
//   · sıralı tekrar, arada master veri değişti: cevap TOKEN'DAN gelir, iş kuralından değil;
//   · 4. durum (iptal edilmiş kayıt) → yolun kodu · başka gövde → CLIENT_TOKEN_COLLISION · sahte 409 düzeltmeleri.
//   §1 tahsilat/ödeme · §2 çek/senet · §3 alış siparişi · §4 mal kabul fişi (D5a)
//   §5 levent planı · §6 dokuma işi (K′ 8032) · §7 fason dokuma kabulü (K′ iş emri claim'i) · §8 top indirme (K′ 8029) (D5b)
//   §9 top doğumu · §10 açık kumaş (K′) · §11 Tambur elle top (a′: bağlı topta erken yol + kendini onarma) ·
//   §12 kartsız bitmiş top · §13 çeki listesi · §14 iş emri arşivi · §15 birleştirilmiş parti (D5c)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Dokunulan ayarlar FOTOĞRAFINA döndürülür.
// =============================================================================
import { randomUUID } from "node:crypto";
import { MachineDataSource, Prisma, WarpBeamOrigin, WarpBeamStatus, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira, type KapiNoktasi, type ZorlanmisSiraSonucu } from "./lib/zorlanmis-sira";
import { paymentService } from "../src/services/payment.service";
import { chequeService } from "../src/services/cheque.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { createWeavingOrder } from "../src/services/weaving-order.service";
import { receiveForWeaving } from "../src/services/subcontractor-weaving.service";
import { openDoff, revokeDoff } from "../src/services/machine-doff.service";
import { InventoryService } from "../src/services/inventory.service";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { SackSearchService } from "../src/services/sack-search.service";
import { ShippingService } from "../src/services/shipping.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { addBatch } from "../src/services/workorder-batch-add.service";
import { createManualMoveFixture, type ManualMoveFixture } from "./fixture-manual-move";
import { fixtureWarehouseId } from "./fixture-warehouse";

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
  specIds: [] as string[], beamIds: [] as string[], weavingIds: [] as string[], subReceiptIds: [] as string[], stationIds: [] as string[],
  machineIds: [] as string[], doffIds: [] as string[], dispatchIds: [] as string[],
  rollIds: [] as string[], manifestIds: [] as string[], sackIds: [] as string[], woIds: [] as string[],
};
let fx: ManualMoveFixture | null = null;
const inv = new InventoryService();
const AYARLAR = [SETTING_KEYS.DEVERE_ENABLED];
let foto: Array<{ key: string; value: Prisma.JsonValue }> | null = null;

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

async function leventDokuma(): Promise<void> {
  console.log("§5 Levent planı · §6 dokuma işi");
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, create: { key: SETTING_KEYS.DEVERE_ENABLED, value: "true" }, update: { value: "true" } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  o.itemIds.push(yarn.id);
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  o.specIds.push(spec.id);
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  o.subIds.push(sub.id);
  {
    const t = randomUUID();
    const planla = (fiziksel: string | null) => () => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id, physicalBeamNo: fiziksel, clientToken: t });
    // B satırı yazmadan hemen önce bekler; A planlar. Eski kodda retry yüklemi yalnız beamNo — token P2002'si ham 409'du.
    await ikisiBasarili("⑤a levent planı", { model: "warpBeam", metod: "create" }, planla("G-1"), async () => (await prisma.warpBeam.count({ where: { clientToken: t } })) === 1);
    const b = await prisma.warpBeam.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (b) o.beamIds.push(b.id);
    check("⑤b aynı token + başka fiziksel levent no → 409 CLIENT_TOKEN_COLLISION (eskiden kıyaslanmıyordu)", (await kodu(planla("G-2"))) === "CLIENT_TOKEN_COLLISION");
    if (b) await prisma.warpBeam.update({ where: { id: b.id }, data: { status: WarpBeamStatus.SCRAPPED } });
    check("⑤c hurdaya ayrılmış leventin token'ı → 409 WARP_BEAM_SCRAPPED (eskiden 'zaten planlanmış')", (await kodu(planla("G-1"))) === "WARP_BEAM_SCRAPPED");
  }
  {
    const kumasId = await kumas("DK");
    const t = randomUUID();
    const ac = (warpSpecId?: string) => () => createWeavingOrder({ itemId: kumasId, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 1000, ...(warpSpecId ? { warpSpecId } : {}), clientToken: t });
    // B 8032'yi tutarken INSERT'ten önce bekler; A kilitte bekler, sonra token'ı kilidin arkasında okur (K′).
    // Eski kodda A tx'ten önce token'ı boş görür, kilitten sonra INSERT eder → token P2002'si ham 409.
    await ikisiBasarili("⑥a dokuma işi", { model: "weavingOrder", metod: "create" }, ac(), async () => (await prisma.weavingOrder.count({ where: { clientToken: t } })) === 1);
    const w = await prisma.weavingOrder.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (w) o.weavingIds.push(w.id);
    check("⑥b aynı token + başka çözgü kartı → 409 CLIENT_TOKEN_COLLISION (eskiden kıyaslanmıyordu)", (await kodu(ac(spec.id))) === "CLIENT_TOKEN_COLLISION");
  }
  {
    const kumasId = await kumas("FD");
    const is = await prisma.weavingOrder.create({
      data: { weavingOrderNumber: `${TAG}-FD`, itemId: kumasId, executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: sub.id, status: WeavingOrderStatus.PLANNED },
      select: { id: true },
    });
    o.weavingIds.push(is.id);
    console.log("§7 Fason dokuma kabulü");
    const t = randomUUID();
    const kabul = (irsaliye: string) => () => receiveForWeaving({ weavingOrderId: is.id, manifestNo: irsaliye, clientToken: t, rolls: [{ initialQty: 480, clientToken: randomUUID() }] });
    // B iş emri satırını claim'leyip INSERT'ten önce bekler; A claim'de bekler, sonra token'ı kilidin arkasında okur (K′).
    // Eski kodda catch yoktu: A'nın INSERT'i token P2002'siyle ham 409 alırdı.
    await ikisiBasarili("⑦a fason dokuma kabulü", { model: "subcontractorReceipt", metod: "create" }, kabul(`${TAG}-I1`), async () => (await prisma.subcontractorReceipt.count({ where: { clientToken: t } })) === 1);
    const r = await prisma.subcontractorReceipt.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) o.subReceiptIds.push(r.id);
    const [rp] = await Promise.allSettled([kabul(`${TAG}-I1`)()]);
    const rolls = rp.status === "fulfilled" ? ((rp.value as { data?: { rolls?: Array<{ initialQty?: unknown }> } }).data?.rolls ?? []) : [];
    check("⑦b ⭐ replay yanıtı ilk başarının biçiminde: toplar initialQty taşır (eskiden eksikti)", rolls.length === 1 && rolls[0]!.initialQty === 480, JSON.stringify(rolls));
    check("⑦c aynı token + başka irsaliye → 409 CLIENT_TOKEN_COLLISION", (await kodu(kabul(`${TAG}-I2`))) === "CLIENT_TOKEN_COLLISION");
    // Makbuz iptali önce topların iptalini ister; ölü hâl burada doğrudan damgayla kurulur (4. durumun okuduğu tek alan).
    if (r) await prisma.subcontractorReceipt.update({ where: { id: r.id }, data: { cancelledAt: new Date() } });
    check("⑦d iptal edilmiş makbuzun token'ı → 409 RECEIPT_CANCELLED", (await kodu(kabul(`${TAG}-I1`))) === "RECEIPT_CANCELLED");
  }
  {
    // Sevkte iki farklı müşterinin emanet leventi: sahip çözümü 409 OWNER_MISMATCH. Başlıktan ÖNCE koştuğu için makbuz
    // doğmaz (eskiden başlık yazılıp topsuz kalıyordu ve aynı token'ın tekrarı "0 top" replay'i dönüyordu).
    const kumasId = await kumas("FE");
    const is = await prisma.weavingOrder.create({
      data: { weavingOrderNumber: `${TAG}-FE`, itemId: kumasId, executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: sub.id, status: WeavingOrderStatus.PLANNED },
      select: { id: true },
    });
    o.weavingIds.push(is.id);
    const emanet = async (ek: string) => {
      const b = await prisma.warpBeam.create({
        data: { beamNo: `${TAG}-${ek}`, warpSpecId: spec.id, status: WarpBeamStatus.SHIPPED_OUT, plannedLengthM: 500, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: await musteri(`E${ek}`) },
        select: { id: true },
      });
      o.beamIds.push(b.id);
      return b.id;
    };
    const sevk = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-SD`, subcontractorId: sub.id, weavingOrderId: is.id }, select: { id: true } });
    o.dispatchIds.push(sevk.id);
    for (const beamId of [await emanet("B1"), await emanet("B2")]) {
      await prisma.subcontractorDispatchItem.create({ data: { dispatchId: sevk.id, kind: "WARP_BEAM", warpBeamId: beamId, dispatchedQty: 500 } });
    }
    const t = randomUUID();
    const sonuc = await kodu(() => receiveForWeaving({ weavingOrderId: is.id, clientToken: t, rolls: [{ initialQty: 100, clientToken: randomUUID() }] }));
    const baslik = await prisma.subcontractorReceipt.count({ where: { clientToken: t } });
    check("⑦e ⭐ karışık emanet sahibi → 409 OWNER_MISMATCH ve makbuz başlığı DOĞMAZ (eskiden topsuz başlık kalıyordu)", sonuc === "OWNER_MISMATCH" && baslik === 0, `${sonuc} · başlık ${baslik}`);
    const kalan = await prisma.subcontractorReceipt.findMany({ where: { weavingOrderId: is.id }, select: { id: true } });
    o.subReceiptIds.push(...kalan.map((r) => r.id));
  }
}

async function indirme(): Promise<void> {
  console.log("§8 Top indirme");
  const st = await prisma.station.create({ data: { name: `${TAG}-DF`, code: `${TAG}-DF`.slice(0, 32), type: "INTERNAL", isActive: true }, select: { id: true } });
  o.stationIds.push(st.id);
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32), isActive: true, productionLineCount: 1 }, select: { id: true } });
  o.machineIds.push(mk.id);
  const t = randomUUID();
  const indir = (adet: number) => () => openDoff({ machineId: mk.id, productionLineNo: 1, pieceCount: adet, counterSource: MachineDataSource.OPERATOR, clientToken: t });
  // B 8029'u tutarken INSERT'ten önce bekler; A kilitte bekler, sonra token'ı kilidin arkasında okur (K′).
  await ikisiBasarili("⑧a top indirme", { model: "doffEvent", metod: "create" }, indir(2), async () => (await prisma.doffEvent.count({ where: { clientToken: t } })) === 1);
  const d = await prisma.doffEvent.findUnique({ where: { clientToken: t }, select: { id: true } });
  if (d) o.doffIds.push(d.id);
  await prisma.machine.update({ where: { id: mk.id }, data: { isActive: false } });
  const [rp] = await Promise.allSettled([indir(2)()]);
  check("⑧b sıralı tekrar, makine arada pasif → replay, `idempotent: true` korunur (tablet okuyor)",
    rp.status === "fulfilled" && (rp.value as { idempotent?: boolean }).idempotent === true, sonucKodu(rp));
  await prisma.machine.update({ where: { id: mk.id }, data: { isActive: true } });
  check("⑧c aynı token + başka adet → 409 CLIENT_TOKEN_COLLISION", (await kodu(indir(3))) === "CLIENT_TOKEN_COLLISION");
  if (d) await revokeDoff(d.id, `${TAG} geri al`);
  check("⑧d geri alınmış indirmenin token'ı → 409 DOFF_REVOKED", (await kodu(indir(2))) === "DOFF_REVOKED");
}

async function topDogumu(): Promise<void> {
  console.log("§9 Top doğumu");
  const item = await kumas("TD");
  const w = await depo("TD");
  {
    const t = randomUUID();
    const gir = () => inv.createInitialEntry({ itemId: item, initialQty: 100, clientToken: t }, undefined, null, false, { warehouseId: w });
    await ikisiBasarili("⑨a top doğumu", { model: "roll", metod: "create" }, gir, async () => (await prisma.roll.count({ where: { clientToken: t } })) === 1);
    const r = await prisma.roll.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) o.rollIds.push(r.id);
    // Kart arada pasife alındı: eskiden ürün kapısı token okumasından önce koşardı → 400.
    await prisma.item.update({ where: { id: item }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } });
    const [rp] = await Promise.allSettled([gir()]);
    check("⑨b ⭐ sıralı tekrar, kart arada pasif → cevap token'dan (idempotent: true), iş kuralından değil",
      rp.status === "fulfilled" && (rp.value as { idempotent?: boolean }).idempotent === true, sonucKodu(rp));
    await prisma.item.update({ where: { id: item }, data: { isActive: true, lifecycleStatus: "ACTIVE" } });
  }
  {
    const gr1 = ((await goodsReceiptService.create({ warehouseId: w })).data as { id: string }).id;
    const gr2 = ((await goodsReceiptService.create({ warehouseId: w })).data as { id: string }).id;
    o.receiptIds.push(gr1, gr2);
    const t = randomUUID();
    const satir = (gr: string) => () => inv.createInitialEntry({ itemId: item, initialQty: 50, clientToken: t }, undefined, null, false, { warehouseId: w, goodsReceiptId: gr });
    check("⑨c fiş satırı ilk doğum", (await kodu(satir(gr1))) === "ok");
    const r = await prisma.roll.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) o.rollIds.push(r.id);
    check("⑨d aynı satır token'ı BAŞKA fişte → 409 CLIENT_TOKEN_COLLISION (eskiden o fişin topunu dönüyordu)", (await kodu(satir(gr2))) === "CLIENT_TOKEN_COLLISION");
  }
}

async function tambur(): Promise<void> {
  console.log("§10 Açık kumaş · §11 Tambur elle top · §12 kartsız bitmiş top");
  fx = await createManualMoveFixture(1);
  const kursun = fx.stepIdBySeq[3]!;
  const tamburAdim = fx.stepIdBySeq[4]!;
  await prisma.workOrderStep.update({ where: { id: kursun }, data: { status: "ACTIVE" } });
  const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: fx.woId }, select: { targetItemId: true, targetColorId: true } });
  const svc = new TamburManualService();
  {
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-AK`, name: `${TAG} açık kumaş fasoncu` }, select: { id: true } });
    o.subIds.push(sub.id);
    const rc = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${TAG}-AK`, subcontractorId: sub.id, workOrderId: fx.woId, stepId: fx.stepIdBySeq[1]! }, select: { id: true } });
    o.subReceiptIds.push(rc.id);
    const t = randomUUID();
    const ac = () => inv.createOpenFabric({ receiptId: rc.id, stepId: kursun, clientToken: t });
    const [ilk] = await Promise.allSettled([ac()]);
    check("⑩a açık kumaş ilk doğum", ilk.status === "fulfilled", sonucKodu(ilk));
    const r = await prisma.roll.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) {
      o.rollIds.push(r.id);
      // Top ilerledi: `currentStepId` artık Tambur. Kimlik doğuş adımıdır.
      await prisma.roll.update({ where: { id: r.id }, data: { currentStepId: tamburAdim } });
    }
    check("⑩b ⭐ top ilerledikten sonra tekrar → replay (eskiden currentStepId kıyası sahte 409 veriyordu)", (await kodu(ac)) === "ok");
  }
  {
    // Kendini onarma: faz 1 (top doğumu) oldu, faz 2 (bağlama) olmadı — aynı token'ın tekrarı bağlar.
    const t = randomUUID();
    const dogum = await inv.createInitialEntry({ itemId: wo.targetItemId!, colorId: wo.targetColorId, initialQty: 60, clientToken: t }, undefined, null, false, {});
    o.rollIds.push(dogum.data.id);
    const ekle = () => svc.createManualRoll({ targetStepId: tamburAdim, initialQty: 60, reason: `${TAG} onarma`, clientToken: t, batchId: fx!.batchId }, {});
    const [rp] = await Promise.allSettled([ekle()]);
    const bagli = await prisma.roll.findUniqueOrThrow({ where: { id: dogum.data.id }, select: { currentStepId: true } });
    check("⑪a ⭐ kendini onarma: bağlanmamış topun token'ıyla tekrar → bağlar (tek top)",
      rp.status === "fulfilled" && bagli.currentStepId === tamburAdim && (await prisma.roll.count({ where: { clientToken: t } })) === 1, sonucKodu(rp));
  }
  {
    const t = randomUUID();
    const ekle = (m: number) => () => svc.createManualRoll({ targetStepId: tamburAdim, initialQty: m, reason: `${TAG} elle top`, clientToken: t, batchId: fx!.batchId }, {});
    check("⑪b elle top ilk kayıt", (await kodu(ekle(70))) === "ok");
    const r = await prisma.roll.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) o.rollIds.push(r.id);
    // İş emri arada TAMAMLANDI: bağlama kapıları 409 verir; (a′) erken yolu cevabı token'dan verir.
    await prisma.workOrder.update({ where: { id: fx.woId }, data: { status: "COMPLETED" } });
    const [rp] = await Promise.allSettled([ekle(70)()]);
    check("⑪c ⭐ iş emri arada tamamlandı → replay, alreadyAttached: true (eskiden 409)",
      rp.status === "fulfilled" && (rp.value as { data?: { alreadyAttached?: boolean } }).data?.alreadyAttached === true, sonucKodu(rp));
    // Erken yol boğazın resolve'undan geçer: gövde kapısı ve 4. durum iş emri kapalıyken de çalışır.
    check("⑪d erken yolda gövde kapısı: başka metre → 409 CLIENT_TOKEN_COLLISION", (await kodu(ekle(71))) === "CLIENT_TOKEN_COLLISION");
    if (r) await prisma.roll.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    check("⑪e erken yolda 4. durum: iptal edilmiş top → 409 ENTRY_CANCELLED", (await kodu(ekle(70))) === "ENTRY_CANCELLED");
    await prisma.workOrder.update({ where: { id: fx.woId }, data: { status: "IN_PROGRESS" } });
  }
  {
    const t = randomUUID();
    const uret = (m: number) => () => svc.produceFinishedRoll({ itemId: wo.targetItemId!, initialQty: m, reason: `${TAG} kartsız`, clientToken: t, markedForKartela: false }, {});
    // B top satırını yazmadan hemen önce bekler; A üretir. Kaybeden de replay'dir → idempotentReplay: true, ikinci audit yok.
    const s12 = await zorlanmisSira({ model: "roll", metod: "create" }, uret(80), uret(80));
    const r = await prisma.roll.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (r) o.rollIds.push(r.id);
    const tekrar = s12.sonuclar.map((x) => (x.status === "fulfilled" ? (x.value as { data?: { idempotentReplay?: boolean } }).data?.idempotentReplay : undefined));
    check("⑫a kartsız bitmiş top: sıra zorlandı", SIRA_ZORLANDI.has(s12.kapi), s12.kapi);
    check("⑫b ⭐ eşzamanlı aynı token: ikisi de başarılı, tek top, kaybeden idempotentReplay: true (eskiden false)",
      s12.sonuclar.every((x) => x.status === "fulfilled") && tekrar.filter((v) => v === true).length === 1 && (await prisma.roll.count({ where: { clientToken: t } })) === 1, ozet(s12));
    const audit = r ? await prisma.systemLog.count({ where: { recordId: r.id, action: "CREATE" } }) : -1;
    check("⑫c replay'de ikinci CREATE audit yazılmaz (ilk doğumun iki satırı: top + Tambur olayı)", audit === 2, `${audit} satır`);
    check("⑫d aynı token + başka metre → 409 CLIENT_TOKEN_COLLISION", (await kodu(uret(81))) === "CLIENT_TOKEN_COLLISION");
  }
}

async function cekiArsivParti(): Promise<void> {
  console.log("§13 Çeki listesi · §14 iş emri arşivi · §15 birleştirilmiş parti");
  const m = await musteri("CL");
  const shipping = new ShippingService();
  const cuval = async () => {
    const s = (await shipping.openSack({ customerId: m, clientToken: randomUUID() })).data as { id: string };
    o.sackIds.push(s.id);
    return s.id;
  };
  {
    const a = await cuval();
    const b = await cuval();
    const t = randomUUID();
    const bas = (ids: string[]) => () => new SackSearchService().printPickList(ids, undefined, t);
    check("⑬a çeki listesi ilk basım", (await kodu(bas([a]))) === "ok");
    const mf = await prisma.manifest.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (mf) o.manifestIds.push(mf.id);
    const [rp] = await Promise.allSettled([bas([a])()]);
    check("⑬b aynı token + aynı çuval → aynı liste (reused: true)", rp.status === "fulfilled" && (rp.value as { data?: { reused?: boolean } }).data?.reused === true, sonucKodu(rp));
    check("⑬c ⭐ aynı token + başka çuval kümesi → 409 CLIENT_TOKEN_COLLISION (eskiden eski listeyi sessizce dönüyordu)", (await kodu(bas([a, b]))) === "CLIENT_TOKEN_COLLISION");
  }
  {
    const woSvc = new WorkOrderService();
    const st = await prisma.station.findUniqueOrThrow({ where: { code: "KURSUN_KK2" }, select: { id: true } });
    const item = await kumas("AR");
    const t = randomUUID();
    const ac = () => woSvc.create({ type: "STOCK_PRODUCTION", targetItemId: item, width: 150, steps: [{ stationId: st.id }], clientToken: t });
    const wo = ((await ac()).data as { id: string }).id;
    o.woIds.push(wo);
    await woSvc.hardDelete(wo, undefined);
    check("⑭a ⭐ panelden arşivlenen iş emrinin token'ı → 409 WORK_ORDER_CANCELLED (eskiden YENİ iş emri açıyordu)", (await kodu(ac)) === "WORK_ORDER_CANCELLED");
    check("⑭b arşiv token'ı tuttu, ikinci iş emri doğmadı", (await prisma.workOrder.count({ where: { clientToken: t } })) === 1);
  }
  {
    const woSvc = new WorkOrderService();
    const st = await prisma.station.findUniqueOrThrow({ where: { code: "KURSUN_KK2" }, select: { id: true } });
    const item = await kumas("BM");
    const wo = ((await woSvc.create({ type: "STOCK_PRODUCTION", targetItemId: item, width: 150, steps: [{ stationId: st.id }] })).data as { id: string }).id;
    o.woIds.push(wo);
    const topla = async () => {
      const r = await prisma.roll.create({ data: { barcode: `${TAG}-BM${o.rollIds.length}`, itemId: item, initialQty: 100, currentQty: 100, status: "STOCK", width: 150, warehouseId: await fixtureWarehouseId(), entrySource: "SUPPLIER_RECEIPT" }, select: { id: true, barcode: true } });
      o.rollIds.push(r.id);
      return r.barcode!;
    };
    const t = randomUUID();
    const b1 = await topla();
    const ekle = () => addBatch(wo, { clientToken: t, rollBarcodes: [b1] });
    check("⑮a parti ekle ilk kayıt", (await kodu(ekle)) === "ok");
    const p1 = await prisma.batch.findUniqueOrThrow({ where: { clientToken: t }, select: { id: true } });
    const p2 = ((await addBatch(wo, { clientToken: randomUUID(), rollBarcodes: [await topla()] })) as { data: { batch: { id: string } } }).data.batch.id;
    await prisma.batch.update({ where: { id: p1.id }, data: { mergedIntoId: p2 } });
    check("⑮b birleştirilmiş partinin token'ı → 409 BATCH_MERGED (eskiden 'başka toplar' çakışması)", (await kodu(ekle)) === "BATCH_MERGED");
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
  foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  await odemeCek();
  await alisSiparisi();
  await malKabul();
  await leventDokuma();
  await indirme();
  await topDogumu();
  await tambur();
  await cekiArsivParti();
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
  if (foto) {
    for (const key of AYARLAR) {
      const eski = foto.find((f) => f.key === key);
      await adim(`ayar ${key}`, () =>
        eski ? prisma.systemSetting.update({ where: { key }, data: { value: eski.value as Prisma.InputJsonValue } }) : prisma.systemSetting.deleteMany({ where: { key } }),
      );
    }
  }
  await adim("D5c topları", async () => {
    const ids = [...o.rollIds, ...(await prisma.roll.findMany({ where: { OR: [{ goodsReceiptId: { in: o.receiptIds } }, { parentReceiptId: { in: o.subReceiptIds } }] }, select: { id: true } })).map((r) => r.id)];
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.roll.updateMany({ where: { id: { in: ids } }, data: { batchId: null, currentStepId: null, sackId: null } });
    await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  });
  await adim("çeki listeleri", () => prisma.manifest.deleteMany({ where: { id: { in: o.manifestIds } } }));
  await adim("çuvallar", () => prisma.sack.deleteMany({ where: { id: { in: o.sackIds } } }));
  await adim("iş emirleri", async () => {
    const w = { workOrderId: { in: o.woIds } };
    await prisma.travelerCardScan.deleteMany({ where: { card: w } });
    await prisma.travelerCard.deleteMany({ where: w });
    await prisma.batch.updateMany({ where: w, data: { mergedIntoId: null } });
    await prisma.batch.deleteMany({ where: w });
    // `work_order_events` defterdir: satır yalnız iş emriyle birlikte (FK kaskadı) gider.
    await prisma.workOrderStep.deleteMany({ where: w });
    await prisma.workOrder.deleteMany({ where: { id: { in: o.woIds } } });
  });
  if (fx) {
    const f = fx;
    await adim("Tambur fikstürü", async () => {
      await prisma.batch.deleteMany({ where: { workOrderId: f.woId, id: { not: f.batchId } } });
      await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: f.woId } });
      await f.teardown();
    });
  }
  const dokumaToplari = o.subReceiptIds.length ? (await prisma.roll.findMany({ where: { parentReceiptId: { in: o.subReceiptIds } }, select: { id: true } })).map((r) => r.id) : [];
  await adim("dokuma topları", async () => {
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: dokumaToplari } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: dokumaToplari } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: dokumaToplari } } });
    await prisma.roll.deleteMany({ where: { id: { in: dokumaToplari } } });
  });
  await adim("fason makbuzları", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: o.subReceiptIds } } }));
  await adim("fason sevkleri", async () => {
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: o.dispatchIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: o.dispatchIds } } });
  });
  await adim("dokuma işleri", async () => {
    await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: o.weavingIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: o.weavingIds } } });
  });
  await adim("leventler", async () => {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: o.beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: o.beamIds } } });
  });
  await adim("çözgü kartı", () => prisma.warpSpec.deleteMany({ where: { id: { in: o.specIds } } }));
  await adim("indirmeler", () => prisma.doffEvent.deleteMany({ where: { id: { in: o.doffIds } } }));
  await adim("makineler", () => prisma.machine.deleteMany({ where: { id: { in: o.machineIds } } }));
  await adim("istasyonlar", () => prisma.station.deleteMany({ where: { id: { in: o.stationIds } } }));
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
