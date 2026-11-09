// =============================================================================
// GELEN BELGE — PARTİ SATIRI MÜŞTERİ PARTİ NO + LİSTE ARAMASI + İE GELEN KÜNYESİ (2026-11-09)
// =============================================================================
// Onay (iş emri formu) ARABA özet/parti satırına müşteri parti no'yu (`customerBatchNo`) yazar: çok partide partinin (formda
// onaylanan), tek partide başlığınki. Liste araması parti satırı parti no'sunu da tarar. İE detayı `incoming` kaynak belge(ler),
// gelen en (hepsi aynıysa) ve müşteri parti no (tekil, sıralı birleşik) taşır.
//   §1 ⭐ saf foldWoIncoming: en eşit/farklı/eksik, kg kısmi null, parti no tekil sıralı, belge tekil sıralı
//   §2 ⭐ tek parti: özet satırı parti no = formda düzeltilen başlık
//   §3 ⭐ İE incoming: notes[{id,noteNo}] · widthCm · customerBatchNo
//   §4 ⭐ çok parti: parti satırları kendi parti no'su; İE customerBatchNo birleşik; en yok → null
//   §5 ⭐ liste araması parti satırı parti no'suyla bulur (başlıkta yok); audit yükünde parti no
// Negatif sonda: summaryTargets parti no'yu yazmayınca §4/§5 kırmızı; arama satır dalı kaldırılınca §5 kırmızı;
// foldWoIncoming en eşitlik denetimi kaldırılınca §1 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { summaryLineId, partyLineId } from "../src/services/gelen-belge-kontrol.service";
import { foldWoIncoming } from "../src/services/helpers/wo-incoming.helper";
import { findById as woDetail } from "../src/services/workorder/detail";
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

function pure(): void {
  console.log("§1 saf");
  const D = (v: string | null) => (v == null ? null : new Prisma.Decimal(v));
  const L = (rollId: string, kg: string | null, w: string | null, b: string | null, n = "1") => ({ rollId, weightKg: D(kg), widthCm: D(w), customerBatchNo: b, note: { id: `n${n}`, noteNo: `GB-${n}` } });
  const m = new Prisma.Decimal(100);
  const same = foldWoIncoming(m, ["a", "b"], [L("a", "10", "150", "B"), L("b", "5", "150.00", "A", "2")]);
  check("§1 ⭐ fold: en hepsinde aynı → tek değer; parti no tekil sıralı; belge tekil sıralı; kg toplam", same?.widthCm?.toString() === "150" && same.customerBatchNo === "A, B" && JSON.stringify(same.notes) === JSON.stringify([{ id: "n1", noteNo: "GB-1" }, { id: "n2", noteNo: "GB-2" }]) && Number(same.kg) === 15, JSON.stringify(same));
  const diff = foldWoIncoming(m, ["a", "b"], [L("a", "10", "150", "A"), L("b", "5", "148", "A")]);
  const miss = foldWoIncoming(m, ["a", "b"], [L("a", null, "150", null), L("b", "5", null, null)]);
  const orphan = foldWoIncoming(m, ["a", "c"], [L("a", "10", "150", "A")]);
  check("§1 ⭐ fold: en farklı / bir kökte yok / kök satırsız → null; kg kısmi → null; parti no yoksa null", diff?.widthCm === null && diff.customerBatchNo === "A" && miss?.widthCm === null && miss.kg === null && miss.customerBatchNo === null && orphan?.widthCm === null && orphan.kg === null, JSON.stringify([diff?.widthCm, miss?.widthCm, orphan?.widthCm]));
  check("§1 fold: kök yok / satır yok → null", foldWoIncoming(m, [], []) === null && foldWoIncoming(m, ["a"], []) === null);
}

