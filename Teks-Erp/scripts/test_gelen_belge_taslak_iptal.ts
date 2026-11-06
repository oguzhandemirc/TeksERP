// =============================================================================
// TEST: GELEN BELGE — "Taslağı iptal et" (yarım kalan okutma taslağını kaldırma, 2026-11-06) — servis, gerçek DB
// =============================================================================
// Taslak deftere hiç yazmamıştır → "iptal" ④ sert silme sınıfıdır (`deleteDeliveryNote`, claim `{id, DRAFT}`); yeni durum
// ya da DRAFT → CANCELLED yolu YOK. Tablet/panel onay modalı satır + parti sayısını toplu silme önizlemesinden okur.
//   §1 ⭐ taslak iptal edilir: belge + satırlar gider, tarama çözülür (silinmez), audit DELETE, top sayısı değişmez;
//      önizleme satır/parti sayısı (bölümsüz 1 · iki bölüm 2 · satırsız 0)
//   §2 ⭐ deftere yazmış (onaylı) belge reddedilir: 409 DELIVERY_NOTE_NOT_DRAFT, belge + toplar yerinde, önizleme silinemez der
//   §3 ⭐ yarış: iki eşzamanlı iptal → TEK kazanan · elle tutulan onay claim tx'i altında iptal → 409 · iptal ‖ onay →
//      TEK kazanan ve tutarlı (onay kazandıysa toplar + belge, iptal kazandıysa SIFIR top)
//   §4 ⭐ K27 BLOCK: yarım taslak aynı (sahip, belge no) ile yeni kaydı ve aynı-belge kısayolunu tutar → iptal sonrası
//      kısayol boş, aynı belge no ile yeni taslak açılır, aynı fotoğraf yeni taslağa bağlanır ve onay geçer
// Negatif sonda (2026-11-06 koşuldu): claim WHERE'inden `status` düşürülünce §3 açık tx ⭐ KIRMIZI (belge onayın altından
// silindi; §2'yi ön okuma yine yakalar); `partyCount` bölümsüz satırlı belgede 0 dönünce §1 önizleme KIRMIZI; tarama çözme
// satırı kaldırılınca §1 HATA (FK Restrict).
// Çalıştır: npx tsx scripts/run-all-tests.ts gelen_belge_taslak_iptal
// =============================================================================
import crypto from "node:crypto";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote, deleteDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { uploadDocumentScan } from "../src/services/gelen-belge-scan.service";
import { findSameDocument } from "../src/services/gelen-belge-ayni-belge.service";
import { previewBulkDeleteDeliveryNotes } from "../src/services/gelen-belge-toplu-sil.service";
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

const TAG = `TST-GBI${Date.now().toString(36).toUpperCase()}Z`;
const MODE_KEY = SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, MODE_KEY];
const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], scans: [] as string[] };
let seq = 0;

interface Fx { actorId: string; owner: string; fabric: string }

async function fixture(): Promise<Fx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
  }
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  return { actorId: admin.id, owner, fabric };
}

async function setMode(mode: "BLOCK" | "WARN"): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: mode }, update: { value: mode } });
}

const docNo = (s: string) => `${TAG}-${s}`;
const pdf = (s: string) => Buffer.from(`%PDF-1.4\n% ${TAG} ${s}\n%%EOF\n`);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const line = (fx: Fx, no: string) => ({ senderRollNo: `${no}-${++seq}`, meters: 50, itemId: fx.fabric });

async function draft(fx: Fx, no: string, opts: { owner?: string | null; lines?: number } = {}): Promise<{ id: string; noteNo: string }> {
  const n = await createDeliveryNote({
    sourceKind: "MANUAL", ...(opts.owner === null ? {} : { ownerCustomerId: opts.owner ?? fx.owner }), senderText: `${TAG} BOYAHANE`, senderDocNo: no,
    lines: Array.from({ length: opts.lines ?? 1 }, () => line(fx, no)),
  }, fx.actorId);
  made.notes.push(n.id);
  return { id: n.id, noteNo: n.noteNo };
}

async function attachScan(fx: Fx, noteId: string, s: string): Promise<{ scanId: string; body: Buffer }> {
  const body = pdf(s);
  const u = await uploadDocumentScan({ contentBase64: body.toString("base64"), noteId }, fx.actorId);
  made.scans.push(u.scan.id);
  return { scanId: u.scan.id, body };
}

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try { await p; return "OK"; } catch (e) { if (e instanceof AppError) return (e.details as { code?: string } | undefined)?.code; throw e; }
};

const ownerRolls = (fx: Fx) => prisma.roll.count({ where: { ownerCustomerId: fx.owner } });

/** Audit best-effort ve tx dışında (`void`) — kısa bekleme, sonra sayım. */
async function deleteLogs(noteId: string): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const n = await prisma.systemLog.count({ where: { tableName: NOTE_TABLE, action: "DELETE", recordId: noteId } });
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 0;
}

