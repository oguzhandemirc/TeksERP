// =============================================================================
// GELEN BELGE — GELEN KUMAŞ / GELEN RENK BEYANI (2026-11-09)
// =============================================================================
// Belgedeki kumaş adı ve renk müşterinin BEYANIDIR (gelen metre gibi), İE hedefi değil. Şablon anahtarları (`desen`/`renk`) aynı,
// anlam "Gelen kumaş"/"Gelen renk". Onay (iş emri formu) ARABA özet/parti satırına `itemText`/`colorText` yazar (gövde > bölüm
// beyanı > belge geneli); İE `incoming` her kökte aynıysa tek değer verir; okuma özeti `incomingDeclared` beyanı ve (ONER'de)
// eşlenen kartı hedeften AYRI alanlarda taşır.
//   §1 ⭐ saf: katalog (desen/renk GELEN, woTarget incoming*), etiket; foldWoIncoming itemText/colorText aynı/farklı/eksik
//   §2 ⭐ tek parti: özet satırı itemText/colorText = şablon desen/renk; İE hedef kumaşı beyandan TÜREMEZ; İE incoming
//   §3 ⭐ gövde beyanı ezer (null = yok)
//   §4 ⭐ çok parti: parti satırı kendi bölüm beyanı; İE incoming farklıysa null, aynıysa değer
//   §5 ⭐ okuma özeti incomingDeclared: KAPALI'da metin var öneri yok; ONER'de öğrenilmiş eşleme (alias) kartı önerir
//   §6 ⭐ `skipDeclared` (2026-11-10, cihazda kapatılan gelen alanlar): beyanlı alan belgeden de gövdeden de yazılmaz (özet + parti
//      satırı null), beyansız istek bugünkü gibi doldurur, bilinmeyen alan adı 400
// Negatif sonda: summaryTargets itemText yazmayınca §2/§4 kırmızı (2026-11-09 elle ölçüldü); `skipped()` hep false dönünce §6 kırmızı.
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
import { FIELD_TARGETS } from "../src/lib/gelen-belge/alan-hedef";
import { ASSIGNABLE_FIELDS } from "../src/lib/gelen-belge/motor";
import { noteFormFields } from "../src/services/gelen-belge-form-alanlari.service";
import { aliasKey } from "../src/services/gelen-belge-eslestirme.service";
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
  check("§1 ⭐ katalog: desen/renk GELEN grubunda, İE karşılığı beyan (incomingItemText/incomingColorText), etiket Gelen kumaş/renk",
    FIELD_TARGETS.desen.group === "GELEN" && FIELD_TARGETS.desen.woTarget === "incomingItemText" && FIELD_TARGETS.renk.woTarget === "incomingColorText"
    && ASSIGNABLE_FIELDS.desen.label === "Gelen kumaş" && ASSIGNABLE_FIELDS.renk.label === "Gelen renk", JSON.stringify([FIELD_TARGETS.desen, FIELD_TARGETS.renk]));
  const L = (rollId: string, it: string | null, co: string | null) => ({ rollId, weightKg: null, widthCm: null, customerBatchNo: null, itemText: it, colorText: co, note: { id: "n1", noteNo: "GB-1" } });
  const m = new Prisma.Decimal(100);
  const same = foldWoIncoming(m, ["a", "b"], [L("a", "Ham Bez", "EKRU"), L("b", " Ham Bez ", "EKRU")]);
  const diff = foldWoIncoming(m, ["a", "b"], [L("a", "Ham Bez", "EKRU"), L("b", "Penye", "EKRU")]);
  const miss = foldWoIncoming(m, ["a", "b"], [L("a", "Ham Bez", null), L("b", "Ham Bez", "EKRU")]);
  const orphan = foldWoIncoming(m, ["a", "c"], [L("a", "Ham Bez", "EKRU")]);
  check("§1 ⭐ fold: hepsinde aynı → tek değer (kırpılmış)", same?.itemText === "Ham Bez" && same.colorText === "EKRU", JSON.stringify(same));
  check("§1 ⭐ fold: farklı / bir kökte yok / kök satırsız → null", diff?.itemText === null && diff.colorText === "EKRU" && miss?.colorText === null && miss.itemText === "Ham Bez" && orphan?.itemText === null, JSON.stringify([diff?.itemText, miss?.colorText, orphan?.itemText]));
}

