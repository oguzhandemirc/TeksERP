// =============================================================================
// GELEN BELGE — TOPLU TASLAK SİLME bekçisi (HTTP, gerçek DB)
// =============================================================================
// Uçlar: POST /api/gelen-belge/irsaliyeler/toplu-sil/onizleme · POST /api/gelen-belge/irsaliyeler/toplu-sil.
// Toplu silme İKİNCİ silme mantığı değildir: her kayıt tekil `deleteDeliveryNote` yolundan geçer.
//   §1 kapı: gelen-belge:read ile iki uç 403 · boş liste / geçersiz kimlik / 201 kimlik → 400 · strict gövde
//   §2 önizleme: sıra korunur, tekrar tek sayılır; DRAFT silinebilir, APPROVED/PARTIAL/APPROVING/CANCELLED
//       409 kodu + Türkçe neden, olmayan kimlik NOT_FOUND; satır/sayfa sayısı; özet; önizleme YAZMAZ
//   §3 uygula: kayıt başına sonuç (DRAFT 200, onaylı 409 DELIVERY_NOTE_NOT_DRAFT, yok 404); taslaklar gitti,
//       onaylılar yerinde, tarama çözüldü (silinmedi), satırlar Cascade, top doğmadı; silinen başına audit DELETE
//   §4 bayat önizleme: önizlemeden sonra onaylanan belge uygulamada 409 (claim WHERE durumu taşır), kayıt yerinde
//   §5 yarış: aynı taslağa eşzamanlı iki uygula → tam bir başarı, öteki 404/409
// Emsal: scripts/test_gelen_belge_taslak.ts.
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import crypto from "node:crypto";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
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
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `GBTS${Date.now().toString(36).toUpperCase()}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} toplu sil`)]);
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], scans: [] as string[] };
const PREVIEW = "/api/gelen-belge/irsaliyeler/toplu-sil/onizleme";
const APPLY = "/api/gelen-belge/irsaliyeler/toplu-sil";

interface PItem { id: string; noteNo: string | null; status: string | null; deletable: boolean; code: string | null; reason: string | null; lineCount: number; scanCount: number }
interface RItem { id: string; noteNo: string | null; ok: boolean; status: number; code: string | null; message: string | null }
type Resp = { status: number; code?: string; data?: { items?: PItem[]; summary?: Record<string, number>; results?: RItem[]; id?: string; scan?: { id?: string } } };

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

const line = (n: number) => ({ senderRollNo: `${TAG}-R${n}`, meters: 100 + n, weightKg: 20 + n, itemText: "Pamuklu", colorText: "Beyaz" });