const TAG = `TEST-GPN${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER,
];
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string }; warnings?: string[] };
    return { status: r.status, code: j.details?.code, data: j.data, warnings: j.warnings };
  };
  const tk = await login(admin.username, admin.password);
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"] } }, select: { id: true } });
  const u = await prisma.user.create({
    data: { username: `${TAG}-w`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} W`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(u.id);
  const wt = await login(u.username, parola);
  check("giriş", tk.length > 0 && wt.length > 0);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} istasyon`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  const mkNote = async (lines: Array<{ meters: number; weightKg?: number | null; blockNo?: number }>, totalsDeclared?: unknown, regionFields?: Record<string, string>) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN`, ...(totalsDeclared ? { totalsDeclared } : {}), lines: lines.map((l, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, itemText: "Kumaş", ...l })) });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const content = Buffer.from(`${TAG}-${randomUUID()}`);
    const s = await prisma.documentScan.create({ data: { noteId: id, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: TAG }, ...(regionFields ? { regions: [{ templateId: null, fields: regionFields }] } : {}) } }, select: { id: true } });
    made.scans.push(s.id);
    if (r.status !== 201) check("taslak", false, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  const body = (extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: 150, routeTemplateId: route, ...extra });
  const formWo = (id: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, wt, b);

  const lineOf = (id: string) => prisma.customerDeliveryNoteLine.findUnique({ where: { id }, select: { customerBatchNo: true, weightKg: true, widthCm: true } });
  type Inc = { notes?: Array<{ id: string; noteNo: string }>; widthCm?: unknown; customerBatchNo?: unknown; kg?: unknown } | null | undefined;
  const incomingOf = async (woId: string) => ((await woDetail(woId)).data as { incoming?: Inc } | null)?.incoming;
  const noteNoOf = async (id: string) => (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { noteNo: true } }))?.noteNo ?? "";

  console.log("§2 tek parti");
  const n2 = await mkNote([{ meters: 100, weightKg: 40 }, { meters: 50, weightKg: 20 }], undefined, { partiNo: `${TAG}P1`, en: "152,5" });
  await prisma.customerDeliveryNote.update({ where: { id: n2 }, data: { customerBatchNo: `${TAG}P1` } }); // okumanın başlığa yazdığı
  const r2 = await formWo(n2, body({ kursunMeters: 150, incomingKg: 70, customerBatchNo: `${TAG}P1X` }));
  const l2 = await lineOf(summaryLineId(n2));
  check("§2 ⭐ özet satırı customerBatchNo = formda düzeltilen başlık", r2.status === 201 && l2?.customerBatchNo === `${TAG}P1X`, `${r2.status} ${r2.code ?? ""} ${l2?.customerBatchNo}`);
  check("§2 özet satırı kg 70, en 152.5 (bugünkü)", Number(l2?.weightKg) === 70 && Number(l2?.widthCm) === 152.5);

  console.log("§3 İE incoming künyesi");
  const inc2 = await incomingOf((r2.data as { workOrderId?: string } | undefined)?.workOrderId ?? "");
  check("§3 ⭐ incoming.notes = [{id, noteNo}] kaynak belge", JSON.stringify(inc2?.notes) === JSON.stringify([{ id: n2, noteNo: await noteNoOf(n2) }]), JSON.stringify(inc2?.notes));
  check("§3 ⭐ incoming.widthCm 152.5 · customerBatchNo P1X", Number(inc2?.widthCm) === 152.5 && inc2?.customerBatchNo === `${TAG}P1X`, JSON.stringify([inc2?.widthCm, inc2?.customerBatchNo]));

  console.log("§4 çok parti");
  const n4 = await mkNote([{ meters: 60, weightKg: 30, blockNo: 1 }, { meters: 40, weightKg: 20, blockNo: 1 }, { meters: 30, weightKg: 10, blockNo: 2 }, { meters: 20, weightKg: 15, blockNo: 2 }],
    { blocks: [{ blockNo: 1, batchNo: `${TAG}A`, kg: "55" }, { blockNo: 2, batchNo: `${TAG}B` }] });
  const r4 = await formWo(n4, body({ mode: "SINGLE", parties: [{ blockNo: 1, meters: 100, batchNo: `${TAG}A` }, { blockNo: 2, meters: 50, batchNo: `${TAG}BX`, incomingKg: 26 }] }));
  const a4 = await lineOf(partyLineId(n4, 1));
  const b4 = await lineOf(partyLineId(n4, 2));
  check("§4 ⭐ parti satırları kendi müşteri parti no'su (A · BX)", r4.status === 201 && a4?.customerBatchNo === `${TAG}A` && b4?.customerBatchNo === `${TAG}BX`, `${r4.status} ${r4.code ?? ""} ${a4?.customerBatchNo} ${b4?.customerBatchNo}`);
  const inc4 = await incomingOf((r4.data as { workOrderId?: string } | undefined)?.workOrderId ?? "");
  check("§4 ⭐ İE incoming.customerBatchNo 'A, BX' · en yok → null · tek belge", inc4?.customerBatchNo === `${TAG}A, ${TAG}BX` && inc4.widthCm === null && inc4.notes?.length === 1, JSON.stringify(inc4));

  console.log("§5 arama + audit");
  const hdr = await prisma.customerDeliveryNote.findUnique({ where: { id: n4 }, select: { customerBatchNo: true } });
  const s5 = await call("GET", `/api/gelen-belge/irsaliyeler?q=${encodeURIComponent(`${TAG}BX`.toLowerCase())}`, tk);
  const ids5 = ((s5.data as { items?: Array<{ id: string }> } | undefined)?.items ?? []).map((i) => i.id);
  check("§5 ⭐ liste araması parti satırı parti no'suyla bulur (başlıkta yok)", s5.status === 200 && !hdr?.customerBatchNo?.includes("BX") && ids5.includes(n4) && !ids5.includes(n2), `${s5.status} ${JSON.stringify(ids5.length)}`);
  const logs = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE_LINE", recordId: { in: [partyLineId(n4, 1), partyLineId(n4, 2), summaryLineId(n2)] } }, select: { newData: true } });
  const blob = JSON.stringify(logs.map((x) => x.newData));
  check("§5 audit yükünde parti satırı parti no'su", logs.length >= 3 && blob.includes(`${TAG}BX`), `${logs.length} kayıt`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(swallow);
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
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge parti satırı parti no bekçisi ===\n");
  pure();
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
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
