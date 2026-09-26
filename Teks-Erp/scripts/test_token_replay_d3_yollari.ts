// =============================================================================
// Bekçi: TOKEN REPLAY D3 — kalan (a) yolları tek boğazda; yol başına ZORLANMIŞ SIRA (DB'li)
// Çalıştır: npx tsx scripts/test_token_replay_d3_yollari.ts
// =============================================================================
// Plan `docs/design/TOKEN-REPLAY-KILIDI.md` §4 D3. Her yol için kaybedenin düştüğü iş kuralı penceresi
// ZORLANARAK açılır (`scripts/lib/zorlanmis-sira.ts`; tx'ten önce koşan kural için `kapsam: "dis"`): B token'ı
// okur, kuralda bekler; A aynı token'la koşar. Beklenen: ikisi de başarılı, tek kayıt — iş kuralı 4xx'i değil.
//   §1 sevkiyat (#1) · §2 hızlı sevk (#2) · §3 çuval aç, varsayılan mod (#15) · §4 paketleme grubu (#14, K′)
//   §5 levent bağlama (#3) · §6 sarım (#4) · §7 fason levent dönüşü (#5) · §8 tezgah koşumu (#7)
//   §9 hızlı iş emri (#12) · §10 parti ekle (#13, K′) · §11 depo transferi (#16) · §12 fatura taslağı (#17)
// Ek olarak yeni 409'lar: başka gövde → CLIENT_TOKEN_COLLISION · geri alınmış/iptal → yolun 4. durum kodu.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Dokunulan ayarlar FOTOĞRAFINA döndürülür.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, RollStatus, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira, type KapiNoktasi, type ZorlanmisSiraSonucu } from "./lib/zorlanmis-sira";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ShippingService } from "../src/services/shipping.service";
import { PackingGroupService } from "../src/services/packing-group.service";
import { InventoryService } from "../src/services/inventory.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { cancelWarpBeamReturn, returnWarpBeam } from "../src/services/subcontractor-beam.service";
import { openMachineRun } from "../src/services/machine-run.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { addBatch } from "../src/services/workorder-batch-add.service";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { invoiceService } from "../src/services/invoice.service";

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
  check(`${ad} ⭐ aynı token eşzamanlı: ikisi de başarılı, tek kayıt (kaybeden iş kuralı 4xx'i almaz)`,
    s.sonuclar.every((r) => r.status === "fulfilled") && (await tek()), ozet(s));
}

const TAG = `TRD3${Date.now().toString(36).toUpperCase()}`;
const AYARLAR = [SETTING_KEYS.PACKING_GROUPS_ENABLE, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.IPLIK_ENABLED];
let foto: Array<{ key: string; value: Prisma.JsonValue }> | null = null;
const ayar = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