async function main(): Promise<void> {
  console.log("=== Gelen belge toplu taslak silme bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
    const parola = kosumaOzguParola();
    const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read"] } }, select: { id: true } });
    const ru = await prisma.user.create({
      data: { username: `${TAG}-okur`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} okur`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(ru.id);
    const reader = await login(ru.username, parola);
    const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} cari` }, select: { id: true } })).id;
    made.customers.push(owner);

    const draft = async (n: number, extra: Record<string, unknown> = {}): Promise<string> => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ownerCustomerId: owner, senderDocNo: `${TAG}-${n}`, ...extra });
      const id = String(r.data?.id ?? "");
      if (id) made.notes.push(id);
      return id;
    };
    const setStatus = (id: string, status: "APPROVED" | "PARTIAL" | "APPROVING" | "CANCELLED") =>
      prisma.customerDeliveryNote.update({
        where: { id },
        data: status === "CANCELLED"
          ? { status, cancelledAt: new Date(), cancelledById: admin.id, cancelReason: "bekçi iptali" }
          : status === "APPROVING" ? { status } : { status, approvedAt: new Date(), approvedById: admin.id },
      });

    // §1 kapı
    console.log("§1 kapı");
    const someId = crypto.randomUUID();
    check("gelen-belge:read ile önizleme 403", (await call("POST", PREVIEW, reader, { ids: [someId] })).status === 403);
    check("gelen-belge:read ile uygula 403", (await call("POST", APPLY, reader, { ids: [someId] })).status === 403);
    check("boş liste → 400", (await call("POST", PREVIEW, tk, { ids: [] })).status === 400);
    check("geçersiz kimlik → 400", (await call("POST", APPLY, tk, { ids: ["x"] })).status === 400);
    check("201 kimlik (tavan 200) → 400", (await call("POST", PREVIEW, tk, { ids: Array.from({ length: 201 }, () => crypto.randomUUID()) })).status === 400);
    check("strict gövde: tanınmayan alan → 400", (await call("POST", APPLY, tk, { ids: [someId], force: true })).status === 400);

    // Fikstür: 2 taslak (biri taramalı + 2 satırlı), onaylı, kısmi, onaylanıyor, iptal
    const up = await call("POST", "/api/gelen-belge/taramalar", tk, { contentBase64: JPEG.toString("base64") });
    const scanId = String(up.data?.scan?.id ?? "");
    if (scanId) made.scans.push(scanId);
    const dA = await draft(1, { scanIds: [scanId], lines: [line(1), line(2)] });
    const dB = await draft(2);
    const ap = await draft(3);
    const pa = await draft(4);
    const ag = await draft(5);
    const ca = await draft(6);
    await setStatus(ap, "APPROVED");
    await setStatus(pa, "PARTIAL");
    await setStatus(ag, "APPROVING");
    await setStatus(ca, "CANCELLED");
    check("fikstür: 6 belge + tarama", [dA, dB, ap, pa, ag, ca, scanId].every((x) => x.length > 0));

    // §2 önizleme
    console.log("§2 önizleme");
    const missing = crypto.randomUUID();
    const before = { notes: await prisma.customerDeliveryNote.count({ where: { id: { in: made.notes } } }), logs: await prisma.systemLog.count({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", action: "DELETE", recordId: { in: made.notes } } }) };
    const pv = await call("POST", PREVIEW, tk, { ids: [dA, ap, dB, pa, ag, ca, missing, dA] });
    const items = pv.data?.items ?? [];
    const by = (id: string) => items.find((i) => i.id === id);
    check("önizleme 200, sıra korunur, tekrar tek sayılır (7 kayıt)", pv.status === 200 && items.map((i) => i.id).join() === [dA, ap, dB, pa, ag, ca, missing].join(), `${pv.status} ${items.length}`);
    check("⭐ DRAFT silinebilir, nedensiz", by(dA)?.deletable === true && by(dA)?.reason === null && by(dB)?.deletable === true);
    const blocked = [ap, pa, ag, ca].map(by);
    check("⭐ APPROVED/PARTIAL/APPROVING/CANCELLED silinemez + DELIVERY_NOTE_NOT_DRAFT + Türkçe neden", blocked.every((b) => b?.deletable === false && b.code === "DELIVERY_NOTE_NOT_DRAFT" && typeof b.reason === "string" && b.reason.length > 10), JSON.stringify(blocked.map((b) => [b?.status, b?.reason])));
    check("olmayan kimlik → NOT_FOUND + neden", by(missing)?.deletable === false && by(missing)?.code === "DELIVERY_NOTE_NOT_FOUND" && !!by(missing)?.reason);
    check("satır/sayfa sayısı kayıt başına (taslak A: 2 satır, 1 sayfa)", by(dA)?.lineCount === 2 && by(dA)?.scanCount === 1 && by(dB)?.lineCount === 0, JSON.stringify(by(dA)));
    const s = pv.data?.summary ?? {};
    check("özet: 7 istenen, 2 silinebilir, 5 engelli, 2 satır, 1 sayfa", s.requested === 7 && s.deletable === 2 && s.blocked === 5 && s.lines === 2 && s.scans === 1, JSON.stringify(s));
    const after = { notes: await prisma.customerDeliveryNote.count({ where: { id: { in: made.notes } } }), logs: await prisma.systemLog.count({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", action: "DELETE", recordId: { in: made.notes } } }) };
    check("önizleme YAZMAZ (belge ve DELETE audit sayısı aynı)", after.notes === before.notes && after.logs === before.logs, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

    // §3 uygula
    console.log("§3 uygula");
    const rollsBefore = await prisma.roll.count();
    const res = await call("POST", APPLY, tk, { ids: [dA, ap, dB, missing, pa] });
    const rs = res.data?.results ?? [];
    const rby = (id: string) => rs.find((r) => r.id === id);
    check("uygula 200, kayıt başına 5 sonuç", res.status === 200 && rs.length === 5, `${res.status} ${rs.length}`);
    check("⭐ taslaklar ok (200, noteNo dolu)", rby(dA)?.ok === true && rby(dB)?.ok === true && !!rby(dA)?.noteNo && rby(dA)?.status === 200);
    check("⭐ onaylı/kısmi 409 DELIVERY_NOTE_NOT_DRAFT + Türkçe mesaj, diğerlerini durdurmadı", [ap, pa].every((id) => rby(id)?.ok === false && rby(id)?.status === 409 && rby(id)?.code === "DELIVERY_NOTE_NOT_DRAFT" && (rby(id)?.message ?? "").includes("taslak değil")), JSON.stringify([rby(ap), rby(pa)]));
    check("olmayan kimlik 404 DELIVERY_NOTE_NOT_FOUND", rby(missing)?.ok === false && rby(missing)?.status === 404 && rby(missing)?.code === "DELIVERY_NOTE_NOT_FOUND");
    check("özet deleted=2 failed=3", res.data?.summary?.deleted === 2 && res.data?.summary?.failed === 3, JSON.stringify(res.data?.summary));
    check("⭐ taslaklar DB'den gitti, onaylı/kısmi yerinde", (await prisma.customerDeliveryNote.count({ where: { id: { in: [dA, dB] } } })) === 0 && (await prisma.customerDeliveryNote.count({ where: { id: { in: [ap, pa] } } })) === 2);
    const scanRow = await prisma.documentScan.findUnique({ where: { id: scanId }, select: { noteId: true } });
    check("tarama silinmedi, çözüldü (noteId null); satırlar Cascade", scanRow !== null && scanRow.noteId === null && (await prisma.customerDeliveryNoteLine.count({ where: { noteId: dA } })) === 0);
    check("top doğmadı (roll sayısı aynı)", (await prisma.roll.count()) === rollsBefore);
    let logs = 0;
    for (let i = 0; i < 20 && logs < 2; i++) {
      logs = await prisma.systemLog.count({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", action: "DELETE", recordId: { in: [dA, dB] } } });
      if (logs < 2) await new Promise((r) => setTimeout(r, 100));
    }
    const wrongLogs = await prisma.systemLog.count({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", action: "DELETE", recordId: { in: [ap, pa] } } });
    check("⭐ audit: silinen her taslağa bir DELETE, düşenlere yok", logs === 2 && wrongLogs === 0, `${logs}/${wrongLogs}`);

    // §4 bayat önizleme
    console.log("§4 bayat önizleme");
    const dC = await draft(7);
    const pv2 = await call("POST", PREVIEW, tk, { ids: [dC] });
    check("önizlemede silinebilir", pv2.data?.items?.[0]?.deletable === true);
    await setStatus(dC, "APPROVED");
    const res2 = await call("POST", APPLY, tk, { ids: [dC] });
    check("⭐ arada onaylanan belge uygulamada 409, kayıt yerinde", res2.data?.results?.[0]?.status === 409 && res2.data?.results?.[0]?.ok === false && (await prisma.customerDeliveryNote.count({ where: { id: dC } })) === 1, JSON.stringify(res2.data?.results));

    // §5 yarış
    console.log("§5 yarış");
    const dD = await draft(8, { lines: [line(8)] });
    const [rA, rB] = await Promise.all([call("POST", APPLY, tk, { ids: [dD] }), call("POST", APPLY, tk, { ids: [dD] })]);
    const outs = [rA.data?.results?.[0], rB.data?.results?.[0]];
    check("⭐ eşzamanlı iki uygula → tam bir başarı, öteki 404/409", outs.filter((o) => o?.ok).length === 1 && outs.some((o) => o?.ok === false && (o.status === 404 || o.status === 409)), JSON.stringify(outs.map((o) => [o?.ok, o?.status])));
    check("yarış sonrası belge yok", (await prisma.customerDeliveryNote.count({ where: { id: dD } })) === 0);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

async function cleanup(): Promise<void> {
  await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.documentScan.deleteMany({ where: { OR: [{ id: { in: made.scans } }, { capturedById: { in: made.users } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
}

if (!engel) void main();
