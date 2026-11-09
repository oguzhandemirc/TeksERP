// =============================================================================
// TEST: GELEN BELGE — aynı müşteri parti no (`gelenBelge.duplicateBatchNo`) — servis, gerçek DB
// =============================================================================
// Demo vakası 2026-11-10: aynı kâğıt üç farklı fotoğrafla okutuldu, belge no boş okundu (K27 görmedi), üç İE açıldı.
//   §1 ALLOW (ayar yok = bugünkü): okuyucu ALLOW döner · işi süren aynı parti no'lu eşe rağmen onay sessiz geçer
//   §2 WARN: ⭐ büyük/küçük harf + boşluk + ı/I farkıyla eş yakalanır → 409 DUPLICATE_BATCH_NO_ACTIVE, details.peers
//      [noteNo, workOrderNumber, customerBatchNo] · reddedilen onay DRAFT bırakır · ⭐ confirmDuplicateBatchNo ile geçer
//      (uyarı satırı) · başka müşteri · ⭐ iptal eş · bitmiş eş · parti no'suz belge sessiz geçer
//   §3 BLOCK: ⭐ 409 DUPLICATE_BATCH_NO + peers · ⭐ onay bayrağı yok sayılmaz
//   §4 WARN + iş emri formu (`createWorkOrderFromNote`, parti no gövdeden): ⭐ bayraksız 409 (belge DRAFT, top/İE yok) ·
//      ⭐ confirmDuplicateBatchNo ile İE açılır
//   §5 çok parti: ⭐ aynı belgenin iki partisi aynı no'yu taşır → kendi kendini tetiklemez · ⭐ parti SATIRINDAKİ no
//      (başlık boş) sonraki belgede eş olarak görülür
//   §6 yarış (elle açık tx): ⭐ 8046 kilidini tutan tx varken eşzamanlı onay BEKLER · ⭐ kilit tx'i aynı parti no'yu yazıp
//      bitirince bekleyen onay onu görür → 409 ACTIVE (kilitsiz kapıda ikisi de geçerdi) · ⭐ kilit claim + parti satırı
//      yazımı boyunca tutulur (claim satır kilidiyle durdurulan onayın 8046'sı başka bağlantıdan alınamaz)
// Negatif sonda (2026-11-10 koşuldu, sonuçlar arşiv notunda): helper'daki üç parça tek tek bozuldu → ilgili satırlar kırmızı.
// Çalıştır: npx tsx scripts/test_gelen_belge_mukerrer_parti_no.ts
// =============================================================================
import crypto from "node:crypto";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { createWorkOrderFromNote } from "../src/services/gelen-belge-form-is-emri.service";
import { cancelDeliveryNote } from "../src/services/gelen-belge-iptal.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { readDuplicateBatchNoMode, SETTING_KEYS } from "../src/services/system-setting.service";
import { batchNoFoldKey, DELIVERY_BATCH_NO_LOCK_NS, type BatchNoPeer } from "../src/services/helpers/gelen-belge-mukerrer.helper";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TST-GBP${Date.now().toString(36).toUpperCase()}Z`;
const MODE_KEY = SETTING_KEYS.GELEN_BELGE_DUPLICATE_BATCH_NO;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, MODE_KEY, SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO, SETTING_KEYS.PRODUCTION_ENABLED,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_ROUTE_MODE];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], routes: [] as string[], stations: [] as string[], wos: [] as string[] };
const svc = new WorkOrderService();
let seq = 0;

type Err = { status: number; code?: string; peers?: BatchNoPeer[] };
async function errorOf(fn: () => Promise<unknown>): Promise<Err | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as { code?: string; peers?: BatchNoPeer[] } | undefined;
      return { status: e.statusCode, code: d?.code, peers: d?.peers };
    }
    return { status: 500, code: (e as Error).message.slice(0, 200) };
  }
}

interface Fx { actorId: string; owner: string; owner2: string; fabric: string; route: string }

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}
const setMode = (mode: "BLOCK" | "WARN" | "ALLOW" | null) => setSetting(MODE_KEY, mode);

async function fixture(): Promise<Fx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_ROUTE_MODE]) await setSetting(k, null);
  // Belge no kapısı bu bekçinin konusu değil: her taslak ayrı belge no taşır, kip serbest.
  await setSetting(SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO, "ALLOW");
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
  const owner2 = (await prisma.customer.create({ data: { code: `${TAG}-OW2`, name: `${TAG} sahip iki` }, select: { id: true } })).id;
  made.customers.push(owner, owner2);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  const route = await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);
  return { actorId: admin.id, owner, owner2, fabric, route: route.id };
}

async function draft(fx: Fx, batchNo: string | null, opts: { owner?: string; blocks?: number[] } = {}): Promise<{ id: string; noteNo: string }> {
  const blocks = opts.blocks ?? [1];
  const n = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: opts.owner ?? fx.owner, senderText: `${TAG} BOYAHANE`, senderDocNo: `${TAG}-D${++seq}`, customerBatchNo: batchNo,
    lines: blocks.map((b) => ({ senderRollNo: `${TAG}-${seq}-${b}`, meters: 50, itemId: fx.fabric, blockNo: b })),
  }, fx.actorId);
  made.notes.push(n.id);
  return { id: n.id, noteNo: n.noteNo };
}

async function rollsOf(noteId: string): Promise<string[]> {
  const ls = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId, rollId: { not: null } }, select: { rollId: true } });
  return ls.map((l) => l.rollId!);
}

async function approved(fx: Fx, batchNo: string, owner?: string): Promise<{ id: string; noteNo: string; rolls: string[] }> {
  const d = await draft(fx, batchNo, { owner });
  await approveDeliveryNote(d.id, { confirmDuplicateBatchNo: true }, fx.actorId);
  return { ...d, rolls: await rollsOf(d.id) };
}

/** Onaylı belgenin toplarıyla İE (demo vakası: her okutma bir İE açtı). */
async function workOrderOf(fx: Fx, rollIds: string[]): Promise<{ id: string; workOrderNumber: string }> {
  const barcodes = (await prisma.roll.findMany({ where: { id: { in: rollIds } }, select: { barcode: true } })).map((r) => r.barcode!);
  const wo = (await svc.quickStart({ rollBarcodes: barcodes, routeTemplateId: fx.route }, fx.actorId)).data!.workOrder;
  made.wos.push(wo.id);
  return { id: wo.id, workOrderNumber: wo.workOrderNumber };
}

const finish = async (noteId: string) => prisma.roll.updateMany({ where: { id: { in: await rollsOf(noteId) } }, data: { status: "SCRAP" } });
const cancel = (fx: Fx, noteId: string) => cancelDeliveryNote(noteId, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId);
const statusOf = async (id: string) => (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const bn = (s: string) => `${TAG}${s}`;

async function scenarioAllow(fx: Fx): Promise<void> {
  console.log("§1 ALLOW (ayar yok = bugünkü)");
  await setMode(null);
  check("§1 ayar yokken okuyucu ALLOW", (await readDuplicateBatchNoMode()) === "ALLOW");
  await approved(fx, bn("A1"));
  const b = await draft(fx, bn("A1"));
  const r = await errorOf(() => approveDeliveryNote(b.id, {}, fx.actorId));
  check("§1 ⭐ işi süren aynı parti no'lu eşe rağmen onay sessiz geçer", r === null && (await statusOf(b.id)) === "APPROVED", JSON.stringify(r));
}

async function scenarioWarn(fx: Fx): Promise<void> {
  console.log("§2 WARN");
  await setMode("WARN");
  check("§2 katlama: boşluk/harf/ı farkı aynı anahtar", batchNoFoldKey(`  ${bn("ism 14")}  `) === batchNoFoldKey(bn("ISM14")) && batchNoFoldKey("ısm1") === batchNoFoldKey("ISM1") && batchNoFoldKey("   ") === null);
  const a = await approved(fx, bn("ISM14"));
  const wo = await workOrderOf(fx, a.rolls);
  const b = await draft(fx, `  ${bn("ism 14").toLowerCase()} `);
  const e1 = await errorOf(() => approveDeliveryNote(b.id, {}, fx.actorId));
  check("§2 ⭐ harf/boşluk farkına rağmen 409 DUPLICATE_BATCH_NO_ACTIVE", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE", JSON.stringify(e1));
  const p = e1?.peers?.find((x) => x.noteNo === a.noteNo);
  check("§2 ⭐ peers künyesi: noteNo + workOrderNumber + customerBatchNo", !!p && p.workOrderNumber === wo.workOrderNumber && p.customerBatchNo === bn("ISM14"), JSON.stringify(e1?.peers));
  check("§2 reddedilen onay hiçbir şey yazmadı (DRAFT, top yok)", (await statusOf(b.id)) === "DRAFT" && (await rollsOf(b.id)).length === 0);
  const r = await approveDeliveryNote(b.id, { confirmDuplicateBatchNo: true }, fx.actorId);
  check("§2 ⭐ onay bayrağıyla geçer + uyarı satırı", r.note.status === "APPROVED" && r.warnings.some((w) => w.includes(wo.workOrderNumber)), JSON.stringify(r.warnings));

  const other = await draft(fx, bn("ISM14"), { owner: fx.owner2 });
  check("§2 başka müşterinin aynı parti no'su sessiz geçer", (await errorOf(() => approveDeliveryNote(other.id, {}, fx.actorId))) === null);

  const c = await approved(fx, bn("C1"));
  await cancel(fx, c.id);
  const cd = await draft(fx, bn("C1"));
  const e2 = await errorOf(() => approveDeliveryNote(cd.id, {}, fx.actorId));
  check("§2 ⭐ iptal eş sayılmaz → onay sessiz geçer", e2 === null, JSON.stringify(e2));

  const f = await approved(fx, bn("F1"));
  await finish(f.id);
  const fd = await draft(fx, bn("F1"));
  const e3 = await errorOf(() => approveDeliveryNote(fd.id, {}, fx.actorId));
  check("§2 bitmiş eş (bütün topları ölü) sayılmaz", e3 === null, JSON.stringify(e3));

  const none = await draft(fx, null);
  check("§2 parti no'suz belge sessiz geçer", (await errorOf(() => approveDeliveryNote(none.id, {}, fx.actorId))) === null);
}

async function scenarioBlock(fx: Fx): Promise<void> {
  console.log("§3 BLOCK");
  await setMode("BLOCK");
  const a = await approved(fx, bn("B1"));
  const b = await draft(fx, bn("b1"));
  const e1 = await errorOf(() => approveDeliveryNote(b.id, {}, fx.actorId));
  check("§3 ⭐ 409 DUPLICATE_BATCH_NO + peers", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO" && !!e1.peers?.some((p) => p.noteNo === a.noteNo), JSON.stringify(e1));
  const e2 = await errorOf(() => approveDeliveryNote(b.id, { confirmDuplicateBatchNo: true }, fx.actorId));
  check("§3 ⭐ BLOCK'ta onay bayrağı yok sayılmaz", e2?.status === 409 && e2.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO", JSON.stringify(e2));
  check("§3 belge DRAFT kaldı", (await statusOf(b.id)) === "DRAFT");
}

const actorOf = (fx: Fx) => ({ userId: fx.actorId, permissions: ["workorder:write"] });

async function scenarioForm(fx: Fx): Promise<void> {
  console.log("§4 WARN + iş emri formundan kayıt");
  await setMode("WARN");
  const a = await approved(fx, bn("FW1"));
  const wo = await workOrderOf(fx, a.rolls);
  // Okuma başlığa yazmadı; operatörün formda gördüğü parti no gövdeden gelir (tablet "Belge okut" yolu).
  const b = await draft(fx, null);
  const input = { clientToken: crypto.randomUUID(), ownerCustomerId: fx.owner, kursunMeters: 50, routeTemplateId: fx.route, customerBatchNo: bn("fw 1") };
  const e1 = await errorOf(() => createWorkOrderFromNote(b.id, input, actorOf(fx)));
  check("§4 ⭐ bayraksız form kaydı → 409 DUPLICATE_BATCH_NO_ACTIVE (peers İE no)", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE" && !!e1.peers?.some((p) => p.workOrderNumber === wo.workOrderNumber), JSON.stringify(e1));
  check("§4 reddedilen kayıt: belge DRAFT, top/İE yok", (await statusOf(b.id)) === "DRAFT" && (await rollsOf(b.id)).length === 0);
  const r = await createWorkOrderFromNote(b.id, { ...input, clientToken: crypto.randomUUID(), confirmDuplicateBatchNo: true }, actorOf(fx));
  made.wos.push(r.workOrderId);
  check("§4 ⭐ confirmDuplicateBatchNo ile İE açılır (uyarı satırı)", !!r.workOrderId && r.warnings.some((w) => w.includes(wo.workOrderNumber)), JSON.stringify(r.warnings));
}

async function scenarioMultiParty(fx: Fx): Promise<void> {
  console.log("§5 çok parti");
  await setMode("WARN");
  const m = await draft(fx, null, { blocks: [1, 2] });
  const parties = [{ blockNo: 1, meters: 50, batchNo: bn("MP1") }, { blockNo: 2, meters: 50, batchNo: bn("mp 1") }];
  const e1 = await errorOf(async () => {
    const r = await createWorkOrderFromNote(m.id, { clientToken: crypto.randomUUID(), ownerCustomerId: fx.owner, kursunMeters: 100, routeTemplateId: fx.route, mode: "SINGLE", parties }, actorOf(fx));
    made.wos.push(r.workOrderId);
  });
  check("§5 ⭐ aynı belgenin iki partisi aynı no → kendi kendini tetiklemez", e1 === null, JSON.stringify(e1));
  const head = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: m.id }, select: { customerBatchNo: true } });
  const n = await draft(fx, bn("MP1"));
  const e2 = await errorOf(() => approveDeliveryNote(n.id, {}, fx.actorId));
  check("§5 ⭐ parti satırındaki no (başlık boş) sonraki belgede eş", head.customerBatchNo === null && e2?.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE" && !!e2.peers?.some((p) => p.noteNo === m.noteNo), JSON.stringify(e2));
}

async function scenarioRace(fx: Fx): Promise<void> {
  console.log("§6 yarış — elle açık tx 8046 kilidini tutar");
  await setMode("WARN");
  const a = await draft(fx, null);
  const b = await draft(fx, null, { blocks: [1, 2] });
  const x = bn("RC1");
  const key = `${fx.owner}:${batchNoFoldKey(x)}`;
  let settled = false;
  let pending: Promise<Err | null> = Promise.resolve(null);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELIVERY_BATCH_NO_LOCK_NS}::int, hashtext(${key}))`;
    // B'nin parti satırı x'i yazacak; kilit tutulurken kapısı eşleri okuyamaz.
    pending = errorOf(async () => {
      const r = await createWorkOrderFromNote(b.id, { clientToken: crypto.randomUUID(), ownerCustomerId: fx.owner, kursunMeters: 100, routeTemplateId: fx.route, mode: "SINGLE", parties: [{ blockNo: 1, meters: 50, batchNo: x }, { blockNo: 2, meters: 50, batchNo: x }] }, actorOf(fx));
      made.wos.push(r.workOrderId);
    }).finally(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 1500));
    check("§6 ⭐ kilit tutulurken eşzamanlı onay bekler (bitmedi)", !settled);
    // Kilit sahibi (eşzamanlı ilk onay) aynı parti no'yu yazar ve bitirir.
    await tx.customerDeliveryNote.update({ where: { id: a.id }, data: { customerBatchNo: x } });
  }, { timeout: 30_000 });
  const e = await pending;
  check("§6 ⭐ bekleyen onay kilit sahibinin yazdığı partiyi görür → 409 ACTIVE", e?.code === "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE" && !!e.peers?.some((p) => p.noteNo === a.noteNo), JSON.stringify(e));
  check("§6 reddedilen onay: belge DRAFT, top yok", (await statusOf(b.id)) === "DRAFT" && (await rollsOf(b.id)).length === 0);

  // Kapı geçtikten SONRA da kilit tutulmalı (parti satırları yazılana dek): claim'i başlık satır kilidiyle durdur, 8046'yı yokla.
  const c = await draft(fx, null, { blocks: [1, 2] });
  const y = bn("RC2");
  const keyY = `${fx.owner}:${batchNoFoldKey(y)}`;
  await prisma.customerDeliveryNote.update({ where: { id: c.id }, data: { kursunMeters: 100, kursunMetersSource: "OUTPUT" } });
  let pendingC: Promise<Err | null> = Promise.resolve(null);
  let heldDuringClaim: boolean | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_delivery_notes WHERE id = ${c.id}::uuid FOR UPDATE`;
    // Onay ucu doğrudan (form yolu claim'den önce başlığı yamar, satır kilidine kapıdan ÖNCE takılırdı).
    pendingC = errorOf(() => approveDeliveryNote(c.id, {}, fx.actorId, { entryMode: "PER_DOCUMENT", parties: [{ blockNo: 1, meters: 50, customerBatchNo: y }, { blockNo: 2, meters: 50, customerBatchNo: y }] }));
    await new Promise((res) => setTimeout(res, 1500));
    const probe = await prisma.$transaction((t2) => t2.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_try_advisory_xact_lock(${DELIVERY_BATCH_NO_LOCK_NS}::int, hashtext(${keyY})) AS ok`);
    heldDuringClaim = probe[0]?.ok === false;
  }, { timeout: 30_000 });
  const ec = await pendingC;
  check("§6 ⭐ kapı geçtikten sonra claim boyunca 8046 tutulur", heldDuringClaim === true, String(heldDuringClaim));
  check("§6 serbest bırakılan onay eşsiz geçer", ec === null, JSON.stringify(ec));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes } }, select: { rollId: true } });
  const rollIds = lines.map((l) => l.rollId).filter((x): x is string => !!x);
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { rollId: null } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "rollStatusEvent", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null, producedInStepId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of made.wos) {
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id } }).catch(swallow);
  }
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge mükerrer müşteri parti no bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    const fx = await fixture();
    await scenarioAllow(fx);
    await scenarioWarn(fx);
    await scenarioBlock(fx);
    await scenarioForm(fx);
    await scenarioMultiParty(fx);
    await scenarioRace(fx);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
    // Ayarlar birebir geri: önceden satırı olan eski değerine, olmayan silinir.
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