async function scenarioCancel(fx: Fx): Promise<void> {
  console.log("§1 taslak iptal edilir");
  await setMode("WARN");
  const d = await draft(fx, docNo("C1"), { lines: 2 });
  const s = await attachScan(fx, d.id, "C1");
  const empty = await draft(fx, docNo("C0"), { lines: 0 });
  const multi = await draft(fx, docNo("C2"), { lines: 3 });
  // İki bölümlü çeki listesi: bölüm beyanı + satırların blok no'ları (OCR'ın yazdığı biçim).
  const ml = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: multi.id }, select: { id: true }, orderBy: { lineNo: "asc" } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { id: { in: ml.slice(1).map((l) => l.id) } }, data: { blockNo: 2 } });
  await prisma.customerDeliveryNote.update({ where: { id: multi.id }, data: { totalsDeclared: { blocks: [{ blockNo: 1, batchNo: "P1" }, { blockNo: 2, batchNo: "P2" }] } } });

  const pv = await previewBulkDeleteDeliveryNotes([d.id, multi.id, empty.id]);
  const by = (id: string) => pv.items.find((i) => i.id === id);
  check("§1 önizleme: taslak silinebilir, 2 satır · 1 parti · 1 sayfa", by(d.id)?.deletable === true && by(d.id)?.lineCount === 2 && by(d.id)?.partyCount === 1 && by(d.id)?.scanCount === 1, JSON.stringify(by(d.id)));
  check("§1 önizleme: iki bölümlü belge 3 satır · 2 parti", by(multi.id)?.lineCount === 3 && by(multi.id)?.partyCount === 2, JSON.stringify(by(multi.id)));
  check("§1 önizleme: satırsız taslak 0 satır · 0 parti", by(empty.id)?.lineCount === 0 && by(empty.id)?.partyCount === 0, JSON.stringify(by(empty.id)));

  const rollsBefore = await ownerRolls(fx);
  const r = await deleteDeliveryNote(d.id, fx.actorId);
  check("§1 ⭐ iptal döner (id + belge no)", r.id === d.id && r.noteNo === d.noteNo);
  const gone = await prisma.customerDeliveryNote.findUnique({ where: { id: d.id }, select: { id: true } });
  const lines = await prisma.customerDeliveryNoteLine.count({ where: { noteId: d.id } });
  check("§1 ⭐ belge ve satırları kalktı", gone === null && lines === 0, `${JSON.stringify(gone)} satır=${lines}`);
  const scan = await prisma.documentScan.findUnique({ where: { id: s.scanId }, select: { noteId: true } });
  check("§1 tarama silinmez, taslaktan çözülür", scan !== null && scan.noteId === null, JSON.stringify(scan));
  check("§1 audit DELETE yazıldı", (await deleteLogs(d.id)) === 1);
  check("§1 defter: top sayısı değişmedi", (await ownerRolls(fx)) === rollsBefore);
  check("§1 ikinci iptal → 404 DELIVERY_NOTE_NOT_FOUND", (await codeOf(deleteDeliveryNote(d.id, fx.actorId))) === "DELIVERY_NOTE_NOT_FOUND");
}

async function scenarioLedger(fx: Fx): Promise<void> {
  console.log("§2 deftere yazmış belge reddedilir");
  await setMode("WARN");
  const d = await draft(fx, docNo("L1"), { lines: 2 });
  await approveDeliveryNote(d.id, {}, fx.actorId);
  const rollsBefore = await ownerRolls(fx);
  const code = await codeOf(deleteDeliveryNote(d.id, fx.actorId));
  check("§2 ⭐ onaylı belgede iptal 409 DELIVERY_NOTE_NOT_DRAFT", code === "DELIVERY_NOTE_NOT_DRAFT", String(code));
  const still = await prisma.customerDeliveryNote.findUnique({ where: { id: d.id }, select: { status: true, _count: { select: { lines: true } } } });
  check("§2 ⭐ belge + satırlar yerinde, durum değişmedi", still?.status === "APPROVED" && still._count.lines === 2, JSON.stringify(still));
  check("§2 toplar yerinde", (await ownerRolls(fx)) === rollsBefore && rollsBefore >= 2, String(rollsBefore));
  const pv = await previewBulkDeleteDeliveryNotes([d.id]);
  check("§2 önizleme silinemez der (NOT_DRAFT + neden)", pv.items[0]?.deletable === false && pv.items[0]?.code === "DELIVERY_NOTE_NOT_DRAFT" && !!pv.items[0]?.reason);
}

