// =============================================================================
// GELEN BELGE — GELEN KG (belge tanıt 3 aşama B1, 2026-11-09)
// =============================================================================
// Saf seçici `pickIncomingKg` / `resolvePartyKg` / `declaredKgOf` + HTTP/DB yolu: `POST /irsaliyeler/:id/is-emri` gövdesi
// `incomingKg` / `parties[].incomingKg` → özet satırı `weightKg`; onay ARABA özet satırının kg'sini topa YAZMAZ; İE detayı
// `incoming.kg` = kök topların satır kg toplamı (eksik satır → null); "Toplar ayrı geldi" (TOP) top kg'si bugünkü gibi.
//   §1 ⭐ öncelik tablosu MANUAL > FIELD > TOTAL > LINE_SUM (16 kombinasyon) + ≤0/NaN/boş reddi + kısmi Σ satır null
//   §2 ⭐ gövde `incomingKg: 0` → 400 (tek ve parti)
//   §3 ⭐ gövdesiz → Σ satır kg önerisi özet satırına; ⭐ Roll.weightKg NULL; ⭐ İE incoming.kg = Σ
//   §4 ⭐ gövdedeki kg önerinin üstünde; §5 ⭐ bir satırda kg yok → özet kg null → İE incoming.kg null
//   §6 ⭐ çok parti: parti 1 beyan kg (TOTAL), parti 2 gövde düzeltmesi → iki özet satırı; İE incoming.kg = toplam
//   §7 ⭐ TOP kipi (Toplar ayrı geldi): top kg'si topa yazılır (bugünkü)
//   §8 GELEN EN: ⭐ şablon `en` → özet satırı widthCm, Roll.width NULL; ⭐ gövde `incomingWidth` önde; 0 → 400; ⭐ partide gövde/belge
// Negatif sonda: onaydaki ARABA koruması kaldırılınca §3 "Roll.weightKg NULL" kırmızı; MANUAL önceliği düşürülünce §1 kırmızı;
// en için ARABA koruması kaldırılınca §8 "Roll.width NULL" kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { summaryLineId, partyLineId } from "../src/services/gelen-belge-kontrol.service";
import { declaredKgOf, pickIncomingKg, resolvePartyKg, type IncomingKgSource } from "../src/lib/gelen-belge/gelen-kg";
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
  console.log("§1 saf seçici");
  const vals = { manualKg: 11, fieldKg: 22, declaredKg: 33, lineKgs: [20, 24] } as const;
  const order: Array<[keyof typeof vals, IncomingKgSource, number]> = [["manualKg", "MANUAL", 11], ["fieldKg", "FIELD", 22], ["declaredKg", "TOTAL", 33], ["lineKgs", "LINE_SUM", 44]];
  let bad = 0;
  for (let mask = 0; mask < 16; mask++) {
    const input: Record<string, unknown> = {};
    order.forEach(([k], i) => { if (mask & (1 << i)) input[k] = vals[k]; });
    const r = pickIncomingKg(input);
    const exp = order.find((_, i) => mask & (1 << i));
    if (exp ? r.kg !== exp[2] || r.source !== exp[1] : r.kg !== null || r.source !== null) { bad++; console.error("  kombinasyon", mask, JSON.stringify(r)); }
  }
  check("§1 ⭐ öncelik tablosu MANUAL > FIELD > TOTAL > LINE_SUM (16 kombinasyon)", bad === 0, `${bad} hatalı`);
  const rej = [0, -5, Number.NaN, "", "abc", "0", null];
  check("§1 ⭐ ≤0 / NaN / boş / metin reddedilir (sıradaki kaynağa düşer)", rej.every((v) => pickIncomingKg({ manualKg: v as number, fieldKg: v as number, declaredKg: "12,5" }).source === "TOTAL"));
  check("§1 TOTAL virgüllü metin 12,5 → 12.5", pickIncomingKg({ declaredKg: "12,5" }).kg === 12.5);
  check("§1 ⭐ kısmi Σ satır (bir satır boş/sıfır) → null", pickIncomingKg({ lineKgs: [10, null] }).kg === null && pickIncomingKg({ lineKgs: [10, 0] }).kg === null && pickIncomingKg({ lineKgs: [] }).kg === null);
  check("§1 resolvePartyKg: beyan > Σ satır; elle en üstte", resolvePartyKg("55", [1, 2]).source === "TOTAL" && resolvePartyKg(null, [1, 2]).kg === 3 && resolvePartyKg(55, [1], 9).source === "MANUAL");
  check("§1 declaredKgOf: belge beyanı > tüm blok kg toplamı; eksik blok → null",
    declaredKgOf({ document: { kg: "70" }, blocks: [{ kg: "1" }] }) === 70 && declaredKgOf({ blocks: [{ kg: "30" }, { kg: "12.5" }] }) === 42.5 && declaredKgOf({ blocks: [{ kg: "30" }, { m: "5" }] }) === null && declaredKgOf(null) === null);
}

