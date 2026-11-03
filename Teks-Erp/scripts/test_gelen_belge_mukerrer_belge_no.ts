// =============================================================================
// TEST: GELEN BELGE — aynı gönderen belge no + aynı fotoğraf (Gülkesim K27) — servis, gerçek DB
// =============================================================================
//   §1 "işi sürüyor" TEK tanım (`NOTE_WORK_ONGOING_WHERE`): topsuz taslak sürer · onaylı + canlı top sürer · bütün topları
//      ölü onaylı biter · ⭐ top tüketilmiş ama PARTİSİNDE canlı top (tambur çocuğu) varsa sürer · iptal biter
//   §2 BLOCK (ayar yok = bugünkü): eş yok geçer · aktif/bitmiş eş → 409 DUPLICATE_DOC_NO (oluştur + başlık düzelt) ·
//      iptal eş serbest · eski eş (ALLOW'da doğmuş) + onay bayrağı → yine 409 · ⭐ yarış: 8044 kilidini elle tutan tx
//      eşi yazarken ikinci oluşturma bekler ve 409 alır · iki eşzamanlı oluşturmadan tam biri geçer
//   §3 WARN: eş taslak yazılır · ⭐ aktif eşte detay şeridi + onay 409 DUPLICATE_DOC_NO_ACTIVE (peers: GB no + İE no) ·
//      ⭐ onay bayrağıyla geçer (uyarı satırı) · bitmiş / iptal eşte şerit yok, onay sessiz geçer
//   §4 ALLOW: aktif eşe rağmen şerit yok, onay bayraksız geçer
//   §5 sha256 (WARN): ⭐ aktif bağlamda ağ tekrarı AYNI kayıt · ⭐ bitmiş belgenin fotoğrafı YENİ kayıt, eski belgenin
//      fotoğrafı yerinde · iptal belgede de yeni kayıt · BLOCK'ta bitmiş belgenin fotoğrafı bugünkü gibi yeniden kullanılır
//   §6 istasyon eşlemesi (`loadDocNoNotes`): işi sürenler varsa bitmişler elenir; hepsi bitmişse bugünkü küme
// Negatif sonda (2026-11-03 koşuldu): NOTE_WORK_ONGOING_WHERE'deki APPROVED dalı "her onaylı sürer"e çevrilince
// §1/§3/§5/§6'nın bitmiş-eş satırları kırmızı (bitmiş eş uyarı verir, foto yeniden kullanılır).
// Çalıştır: npx tsx scripts/test_gelen_belge_mukerrer_belge_no.ts
// =============================================================================
import crypto from "node:crypto";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote, getDeliveryNote, updateDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { cancelDeliveryNote } from "../src/services/gelen-belge-iptal.service";
import { uploadDocumentScan } from "../src/services/gelen-belge-scan.service";
import { loadDocNoNotes } from "../src/services/gelen-belge-istasyon-okutma.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { lockDocNosTx, NOTE_WORK_ONGOING_WHERE } from "../src/services/helpers/gelen-belge-mukerrer.helper";
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

const TAG = `TST-GBM${Date.now().toString(36).toUpperCase()}Z`;
const MODE_KEY = SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, MODE_KEY];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], routes: [] as string[], stations: [] as string[], scans: [] as string[], wos: [] as string[] };
const svc = new WorkOrderService();
let seq = 0;

type Err = { status: number; code?: string; peers?: Array<{ noteNo: string; workOrderNumbers: string[] }> };
async function errorOf(fn: () => Promise<unknown>): Promise<Err | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as { code?: string; peers?: Err["peers"] } | undefined;
      return { status: e.statusCode, code: d?.code, peers: d?.peers };
    }
    return { status: 500, code: (e as Error).message.slice(0, 200) };
  }
}

interface Fx { actorId: string; owner: string; owner2: string; fabric: string; route: string }

async function fixture(): Promise<Fx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
  }
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
  const owner2 = (await prisma.customer.create({ data: { code: `${TAG}-OW2`, name: `${TAG} sahip iki` }, select: { id: true } })).id;
  made.customers.push(owner, owner2);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  const route = await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);
  return { actorId: admin.id, owner, owner2, fabric, route: route.id };
}