const o = {
  customerIds: [] as string[], itemIds: [] as string[], rollIds: [] as string[], sackIds: [] as string[], shipmentIds: [] as string[],
  groupIds: [] as string[], beamIds: [] as string[], specIds: [] as string[], subIds: [] as string[], stationIds: [] as string[],
  machineIds: [] as string[], woIds: [] as string[], dispatchIds: [] as string[], warehouseIds: [] as string[], transferIds: [] as string[],
  invoiceIds: [] as string[],
};
const shipping = new ShippingService();
const inv = new InventoryService();
const woSvc = new WorkOrderService();

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
let seq = 0;
async function top(itemId: string, status: RollStatus, ek: Partial<Prisma.RollUncheckedCreateInput> = {}): Promise<{ id: string; barcode: string }> {
  seq++;
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-R${seq}`, itemId, initialQty: 100, currentQty: 100, status, warehouseId: await fixtureWarehouseId(), entrySource: "SUPPLIER_RECEIPT", ...ek },
    select: { id: true, barcode: true },
  });
  o.rollIds.push(r.id);
  return { id: r.id, barcode: r.barcode! };
}

async function sevkiyat(): Promise<void> {
  console.log("§1 Sevkiyat (#1) · §2 hızlı sevk (#2) · §3 çuval aç (#15, varsayılan mod)");
  const m = await musteri("M1");
  const item = await kumas("K1");
  const cuval = async () => {
    const s = (await shipping.openSack({ customerId: m, clientToken: randomUUID() })).data as { id: string };
    o.sackIds.push(s.id);
    await top(item, RollStatus.WAREHOUSE, { sackId: s.id });
    return s.id;
  };
  const sevk = (sackIds: string[], t: string) => () => shipping.createShipment({ sackIds, customerId: m, orderless: true, clientToken: t });
  const sevkSayisi = (t: string) => prisma.shipment.count({ where: { clientToken: t } });
  {
    const s1 = await cuval();
    const t = randomUUID();
    // B token'ı okur, tx ÖNCESİ çuval kontrolünde (`loadSacksForShipment`) bekler; A aynı çuvalla sevk eder.
    await ikisiBasarili("①a sevkiyat", { model: "sack", metod: "findMany", kapsam: "dis" }, sevk([s1], t), async () => (await sevkSayisi(t)) === 1);
    const s2 = await cuval();
    check("①b aynı token + başka çuval kümesi → 409 CLIENT_TOKEN_COLLISION (eskiden gövde kapısı yoktu)", (await kodu(sevk([s1, s2], t))) === "CLIENT_TOKEN_COLLISION");
  }
  {
    const r = await top(item, RollStatus.WAREHOUSE);
    const t = randomUUID();
    const hizli = () => shipping.createShipmentFromRolls({ rollIds: [r.id], customerId: m, orderless: true, clientToken: t });
    // B tx ÖNCESİ top kontrolünde bekler; A aynı toplarla hızlı sevk eder.
    await ikisiBasarili("②a hızlı sevk", { model: "roll", metod: "findMany", kapsam: "dis" }, hizli, async () => (await sevkSayisi(t)) === 1);
  }
  {
    const t = randomUUID();
    const ac = () => shipping.openSack({ customerId: m, clientToken: t });
    // Varsayılan mod kilitsizdir (8033/8035 yok): B çuvalı yazarken bekler, A aynı token'la açar.
    await ikisiBasarili("③a çuval aç (varsayılan mod, kilitsiz)", { model: "sack", metod: "create" }, ac, async () => (await prisma.sack.count({ where: { clientToken: t } })) === 1);
    const m2 = await musteri("M2");
    check("③b aynı token + başka müşteri → 409 CLIENT_TOKEN_COLLISION", (await kodu(() => shipping.openSack({ customerId: m2, clientToken: t }))) === "CLIENT_TOKEN_COLLISION");
    const sk = await prisma.sack.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (sk) o.sackIds.push(sk.id);
  }
}

async function paketlemeGrubu(): Promise<void> {
  console.log("§4 Paketleme grubu (#14, K′ 8034)");
  await ayar(SETTING_KEYS.PACKING_GROUPS_ENABLE, "true");
  const m = await musteri("PG");
  const sk = (await shipping.openSack({ customerId: m, clientToken: randomUUID() })).data as { id: string };
  o.sackIds.push(sk.id);
  const t = randomUUID();
  const kur = () => PackingGroupService.createWithSacks({ customerId: m, sackIds: [sk.id], clientToken: t });
  // B 8034'ü alıp grubu yazarken bekler; A aynı kilitte bekler, sonra token'ı kilidin ARKASINDA okur.
  await ikisiBasarili("④a paketleme grubu", { model: "packingGroup", metod: "create" }, kur, async () => (await prisma.packingGroup.count({ where: { clientToken: t } })) === 1);
  const g = await prisma.packingGroup.findUnique({ where: { clientToken: t }, select: { id: true } });
  if (g) o.groupIds.push(g.id);
}

async function levent(): Promise<void> {
  console.log("§5 Levent bağlama (#3) · §6 sarım (#4) · §7 fason levent dönüşü (#5)");
  await ayar(SETTING_KEYS.DEVERE_ENABLED, "true");
  await ayar(SETTING_KEYS.DEVERE_MOUNT_TRACKING, "true");
  await ayar(SETTING_KEYS.IPLIK_ENABLED, "false");
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  o.itemIds.push(yarn.id);
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  o.specIds.push(spec.id);
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  o.subIds.push(sub.id);
  const planla = async () => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    o.beamIds.push(p.data.id);
    return p.data.id;
  };
  const sar = (id: string, m: number, t: string | null) => () => windWarpBeam(id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL, clientToken: t });
  const woundSayisi = (id: string) => prisma.warpBeamEvent.count({ where: { beamId: id, kind: "WOUND" } });

  // §5 bağlama
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, consumesWarpBeam: true }, select: { id: true } });
  o.stationIds.push(stLoom.id);
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
  o.machineIds.push(loom.id);
  {
    const b = await planla();
    await sar(b, 500, null)();
    const t = randomUUID();
    const bagla = (pos: number) => () => mountBeam(b, { machineId: loom.id, position: pos, clientToken: t });
    // B leventi okurken (`loadBeamTx`) bekler; A bağlar. Eski kod B'ye 409 WARP_BEAM_STATE verirdi.
    await ikisiBasarili("⑤a levent bağlama", { model: "warpBeam", metod: "findUnique" }, bagla(1), async () => (await prisma.warpBeamEvent.count({ where: { clientToken: t } })) === 1);
    check("⑤b aynı token + başka yuva → 409 CLIENT_TOKEN_COLLISION (eskiden makine/yuva kıyaslanmıyordu)", (await kodu(bagla(2))) === "CLIENT_TOKEN_COLLISION");
  }
  // §6 sarım
  {
    const b = await planla();
    const t = randomUUID();
    // B claim'de (PLANNED → READY) bekler; A sarar. Eski kod B'ye 409 WARP_BEAM_STATE verirdi.
    await ikisiBasarili("⑥a sarım", { model: "warpBeam", metod: "updateMany" }, sar(b, 500, t), async () => (await woundSayisi(b)) === 1);
    check("⑥b aynı token + başka metre → 409 CLIENT_TOKEN_COLLISION (eskiden metre kıyaslanmıyordu)", (await kodu(sar(b, 480, t))) === "CLIENT_TOKEN_COLLISION");
  }
  // §7 fason levent dönüşü
  {
    const stHs = await prisma.station.create({ data: { name: `${TAG}-HASIL`, code: `${TAG}-HS`.slice(0, 32), type: StationType.EXTERNAL }, select: { id: true } });
    o.stationIds.push(stHs.id);
    const item = await kumas("KW");
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-W1`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item, steps: { create: [{ stationId: stHs.id, stepSequence: 1, status: "PENDING" }] } },
      include: { steps: true },
    });
    o.woIds.push(wo.id);
    const b = await planla();
    await sar(b, 500, null)();
    const d = await new SubcontractorService().dispatch({ workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: sub.id, rollIds: [], warpBeamIds: [b] }, undefined);
    const dispatchId = (d.data as { id: string }).id;
    o.dispatchIds.push(dispatchId);
    const t = randomUUID();
    const don = (m: number) => () => returnWarpBeam(dispatchId, { warpBeamId: b, lengthM: m, clientToken: t });
    // B claim'de (SHIPPED_OUT → READY) bekler; A dönüşü yazar.
    await ikisiBasarili("⑦a fason levent dönüşü", { model: "warpBeam", metod: "updateMany" }, don(450), async () => (await prisma.warpBeamEvent.count({ where: { clientToken: t } })) === 1);
    check("⑦b aynı token + başka metre → 409 CLIENT_TOKEN_COLLISION", (await kodu(don(440))) === "CLIENT_TOKEN_COLLISION");
    await cancelWarpBeamReturn(dispatchId, { warpBeamId: b, reason: `${TAG} yanlış dönüş` });
    check("⑦c geri alınmış dönüşün token'ı → 409 WARP_BEAM_EVENT_REVOKED (eskiden 'dönüşü zaten kaydedilmiş')", (await kodu(don(450))) === "WARP_BEAM_EVENT_REVOKED");
  }
}