const TAG = `TEST-GKG${Date.now().toString(36).toUpperCase()}`;
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
  const lineOf = (id: string) => prisma.customerDeliveryNoteLine.findUnique({ where: { id }, select: { weightKg: true, widthCm: true, rollId: true, roll: { select: { weightKg: true, width: true } } } });
  const incomingOf = async (woId: string) => ((await woDetail(woId)).data as { incoming?: { kg: unknown; kgSource: unknown; meters: unknown } | null } | null)?.incoming;

  console.log("§2 gövde kapısı");
  const n2 = await mkNote([{ meters: 100, weightKg: 40 }]);
  const r2a = await formWo(n2, body({ incomingKg: 0 }));
  const r2b = await formWo(n2, body({ parties: [{ blockNo: 1, meters: 10, incomingKg: 0 }, { blockNo: 2, meters: 10 }] }));
  check("§2 ⭐ incomingKg: 0 → 400 (tek ve parti), belge DRAFT", r2a.status === 400 && r2b.status === 400 && (await prisma.customerDeliveryNote.findUnique({ where: { id: n2 }, select: { status: true } }))?.status === "DRAFT", `${r2a.status} ${r2b.status}`);

  console.log("§3 öneri özet satırına, topa değil");
  const n3 = await mkNote([{ meters: 100, weightKg: 40 }, { meters: 50, weightKg: 20 }]);
  const oz3 = await call("GET", `/api/gelen-belge/irsaliyeler/${n3}/okuma-ozeti`, wt);
  check("§3 okuma özeti incomingKg 60 · LINE_SUM", oz3.data?.incomingKg === 60 && oz3.data?.incomingKgSource === "LINE_SUM", JSON.stringify([oz3.data?.incomingKg, oz3.data?.incomingKgSource]));
  const r3 = await formWo(n3, body());
  const l3 = await lineOf(summaryLineId(n3));
  check("§3 ⭐ gövdesiz → özet satırı weightKg = 60 (Σ satır)", r3.status === 201 && Number(l3?.weightKg) === 60, `${r3.status} ${r3.code ?? ""} ${String(l3?.weightKg)}`);
  check("§3 ⭐ Roll.weightKg NULL (ARABA özet satırının kg'si topa geçmez)", !!l3?.rollId && l3.roll?.weightKg == null, String(l3?.roll?.weightKg));
  const wo3 = (r3.data as { workOrderId?: string } | undefined)?.workOrderId ?? "";
  const inc3 = await incomingOf(wo3);
  check("§3 ⭐ İE detayı incoming.kg = 60 · DOCUMENT, meters = 150", Number(inc3?.kg) === 60 && inc3?.kgSource === "DOCUMENT" && Number(inc3?.meters) === 150, JSON.stringify(inc3));

  console.log("§4 gövde > öneri");
  const n4 = await mkNote([{ meters: 100, weightKg: 40 }]);
  const r4 = await formWo(n4, body({ kursunMeters: 100, incomingKg: 77.5 }));
  const l4 = await lineOf(summaryLineId(n4));
  check("§4 ⭐ gövdedeki 77.5 yazıldı", r4.status === 201 && Number(l4?.weightKg) === 77.5 && l4?.roll?.weightKg == null, `${r4.status} ${String(l4?.weightKg)}`);

  console.log("§5 eksik kg");
  const n5 = await mkNote([{ meters: 100, weightKg: 40 }, { meters: 50 }]);
  const r5 = await formWo(n5, body());
  const l5 = await lineOf(summaryLineId(n5));
  const inc5 = await incomingOf((r5.data as { workOrderId?: string } | undefined)?.workOrderId ?? "");
  check("§5 ⭐ bir satırda kg yok → özet kg null, İE incoming.kg null (kısmi toplam yok)", r5.status === 201 && l5?.weightKg == null && inc5 !== undefined && inc5 !== null && inc5.kg === null && inc5.kgSource === null, JSON.stringify(inc5));

  console.log("§6 çok parti");
  const n6 = await mkNote([{ meters: 60, weightKg: 30, blockNo: 1 }, { meters: 40, weightKg: 20, blockNo: 1 }, { meters: 30, weightKg: 10, blockNo: 2 }, { meters: 20, weightKg: 15, blockNo: 2 }],
    { blocks: [{ blockNo: 1, batchNo: `${TAG}A`, kg: "55" }, { blockNo: 2, batchNo: `${TAG}B` }] });
  const pr6 = await call("GET", `/api/gelen-belge/irsaliyeler/${n6}/partiler`, tk);
  const pp6 = ((pr6.data as { parties?: Array<{ blockNo: number; suggestedKg: number | null; kgSource: string | null }> } | undefined)?.parties) ?? [];
  check("§6 /partiler suggestedKg: 1 → 55 TOTAL, 2 → 25 LINE_SUM", pp6.find((p) => p.blockNo === 1)?.suggestedKg === 55 && pp6.find((p) => p.blockNo === 1)?.kgSource === "TOTAL" && pp6.find((p) => p.blockNo === 2)?.suggestedKg === 25 && pp6.find((p) => p.blockNo === 2)?.kgSource === "LINE_SUM", JSON.stringify(pp6.map((p) => [p.blockNo, p.suggestedKg, p.kgSource])));
  const r6 = await formWo(n6, body({ mode: "SINGLE", parties: [{ blockNo: 1, meters: 100 }, { blockNo: 2, meters: 50, incomingKg: 26 }] }));
  const a6 = await lineOf(partyLineId(n6, 1));
  const b6 = await lineOf(partyLineId(n6, 2));
  check("§6 ⭐ parti özet satırları 55 (öneri) + 26 (gövde); toplar kg'siz", r6.status === 201 && Number(a6?.weightKg) === 55 && Number(b6?.weightKg) === 26 && a6?.roll?.weightKg == null && b6?.roll?.weightKg == null, `${r6.status} ${r6.code ?? ""} ${String(a6?.weightKg)} ${String(b6?.weightKg)}`);
  const inc6 = await incomingOf((r6.data as { workOrderId?: string } | undefined)?.workOrderId ?? "");
  check("§6 ⭐ İE incoming.kg = 81 (iki kök)", Number(inc6?.kg) === 81, JSON.stringify(inc6));

  console.log("§7 TOP kipi bugünkü gibi");
  const n7 = await mkNote([{ meters: 100, weightKg: 40 }]);
  const r7 = await formWo(n7, body({ rollMode: "SEPARATE", rolls: [{ meters: 70, weightKg: 28 }, { meters: 30, weightKg: 12 }] }));
  const t7 = await lineOf(partyLineId(n7, 1));
  check("§7 ⭐ TOP kipinde top kg'si topa yazılır (28)", r7.status === 201 && Number(t7?.roll?.weightKg) === 28, `${r7.status} ${r7.code ?? ""} ${String(t7?.roll?.weightKg)}`);

  console.log("§8 gelen en");
  const n8 = await mkNote([{ meters: 100, weightKg: 40 }], undefined, { en: "152,5" });
  const r8 = await formWo(n8, body({ kursunMeters: 100 }));
  const l8 = await lineOf(summaryLineId(n8));
  check("§8 ⭐ gövdesiz → şablon en 152,5 özet satırına; Roll.width NULL", r8.status === 201 && Number(l8?.widthCm) === 152.5 && !!l8?.rollId && l8.roll?.width == null, `${r8.status} ${r8.code ?? ""} ${String(l8?.widthCm)} ${String(l8?.roll?.width)}`);
  const n8b = await mkNote([{ meters: 100 }], undefined, { en: "152" });
  const r8b = await formWo(n8b, body({ kursunMeters: 100, incomingWidth: 148 }));
  const l8b = await lineOf(summaryLineId(n8b));
  check("§8 ⭐ gövdedeki incomingWidth (148) belgedekinin önünde", r8b.status === 201 && Number(l8b?.widthCm) === 148, `${r8b.status} ${String(l8b?.widthCm)}`);
  const r8c = await formWo(n8b, body({ incomingWidth: 0 }));
  check("§8 incomingWidth: 0 → 400", r8c.status === 400, String(r8c.status));
  const n8d = await mkNote([{ meters: 60, blockNo: 1 }, { meters: 40, blockNo: 2 }], { blocks: [{ blockNo: 1, batchNo: `${TAG}C` }, { blockNo: 2, batchNo: `${TAG}D` }] }, { en: "160" });
  const r8d = await formWo(n8d, body({ mode: "SINGLE", parties: [{ blockNo: 1, meters: 60 }, { blockNo: 2, meters: 40, incomingWidth: 158 }] }));
  const a8 = await lineOf(partyLineId(n8d, 1));
  const b8 = await lineOf(partyLineId(n8d, 2));
  check("§8 ⭐ parti: belge en 160 + gövde 158; toplar ensiz", r8d.status === 201 && Number(a8?.widthCm) === 160 && Number(b8?.widthCm) === 158 && a8?.roll?.width == null && b8?.roll?.width == null, `${r8d.status} ${r8d.code ?? ""} ${String(a8?.widthCm)} ${String(b8?.widthCm)}`);
  const n8e = await mkNote([{ meters: 100 }]);
  const r8e = await formWo(n8e, body({ kursunMeters: 100 }));
  check("§8 belgede en yoksa özet satırı widthCm NULL", r8e.status === 201 && (await lineOf(summaryLineId(n8e)))?.widthCm == null, String(r8e.status));
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
  console.log("=== Gelen belge gelen kg bekçisi ===\n");
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
