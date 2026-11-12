// =============================================================================
// GELEN BELGE → İŞ EMRİ FORMU: tam form alanları + tanıtma hedefleri + iki ayar (K30 S16a, Gülkesim 2026-11-04)
// =============================================================================
// HTTP + gerçek DB. Uçlar: `POST /irsaliyeler/:id/is-emri` (yeni alanlar), `GET /irsaliyeler/:id/okuma-ozeti`
// (`formFields` + `suggestions`), `GET|PUT /ayarlar` (`desenRenkEslesme`, `tabletIeGirisi`). Sınanan:
//   §1 iki ayarın varsayılanı KAPALI / IKISI (= bugünkü), tanınmayan değer 400, geçerli değer yazılır; ham uca kapalı
//   §2 ⭐ alanlarsız form = bugünkü: top + İE hedef ürünü varsayılan ürün, en/hedef/tarih boş
//   §3 ⭐ alanlar verilince EZER: hedef ürün (top da onunla doğar), renk, en, hedef metraj/kg, planlı tarihler; kat tipi
//      istasyon varsayılanını ezer; çok parti SINGLE'da da alanlar İE'ye geçer
//   §4 400: uuid değil, en ≤0, serbest metin tarih, top doğuramayan hedef ürün (GELEN_BELGE_TARGET_ITEM_INVALID; belge
//      DRAFT kalır), PER_PARTY + hedef metraj (GELEN_BELGE_FORM_TARGET_PER_PARTY; belge DRAFT kalır)
//   §5 ⭐ okuma özeti: TR sayı ("1.250,50"), kanonik ondalık ("125.125" binlik SANILMAZ); KAPALI öneri yok; ONER tek aday
//      önerilir, çift aday/top doğuramayan ürün önerilmez; NOT desen/renk nota eklenir
//   §6 saf `formNumber` / `formFieldsFromRegion` + tanıtma anahtarları (`ASSIGNABLE_FIELD_KEYS`)
// Negatif sonda: `formWorkOrderFields` boş nesne dönünce §3 kırmızı; `noteFormFields` ONER dalı atlanınca §5 ONER kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { partyLineId } from "../src/services/gelen-belge-kontrol.service";
import { formNumber, formFieldsFromRegion, FORM_NOTE_MAX } from "../src/lib/gelen-belge/form-alanlari";
import { ASSIGNABLE_FIELD_KEYS } from "../src/lib/gelen-belge/motor";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { StationCapabilityService } from "../src/services/station-capability.service";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";
import { stockFromCustomerGoodsWarning } from "../src/services/gelen-belge-form-is-emri.service";

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