async function scenarioRace(fx: Fx): Promise<void> {
  console.log("§3 yarış");
  await setMode("WARN");
  const d = await draft(fx, docNo("R1"));
  const two = await Promise.allSettled([deleteDeliveryNote(d.id, fx.actorId), deleteDeliveryNote(d.id, fx.actorId)]);
  const okCount = two.filter((x) => x.status === "fulfilled").length;
  const loserCodes = two.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => (x.reason as AppError).details?.code);
  check("§3 ⭐ iki eşzamanlı iptal → tek kazanan, kaybeden 404/409", okCount === 1 && loserCodes.length === 1 && ["DELIVERY_NOTE_NOT_FOUND", "DELIVERY_NOTE_NOT_DRAFT"].includes(String(loserCodes[0])), JSON.stringify(loserCodes));

  // Elle tutulan tx: onay claim'i (DRAFT → APPROVING) satırı kilitli tutarken iptal ön okuması DRAFT görür, sonra
  // claim'de bekler; tx bitince WHERE {id, DRAFT} tutmaz → 409. Claim'siz silme belgeyi onayın altından silerdi.
  const h = await draft(fx, docNo("R3"));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let claimed!: () => void;
  const claimedP = new Promise<void>((r) => { claimed = r; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.customerDeliveryNote.updateMany({ where: { id: h.id, status: "DRAFT" }, data: { status: "APPROVING" } });
    claimed();
    await gate;
  }, { timeout: 20_000 });
  await claimedP;
  const delP = codeOf(deleteDeliveryNote(h.id, fx.actorId));
  await new Promise((r) => setTimeout(r, 300));
  release();
  await holder;
  const heldCode = await delP;
  const heldRow = await prisma.customerDeliveryNote.findUnique({ where: { id: h.id }, select: { status: true } });
  check("§3 ⭐ açık onay claim'i altında iptal → 409 NOT_DRAFT, belge APPROVING kalır", heldCode === "DELIVERY_NOTE_NOT_DRAFT" && heldRow?.status === "APPROVING", JSON.stringify({ heldCode, heldRow }));

  for (let i = 0; i < 3; i++) {
    const n = await draft(fx, docNo(`R2-${i}`), { lines: 2 });
    const before = await ownerRolls(fx);
    const [del, appr] = await Promise.allSettled([deleteDeliveryNote(n.id, fx.actorId), approveDeliveryNote(n.id, {}, fx.actorId)]);
    const after = await ownerRolls(fx);
    const row = await prisma.customerDeliveryNote.findUnique({ where: { id: n.id }, select: { status: true } });
    const winners = [del, appr].filter((x) => x.status === "fulfilled").length;
    const consistent = del.status === "fulfilled" ? row === null && after === before : row?.status === "APPROVED" && after === before + 2;
    check(`§3 ⭐ iptal ‖ onay #${i + 1} → tek kazanan + tutarlı`, winners === 1 && consistent, JSON.stringify({ del: del.status, appr: appr.status, row, d: after - before }));
  }
}

async function scenarioRescan(fx: Fx): Promise<void> {
  console.log("§4 K27 BLOCK: iptal sonrası aynı belge yeniden okutulur");
  await setMode("BLOCK");
  const x = docNo("B1");
  const a = await draft(fx, x);
  const s = await attachScan(fx, a.id, "B1");
  const bySha = (await findSameDocument({ sha256: [sha(s.body)] })).match;
  const byNo = (await findSameDocument({ ownerCustomerId: fx.owner, senderDocNo: x })).match;
  check("§4 önce: yarım taslak kısayolda (fotoğraf + belge no)", bySha?.note.id === a.id && bySha.state === "DRAFT" && byNo?.note.id === a.id, JSON.stringify({ s: bySha?.note.id, n: byNo?.note.id }));
  const blocked = await codeOf(draft(fx, x));
  check("§4 önce: aynı (sahip, belge no) ile yeni taslak 409", blocked === "DELIVERY_NOTE_DUPLICATE_DOC_NO", String(blocked));

  await deleteDeliveryNote(a.id, fx.actorId);
  check("§4 ⭐ iptal sonrası fotoğraf kısayolu boş", (await findSameDocument({ sha256: [sha(s.body)] })).match === null);
  check("§4 ⭐ iptal sonrası belge no kısayolu boş", (await findSameDocument({ ownerCustomerId: fx.owner, senderDocNo: x })).match === null);
  const b = await draft(fx, x);
  check("§4 ⭐ aynı (sahip, belge no) ile yeni taslak açılır", b.id !== a.id);
  const re = await uploadDocumentScan({ contentBase64: s.body.toString("base64"), noteId: b.id }, fx.actorId);
  check("§4 ⭐ aynı fotoğraf yeni taslağa bağlanır (yeni tarama doğmaz)", re.scan.id === s.scanId && re.duplicate === true && re.boundTo === b.id, JSON.stringify({ id: re.scan.id === s.scanId, b: re.boundTo }));
  const appr = await codeOf(approveDeliveryNote(b.id, {}, fx.actorId));
  check("§4 ⭐ yeni taslak onaylanır (mükerrer engeli yok)", appr === "OK", String(appr));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes } }, select: { rollId: true } });
  const rollIds = [...new Set([...lines.map((l) => l.rollId).filter((x): x is string => !!x),
    ...(await prisma.roll.findMany({ where: { ownerCustomerId: { in: made.customers } }, select: { id: true } })).map((r) => r.id)])];
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
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge taslak iptali bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    const fx = await fixture();
    await scenarioCancel(fx);
    await scenarioLedger(fx);
    await scenarioRace(fx);
    await scenarioRescan(fx);
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
