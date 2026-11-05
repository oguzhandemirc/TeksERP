// =============================================================================
// TEST: GELEN BELGE — aynı belge tekrar okutulunca kısayol (`findSameDocument`, 2026-11-06) — servis, gerçek DB
// =============================================================================
//   §1 SHA: taslağa bağlı fotoğraf → DRAFT eşleşmesi · `excludeNoteId` (çağıranın kendi taslağı) → null · bilinmeyen sha → null
//   §2 BLOCK: formdan İE açılmış belge → ⭐ PROCESSED + İE numarası · İE iptal → aynı belge, İE durumu CANCELLED ·
//      bitmiş belge BLOCK'ta yine eşleşir (yükleme yeniden kullanır) · iptal belge → state CANCELLED
//   §3 WARN: ⭐ işi bitmiş belgenin fotoğrafı eşleşme DEĞİL (yükleme yeni kayıt doğurur — `scanNeedsFreshRecord`)
//   §4 DOC_NO: BLOCK'ta (sahip, belge no) eşi eşleşir · kendi taslağı / başka sahip / iptal eş → null · WARN → null
//   §5 ⭐ yükleme 409 `DOCUMENT_SCAN_NOT_FREE` details.sameDocument.note.id = fotoğrafın bağlı olduğu taslak
//   §6 ⭐ K27 BLOCK: sahipsiz okutulan kopya taslak İE kaydında 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO` → kopya taslak
//      SİLİNMEZ (DRAFT kalır) · DRAFT için iptal yolu yok (`cancelDeliveryNote` 409 NOT_CANCELLABLE) · kart verisi eşi gösterir
//      (1e kararı 2026-11-06: sert silme yok; iptal ucu yalnız onaylıda — yeni iptal yolu icat edilmez, taslak kalır)
// Negatif sonda (2026-11-06 koşuldu): servisteki `scanNeedsFreshRecord` satırı kaldırılınca §3 ⭐ KIRMIZI;
// 409 details'ten `sameDocument` düşürülünce §5 ⭐ KIRMIZI; iptal claim'ine DRAFT eklenince §6 NOT_CANCELLABLE KIRMIZI.
// Çalıştır: npx tsx scripts/run-all-tests.ts gelen_belge_ayni_belge_kisayol
// =============================================================================
import crypto from "node:crypto";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { createWorkOrderFromNote } from "../src/services/gelen-belge-form-is-emri.service";
import { cancelDeliveryNote } from "../src/services/gelen-belge-iptal.service";
import { uploadDocumentScan } from "../src/services/gelen-belge-scan.service";
import { findSameDocument, type SameDocumentMatch } from "../src/services/gelen-belge-ayni-belge.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
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

const TAG = `TST-GBK${Date.now().toString(36).toUpperCase()}Z`;
const MODE_KEY = SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, MODE_KEY, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], routes: [] as string[], stations: [] as string[], scans: [] as string[], wos: [] as string[] };
let seq = 0;

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

async function setMode(mode: "BLOCK" | "WARN"): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: mode }, update: { value: mode } });
}

const docNo = (s: string) => `${TAG}-${s}`;
const pdf = (s: string) => Buffer.from(`%PDF-1.4\n% ${TAG} ${s}\n%%EOF\n`);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