const TAG = `TEST-GFA${Date.now().toString(36).toUpperCase()}`;
const made = { props: [] as string[], customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], colors: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI,
  SETTING_KEYS.PRODUCTION_ROUTE_MODE,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { [k: string]: unknown }; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string | null, ocrResult: unknown, pageNo = 1): Promise<string> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
  return s.id;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE,
    SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
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
  check("admin login", tk.length > 0);
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"] } }, select: { id: true } });
  const wu = await prisma.user.create({
    data: { username: `${TAG}-w`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} W`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(wu.id);
  const woUser = await login(wu.username, parola);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const mkItem = async (suffix: string, name: string, itemType: "FABRIC" | "YARN") => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${suffix}`, name, itemType, unit: "MT" }, select: { id: true } })).id;
    made.items.push(id);
    return id;
  };
  const fabric = await mkItem("MM", `${TAG} müşteri malı`, "FABRIC");
  const fabric2Name = `${TAG} Saten Desen`;
  const fabric2 = await mkItem("SAT", fabric2Name, "FABRIC");
  const yarnName = `${TAG} İplik`;
  const yarn = await mkItem("IP", yarnName, "YARN");
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const mkColor = async (code: string, name: string) => {
    const id = (await prisma.color.create({ data: { code, name }, select: { id: true } })).id;
    made.colors.push(id);
    return id;
  };
  const colorCode = `${TAG}-R1`.slice(0, 32);
  const color = await mkColor(colorCode, `${TAG} Gece Mavisi`);
  // Çift aday: canlı adlar DB'de tekil (`colors_nameFoldColor_key`), kod büyük/küçük harf duyarlı tekil → kod çifti.
  const twinCode = `${TAG}-R2`.slice(0, 32);
  await mkColor(twinCode, `${TAG} İkiz A`);
  await mkColor(twinCode.toLowerCase(), `${TAG} İkiz B`);

  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  /** Tek partili sade belge: iki satır, 1 sayfa taranmış. `ocr` verilirse taramanın okuma sonucu odur. */
  const mkNote = async (ocr: unknown = { ocr: { text: TAG } }) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN`,
      lines: [100, 110].map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    await addScan(id, ocr, 1);
    check(`taslak (${made.notes.length})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  /** Çok partili belge (2 blok, 2 sayfa taranmış). */
  const mkPartyNote = async () => {
    const id = await mkNote();
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id }, orderBy: { lineNo: "asc" }, select: { id: true } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { id: { in: lines.slice(1).map((l) => l.id) } }, data: { blockNo: 2 } });
    await prisma.customerDeliveryNote.update({ where: { id }, data: { pageCount: 2, totalsDeclared: { blocks: [
      { blockNo: 1, batchNo: `${TAG}-P${made.notes.length}A`, orderNo: "1", topCount: 1, count: null, kg: null, m: "100" },
      { blockNo: 2, batchNo: `${TAG}-P${made.notes.length}B`, orderNo: "2", topCount: 1, count: null, kg: null, m: "110" },
    ] } } });
    await addScan(id, { ocr: { text: TAG } }, 2);
    return id;
  };
  const parties = (id: string) => [{ blockNo: 1, batchNo: `${TAG}-${id.slice(0, 6)}A`, meters: 100 }, { blockNo: 2, batchNo: `${TAG}-${id.slice(0, 6)}B`, meters: 110 }];
  const body = (extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "210", routeTemplateId: route, ...extra });
  const formWo = (id: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, b);
  const woRow = (id: unknown) => prisma.workOrder.findUnique({ where: { id: String(id ?? "") }, select: { targetItemId: true, targetColorId: true, width: true, targetQuantity: true, targetWeight: true, plannedStartDate: true, plannedEndDate: true, foldType: true } });
  const rollItems = async (noteId: string) => (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId, rollId: { not: null } }, select: { roll: { select: { itemId: true } } } })).map((l) => l.roll?.itemId);
  const noteStatus = async (id: string) => (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true } }))?.status;

  console.log("§1 iki ayar");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 desenRenkEslesme KAPALI + default KAPALI; tabletIeGirisi IKISI + default IKISI",
    s1.data?.desenRenkEslesme === "KAPALI" && s1.data?.defaultDesenRenkEslesme === "KAPALI" && s1.data?.tabletIeGirisi === "IKISI" && s1.data?.defaultTabletIeGirisi === "IKISI",
    JSON.stringify({ d: s1.data?.desenRenkEslesme, t: s1.data?.tabletIeGirisi }));
  check("§1 iki anahtar ham ayar ucuna kapalı (dedicated)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME) && INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI));
  const bad1 = await call("PUT", "/api/gelen-belge/ayarlar", tk, { desenRenkEslesme: "BENZER" });
  const bad1b = await call("PUT", "/api/gelen-belge/ayarlar", tk, { tabletIeGirisi: "HEPSI" });
  check("§1 tanınmayan değer 400 (iki ayar)", bad1.status === 400 && bad1b.status === 400, `${bad1.status} ${bad1b.status}`);
  const ok1 = await call("PUT", "/api/gelen-belge/ayarlar", tk, { desenRenkEslesme: "NOT", tabletIeGirisi: "BELGE" });
  const s1b = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 geçerli değer yazılır (NOT / BELGE)", ok1.status === 200 && s1b.data?.desenRenkEslesme === "NOT" && s1b.data?.tabletIeGirisi === "BELGE", `${ok1.status} ${ok1.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI, null);

  console.log("§2 alanlarsız form = bugünkü");
  const n2 = await mkNote();
  const r2 = await formWo(n2, body());
  const wo2 = await woRow(r2.data?.workOrderId);
  const ri2 = await rollItems(n2);
  // Bugünkü quickStart planlı tarihleri kendisi türetir (bugün / +7 gün) — alanlarsız formda da öyle kalır.
  check("§2 ⭐ 201; top + İE hedef ürünü varsayılan ürün; renk/en/hedef kg boş, planlı tarihler quickStart'ın",
    r2.status === 201 && ri2.length > 0 && ri2.every((i) => i === fabric) && wo2?.targetItemId === fabric && wo2.targetColorId === null && wo2.width === null && wo2.targetWeight === null && !!wo2.plannedStartDate && !!wo2.plannedEndDate,
    `${r2.status} ${r2.code ?? ""} ${JSON.stringify({ ri2, wo2 })}`);

  console.log("§3 alanlar ezer");
  const kat = await prisma.fabricProperty.findUnique({ where: { code: FOLD_PROPERTY_CODE }, select: { id: true, values: { where: { isActive: true }, select: { id: true, code: true }, take: 2, orderBy: { code: "asc" } } } });
  const [foldDefault, foldOther] = kat?.values ?? [];
  const kStation = (await prisma.station.create({ data: { code: `${TAG}-KAT`.slice(0, 32), name: `${TAG} tambur`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(kStation);
  if (kat && foldDefault) await new StationCapabilityService().setCapabilities(kStation, { properties: [{ propertyId: kat.id, mode: "OPTIONAL", defaultOn: true, defaultValueId: foldDefault.id }] });
  const kRoute = (await prisma.route.create({ data: { name: `${TAG} kat rota`, steps: { create: [{ stationId: kStation, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(kRoute);
  const n3 = await mkNote();
  const fields3 = { targetItemId: fabric2, targetColorId: color, width: 180, targetQuantity: 205.5, targetWeight: 25.25, plannedStartDate: "2026-11-05", plannedEndDate: "2026-11-10T12:00:00+03:00" };
  const r3 = await formWo(n3, body({ ...fields3, routeTemplateId: kRoute, ...(foldOther ? { foldType: foldOther.code } : {}) }));
  const wo3 = await woRow(r3.data?.workOrderId);
  const ri3 = await rollItems(n3);
  check("§3 ⭐ hedef ürün: top + İE formda seçilen ürünle", r3.status === 201 && ri3.length > 0 && ri3.every((i) => i === fabric2) && wo3?.targetItemId === fabric2, `${r3.status} ${r3.code ?? ""} ${JSON.stringify({ ri3, t: wo3?.targetItemId })}`);
  check("§3 ⭐ renk, en, hedef metraj/kg, planlı tarihler İE'ye yazılı",
    wo3?.targetColorId === color && num(wo3.width) === 180 && num(wo3.targetQuantity) === 205.5 && num(wo3.targetWeight) === 25.25
    && wo3.plannedStartDate?.toISOString() === "2026-11-05T00:00:00.000Z" && wo3.plannedEndDate?.toISOString() === "2026-11-10T09:00:00.000Z",
    JSON.stringify(wo3));
  if (foldOther) check("§3 ⭐ kat tipi istasyon varsayılanını ezer", wo3?.foldType === foldOther.code, JSON.stringify({ got: wo3?.foldType, want: foldOther.code, def: foldDefault?.code }));
  else console.log("ℹ️  §3 kat ezme atlandı: KAT özelliğinin iki aktif değeri yok");
  const n3p = await mkPartyNote();
  const r3p = await formWo(n3p, body({ parties: parties(n3p), mode: "SINGLE", targetItemId: fabric2, targetQuantity: 210, width: 150 }));
  const wo3p = await woRow(r3p.data?.workOrderId);
  const pr3p = await prisma.customerDeliveryNoteLine.findMany({ where: { id: { in: [partyLineId(n3p, 1), partyLineId(n3p, 2)] } }, select: { roll: { select: { itemId: true } } } });
  check("§3 ⭐ çok parti SINGLE: alanlar İE'ye, parti topları hedef ürünle", r3p.status === 201 && wo3p?.targetItemId === fabric2 && num(wo3p.targetQuantity) === 210 && num(wo3p.width) === 150 && pr3p.length === 2 && pr3p.every((l) => l.roll?.itemId === fabric2),
    `${r3p.status} ${r3p.code ?? ""} ${JSON.stringify({ wo3p, pr3p })}`);

  console.log("§4 400'ler");
  const n4 = await mkNote();
  const bad = async (label: string, extra: Record<string, unknown>, code?: string) => {
    const r = await formWo(n4, body(extra));
    check(`§4 ${label} → 400${code ? ` ${code}` : ""}; belge DRAFT`, r.status === 400 && (!code || r.code === code) && (await noteStatus(n4)) === "DRAFT", `${r.status} ${r.code ?? ""}`);
  };
  await bad("hedef ürün uuid değil", { targetItemId: "abc" });
  await bad("en 0", { width: 0 });
  await bad("tarih serbest metin", { plannedStartDate: "yarın" });
  await bad("⭐ top doğuramayan (iplik) hedef ürün", { targetItemId: yarn }, "GELEN_BELGE_TARGET_ITEM_INVALID");
  check("§4 iplik reddinde top doğmadı", (await rollItems(n4)).length === 0);
  const n4p = await mkPartyNote();
  const r4p = await formWo(n4p, body({ parties: parties(n4p), mode: "PER_PARTY", targetQuantity: 210 }));
  const r4w = await formWo(n4p, body({ parties: parties(n4p), mode: "PER_PARTY", targetWeight: 5 }));
  check("§4 ⭐ PER_PARTY + hedef metraj / hedef kg → 400 GELEN_BELGE_FORM_TARGET_PER_PARTY; belge DRAFT",
    r4p.status === 400 && r4p.code === "GELEN_BELGE_FORM_TARGET_PER_PARTY" && r4w.status === 400 && r4w.code === "GELEN_BELGE_FORM_TARGET_PER_PARTY" && (await noteStatus(n4p)) === "DRAFT",
    `${r4p.status} ${r4p.code ?? ""} / ${r4w.status} ${r4w.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, "PER_PARTY");
  const r4s = await formWo(n4p, body({ parties: parties(n4p), targetQuantity: 210 }));
  check("§4 mode'suz + ayar PER_PARTY + hedef metraj → 400 (kip onaydan önce çözülür)", r4s.status === 400 && r4s.code === "GELEN_BELGE_FORM_TARGET_PER_PARTY" && (await noteStatus(n4p)) === "DRAFT", `${r4s.status} ${r4s.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, null);

  console.log("§5 okuma özeti");
  const region = (fields: Record<string, string>) => ({ regions: [{ templateId: null, fields }] });
  const n5 = await mkNote(region({ hedefMetraj: "1.250,50", hedefKg: "125.125", en: "180", desen: fabric2Name.toLowerCase(), renk: colorCode.toLowerCase(), not: "acil" }));
  const read = async (id: string) => {
    const r = await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`, woUser);
    return { status: r.status, ff: (r.data?.formFields ?? null) as Record<string, unknown> | null, sg: (r.data?.suggestions ?? null) as { targetItem?: { id: string }; targetColor?: { id: string } } | null };
  };
  // Varsayılan KAPALI (2026-11-12, bugünkü davranış): KAPALI dalı ayar YAZILMADAN (null = varsayılan) ölçülür.
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, null);
  const k5 = await read(n5);
  check("§5 ⭐ KAPALI (varsayılan): TR sayı 1250.5, kanonik 125.125 (binlik sanılmaz), en 180, yazılar; öneri yok, not yalnız 'acil'",
    k5.status === 200 && k5.ff?.hedefMetraj === 1250.5 && k5.ff?.hedefKg === 125.125 && k5.ff?.en === 180 && k5.ff?.desenText === fabric2Name.toLowerCase() && k5.ff?.renkText === colorCode.toLowerCase() && k5.ff?.not === "acil"
    && !!k5.sg && Object.keys(k5.sg).length === 0, JSON.stringify(k5));
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, "ONER");
  const o5 = await read(n5);
  check("§5 ⭐ ONER: ürün adı (büyük/küçük harf farklı) + renk kodu tek aday → önerilir", o5.sg?.targetItem?.id === fabric2 && o5.sg?.targetColor?.id === color && o5.ff?.not === "acil", JSON.stringify(o5.sg));
  const n5b = await mkNote(region({ desen: yarnName, renk: twinCode }));
  const o5b = await read(n5b);
  check("§5 ⭐ ONER: çift aday renk (kod büyük/küçük harf ikizi) + top doğuramayan ürün → öneri yok", o5b.status === 200 && !!o5b.sg && Object.keys(o5b.sg).length === 0, JSON.stringify(o5b));
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, "NOT");
  const t5 = await read(n5);
  check("§5 ⭐ NOT: öneri yok, desen/renk nota eklenir", !!t5.sg && Object.keys(t5.sg).length === 0 && t5.ff?.not === `acil · Desen: ${fabric2Name.toLowerCase()} · Renk: ${colorCode.toLowerCase()}`, JSON.stringify(t5));
  await setSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, null);
  const n5c = await mkNote();
  const e5 = await read(n5c);
  check("§5 bölgesiz tarama → formFields {} + suggestions {} (eski davranış bozulmaz)", e5.status === 200 && !!e5.ff && Object.keys(e5.ff).length === 0 && !!e5.sg && Object.keys(e5.sg).length === 0, JSON.stringify(e5));

  console.log("§6 saf yardımcılar");
  const cases: Array<[string | null, number | undefined]> = [["1.250,50", 1250.5], ["125.125", 125.125], ["1250.5", 1250.5], ["180", 180], ["0", undefined], ["-5", undefined], ["abc", undefined], ["", undefined], [null, undefined]];
  const wrong = cases.filter(([raw, want]) => formNumber(raw) !== want).map(([raw, want]) => `${raw}→${formNumber(raw)}≠${want}`);
  check("§6 formNumber: TR biçim, kanonik ondalık, sıfır/negatif/çözülemeyen yok", wrong.length === 0, wrong.join(" "));
  const long = formFieldsFromRegion({ not: "x".repeat(990), desen: "D", renk: "R" }, "NOT");
  check("§6 NOT kipi notu FORM_NOTE_MAX'ta keser; KAPALI'da desen/renk nota girmez",
    long.not?.length === FORM_NOTE_MAX && formFieldsFromRegion({ desen: "D", renk: "R" }, "KAPALI").not === undefined && formFieldsFromRegion(null, "NOT") && Object.keys(formFieldsFromRegion(null, "NOT")).length === 0);
  check("§6 tanıtma anahtarları hedefMetraj / hedefKg / en / desen / renk / not içerir", ["hedefMetraj", "hedefKg", "en", "desen", "renk", "not"].every((k) => (ASSIGNABLE_FIELD_KEYS as readonly string[]).includes(k)), JSON.stringify(ASSIGNABLE_FIELD_KEYS));

  console.log("§7 K30-D tür, hedef özellikler, rota adımları");
  // AUTO bayraklı istasyon: anahtarsız form bayrağı tohumlar (bugünkü); anahtar varsa istemcinin kümesi geçer.
  const mkProp = async (n: string) => { const id = (await prisma.fabricProperty.create({ data: { code: `${TAG}-${n}`.slice(0, 32), name: `${TAG} ${n}`, valueType: "FLAG" }, select: { id: true } })).id; made.props.push(id); return id; };
  const flagAuto = await mkProp("FA");
  const flagOther = await mkProp("FB");
  const fStation = (await prisma.station.create({ data: { code: `${TAG}-FLG`.slice(0, 32), name: `${TAG} bayrak`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(fStation);
  await new StationCapabilityService().setCapabilities(fStation, { properties: [{ propertyId: flagAuto, mode: "AUTO" }, { propertyId: flagOther, mode: "OPTIONAL" }] });
  const fRoute = (await prisma.route.create({ data: { name: `${TAG} bayrak rota`, steps: { create: [{ stationId: fStation, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(fRoute);
  // İE doğmadıysa (kırmızı yol) boş uuid sorguyu çökertmesin → sıfır uuid = boş sonuç, check ❌ basar.
  const woId = (id: unknown) => (typeof id === "string" && id ? id : "00000000-0000-0000-0000-000000000000");
  const woProps = async (id: unknown) => (await prisma.workOrderTargetProperty.findMany({ where: { workOrderId: woId(id) }, select: { propertyId: true } })).map((x) => x.propertyId).sort();
  const woSteps = async (id: unknown) => prisma.workOrderStep.findMany({ where: { workOrderId: woId(id) }, orderBy: { stepSequence: "asc" }, select: { stationId: true, stepSequence: true, notes: true } });
  const woMeta = (id: unknown) => prisma.workOrder.findUnique({ where: { id: woId(id) }, select: { type: true, routeTemplateId: true } });

  const n7a = await mkNote();
  const r7a = await formWo(n7a, body({ routeTemplateId: fRoute }));
  const p7a = await woProps(r7a.data?.workOrderId);
  const s7a = await woSteps(r7a.data?.workOrderId);
  const m7a = await woMeta(r7a.data?.workOrderId);
  check("§7 ⭐ alanlar verilmezse bugünkü: istasyon bayrağı tohumlanır, adımlar şablondan, tür türetilir (STOCK)",
    r7a.status === 201 && p7a.includes(flagAuto) && !p7a.includes(flagOther) && s7a.length === 1 && s7a[0]?.stationId === fStation && m7a?.routeTemplateId === fRoute && m7a?.type === "STOCK_PRODUCTION",
    `${r7a.status} ${r7a.code ?? ""} ${JSON.stringify({ p7a, s7a, m7a })}`);

  check("§7 ⭐ tür seçilmeden (Belge Okut) STOK türetilince yanıt uyarır: müşteri malı → Fason Belge Okut (2. prova IE0611260014)",
    (r7a.warnings ?? []).includes(stockFromCustomerGoodsWarning()), JSON.stringify(r7a.warnings));

  const n7b = await mkNote();
  const r7b = await formWo(n7b, body({ routeTemplateId: fRoute, targetPropertyIds: [flagOther], type: "STOCK_PRODUCTION" }));
  const p7b = await woProps(r7b.data?.workOrderId);
  check("§7 ⭐ targetPropertyIds yazılır (istemci kümesi; kaldırılan AUTO bayrak tohumlanmaz)", r7b.status === 201 && p7b.length === 1 && p7b[0] === flagOther, `${r7b.status} ${r7b.code ?? ""} ${JSON.stringify(p7b)}`);
  check("§7 ⭐ type yazılır", (await woMeta(r7b.data?.workOrderId))?.type === "STOCK_PRODUCTION");
  check("§7 tür AÇIKÇA seçildiyse (Stoğa üretim) uyarı yok", !(r7b.warnings ?? []).includes(stockFromCustomerGoodsWarning()), JSON.stringify(r7b.warnings));
  const n7c = await mkNote();
  const r7c = await formWo(n7c, body({ routeTemplateId: fRoute, targetPropertyIds: [] }));
  check("§7 targetPropertyIds: [] → bayraksız İE", r7c.status === 201 && (await woProps(r7c.data?.workOrderId)).length === 0, `${r7c.status} ${r7c.code ?? ""}`);

  // Düzenlenmiş adımlar: şablonun (tek kurşun istasyonu) yerine bu sırayla doğar.
  const n7d = await mkNote();
  const steps7 = [{ stationId: kStation, notes: "önce tambur" }, { stationId: station, sequence: 2 }, { stationId: fStation, notes: "son" }];
  const r7d = await formWo(n7d, body({ steps: steps7 }));
  const s7d = await woSteps(r7d.data?.workOrderId);
  const p7d = await woProps(r7d.data?.workOrderId);
  check("§7 ⭐ steps verilince İE adımları bu sırayla doğar (şablon değil)",
    r7d.status === 201 && s7d.map((x) => x.stationId).join() === [kStation, station, fStation].join() && s7d.map((x) => x.stepSequence).join() === "1,2,3" && s7d[0]?.notes === "önce tambur" && s7d[2]?.notes === "son",
    `${r7d.status} ${r7d.code ?? ""} ${JSON.stringify(s7d)}`);
  check("§7 ⭐ düzenlenmiş adımların istasyon bayrağı tohumlanır (varsayılanlar adımlardan)", p7d.includes(flagAuto), JSON.stringify(p7d));

  const n7e = await mkNote();
  const deadStation = (await prisma.station.create({ data: { code: `${TAG}-PSF`.slice(0, 32), name: `${TAG} pasif`, type: "INTERNAL", isActive: false }, select: { id: true } })).id;
  made.stations.push(deadStation);
  const bad7 = async (label: string, extra: Record<string, unknown>, code?: string) => {
    const r = await formWo(n7e, body(extra));
    check(`§7 ${label} → 400${code ? ` ${code}` : ""}; belge DRAFT`, r.status === 400 && (!code || r.code === code) && (await noteStatus(n7e)) === "DRAFT", `${r.status} ${r.code ?? ""}`);
  };
  await bad7("⭐ geçersiz (pasif) istasyon", { steps: [{ stationId: deadStation }] });
  await bad7("olmayan istasyon", { steps: [{ stationId: randomUUID() }] });
  // Rotasız yol yalnız "Okutmayla"da açılır; SIRALI'da rota kapısı önce 400 verirdi (adım kapısını ölçmezdi).
  await setSetting(SETTING_KEYS.PRODUCTION_ROUTE_MODE, "SCAN");
  await bad7("rotasız (Okutmayla) + steps", { routeTemplateId: undefined, steps: [{ stationId: station }] }, "GELEN_BELGE_FORM_STEPS_NEED_ROUTE");
  await setSetting(SETTING_KEYS.PRODUCTION_ROUTE_MODE, null);
  await bad7("steps + stepPlanning", { steps: [{ stationId: station }], stepPlanning: [{ sequence: 1, plannedMachineId: null }] }, "GELEN_BELGE_FORM_STEPS_WITH_PLANNING");
  await bad7("sıra dizi sırasıyla uyuşmaz", { steps: [{ stationId: station, sequence: 2 }] }, "GELEN_BELGE_FORM_STEPS_ORDER");
  await bad7("adımda tanınmayan alan (strict)", { steps: [{ stationId: station, foo: 1 }] });
  await bad7("boş adım listesi", { steps: [] });
  await bad7("tanınmayan tür", { type: "FOO" });
  await bad7("⭐ siparişe özel tür + kalemsiz (onaydan önce)", { type: "ORDER_PRODUCTION" }, "GELEN_BELGE_FORM_TYPE_NEEDS_ORDER");

  // Çok parti PER_PARTY: düzenlenmiş adımlar her iş emrine.
  const n7p = await mkPartyNote();
  const r7p = await formWo(n7p, body({ parties: parties(n7p), mode: "PER_PARTY", steps: [{ stationId: station }, { stationId: kStation }] }));
  const ids7p = (r7p.data as { workOrders?: Array<{ workOrderId: string }> } | undefined)?.workOrders?.map((w) => w.workOrderId) ?? [];
  const st7p = await Promise.all(ids7p.map(async (id) => (await woSteps(id)).map((x) => x.stationId).join()));
  check("§7 ⭐ çok parti PER_PARTY: her iş emri düzenlenmiş adımlarla", r7p.status === 201 && ids7p.length === 2 && st7p.every((x) => x === [station, kStation].join()), `${r7p.status} ${r7p.code ?? ""} ${JSON.stringify(st7p)}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
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
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.props } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.color.deleteMany({ where: { id: { in: made.colors } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge iş emri formu alanları (K30 S16a) bekçisi ===\n");
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