const TAG = `TEST-GKR${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], colors: [] as string[], aliases: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME,
];
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME]) await setSetting(k, null);
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

  const lineOf = (id: string) => prisma.customerDeliveryNoteLine.findUnique({ where: { id }, select: { itemText: true, colorText: true, itemId: true, colorId: true } });
  type Inc = { itemText?: unknown; colorText?: unknown } | null | undefined;
  const incomingOf = async (woId: string) => ((await woDetail(woId)).data as { incoming?: Inc } | null)?.incoming;
  const woOf = (r: Resp) => (r.data as { workOrderId?: string } | undefined)?.workOrderId ?? "";

  console.log("§2 tek parti");
  const n2 = await mkNote([{ meters: 100 }, { meters: 50 }], undefined, { desen: "Ham  Bez 30/1", renk: "EKRU" });
  const r2 = await formWo(n2, body({ kursunMeters: 150 }));
  const l2 = await lineOf(summaryLineId(n2));
  check("§2 ⭐ özet satırı itemText/colorText = şablon desen/renk (beyan)", r2.status === 201 && l2?.itemText === "Ham Bez 30/1" && l2.colorText === "EKRU", `${r2.status} ${r2.code ?? ""} ${JSON.stringify(l2)}`);
  check("§2 özet satırı itemId/colorId yazılmaz (beyan ≠ eşleme)", l2?.itemId === null && l2.colorId === null);
  const wo2 = await prisma.workOrder.findUnique({ where: { id: woOf(r2) }, select: { targetItemId: true, targetColorId: true } });
  check("§2 ⭐ İE hedefi beyandan türemez (hedef renk boş; kumaş = varsayılan kart)", wo2?.targetColorId === null && (wo2.targetItemId === null || wo2.targetItemId === fabric), JSON.stringify(wo2));
  const inc2 = await incomingOf(woOf(r2));
  check("§2 ⭐ İE incoming.itemText/colorText", inc2?.itemText === "Ham Bez 30/1" && inc2.colorText === "EKRU", JSON.stringify(inc2));

  console.log("§3 gövde beyanı ezer");
  const n3 = await mkNote([{ meters: 150 }], undefined, { desen: "Okunan", renk: "Okunan Renk" });
  const r3 = await formWo(n3, body({ incomingItemText: "  Düzeltilen Kumaş ", incomingColorText: null }));
  const l3 = await lineOf(summaryLineId(n3));
  check("§3 ⭐ gövde itemText ezer (kırpılır), null renk = yok", r3.status === 201 && l3?.itemText === "Düzeltilen Kumaş" && l3.colorText === null, `${r3.status} ${r3.code ?? ""} ${JSON.stringify(l3)}`);

  console.log("§4 çok parti");
  const n4 = await mkNote([{ meters: 60, blockNo: 1 }, { meters: 40, blockNo: 1 }, { meters: 30, blockNo: 2 }, { meters: 20, blockNo: 2 }],
    { blocks: [{ blockNo: 1, batchNo: `${TAG}A`, itemText: "Kumaş A", colorText: "LACİVERT" }, { blockNo: 2, batchNo: `${TAG}B`, itemText: "Kumaş B", colorText: "LACİVERT" }] }, { desen: "Belge Geneli" });
  const r4 = await formWo(n4, body({ mode: "SINGLE", parties: [{ blockNo: 1, meters: 100 }, { blockNo: 2, meters: 50, incomingColorText: "SİYAH" }] }));
  const a4 = await lineOf(partyLineId(n4, 1));
  const b4 = await lineOf(partyLineId(n4, 2));
  check("§4 ⭐ parti satırları kendi bölüm beyanı (A · B), gövde rengi ezer", r4.status === 201 && a4?.itemText === "Kumaş A" && a4.colorText === "LACİVERT" && b4?.itemText === "Kumaş B" && b4.colorText === "SİYAH", `${r4.status} ${r4.code ?? ""} ${JSON.stringify([a4, b4])}`);
  const inc4 = await incomingOf(woOf(r4));
  check("§4 ⭐ İE incoming: kumaş farklı → null, renk farklı → null", inc4?.itemText === null && inc4.colorText === null, JSON.stringify(inc4));

  console.log("§5 okuma özeti incomingDeclared");
  const color = (await prisma.color.create({ data: { code: `${TAG}C`.slice(0, 32), name: `${TAG} Kartela Rengi` }, select: { id: true } })).id;
  made.colors.push(color);
  const raw = `${TAG} KOD-77`;
  made.aliases.push((await prisma.deliveryNoteAlias.create({ data: { scope: "COLOR", senderCustomerId: null, rawKey: aliasKey("COLOR", raw), targetId: color }, select: { id: true } })).id);
  const n5 = await mkNote([{ meters: 10 }], undefined, { desen: "Beyan Kumaş", renk: raw });
  // Varsayılan KAPALI (2026-11-12, bugünkü davranış): KAPALI dalı ayar YAZILMADAN (null = varsayılan) ölçülür.
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, null);
  const kapali = await noteFormFields(n5, "NORMAL");
  check("§5 ⭐ KAPALI (varsayılan): incomingDeclared metinleri var, eşleme önerisi yok", kapali.incomingDeclared?.itemText === "Beyan Kumaş" && kapali.incomingDeclared.colorText === raw && kapali.incomingDeclared.suggestedColor === null && !kapali.suggestions.targetColor, JSON.stringify(kapali.incomingDeclared));
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, "ONER");
  const oner = await noteFormFields(n5, "NORMAL");
  check("§5 ⭐ ONER: öğrenilmiş eşleme (alias) kartı önerir; beyan metni ayrı alanda kalır", oner.incomingDeclared?.suggestedColor?.id === color && oner.suggestions.targetColor?.id === color && oner.incomingDeclared.colorText === raw, JSON.stringify(oner.incomingDeclared));
  const blind = await noteFormFields(n5, "BLIND");
  check("§5 BLIND: beyan bloğu yok", blind.incomingDeclared === undefined);

  await skipDeclaredSection({ mkNote, body, formWo });
}

type Ctx = {
  mkNote: (lines: Array<{ meters: number; weightKg?: number | null; blockNo?: number }>, totalsDeclared?: unknown, regionFields?: Record<string, string>) => Promise<string>;
  body: (extra?: Record<string, unknown>) => Record<string, unknown>;
  formWo: (id: string, b: unknown) => Promise<Resp>;
};

/** §6 cihazda kapatılan gelen alanlar: sunucu belgeden doldurmaz; beyansız istek bugünkü gibi. */
async function skipDeclaredSection({ mkNote, body, formWo }: Ctx): Promise<void> {
  console.log("§6 skipDeclared");
  const ALL = ["incomingKg", "incomingWidth", "incomingItemText", "incomingColorText"];
  const full = (id: string) => prisma.customerDeliveryNoteLine.findUnique({ where: { id }, select: { itemText: true, colorText: true, weightKg: true, widthCm: true } });
  const fields = { desen: "Ham Bez", renk: "EKRU", en: "160" };
  const base = await mkNote([{ meters: 100, weightKg: 40 }, { meters: 50, weightKg: 20 }], undefined, fields);
  const rb = await formWo(base, body());
  const lb = await full(summaryLineId(base));
  check("§6 ⭐ beyansız (eski istemci): dört alan belgeden dolar (kg Σ 60, en 160, kumaş, renk)", rb.status === 201 && Number(lb?.weightKg) === 60 && Number(lb?.widthCm) === 160 && lb?.itemText === "Ham Bez" && lb.colorText === "EKRU", `${rb.status} ${rb.code ?? ""} ${JSON.stringify(lb)}`);
  const all = await mkNote([{ meters: 100, weightKg: 40 }, { meters: 50, weightKg: 20 }], undefined, fields);
  const ra = await formWo(all, body({ skipDeclared: ALL }));
  const la = await full(summaryLineId(all));
  check("§6 ⭐ dördü kapalı: özet satırında kg/en/kumaş/renk NULL (OCR'dan doldurulmaz)", ra.status === 201 && la?.weightKg === null && la.widthCm === null && la.itemText === null && la.colorText === null, `${ra.status} ${ra.code ?? ""} ${JSON.stringify(la)}`);
  const some = await mkNote([{ meters: 150, weightKg: 30 }], undefined, fields);
  const rs = await formWo(some, body({ skipDeclared: ["incomingColorText", "incomingWidth"], incomingColorText: "MAVİ", incomingWidth: 150 }));
  const ls = await full(summaryLineId(some));
  check("§6 ⭐ kısmi: kapalı renk/en gövdede gelse de yazılmaz; açık kg/kumaş belgeden", rs.status === 201 && ls?.colorText === null && ls.widthCm === null && Number(ls.weightKg) === 30 && ls.itemText === "Ham Bez", `${rs.status} ${rs.code ?? ""} ${JSON.stringify(ls)}`);
  const multi = await mkNote([{ meters: 60, blockNo: 1, weightKg: 10 }, { meters: 40, blockNo: 2, weightKg: 8 }],
    { blocks: [{ blockNo: 1, batchNo: `${TAG}S1`, itemText: "Kumaş A", colorText: "LACİVERT" }, { blockNo: 2, batchNo: `${TAG}S2`, itemText: "Kumaş B", colorText: "SİYAH" }] }, fields);
  const rm = await formWo(multi, body({ mode: "SINGLE", skipDeclared: ["incomingItemText", "incomingKg"], parties: [{ blockNo: 1, meters: 60 }, { blockNo: 2, meters: 40, incomingItemText: "Elle", incomingKg: 9 }] }));
  const [pa, pb] = await Promise.all([full(partyLineId(multi, 1)), full(partyLineId(multi, 2))]);
  check("§6 ⭐ çok parti: kapalı kumaş/kg parti satırlarında NULL (gövde dahil), açık renk/en bölümden/belgeden", rm.status === 201 && pa?.itemText === null && pb?.itemText === null && pa.weightKg === null && pb.weightKg === null && pa.colorText === "LACİVERT" && pb.colorText === "SİYAH" && Number(pa.widthCm) === 160, `${rm.status} ${rm.code ?? ""} ${JSON.stringify([pa, pb])}`);
  const bad = await mkNote([{ meters: 150 }], undefined, fields);
  const rx = await formWo(bad, body({ skipDeclared: ["customerBatchNo"] }));
  check("§6 parti no / metre kapatılamaz: bilinmeyen alan adı 400", rx.status === 400, `${rx.status} ${rx.code ?? ""}`);
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
  await prisma.deliveryNoteAlias.deleteMany({ where: { id: { in: made.aliases } } }).catch(swallow);
  await prisma.color.deleteMany({ where: { id: { in: made.colors } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge gelen kumaş/renk beyanı bekçisi ===\n");
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
