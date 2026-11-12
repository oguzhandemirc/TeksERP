// =============================================================================
// TEST: GELEN BELGE — onaylı belgede fiş no / fiş tarihi düzeltme (`PATCH /irsaliyeler/:id/kunye`, 2026-11-10)
// =============================================================================
// Kaynak: `services/gelen-belge-kunye-duzelt.service.ts` (`fixNoteIdentity`) + route `IdentityFixBody` (katı şema).
//   §1 ⭐ APPROVED belgede no + tarih düzelir; audit eski→yeni (identityFix); satır/durum/sahip değişmez; PARTIAL da açık
//   §2 ⭐ istasyon araması yeni no ile İE'yi bulur (`loadDocNoNotes` + `stationWorkSearchWhere`), eski no artık bulmaz
//   §3 ⭐ iptal belge 409 DELIVERY_NOTE_IDENTITY_NOT_FIXABLE · taslak 409 aynı kod · değişiklik yoksa yazmaz/audit atmaz
//   §4 ⭐ mükerrer: BLOCK aynı sahip + aynı no → 409 DUPLICATE_DOC_NO (yazılmaz) · iptal eş serbest · WARN işi süren eş
//      → 409 DUPLICATE_DOC_NO_ACTIVE + peers, confirmDuplicateDocNo ile geçer (uyarı + audit'te eş) · ALLOW serbest
//   §5 ⭐ eşzamanlı iki düzeltme: ilk yazar satırı tutarken (elle açık tx) ikincisi bekler ve 409 DELIVERY_NOTE_CHANGED alır —
//      BEYAN: "son yazan kazanır" YOK; ikinci yazar bayat görüntüyle ezemez (claim WHERE eski no + eski tarih taşır)
//   §6 HTTP: başka başlık alanı 400 (katı şema, yazılmaz) · boş gövde 400 · geçersiz tarih 400 · izinsiz (yalnız read) 403 · izinli 200
// NEGATİF SONDA (2026-11-10, tek tek, md5 ile geri alındı; temel 36/0):
//   • claim WHERE'inden eski no + eski tarih düşürüldü → §5 iki kırmızı (ikinci yazar ezdi; 34/2)
//   • claim WHERE durum kümesi + servis ön kontrolü silindi → §3 iptal/taslak üç kırmızı (33/3)
//   • `duplicateDocNoApprovalGate` çağrısı silindi → §4 WARN üç kırmızı (33/3); BLOCK'u 8044 kilidi + `assertDocNoUniqueTx` yine tutar
//   • route `IdentityFixBody` yerine gevşek `UpdateBody` → §6 başka-alan iki kırmızı (34/2)
// Çalıştır: npx tsx scripts/test_gelen_belge_kunye_duzelt.ts
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { RollForm, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { AppError } from "../src/utils/app-error";
import { fixNoteIdentity } from "../src/services/gelen-belge-kunye-duzelt.service";
import { loadDocNoNotes } from "../src/services/gelen-belge-istasyon-okutma.service";
import { stationWorkSearchWhere } from "../src/services/helpers/workorder-doc-search.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-GBKD-${STAMP}`;
const MODE_KEY = SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, MODE_KEY];
const fx = { woIds: [] as string[], rollIds: [] as string[], noteIds: [] as string[], itemIds: [] as string[], customerIds: [] as string[], userIds: [] as string[] };

type Err = { status: number; code?: string; peers?: Array<{ noteNo: string }> };
async function errorOf(fn: () => Promise<unknown>): Promise<Err | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) {
      const d = e.details as { code?: string; peers?: Err["peers"] } | undefined;
      return { status: e.statusCode, code: d?.code, peers: d?.peers };
    }
    return { status: 500, code: (e as Error).message.slice(0, 200) };
  }
}

async function setMode(mode: "BLOCK" | "WARN" | "ALLOW" | null): Promise<void> {
  if (mode === null) await prisma.systemSetting.deleteMany({ where: { key: MODE_KEY } });
  else await prisma.systemSetting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: mode }, update: { value: mode } });
}