async function setMode(mode: "BLOCK" | "WARN" | "ALLOW" | null): Promise<void> {
  if (mode === null) await prisma.systemSetting.deleteMany({ where: { key: MODE_KEY } });
  else await prisma.systemSetting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: mode }, update: { value: mode } });
}

async function draft(fx: Fx, docNo: string, owner = fx.owner): Promise<{ id: string; noteNo: string }> {
  const n = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} BOYAHANE`, senderDocNo: docNo,
    lines: [{ senderRollNo: `${docNo}-${++seq}`, meters: 50, itemId: fx.fabric }],
  }, fx.actorId);
  made.notes.push(n.id);
  return { id: n.id, noteNo: n.noteNo };
}

async function rollsOf(noteId: string): Promise<string[]> {
  const ls = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId, rollId: { not: null } }, select: { rollId: true } });
  return ls.map((l) => l.rollId!);
}

async function approved(fx: Fx, docNo: string, owner = fx.owner): Promise<{ id: string; noteNo: string; rolls: string[] }> {
  const d = await draft(fx, docNo, owner);
  await approveDeliveryNote(d.id, { confirmDuplicateDocNo: true }, fx.actorId);
  return { ...d, rolls: await rollsOf(d.id) };
}

/** Bitir: belgenin bütün topları fire (NO_LIVE kümesi) — sevk zincirini kurmadan "işi bitti" hâli. */
async function finish(noteId: string): Promise<void> {
  await prisma.roll.updateMany({ where: { id: { in: await rollsOf(noteId) } }, data: { status: "SCRAP" } });
}

async function cancel(fx: Fx, noteId: string): Promise<void> {
  await cancelDeliveryNote(noteId, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId);
}

const ongoing = async (id: string) => (await prisma.customerDeliveryNote.count({ where: { AND: [{ id }, NOTE_WORK_ONGOING_WHERE] } })) === 1;
const docNo = (s: string) => `${TAG}-${s}`;

async function scenarioHelper(fx: Fx): Promise<void> {
  console.log("§1 işi sürüyor — tek tanım");
  await setMode("ALLOW");
  const d = await draft(fx, docNo("H0"));
  check("§1 topsuz taslak sürer", await ongoing(d.id));
  const a = await approved(fx, docNo("H1"));
  check("§1 onaylı + canlı top sürer", await ongoing(a.id));
  await finish(a.id);
  check("§1 ⭐ bütün topları ölü onaylı belge biter", !(await ongoing(a.id)));
  // Tambur: belgenin topu tüketilir, çocuğu partiyi kalıtır → parti canlıysa iş sürer.
  const t = await approved(fx, docNo("H2"));
  const wo = (await svc.quickStart({ rollBarcodes: [(await prisma.roll.findUniqueOrThrow({ where: { id: t.rolls[0]! }, select: { barcode: true } })).barcode!], routeTemplateId: fx.route }, fx.actorId)).data!.workOrder.id;
  const batch = await prisma.roll.findUniqueOrThrow({ where: { id: t.rolls[0]! }, select: { batchId: true } });
  const child = await approved(fx, docNo("H3"));
  await prisma.roll.updateMany({ where: { id: { in: child.rolls } }, data: { batchId: batch.batchId } });
  await prisma.roll.updateMany({ where: { id: { in: t.rolls } }, data: { status: "TAMBUR_CONSUMED" } });
  check("§1 ⭐ top tüketilmiş ama partisinde canlı top var → sürer", batch.batchId !== null && (await ongoing(t.id)), String(batch.batchId));
  await finish(child.id);
  check("§1 partideki son top da ölünce biter", !(await ongoing(t.id)));
  made.wos.push(wo);
  const c = await approved(fx, docNo("H4"));
  await cancel(fx, c.id);
  check("§1 iptal belge biter", !(await ongoing(c.id)));
}

async function scenarioBlock(fx: Fx): Promise<void> {
  console.log("§2 BLOCK (ayar yok = bugünkü)");
  await setMode(null);
  const x = docNo("B1");
  const a = await draft(fx, x);
  check("§2 eş yok → taslak doğar", !!a.id);
  const e1 = await errorOf(() => draft(fx, x));
  check("§2 ⭐ aktif eş → oluşturma 409 DUPLICATE_DOC_NO", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(e1));
  const other = await draft(fx, docNo("B1-diger"));
  const e2 = await errorOf(() => updateDeliveryNote(other.id, { senderDocNo: x }, fx.actorId));
  check("§2 ⭐ başlık düzeltme ile eşe dönüşme → 409", e2?.status === 409 && e2.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(e2));
  const keep = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: other.id }, select: { senderDocNo: true } });
  check("§2 reddedilen düzeltme yazılmadı", keep.senderDocNo === docNo("B1-diger"), String(keep.senderDocNo));
  const e2b = await errorOf(() => draft(fx, x, fx.owner2));
  check("§2 başka sahip aynı no → serbest (tekillik sahip başına)", e2b === null, JSON.stringify(e2b));

  const f = await approved(fx, docNo("B2"));
  await finish(f.id);
  const e3 = await errorOf(() => draft(fx, docNo("B2")));
  check("§2 bitmiş eş de BLOCK'ta 409 (bugünkü)", e3?.status === 409 && e3.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(e3));

  const c = await approved(fx, docNo("B3"));
  await cancel(fx, c.id);
  const e4 = await errorOf(() => draft(fx, docNo("B3")));
  check("§2 iptal eş → yeni belge serbest", e4 === null, JSON.stringify(e4));

  // Eski eş: ALLOW'da doğmuş çift, kip BLOCK'a dönünce onay bayrağı yok sayılmaz.
  await setMode("ALLOW");
  await draft(fx, docNo("B4"));
  const legacy = await draft(fx, docNo("B4"));
  await setMode("BLOCK");
  const e5 = await errorOf(() => approveDeliveryNote(legacy.id, { confirmDuplicateDocNo: true }, fx.actorId));
  check("§2 ⭐ BLOCK'ta onay bayrağı yok sayılmaz → 409 DUPLICATE_DOC_NO", e5?.status === 409 && e5.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(e5));

  console.log("§2b BLOCK yarışı");
  const y = docNo("R1");
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const hasLock = new Promise<void>((r) => { locked = r; });
  const holderId = crypto.randomUUID();
  const holder = prisma.$transaction(async (tx) => {
    await lockDocNosTx(tx, "BLOCK", [y]);
    await tx.customerDeliveryNote.create({ data: { id: holderId, noteNo: `${TAG}-RH`.slice(0, 32), sourceKind: "MANUAL", status: "DRAFT", ownerCustomerId: fx.owner, senderDocNo: y, createdById: fx.actorId, updatedById: fx.actorId } });
    locked();
    await gate;
  }, { timeout: 30_000 });
  made.notes.push(holderId);
  await hasLock;
  let settled = false;
  const racer = errorOf(() => draft(fx, y)).finally(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 600));
  check("§2b ⭐ kilit tutulurken ikinci oluşturma BEKLER", !settled);
  release();
  await holder;
  const er = await racer;
  check("§2b ⭐ kilit bırakılınca ikinci 409 DUPLICATE_DOC_NO (eşi gördü)", er?.status === 409 && er.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(er));
  const z = docNo("R2");
  const both = await Promise.all([errorOf(() => draft(fx, z)), errorOf(() => draft(fx, z))]);
  const ok = both.filter((b) => b === null).length;
  const dup = both.filter((b) => b?.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO").length;
  check("§2b ⭐ iki eşzamanlı oluşturma: tam biri geçer, biri 409", ok === 1 && dup === 1, JSON.stringify(both));
  const rows = await prisma.customerDeliveryNote.count({ where: { ownerCustomerId: fx.owner, senderDocNo: z, status: { not: "CANCELLED" } } });
  check("§2b DB'de tek satır", rows === 1, String(rows));
  // Yarışta doğan taslağı temizlik listesine al.
  for (const n of await prisma.customerDeliveryNote.findMany({ where: { senderDocNo: z }, select: { id: true } })) made.notes.push(n.id);
}

async function scenarioWarn(fx: Fx): Promise<void> {
  console.log("§3 WARN");
  await setMode("WARN");
  const x = docNo("W1");
  const a = await approved(fx, x);
  const wo = (await svc.quickStart({ rollBarcodes: [(await prisma.roll.findUniqueOrThrow({ where: { id: a.rolls[0]! }, select: { barcode: true } })).barcode!], routeTemplateId: fx.route }, fx.actorId)).data!.workOrder;
  made.wos.push(wo.id);
  const b = await draft(fx, x);
  check("§3 aktif eş varken taslak yazılır", !!b.id);
  const det = await getDeliveryNote(b.id);
  check("§3 ⭐ taslak detayında şerit: eş GB no", det.duplicateDocNo?.peers.some((p) => p.noteNo === a.noteNo) === true, JSON.stringify(det.duplicateDocNo));
  const e1 = await errorOf(() => approveDeliveryNote(b.id, {}, fx.actorId));
  check("§3 ⭐ bayraksız onay → 409 DUPLICATE_DOC_NO_ACTIVE", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", JSON.stringify(e1));
  check("§3 ⭐ details.peers künyesi: GB no + İE no", !!e1?.peers?.some((p) => p.noteNo === a.noteNo && p.workOrderNumbers.includes(wo.workOrderNumber)), JSON.stringify(e1?.peers));
  const st = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: b.id }, select: { status: true } });
  check("§3 reddedilen onay hiçbir şey yazmadı (DRAFT)", st.status === "DRAFT", st.status);
  const r = await approveDeliveryNote(b.id, { confirmDuplicateDocNo: true }, fx.actorId);
  check("§3 ⭐ onay bayrağıyla geçer + uyarı satırı", r.note.status === "APPROVED" && r.warnings.some((w) => w.includes(a.noteNo)), JSON.stringify(r.warnings));

  const f = await approved(fx, docNo("W2"));
  await finish(f.id);
  const g = await draft(fx, docNo("W2"));
  check("§3 bitmiş eşte şerit yok", (await getDeliveryNote(g.id)).duplicateDocNo === null);
  const e2 = await errorOf(() => approveDeliveryNote(g.id, {}, fx.actorId));
  check("§3 ⭐ bitmiş eşte onay sessiz geçer", e2 === null, JSON.stringify(e2));

  const c = await approved(fx, docNo("W3"));
  await cancel(fx, c.id);
  const h = await draft(fx, docNo("W3"));
  const e3 = await errorOf(() => approveDeliveryNote(h.id, {}, fx.actorId));
  check("§3 iptal eşte onay sessiz geçer", e3 === null, JSON.stringify(e3));
  const solo = await draft(fx, docNo("W4"));
  const e4 = await errorOf(() => approveDeliveryNote(solo.id, {}, fx.actorId));
  check("§3 eş yokken onay geçer", e4 === null, JSON.stringify(e4));
}

async function scenarioAllow(fx: Fx): Promise<void> {
  console.log("§4 ALLOW");
  await setMode("ALLOW");
  const x = docNo("A1");
  await approved(fx, x);
  const b = await draft(fx, x);
  check("§4 aktif eşe rağmen şerit yok", (await getDeliveryNote(b.id)).duplicateDocNo === null);
  const e = await errorOf(() => approveDeliveryNote(b.id, {}, fx.actorId));
  check("§4 ⭐ bayraksız onay geçer", e === null, JSON.stringify(e));
}

const pdf = (s: string) => Buffer.from(`%PDF-1.4\n% ${TAG} ${s}\n%%EOF\n`).toString("base64");

async function scenarioSha(fx: Fx): Promise<void> {
  console.log("§5 aynı fotoğraf (sha256)");
  await setMode("WARN");
  const n1 = await draft(fx, docNo("S1"));
  const body = pdf("S1");
  const u1 = await uploadDocumentScan({ contentBase64: body, noteId: n1.id }, fx.actorId);
  made.scans.push(u1.scan.id);
  const u2 = await uploadDocumentScan({ contentBase64: body, noteId: n1.id }, fx.actorId);
  check("§5 ⭐ aktif bağlamda ağ tekrarı AYNI kayıt", u2.duplicate && u2.scan.id === u1.scan.id, `${u2.scan.id}`);
  const u3 = await uploadDocumentScan({ contentBase64: body }, fx.actorId);
  check("§5 serbest yüklemede de aynı kayıt", u3.duplicate && u3.scan.id === u1.scan.id);
  await approveDeliveryNote(n1.id, {}, fx.actorId);
  await finish(n1.id);
  const n2 = await draft(fx, docNo("S1"));
  const u4 = await uploadDocumentScan({ contentBase64: body, noteId: n2.id }, fx.actorId);
  made.scans.push(u4.scan.id);
  check("§5 ⭐ bitmiş belgenin fotoğrafı YENİ kayıt doğurur", !u4.duplicate && u4.scan.id !== u1.scan.id && u4.scan.noteId === n2.id, JSON.stringify({ d: u4.duplicate, id: u4.scan.id }));
  const old = await prisma.documentScan.findUniqueOrThrow({ where: { id: u1.scan.id }, select: { noteId: true } });
  check("§5 ⭐ eski belgenin fotoğrafı yerinde", old.noteId === n1.id);
  const u5 = await uploadDocumentScan({ contentBase64: body, noteId: n2.id }, fx.actorId);
  check("§5 yeni bağlamda tekrar → yeni kaydın kendisi", u5.duplicate && u5.scan.id === u4.scan.id);

  const c = await draft(fx, docNo("S2"));
  const cb = pdf("S2");
  const cs = (await uploadDocumentScan({ contentBase64: cb, noteId: c.id }, fx.actorId)).scan;
  made.scans.push(cs.id);
  await approveDeliveryNote(c.id, {}, fx.actorId);
  await cancel(fx, c.id);
  const u6 = await uploadDocumentScan({ contentBase64: cb }, fx.actorId);
  made.scans.push(u6.scan.id);
  check("§5 iptal belgenin fotoğrafı YENİ kayıt", !u6.duplicate && u6.scan.id !== cs.id);

  await setMode("BLOCK");
  const b = await draft(fx, docNo("S3"));
  const bb = pdf("S3");
  const bs = (await uploadDocumentScan({ contentBase64: bb, noteId: b.id }, fx.actorId)).scan;
  made.scans.push(bs.id);
  await approveDeliveryNote(b.id, {}, fx.actorId);
  await finish(b.id);
  const u7 = await uploadDocumentScan({ contentBase64: bb }, fx.actorId);
  check("§5 BLOCK'ta bitmiş belgenin fotoğrafı bugünkü gibi yeniden kullanılır", u7.duplicate && u7.scan.id === bs.id);
}

async function scenarioStation(fx: Fx): Promise<void> {
  console.log("§6 istasyon eşlemesi");
  await setMode("ALLOW");
  const x = docNo("I1");
  const done = await approved(fx, x);
  await finish(done.id);
  const live = await approved(fx, x, fx.owner2);
  const both = await loadDocNoNotes(x);
  check("§6 ⭐ işi süren varken bitmiş elenir", both.length === 1 && both[0]!.id === live.id, both.map((n) => n.noteNo).join(","));
  await finish(live.id);
  const all = await loadDocNoNotes(x);
  check("§6 hepsi bitmişse bugünkü küme (ikisi de)", all.length === 2, all.map((n) => n.noteNo).join(","));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes } }, select: { rollId: true } });
  const rollIds = lines.map((l) => l.rollId).filter((x): x is string => !!x);
  const wos = made.wos;
  await prisma.documentScan.updateMany({ where: { OR: [{ id: { in: made.scans } }, { noteId: { in: made.notes } }] }, data: { noteId: null } }).catch(swallow);
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { rollId: null } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "rollStatusEvent", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null, producedInStepId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of wos) {
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
  console.log("=== Gelen belge mükerrer belge no + aynı fotoğraf bekçisi (K27) ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    const fx = await fixture();
    await scenarioHelper(fx);
    await scenarioBlock(fx);
    await scenarioWarn(fx);
    await scenarioAllow(fx);
    await scenarioSha(fx);
    await scenarioStation(fx);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
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
else void prisma.$disconnect();