async function kosum(): Promise<void> {
  console.log("§8 Tezgah koşumu (#7)");
  const st = await prisma.station.create({ data: { name: `${TAG}-MR`, code: `${TAG}-MR`.slice(0, 32), type: "INTERNAL", isActive: true }, select: { id: true } });
  o.stationIds.push(st.id);
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32), isActive: true, productionLineCount: 1 }, select: { id: true } });
  o.machineIds.push(mk.id);
  const t = randomUUID();
  const ac = () => openMachineRun({ machineId: mk.id, productionLineNo: 1, startedAt: new Date(Date.now() - 3600_000), clientToken: t });
  // B tx ÖNCESİ hat kontrolünde (`assertProductionLineFree`) bekler; A koşumu açar. Eski kod B'ye 409 PRODUCTION_LINE_OCCUPIED verirdi.
  await ikisiBasarili("⑧a tezgah koşumu", { model: "machineRun", metod: "findFirst", kapsam: "dis" }, ac, async () => (await prisma.machineRun.count({ where: { clientToken: t } })) === 1);
}

async function isEmri(): Promise<void> {
  console.log("§9 Hızlı iş emri (#12) · §10 parti ekle (#13, K′)");
  const st = await prisma.station.findUniqueOrThrow({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const item = await kumas("KQ");
  {
    const r = await top(item, RollStatus.STOCK, { width: 150 });
    const t = randomUUID();
    const bas = () => woSvc.quickStart({ steps: [{ stationId: st.id, notes: null }], rollBarcodes: [r.barcode], clientToken: t }, undefined);
    // B tx ÖNCESİ top doğrulamasında bekler; A iş emrini açıp topu bağlar. Eski kod B'ye 400 "Yalnız envanterdeki…" verirdi.
    await ikisiBasarili("⑨a hızlı iş emri", { model: "roll", metod: "findMany", kapsam: "dis" }, bas, async () => (await prisma.workOrder.count({ where: { clientToken: t } })) === 1);
    const wo = await prisma.workOrder.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (wo) o.woIds.push(wo.id);
    const baska = await kumas("KQ2");
    check("⑨b aynı token + başka hedef kumaş → 409 CLIENT_TOKEN_COLLISION",
      (await kodu(() => woSvc.quickStart({ steps: [{ stationId: st.id, notes: null }], rollBarcodes: [r.barcode], targetItemId: baska, clientToken: t }, undefined))) === "CLIENT_TOKEN_COLLISION");
    if (wo) {
      await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
      check("⑨c iptal edilmiş iş emrinin token'ı → 409 WORK_ORDER_CANCELLED", (await kodu(bas)) === "WORK_ORDER_CANCELLED");
    }
  }
  {
    const wo = ((await woSvc.create({ type: "STOCK_PRODUCTION", targetItemId: item, width: 150, steps: [{ stationId: st.id }] })).data as { id: string }).id;
    o.woIds.push(wo);
    const r = await top(item, RollStatus.STOCK, { width: 150 });
    const t = randomUUID();
    const ekle = (bc: string[]) => () => addBatch(wo, { clientToken: t, rollBarcodes: bc });
    // B iş emri kilidini alıp top claim'inde bekler; A aynı kilitte bekler, token'ı kilidin ARKASINDA okur.
    await ikisiBasarili("⑩a parti ekle", { model: "roll", metod: "updateMany" }, ekle([r.barcode]), async () => (await prisma.batch.count({ where: { clientToken: t } })) === 1);
    const r2 = await top(item, RollStatus.STOCK, { width: 150 });
    check("⑩b aynı token + başka top → 409 CLIENT_TOKEN_COLLISION (eskiden yalnız iş emri kıyaslanıyordu)", (await kodu(ekle([r2.barcode]))) === "CLIENT_TOKEN_COLLISION");
  }
}

async function depoFatura(): Promise<void> {
  console.log("§11 Depo transferi (#16) · §12 fatura taslağı (#17)");
  const item = await kumas("KT");
  const depo = async (ek: string) => {
    const w = await prisma.warehouse.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek} deposu` }, select: { id: true } });
    o.warehouseIds.push(w.id);
    return w.id;
  };
  const a = await depo("A");
  const b = await depo("B");
  {
    const r = ((await inv.createInitialEntry({ itemId: item, initialQty: 100 }, undefined, undefined, false, { warehouseId: a, forcedStatus: RollStatus.WAREHOUSE })).data as { id: string }).id;
    o.rollIds.push(r);
    const t = randomUUID();
    const tasi = () => warehouseTransferService.create({ fromWarehouseId: a, toWarehouseId: b, rollIds: [r], clientToken: t });
    // B transferi yazarken bekler; A taşır. Eski kod token P2002'sini predicate'siz 5 kez deneyip B'ye 400 verirdi.
    await ikisiBasarili("⑪a depo transferi", { model: "warehouseTransfer", metod: "create" }, tasi, async () => (await prisma.warehouseTransfer.count({ where: { clientToken: t } })) === 1);
    const tr = await prisma.warehouseTransfer.findUnique({ where: { clientToken: t }, select: { id: true } });
    if (tr) {
      o.transferIds.push(tr.id);
      await warehouseTransferService.cancel(tr.id, `${TAG} iptal`);
      check("⑪b iptal edilmiş transferin token'ı → 409 TRANSFER_CANCELLED (eskiden 'zaten yapılmış')", (await kodu(tasi)) === "TRANSFER_CANCELLED");
    }
  }
  {
    const m = await musteri("FT");
    const t = randomUUID();
    const kes = () => invoiceService.createDraft({ type: "SALES", customerId: m, currency: "TRY", lines: [{ description: `${TAG} kumaş`, qty: 100, unit: "m", unitPrice: 25, vatRate: 20 }], clientToken: t });
    const d = await kes();
    o.invoiceIds.push(d.data!.id);
    check("⑫a sıralı tekrar → aynı fatura (replay)", (await kodu(kes)) === "ok" && (await prisma.invoice.count({ where: { clientToken: t } })) === 1);
    await invoiceService.cancel(d.data!.id, `${TAG} iptal`);
    check("⑫b iptal edilmiş faturanın token'ı → 409 INVOICE_CANCELLED (eskiden 'zaten oluşturulmuş')", (await kodu(kes)) === "INVOICE_CANCELLED");
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Token replay — D3 yolları, zorlanmış sıra ===\n");
  foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  await sevkiyat();
  await paketlemeGrubu();
  await levent();
  await kosum();
  await isEmri();
  await depoFatura();
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
  // Sevkiyat/çuval/iş emri/transfer/levent kalıntıları — bağımlıdan bağımsıza.
  const custWhere = { customerId: { in: o.customerIds } };
  const shipments = (await prisma.shipment.findMany({ where: custWhere, select: { id: true } })).map((s) => s.id);
  const sacks = [...new Set([...o.sackIds, ...(await prisma.sack.findMany({ where: custWhere, select: { id: true } })).map((s) => s.id)])];
  const woRolls = o.woIds.length ? (await prisma.roll.findMany({ where: { OR: [{ currentStep: { workOrderId: { in: o.woIds } } }, { batch: { workOrderId: { in: o.woIds } } }] }, select: { id: true } })).map((r) => r.id) : [];
  const sackRolls = sacks.length ? (await prisma.roll.findMany({ where: { sackId: { in: sacks } }, select: { id: true } })).map((r) => r.id) : [];
  const rolls = [...new Set([...o.rollIds, ...woRolls, ...sackRolls])];
  await adim("tahsis/sevk bağları", async () => {
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sacks } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipments } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...shipments, ...o.transferIds, ...o.dispatchIds] } } });
  });
  await adim("top izleri", async () => {
    await prisma.roll.updateMany({ where: { id: { in: rolls } }, data: { sackId: null, shipmentId: null } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rolls } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rolls } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rolls } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rolls } } });
  });
  await adim("transferler", () => prisma.warehouseTransfer.deleteMany({ where: { id: { in: o.transferIds } } }));
  await adim("levent olayları", () => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: o.beamIds } } }));
  await adim("fason sevk kalemleri", () => prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: o.dispatchIds } } }));
  await adim("fason sevkler", () => prisma.subcontractorDispatch.deleteMany({ where: { id: { in: o.dispatchIds } } }));
  await adim("toplar", () => prisma.roll.deleteMany({ where: { id: { in: rolls } } }));
  await adim("sevkiyatlar", () => prisma.shipment.deleteMany({ where: { id: { in: shipments } } }));
  await adim("çuvallar", async () => {
    await prisma.sack.updateMany({ where: { id: { in: sacks } }, data: { packingGroupId: null } });
    await prisma.sack.deleteMany({ where: { id: { in: sacks } } });
  });
  await adim("paketleme grupları", () => prisma.packingGroup.deleteMany({ where: { OR: [{ id: { in: o.groupIds } }, custWhere] } }));
  await adim("koşumlar", () => prisma.machineRun.deleteMany({ where: { machineId: { in: o.machineIds } } }));
  await adim("iş emirleri", async () => {
    const w = { workOrderId: { in: o.woIds } };
    await prisma.travelerCardScan.deleteMany({ where: { card: w } });
    await prisma.travelerCard.deleteMany({ where: w });
    await prisma.batch.deleteMany({ where: w });
    await prisma.workOrderToOrderLine.deleteMany({ where: w });
    await prisma.workOrderStep.deleteMany({ where: w });
    await prisma.workOrder.deleteMany({ where: { id: { in: o.woIds } } });
  });
  await adim("leventler", () => prisma.warpBeam.deleteMany({ where: { id: { in: o.beamIds } } }));
  await adim("çözgü kartı", () => prisma.warpSpec.deleteMany({ where: { id: { in: o.specIds } } }));
  await adim("fasoncu", () => prisma.subcontractor.deleteMany({ where: { id: { in: o.subIds } } }));
  await adim("makineler", () => prisma.machine.deleteMany({ where: { id: { in: o.machineIds } } }));
  await adim("istasyonlar", () => prisma.station.deleteMany({ where: { id: { in: o.stationIds } } }));
  await adim("depolar", () => prisma.warehouse.deleteMany({ where: { id: { in: o.warehouseIds } } }));
  const cariler = (await prisma.cariAccount.findMany({ where: custWhere, select: { id: true } })).map((c) => c.id);
  await adim("faturalar", async () => {
    await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: o.invoiceIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: o.invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: o.invoiceIds } } });
  });
  await adim("cari", async () => {
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: cariler } } });
  });
  await adim("kartlar", () => prisma.item.deleteMany({ where: { id: { in: o.itemIds } } }));
  await adim("müşteriler", () => prisma.customer.deleteMany({ where: { id: { in: o.customerIds } } }));
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