let seq = 0;
let itemId = "";
/** Onaylı belge: tek satır → canlı top → parti → açık İE (rotasız). Belge no boş doğar (sahadaki vaka). */
async function approvedNote(owner: string, opts: { status?: "APPROVED" | "PARTIAL" | "CANCELLED" | "DRAFT"; docNo?: string | null; withWo?: boolean } = {}) {
  const n = seq++;
  let rollId: string | null = null;
  let woNo: string | null = null;
  if (opts.withWo !== false && opts.status !== "DRAFT") {
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-W${n}`, status: WorkOrderStatus.IN_PROGRESS }, select: { id: true, workOrderNumber: true } });
    fx.woIds.push(wo.id);
    woNo = wo.workOrderNumber;
    const batchId = (await prisma.batch.create({ data: { workOrderId: wo.id, batchNumber: `${P}-B${n}` }, select: { id: true } })).id;
    rollId = (await prisma.roll.create({ data: { barcode: `${P}-R${n}`.slice(0, 40), itemId, initialQty: 10, currentQty: 10, status: RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK, batchId }, select: { id: true } })).id;
    fx.rollIds.push(rollId);
  }
  const note = await prisma.customerDeliveryNote.create({
    data: { noteNo: `${P}-N${n}`.slice(0, 32), sourceKind: "MANUAL", status: opts.status ?? "APPROVED", ownerCustomerId: owner, senderDocNo: opts.docNo ?? null, lines: { create: [{ lineNo: 1, meters: 10, rollId }] } },
    select: { id: true, noteNo: true },
  });
  fx.noteIds.push(note.id);
  return { ...note, woNo };
}

const auditsOf = (recordId: string) => prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId, action: "UPDATE" }, select: { oldData: true, newData: true }, orderBy: { createdAt: "asc" } });

async function scenarioFix(owner: string, actorId: string): Promise<void> {
  console.log("§1 onaylı belgede düzeltme");
  await setMode(null);
  const a = await approvedNote(owner);
  const docNo = `${P}-FIS1`;
  const res = await fixNoteIdentity(a.id, { senderDocNo: `  ${docNo} `, senderDocDate: "2026-11-08" }, actorId);
  const row = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: a.id }, select: { senderDocNo: true, senderDocDate: true, status: true, ownerCustomerId: true, _count: { select: { lines: true } } } });
  check("§1 ⭐ fiş no kırpılıp yazıldı", row.senderDocNo === docNo, String(row.senderDocNo));
  check("§1 ⭐ fiş tarihi yazıldı", row.senderDocDate?.toISOString().slice(0, 10) === "2026-11-08");
  check("§1 durum/sahip/satır değişmedi", row.status === "APPROVED" && row.ownerCustomerId === owner && row._count.lines === 1);
  check("§1 yanıt detay şeklinde (noteNo + lines)", res.note.noteNo === a.noteNo && Array.isArray(res.note.lines) && res.note.senderDocNo === docNo);
  const logs = await auditsOf(a.id);
  const last = logs.at(-1) as { oldData: Record<string, unknown>; newData: Record<string, unknown> } | undefined;
  check("§1 ⭐ audit eski→yeni", logs.length === 1 && last?.oldData.senderDocNo === null && last?.newData.senderDocNo === docNo && last?.newData.senderDocDate === "2026-11-08" && last?.newData.identityFix === true, JSON.stringify(last));
  // Yalnız tarih: no korunur.
  await fixNoteIdentity(a.id, { senderDocDate: null }, actorId);
  const row2 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: a.id }, select: { senderDocNo: true, senderDocDate: true } });
  check("§1 yalnız tarih anahtarı: tarih temizlendi, no korundu", row2.senderDocNo === docNo && row2.senderDocDate === null);
  const p = await approvedNote(owner, { status: "PARTIAL" });
  await fixNoteIdentity(p.id, { senderDocNo: `${P}-FISP` }, actorId);
  check("§1 PARTIAL belgede de düzelir", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: p.id }, select: { senderDocNo: true } })).senderDocNo === `${P}-FISP`);

  console.log("§2 istasyon araması yeni no ile");
  const b = await approvedNote(owner, { docNo: `${P}-ESKI` });
  check("§2 ön koşul: eski no istasyonda bulunur", (await loadDocNoNotes(`${P}-ESKI`)).some((x) => x.id === b.id));
  await fixNoteIdentity(b.id, { senderDocNo: `${P}-YENI` }, actorId);
  const found = await loadDocNoNotes(`${P}-YENI`.toLowerCase());
  check("§2 ⭐ `loadDocNoNotes` yeni no ile belgeyi bulur", found.some((x) => x.id === b.id), found.map((x) => x.noteNo).join(","));
  check("§2 eski no artık bulmaz", !(await loadDocNoNotes(`${P}-ESKI`)).some((x) => x.id === b.id));
  const where = stationWorkSearchWhere(`${P}-YENI`);
  const wos = where ? await prisma.workOrder.findMany({ where: { AND: [{ id: { in: fx.woIds } }, where] }, select: { workOrderNumber: true } }) : [];
  check("§2 ⭐ istasyon elle araması yeni no ile İE'yi bulur", wos.length === 1 && wos[0]!.workOrderNumber === b.woNo, wos.map((w) => w.workOrderNumber).join(","));
}

async function scenarioStatus(owner: string, actorId: string): Promise<void> {
  console.log("§3 durum kapısı");
  const c = await approvedNote(owner, { status: "CANCELLED", docNo: `${P}-IPT` });
  const e1 = await errorOf(() => fixNoteIdentity(c.id, { senderDocNo: `${P}-IPT2` }, actorId));
  check("§3 ⭐ iptal belge → 409 IDENTITY_NOT_FIXABLE", e1?.status === 409 && e1.code === "DELIVERY_NOTE_IDENTITY_NOT_FIXABLE", JSON.stringify(e1));
  check("§3 iptal belgede no değişmedi", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: c.id }, select: { senderDocNo: true } })).senderDocNo === `${P}-IPT`);
  const d = await approvedNote(owner, { status: "DRAFT" });
  const e2 = await errorOf(() => fixNoteIdentity(d.id, { senderDocNo: `${P}-TSL` }, actorId));
  check("§3 taslak → 409 IDENTITY_NOT_FIXABLE (taslak kendi PATCH'iyle)", e2?.status === 409 && e2.code === "DELIVERY_NOTE_IDENTITY_NOT_FIXABLE", JSON.stringify(e2));
  const e3 = await errorOf(() => fixNoteIdentity(randomUUID(), { senderDocNo: "X" }, actorId));
  check("§3 yok belge → 404", e3?.status === 404, JSON.stringify(e3));
  const same = await approvedNote(owner, { docNo: `${P}-AYNI` });
  await fixNoteIdentity(same.id, { senderDocNo: `${P}-AYNI` }, actorId);
  check("§3 değişiklik yoksa audit yok", (await auditsOf(same.id)).length === 0);
  const e4 = await errorOf(() => fixNoteIdentity(same.id, { senderDocDate: "2026-02-31" }, actorId));
  check("§3 takvimde olmayan tarih → 400 DATE_INVALID", e4?.status === 400 && e4.code === "DELIVERY_NOTE_DATE_INVALID", JSON.stringify(e4));
}

async function scenarioDuplicate(owner: string, owner2: string, actorId: string): Promise<void> {
  console.log("§4 mükerrer belge no");
  await setMode(null); // BLOCK varsayılan
  const peer = await approvedNote(owner, { docNo: `${P}-DUP` });
  const x = await approvedNote(owner);
  const e1 = await errorOf(() => fixNoteIdentity(x.id, { senderDocNo: `${P}-DUP` }, actorId));
  check("§4 ⭐ BLOCK aynı sahip + aynı no → 409 DUPLICATE_DOC_NO", e1?.status === 409 && e1.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO", JSON.stringify(e1));
  check("§4 BLOCK'ta yazılmadı", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: x.id }, select: { senderDocNo: true } })).senderDocNo === null);
  const y = await approvedNote(owner2);
  check("§4 başka sahipte aynı no serbest", (await errorOf(() => fixNoteIdentity(y.id, { senderDocNo: `${P}-DUP` }, actorId))) === null);
  await prisma.customerDeliveryNote.update({ where: { id: peer.id }, data: { status: "CANCELLED" } });
  check("§4 iptal eş BLOCK'ta engel değil", (await errorOf(() => fixNoteIdentity(x.id, { senderDocNo: `${P}-DUP` }, actorId))) === null);

  await setMode("WARN");
  const w1 = await approvedNote(owner, { docNo: `${P}-WRN` });
  const w2 = await approvedNote(owner);
  const e2 = await errorOf(() => fixNoteIdentity(w2.id, { senderDocNo: `${P}-WRN` }, actorId));
  check("§4 ⭐ WARN işi süren eş → 409 DUPLICATE_DOC_NO_ACTIVE + peers", e2?.status === 409 && e2.code === "DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE" && !!e2.peers?.some((p) => p.noteNo === w1.noteNo), JSON.stringify(e2));
  const ok = await fixNoteIdentity(w2.id, { senderDocNo: `${P}-WRN`, confirmDuplicateDocNo: true }, actorId);
  check("§4 ⭐ WARN onay bayrağıyla geçer + uyarı", ok.note.senderDocNo === `${P}-WRN` && ok.warnings.length === 1, JSON.stringify(ok.warnings));
  const log = (await auditsOf(w2.id)).at(-1) as { newData: Record<string, unknown> } | undefined;
  check("§4 audit onaylanan eşi taşır", JSON.stringify(log?.newData.duplicateDocNoConfirmedPeers) === JSON.stringify([w1.noteNo]), JSON.stringify(log?.newData));

  await setMode("ALLOW");
  const al = await approvedNote(owner);
  check("§4 ALLOW eşe rağmen serbest", (await errorOf(() => fixNoteIdentity(al.id, { senderDocNo: `${P}-WRN` }, actorId))) === null);
  await setMode(null);
}

async function scenarioRace(owner: string, actorId: string): Promise<void> {
  console.log("§5 eşzamanlı iki düzeltme");
  const r = await approvedNote(owner, { docNo: `${P}-YRS0` });
  let releaseA: () => void = () => undefined;
  const hold = new Promise<void>((res) => { releaseA = res; });
  let aLocked: () => void = () => undefined;
  const lockedA = new Promise<void>((res) => { aLocked = res; });
  // Yazar A: aynı claim'i elle açık tx'te yapar ve satır kilidini tutar.
  const writerA = prisma.$transaction(async (tx) => {
    await tx.customerDeliveryNote.updateMany({ where: { id: r.id, status: { in: ["APPROVED", "PARTIAL"] }, senderDocNo: `${P}-YRS0` }, data: { senderDocNo: `${P}-YRSA` } });
    aLocked();
    await hold;
  }, { timeout: 20_000 });
  await lockedA;
  // Yazar B: A commit olmadan önce eski görüntüyü okur, claim'de satır kilidinde bekler.
  const writerB = errorOf(() => fixNoteIdentity(r.id, { senderDocNo: `${P}-YRSB` }, actorId));
  await new Promise((res) => setTimeout(res, 400));
  releaseA();
  await writerA;
  const eB = await writerB;
  const final = (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: r.id }, select: { senderDocNo: true } })).senderDocNo;
  check("§5 ⭐ ikinci yazar 409 DELIVERY_NOTE_CHANGED", eB?.status === 409 && eB.code === "DELIVERY_NOTE_CHANGED", JSON.stringify(eB));
  check("§5 ⭐ ilk yazarın değeri kaldı (son yazan ezmedi)", final === `${P}-YRSA`, String(final));
}

async function scenarioHttp(owner: string, adminId: string, url: string): Promise<void> {
  console.log("§6 HTTP");
  const parola = kosumaOzguParola();
  const mkUser = async (suffix: string, perms: string[]) => {
    const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${P}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${P} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: adminId })) } },
      select: { id: true, username: true },
    });
    fx.userIds.push(u.id);
    return u;
  };
  const login = async (username: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: parola, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const patch = async (token: string, id: string, body: unknown) => {
    const r = await fetch(`${url}/api/gelen-belge/irsaliyeler/${id}/kunye`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: { senderDocNo?: string | null }; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const writer = await login((await mkUser("yaz", ["gelen-belge:read", "gelen-belge:write"])).username);
  const reader = await login((await mkUser("oku", ["gelen-belge:read"])).username);
  check("§6 iki kullanıcı girişi", writer.length > 0 && reader.length > 0);
  const n = await approvedNote(owner);
  const r1 = await patch(writer, n.id, { senderDocNo: `${P}-H1`, customerBatchNo: "X" });
  check("§6 ⭐ başka başlık alanı → 400", r1.status === 400, JSON.stringify(r1));
  const r2 = await patch(writer, n.id, { ownerCustomerId: randomUUID() });
  check("§6 ⭐ sahip değiştirme → 400", r2.status === 400, JSON.stringify(r2));
  check("§6 400'lerde yazılmadı", (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: n.id }, select: { senderDocNo: true } })).senderDocNo === null);
  check("§6 boş gövde → 400", (await patch(writer, n.id, {})).status === 400);
  check("§6 biçimsiz tarih → 400", (await patch(writer, n.id, { senderDocDate: "08.11.2026" })).status === 400);
  const r3 = await patch(reader, n.id, { senderDocNo: `${P}-H1` });
  check("§6 ⭐ yalnız okuma izni → 403", r3.status === 403, JSON.stringify(r3));
  const r4 = await patch(writer, n.id, { senderDocNo: `${P}-H1`, senderDocDate: "2026-11-09" });
  check("§6 ⭐ izinli → 200 + yeni no", r4.status === 200 && r4.data?.senderDocNo === `${P}-H1`, JSON.stringify(r4).slice(0, 200));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await del("satır", () => prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: fx.noteIds } } }));
  await del("belge", () => prisma.customerDeliveryNote.deleteMany({ where: { id: { in: fx.noteIds } } }));
  await del("top", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("parti", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("iş emri", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("kalem", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("cari", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  // Bekçi kullanıcısı sert silinmez (audit FK) — pasifleşir.
  await del("kullanıcı", () => prisma.user.updateMany({ where: { id: { in: fx.userIds } }, data: { isActive: false } }));
  check("temizlik: TEST-GBKD belge/İE kalıntısı yok", (await prisma.customerDeliveryNote.count({ where: { id: { in: fx.noteIds } } })) === 0 && (await prisma.workOrder.count({ where: { id: { in: fx.woIds } } })) === 0);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge künye düzeltme (onaylı belgede fiş no / tarih) ===");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  let server: Server | null = null;
  try {
    for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) {
      await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    }
    const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
    itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST GBKD kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    fx.itemIds.push(itemId);
    const owner = (await prisma.customer.create({ data: { code: `${P}-O1`, name: `${P} sahip` }, select: { id: true } })).id;
    const owner2 = (await prisma.customer.create({ data: { code: `${P}-O2`, name: `${P} sahip iki` }, select: { id: true } })).id;
    fx.customerIds.push(owner, owner2);
    await scenarioFix(owner, admin.id);
    await scenarioStatus(owner, admin.id);
    await scenarioDuplicate(owner, owner2, admin.id);
    await scenarioRace(owner, admin.id);
    server = await new Promise<Server>((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    await scenarioHttp(owner, admin.id, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    stopNotificationJobs();
    if (server) { server.closeAllConnections(); await new Promise((res) => server!.close(res)); }
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