async function draft(fx: Fx, no: string, owner = fx.owner): Promise<{ id: string; noteNo: string }> {
  const n = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} BOYAHANE`, senderDocNo: no,
    lines: [{ senderRollNo: `${no}-${++seq}`, meters: 50, itemId: fx.fabric }],
  }, fx.actorId);
  made.notes.push(n.id);
  return { id: n.id, noteNo: n.noteNo };
}

/** Taslak + fotoğraf; fotoğrafın sha'sını döndürür. */
async function draftWithScan(fx: Fx, s: string): Promise<{ id: string; noteNo: string; sha: string; body: Buffer }> {
  const d = await draft(fx, docNo(s));
  const body = pdf(s);
  const u = await uploadDocumentScan({ contentBase64: body.toString("base64"), noteId: d.id }, fx.actorId);
  made.scans.push(u.scan.id);
  return { ...d, sha: sha(body), body };
}

async function finish(noteId: string): Promise<void> {
  const ls = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId, rollId: { not: null } }, select: { rollId: true } });
  await prisma.roll.updateMany({ where: { id: { in: ls.map((l) => l.rollId!) } }, data: { status: "SCRAP" } });
}

const m = async (q: Parameters<typeof findSameDocument>[0]): Promise<SameDocumentMatch | null> => (await findSameDocument(q)).match;

async function scenarioSha(fx: Fx): Promise<void> {
  console.log("§1 SHA → taslak");
  await setMode("WARN");
  const d = await draftWithScan(fx, "S1");
  const r = await m({ sha256: [d.sha] });
  check("§1 taslağa bağlı fotoğraf → DRAFT eşleşmesi", r?.via === "SHA" && r.state === "DRAFT" && r.note.id === d.id && r.workOrders.length === 0, JSON.stringify(r?.note.id));
  check("§1 çağıranın kendi taslağı (excludeNoteId) → null", (await m({ sha256: [d.sha], excludeNoteId: d.id })) === null);
  check("§1 bilinmeyen sha → null", (await m({ sha256: ["0".repeat(64)] })) === null);
  const r2 = await m({ sha256: ["f".repeat(64), d.sha] });
  check("§1 çok sayfada ilk eşleşen sayfa bulunur", r2?.note.id === d.id);
}

async function scenarioBlock(fx: Fx): Promise<void> {
  console.log("§2 BLOCK → işlenmiş belge + İE");
  await setMode("BLOCK");
  for (const [k, v] of [[SETTING_KEYS.PRODUCTION_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER"], [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fx.fabric]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  const d = await draftWithScan(fx, "B1");
  const wo = await createWorkOrderFromNote(d.id, { clientToken: crypto.randomUUID(), ownerCustomerId: fx.owner, kursunMeters: 50, routeTemplateId: fx.route }, { userId: fx.actorId, permissions: ["workorder:write"] });
  made.wos.push(wo.workOrderId);
  const r = await m({ sha256: [d.sha] });
  check("§2 ⭐ formdan İE açılmış belge → PROCESSED + İE", r?.state === "PROCESSED" && r.note.id === d.id && r.workOrders.some((w) => w.id === wo.workOrderId), JSON.stringify({ s: r?.state, w: r?.workOrders }));
  await prisma.workOrder.update({ where: { id: wo.workOrderId }, data: { status: "CANCELLED" } });
  const r2 = await m({ sha256: [d.sha] });
  check("§2 İE iptal → aynı belge, İE durumu CANCELLED", r2?.note.id === d.id && r2.workOrders.find((w) => w.id === wo.workOrderId)?.status === "CANCELLED", JSON.stringify(r2?.workOrders));
  await finish(d.id);
  check("§2 BLOCK'ta bitmiş belge yine eşleşir (yükleme yeniden kullanır)", (await m({ sha256: [d.sha] }))?.note.id === d.id);

  const c = await draftWithScan(fx, "B2");
  await approveDeliveryNote(c.id, {}, fx.actorId);
  await cancelDeliveryNote(c.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId);
  const r3 = await m({ sha256: [c.sha] });
  check("§2 iptal belge → state CANCELLED", r3?.state === "CANCELLED" && r3.note.id === c.id, JSON.stringify(r3?.state));
}

async function scenarioWarnFinished(fx: Fx): Promise<void> {
  console.log("§3 WARN → bitmiş belge eşleşme değil");
  await setMode("WARN");
  const d = await draftWithScan(fx, "W1");
  await approveDeliveryNote(d.id, {}, fx.actorId);
  check("§3 onaylı + canlı toplu belge eşleşir", (await m({ sha256: [d.sha] }))?.state === "PROCESSED");
  await finish(d.id);
  const r = await m({ sha256: [d.sha] });
  check("§3 ⭐ işi bitmiş belgenin fotoğrafı → null (yükleme yeni kayıt doğurur)", r === null, JSON.stringify(r?.note.id));
}

async function scenarioDocNo(fx: Fx): Promise<void> {
  console.log("§4 belge no (sahip + gönderen no)");
  await setMode("BLOCK");
  const x = docNo("D1");
  const a = await draft(fx, x);
  const r = await m({ ownerCustomerId: fx.owner, senderDocNo: ` ${x} ` });
  check("§4 BLOCK'ta eş eşleşir (kırpılmış no)", r?.via === "DOC_NO" && r.note.id === a.id, JSON.stringify(r?.note.id));
  check("§4 kendi taslağı (excludeNoteId) → null", (await m({ ownerCustomerId: fx.owner, senderDocNo: x, excludeNoteId: a.id })) === null);
  check("§4 başka sahip → null", (await m({ ownerCustomerId: fx.owner2, senderDocNo: x })) === null);
  check("§4 sahipsiz sorgu → null", (await m({ senderDocNo: x })) === null);
  await setMode("WARN");
  check("§4 WARN → null (mevcut uyarı diyaloğu kalır)", (await m({ ownerCustomerId: fx.owner, senderDocNo: x })) === null);
  await setMode("BLOCK");
  const y = docNo("D2");
  const c = await draft(fx, y);
  await approveDeliveryNote(c.id, {}, fx.actorId);
  await cancelDeliveryNote(c.id, { clientToken: crypto.randomUUID(), reason: "Yanlış belge girildi" }, fx.actorId);
  check("§4 iptal eş → null", (await m({ ownerCustomerId: fx.owner, senderDocNo: y })) === null);
}

async function scenarioConflict(fx: Fx): Promise<void> {
  console.log("§5 yükleme 409 ayrıntısı");
  await setMode("WARN");
  const d = await draftWithScan(fx, "C1");
  const other = await draft(fx, docNo("C2"));
  let details: { code?: string; boundTo?: string; sameDocument?: SameDocumentMatch | null } | undefined;
  try {
    await uploadDocumentScan({ contentBase64: d.body.toString("base64"), noteId: other.id }, fx.actorId);
  } catch (e) {
    if (e instanceof AppError) details = e.details as typeof details;
    else throw e;
  }
  check("§5 ⭐ 409 DOCUMENT_SCAN_NOT_FREE + sameDocument.note.id", details?.code === "DOCUMENT_SCAN_NOT_FREE" && details.boundTo === d.id && details.sameDocument?.note.id === d.id && details.sameDocument.state === "DRAFT", JSON.stringify({ c: details?.code, s: details?.sameDocument?.note.id }));
}

async function scenarioBlockCopyDraft(fx: Fx): Promise<void> {
  console.log("§6 K27 BLOCK → kopya taslak kalır");
  await setMode("BLOCK");
  const x = docNo("K1");
  const a = await draft(fx, x);
  await approveDeliveryNote(a.id, {}, fx.actorId);
  // OCR sahibi doldurmaz → kopya taslak doğar; çakışma İE kaydında sahip yazılınca çıkar.
  const b = await createDeliveryNote({
    sourceKind: "MANUAL", senderText: `${TAG} BOYAHANE`, senderDocNo: x,
    lines: [{ senderRollNo: `${x}-${++seq}`, meters: 50, itemId: fx.fabric }],
  }, fx.actorId);
  made.notes.push(b.id);
  const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
    try { await p; return "OK"; } catch (e) { if (e instanceof AppError) return (e.details as { code?: string } | undefined)?.code; throw e; }
  };
  const woCode = await codeOf(createWorkOrderFromNote(b.id, { clientToken: crypto.randomUUID(), ownerCustomerId: fx.owner, kursunMeters: 50, routeTemplateId: fx.route }, { userId: fx.actorId, permissions: ["workorder:write"] }));
  check("§6 İE kaydı 409 DELIVERY_NOTE_DUPLICATE_DOC_NO", woCode === "DELIVERY_NOTE_DUPLICATE_DOC_NO", String(woCode));
  const after = await prisma.customerDeliveryNote.findUnique({ where: { id: b.id }, select: { status: true } });
  check("§6 ⭐ kopya taslak silinmez, DRAFT kalır", after?.status === "DRAFT", JSON.stringify(after));
  const cancelCode = await codeOf(cancelDeliveryNote(b.id, { clientToken: crypto.randomUUID(), reason: "Aynı belge zaten işlendi" }, fx.actorId));
  check("§6 DRAFT iptal yolu yok (409 NOT_CANCELLABLE — karar: taslak olduğu gibi kalır)", cancelCode === "DELIVERY_NOTE_NOT_CANCELLABLE", String(cancelCode));
  const r = await m({ ownerCustomerId: fx.owner, senderDocNo: x, excludeNoteId: b.id });
  check("§6 kart verisi: eş (onaylı) belge", r?.via === "DOC_NO" && r.note.id === a.id && r.state === "PROCESSED", JSON.stringify({ id: r?.note.id, s: r?.state }));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes } }, select: { rollId: true } });
  const rollIds = lines.map((l) => l.rollId).filter((x): x is string => !!x);
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
  console.log("=== Gelen belge aynı belge kısayolu bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    const fx = await fixture();
    await scenarioSha(fx);
    await scenarioBlock(fx);
    await scenarioWarnFinished(fx);
    await scenarioDocNo(fx);
    await scenarioConflict(fx);
    await scenarioBlockCopyDraft(fx);
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
