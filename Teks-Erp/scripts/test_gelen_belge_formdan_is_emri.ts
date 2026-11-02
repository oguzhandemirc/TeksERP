// =============================================================================
// GELEN BELGE — iş emri formundan kayıt + iş emri tek istekte (Gülkesim OIE, sözleşme 1–4)
// =============================================================================
// HTTP + gerçek DB. `POST /api/gelen-belge/irsaliyeler/:id/is-emri` (`gelen-belge-form-is-emri.service.ts`), ayarlar
// `gelenBelge.formApproval` + `production.refakatAutoPrint`, detay `ownerSuggestion`, `GET /api/routes?shortcut=1`. Sınanan:
//   §1 ayar varsayılanları SEPARATE / false (bugünkü), iki anahtar ham uca kapalı (dedicated küme)
//   §2 ⭐ izin: yalnız gelen-belge:approve → 403; ⭐ ayar SEPARATE → 403 GELEN_BELGE_FORM_APPROVAL_DISABLED (belge DRAFT)
//   §3 ⭐ okuması SÜREN belge (okuyucu var, sayfa bekliyor) → 409 DELIVERY_NOTE_NOT_READ, top 0
//   §3b ⭐ okuma düştü (READ_FAILED) / okuyucu yok (NO_SERVICE) → elle değerle 201 + "sayfa okunamadı" uyarısı
//   §8 ⭐ yarım kalan onay aynı token'la devam eder: özet satırı FAILED + başlık PARTIAL → 201 tek top/tek İE;
//      bayat APPROVING → 201; taze APPROVING → 409 DELIVERY_NOTE_NOT_APPROVABLE (onay claim'i)
//   §4 ⭐ mutlu yol (gelen-belge:approve OLMADAN): 1 top = kursunMeters, 1 İE, sahip yazıldı, parti no belgeden, rota = seçilen,
//      hedef değer geçti, adım planı kabul, audit "WITH_WORK_ORDER: <kullanıcı>"
//   §5 ⭐ aynı clientToken → aynı yanıt, yeni İE/top yok; strict gövde 400
//   §6 ⭐ ownerSuggestion: tam metinde sahip adı → bulur (gönderen hariç, source FULL_TEXT); yalnız gönderen/parçalı ad → null;
//      sahipli taslak null; ⭐ tek çekirdek kelimeli cari adres satırında geçse de null; ⭐ kurulumun kendi firması aday değil
//   §7 ⭐ kısayol: ?shortcut=1 yalnız işaretliler, shortcutOrder sırası; tip hatası 400
//   §7b ⭐ rota yanıtında adım istasyonu `isKursunStation` (KURSUN_DISPATCH_STATION_WHERE): kurşun AUTO'lu PROCESS_QC true,
//       yeteneksiz PROCESS_QC false — tekil, liste ve kısayol yanıtında + `GET /api/stations/:id`
// Negatif sonda: `assertFormApprovalEnabled` çağrısı kaldırılınca §2 kırmızı; `excludeIds` boş verilince §6 gönderen kırmızı;
// onay yeniden yalnız DRAFT'ta koşturulunca §8 kırmızı; okuma kapısı [READ, PARTIAL] allowlist'ine dönünce §3b kırmızı.
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
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { summaryLineId } from "../src/services/gelen-belge-kontrol.service";
import { updateDeliveryNote } from "../src/services/gelen-belge-note.service";
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

const TAG = `TEST-GBF${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], props: [] as string[], scans: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.COMPANY_NAME,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { [k: string]: unknown }; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string, status: "READ" | "PENDING" | "READ_FAILED", text: string): Promise<void> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status, ...(status === "READ" ? { ocrResult: { ocr: { text } } } : {}) },
    select: { id: true },
  });
  made.scans.push(s.id);
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
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
  const mkUser = async (suffix: string, perms: string[]) => {
    const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(u.id);
    return { token: await login(u.username, parola), username: u.username };
  };
  const approver = await mkUser("A", ["gelen-belge:read", "gelen-belge:write", "gelen-belge:approve"]);
  const woUser = await mkUser("W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);

  const mkCustomer = async (suffix: string, name: string) => {
    const c = (await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name }, select: { id: true } })).id;
    made.customers.push(c);
    return c;
  };
  const owner = await mkCustomer("OWN", `${TAG} Akdeniz Perdecilik`);
  const sender = await mkCustomer("SND", `${TAG} Marmara Boyahane`);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const flag = (await prisma.fabricProperty.create({ data: { code: `${TAG}-KR`.slice(0, 32), name: `TEST Kursun ${TAG}`, valueType: "FLAG" }, select: { id: true } })).id;
  made.props.push(flag);
  const gramaj = await prisma.fabricProperty.create({
    data: { code: `${TAG}-KG`.slice(0, 32), name: `TEST Kursun gramaji ${TAG}`, valueType: "CHOICE", variantOfPropertyId: flag, values: { create: [{ code: `${TAG}G25`.slice(0, 32), name: "25 gr", sortOrder: 0 }] } },
    select: { id: true, values: { select: { id: true } } },
  });
  made.props.push(gramaj.id);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  await prisma.stationProperty.create({ data: { stationId: station, propertyId: flag } });
  const mkRoute = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await prisma.route.create({ data: { name: `${TAG} ${name}`, steps: { create: [{ stationId: station, sequence: 1 }] }, ...extra }, select: { id: true } });
    made.routes.push(r.id);
    return r.id;
  };
  const chosen = await mkRoute("kurşun rotası");

  const mkNote = async (scan: "READ" | "PENDING" | "READ_FAILED", text = `${TAG} belge`) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderCustomerId: sender, senderText: `${TAG} GÖNDEREN`, lines: [{ senderRollNo: `${TAG}-${made.notes.length}`, meters: 100, itemText: "Kumaş" }] });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    if (id) await addScan(id, scan, text);
    check(`taslak (${made.notes.length})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  const statusOf = async (id: string) => (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true } }))?.status;
  const rollsOf = async (id: string) => (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const woCount = () => prisma.workOrder.count();
  const body = (extra: Record<string, unknown> = {}) => ({
    clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: `${TAG}-P1`, kursunMeters: "4521.5", routeTemplateId: chosen,
    targetValues: [{ propertyId: gramaj.id, valueId: gramaj.values[0].id }], stepPlanning: [{ sequence: 1 }], notes: `${TAG} not`, ...extra,
  });
  const formWo = (id: string, token: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, token, b);

  console.log("§1 ayar varsayılanları");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 formApproval SEPARATE + defaultFormApproval SEPARATE + refakatAutoPrint false", s1.data?.formApproval === "SEPARATE" && s1.data?.defaultFormApproval === "SEPARATE" && s1.data?.refakatAutoPrint === false, JSON.stringify({ f: s1.data?.formApproval, r: s1.data?.refakatAutoPrint }));
  check("§1 iki anahtar dedicated (ham uç kapalı)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL) && INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT));

  console.log("§2 izin + ayar kapısı");
  const n = await mkNote("READ", `Sayın ${TAG} Akdeniz Perdecilik\n${TAG} Marmara Boyahane A.Ş.`);
  const r2a = await formWo(n, approver.token, body());
  check("§2 ⭐ yalnız gelen-belge:approve → 403", r2a.status === 403, `${r2a.status} ${r2a.code ?? ""}`);
  const r2b = await formWo(n, woUser.token, body());
  check("§2 ⭐ ayar SEPARATE → 403 GELEN_BELGE_FORM_APPROVAL_DISABLED", r2b.status === 403 && r2b.code === "GELEN_BELGE_FORM_APPROVAL_DISABLED", `${r2b.status} ${r2b.code ?? ""}`);
  check("§2 belge DRAFT, top 0", (await statusOf(n)) === "DRAFT" && (await rollsOf(n)).length === 0);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");

  console.log("§6 müşteri önerisi (sahipsiz taslak)");
  const d6 = await call("GET", `/api/gelen-belge/irsaliyeler/${n}`, tk);
  const sug = d6.data?.ownerSuggestion as { customerId?: string; matchedText?: string; source?: string } | null | undefined;
  check("§6 ⭐ tam metinde sahip adı → öneri = sahip (gönderen hariç), source FULL_TEXT", sug?.customerId === owner && !!sug?.matchedText?.includes("Akdeniz") && sug?.source === "FULL_TEXT", JSON.stringify(sug));
  const n6 = await mkNote("READ", `${TAG} Marmara Boyahane\nAkdeniz ${TAG}`);
  const d6b = await call("GET", `/api/gelen-belge/irsaliyeler/${n6}`, tk);
  check("§6 ⭐ yalnız gönderen + parçalı ad → null", d6b.status === 200 && d6b.data?.ownerSuggestion === null, JSON.stringify(d6b.data?.ownerSuggestion));
  const SFX = TAG.replace(/[^A-Z0-9]/g, "");
  await mkCustomer("CITY", `İstanbul${SFX} Tekstil`);
  const n6c = await mkNote("READ", `${TAG} Marmara Boyahane\nMerkez Mah. Güngören / İSTANBUL${SFX}`);
  const d6e = await call("GET", `/api/gelen-belge/irsaliyeler/${n6c}`, tk);
  check("§6 ⭐ tek çekirdek kelimeli cari (adres satırında) → null", d6e.status === 200 && d6e.data?.ownerSuggestion === null, JSON.stringify(d6e.data?.ownerSuggestion));
  await setSetting(SETTING_KEYS.COMPANY_NAME, `${SFX} Perde Kurşun`);
  await mkCustomer("SELF", `${SFX} Perde Kurşun San. Tic. Ltd.`);
  const n6d = await mkNote("READ", `Alıcı: ${SFX} PERDE KURŞUN SAN TİC\nSayın ${TAG} Akdeniz Perdecilik`);
  const d6f = await call("GET", `/api/gelen-belge/irsaliyeler/${n6d}`, tk);
  check("§6 ⭐ kurulumun kendi firması aday değil → öneri = gerçek sahip", (d6f.data?.ownerSuggestion as { customerId?: string } | null)?.customerId === owner, JSON.stringify(d6f.data?.ownerSuggestion));
  const ozet = await call("GET", `/api/gelen-belge/irsaliyeler/${n}/okuma-ozeti`, tk);
  check("§6 okuma özeti aynı öneri", (ozet.data?.ownerSuggestion as { customerId?: string } | null)?.customerId === owner);

  console.log("§3 okuması süren belge");
  const n3 = await mkNote("PENDING");
  setReaderUrlForTests("http://127.0.0.1:9");
  const r3 = await formWo(n3, woUser.token, body());
  setReaderUrlForTests(null);
  check("§3 ⭐ 409 DELIVERY_NOTE_NOT_READ, DRAFT, top 0", r3.status === 409 && r3.code === "DELIVERY_NOTE_NOT_READ" && (await statusOf(n3)) === "DRAFT" && (await rollsOf(n3)).length === 0, `${r3.status} ${r3.code ?? ""}`);

  console.log("§3b okuma düşmüş / okuyucusuz belge elle değerle kaydedilir");
  const n3b = await mkNote("READ_FAILED");
  const r3b = await formWo(n3b, woUser.token, body({ ourBatchNo: `${TAG}-P3B` }));
  const w3b = r3b.warnings ?? [];
  check("§3b ⭐ READ_FAILED → 201, APPROVED, 1 top + uyarı", r3b.status === 201 && (await statusOf(n3b)) === "APPROVED" && (await rollsOf(n3b)).length === 1 && w3b.some((w) => w.includes("sayfa okunamadı")), `${r3b.status} ${r3b.code ?? ""} ${JSON.stringify(w3b).slice(0, 200)}`);
  const r3c = await formWo(n3, woUser.token, body({ ourBatchNo: `${TAG}-P3C` }));
  check("§3b ⭐ okuyucusuz (NO_SERVICE) → 201, 1 top + uyarı", r3c.status === 201 && (await rollsOf(n3)).length === 1 && (r3c.warnings ?? []).some((w) => w.includes("sayfa okunamadı")), `${r3c.status} ${r3c.code ?? ""}`);

  console.log("§4 mutlu yol");
  const w4 = await woCount();
  const b4 = body();
  const r4 = await formWo(n, woUser.token, b4);
  const d4 = r4.data as { workOrderId?: string; workOrderNo?: string; batchNumber?: string; rollId?: string } | undefined;
  const rolls = await rollsOf(n);
  check("§4 201 + yanıt alanları", r4.status === 201 && !!d4?.workOrderId && !!d4?.workOrderNo && !!d4?.rollId, `${r4.status} ${r4.code ?? ""} ${JSON.stringify(r4.data)?.slice(0, 300)}`);
  check("§4 ⭐ belge APPROVED, sahip yazıldı, 1 top", (await statusOf(n)) === "APPROVED" && rolls.length === 1 && rolls[0] === d4?.rollId && (await prisma.customerDeliveryNote.findUnique({ where: { id: n }, select: { ownerCustomerId: true } }))?.ownerCustomerId === owner);
  const roll = d4?.rollId ? await prisma.roll.findUnique({ where: { id: d4.rollId }, select: { currentQty: true, ownerCustomerId: true } }) : null;
  check("§4 ⭐ top = kursunMeters, sahipli", !!roll && Number(roll.currentQty) === 4521.5 && roll.ownerCustomerId === owner, `${roll?.currentQty}`);
  check("§4 ⭐ 1 iş emri", (await woCount()) === w4 + 1);
  const wo = d4?.workOrderId ? await prisma.workOrder.findUnique({ where: { id: d4.workOrderId }, select: { routeTemplateId: true, clientToken: true, targetValues: { select: { valueId: true } }, batches: { select: { batchNumber: true, rolls: { select: { id: true } } } } } }) : null;
  check("§4 ⭐ rota = seçilen, token = gövdedeki", wo?.routeTemplateId === chosen && wo?.clientToken === b4.clientToken);
  check("§4 ⭐ parti no belgeden + top partide", d4?.batchNumber === `${TAG}-P1` && !!wo?.batches.some((b) => b.batchNumber === `${TAG}-P1` && b.rolls.some((r) => r.id === d4?.rollId)), `${d4?.batchNumber}`);
  check("§4 ⭐ hedef değer geçti", wo?.targetValues.some((t) => t.valueId === gramaj.values[0].id) === true);
  const audit = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: n }, select: { newData: true } });
  check("§4 ⭐ audit WITH_WORK_ORDER: <kullanıcı>", audit.some((a) => JSON.stringify(a.newData).includes(`WITH_WORK_ORDER: ${woUser.username}`)));

  console.log("§5 replay");
  const r5 = await formWo(n, woUser.token, b4);
  check("§5 ⭐ aynı token → aynı yanıt", r5.status === 201 && JSON.stringify(r5.data) === JSON.stringify(r4.data), `${r5.status} ${r5.code ?? ""}`);
  check("§5 ⭐ yeni İE/top yok", (await woCount()) === w4 + 1 && (await rollsOf(n)).length === 1);
  const r5b = await formWo(n6, woUser.token, { ...body(), extra: 1 });
  check("§5 strict gövde → 400", r5b.status === 400 && (await statusOf(n6)) === "DRAFT", `${r5b.status}`);
  const d6c = await call("GET", `/api/gelen-belge/irsaliyeler/${n}`, tk);
  check("§6 sahipli/onaylı belgede öneri null", d6c.data?.ownerSuggestion === null);

  console.log("§8 yarım kalan onay aynı token'la devam eder");
  // Onay ortasında düşmüş belge: sahip + metre yazılmış, özet satırı FAILED/ENTERING, başlık PARTIAL/APPROVING.
  const halfDone = async (status: "PARTIAL" | "APPROVING", lineStatus: "FAILED" | "ENTERING", staleMin: number) => {
    const id = await mkNote("READ");
    await updateDeliveryNote(id, { ownerCustomerId: owner, kursunMeters: 321 }, admin.id);
    await prisma.customerDeliveryNoteLine.create({ data: { id: summaryLineId(id), noteId: id, lineNo: 99, blockNo: 1, lineKind: "ARABA", meters: 321, status: lineStatus, failReason: lineStatus === "FAILED" ? "geçici DB hatası (test)" : null, confidence: 1 } });
    // updatedAt ms hassasiyetinde (Prisma yazımı gibi) — onay claim'i ön kontrol görüntüsüne eşitlikle bağlanır.
    await prisma.$executeRaw`UPDATE "customer_delivery_notes" SET "status" = ${status}::"DeliveryNoteStatus", "updatedAt" = ${new Date(Date.now() - staleMin * 60_000)} WHERE "id" = ${id}::uuid`;
    return id;
  };
  const w8 = await woCount();
  const n8 = await halfDone("PARTIAL", "FAILED", 0);
  const b8 = body({ ourBatchNo: `${TAG}-P8` });
  const r8 = await formWo(n8, woUser.token, b8);
  check("§8 ⭐ PARTIAL + özet FAILED → 201, APPROVED, 1 top, 1 İE", r8.status === 201 && (await statusOf(n8)) === "APPROVED" && (await rollsOf(n8)).length === 1 && (await woCount()) === w8 + 1, `${r8.status} ${r8.code ?? ""} ${JSON.stringify(r8.data)?.slice(0, 200)}`);
  const r8r = await formWo(n8, woUser.token, b8);
  check("§8 ⭐ aynı token tekrar → aynı yanıt, yeni top/İE yok", r8r.status === 201 && JSON.stringify(r8r.data) === JSON.stringify(r8.data) && (await rollsOf(n8)).length === 1 && (await woCount()) === w8 + 1, `${r8r.status}`);
  const n8b = await halfDone("APPROVING", "ENTERING", 11);
  const r8b = await formWo(n8b, woUser.token, body({ ourBatchNo: `${TAG}-P8B` }));
  check("§8 ⭐ bayat APPROVING → 201, APPROVED, 1 top", r8b.status === 201 && (await statusOf(n8b)) === "APPROVED" && (await rollsOf(n8b)).length === 1, `${r8b.status} ${r8b.code ?? ""}`);
  const n8c = await halfDone("APPROVING", "ENTERING", 0);
  const r8c = await formWo(n8c, woUser.token, body({ ourBatchNo: `${TAG}-P8C` }));
  check("§8 taze APPROVING → 409 DELIVERY_NOTE_NOT_APPROVABLE, top 0", r8c.status === 409 && r8c.code === "DELIVERY_NOTE_NOT_APPROVABLE" && (await rollsOf(n8c)).length === 0, `${r8c.status} ${r8c.code ?? ""}`);

  console.log("§7 kısayol listesi");
  const a = await mkRoute("kısayol A", { isWorkOrderShortcut: true, shortcutOrder: 2 });
  const b = await mkRoute("kısayol B", { isWorkOrderShortcut: true, shortcutOrder: 1 });
  const c = await mkRoute("kısayol değil");
  const l7 = await call("GET", "/api/routes?shortcut=1", tk);
  const list = (l7.data as unknown as Array<{ id: string; isWorkOrderShortcut: boolean }>) ?? [];
  const ids = list.map((x) => x.id);
  check("§7 ⭐ yalnız işaretliler", l7.status === 200 && list.length > 0 && list.every((x) => x.isWorkOrderShortcut === true) && !ids.includes(c), `${l7.status} n=${list.length}`);
  check("§7 ⭐ shortcutOrder sırası (B önce A)", ids.indexOf(b) >= 0 && ids.indexOf(a) > ids.indexOf(b));
  const all = await call("GET", "/api/routes?pageSize=100&search=" + encodeURIComponent(TAG), tk);
  check("§7 bayraksız liste değişmez (kısayolsuz da gelir)", ((all.data as unknown as Array<{ id: string }>) ?? []).some((x) => x.id === c), `${all.status}`);
  console.log("§7b isKursunStation");
  // Kurşun özelliği seed'in (prisma/seed.ts) — yoksa ortam eksik, sınama kırmızı.
  const kprop = await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } });
  if (!kprop) throw new Error("Fikstür eksik: KURSUN özelliği (npm run seed)");
  const mkQc = async (suffix: string) => {
    const id = (await prisma.station.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } })).id;
    made.stations.push(id);
    return id;
  };
  const kSt = await mkQc("KQC");
  await prisma.stationProperty.create({ data: { stationId: kSt, propertyId: kprop.id, mode: "AUTO" } });
  const qSt = await mkQc("QC");
  const kr = (await prisma.route.create({ data: { name: `${TAG} kurşun+kk`, isWorkOrderShortcut: true, steps: { create: [{ stationId: kSt, sequence: 1 }, { stationId: qSt, sequence: 2 }] } }, select: { id: true } })).id;
  made.routes.push(kr);
  type RStep = { station?: { id: string; isKursunStation?: boolean } };
  const flagsOf = (steps: RStep[] | undefined) => (steps ?? []).map((x) => x.station?.isKursunStation);
  const one = await call("GET", `/api/routes/${kr}`, tk);
  check("§7b ⭐ tekil: kurşun istasyonu true, yeteneksiz PROCESS_QC false", JSON.stringify(flagsOf((one.data as { steps?: RStep[] } | undefined)?.steps)) === "[true,false]", JSON.stringify(flagsOf((one.data as { steps?: RStep[] } | undefined)?.steps)));
  const sl = ((await call("GET", "/api/routes?shortcut=1", tk)).data as unknown as Array<{ id: string; steps?: RStep[] }>) ?? [];
  check("§7b ⭐ kısayol listesi aynı", JSON.stringify(flagsOf(sl.find((x) => x.id === kr)?.steps)) === "[true,false]");
  const fl = ((await call("GET", "/api/routes?pageSize=100&search=" + encodeURIComponent(TAG), tk)).data as unknown as Array<{ id: string; steps?: RStep[] }>) ?? [];
  check("§7b ⭐ düz liste aynı", JSON.stringify(flagsOf(fl.find((x) => x.id === kr)?.steps)) === "[true,false]");
  const st1 = await call("GET", `/api/stations/${kSt}`, tk);
  const st2 = await call("GET", `/api/stations/${qSt}`, tk);
  check("§7b ⭐ istasyon tekil yanıtı aynı (elle seçilen adım)", st1.data?.isKursunStation === true && st2.data?.isKursunStation === false, `${st1.status} ${String(st1.data?.isKursunStation)} ${String(st2.data?.isKursunStation)}`);

  const p7 = await call("PATCH", `/api/routes/${c}`, tk, { shortcutOrder: -1 });
  const p7b = await call("PATCH", `/api/routes/${c}`, tk, { isWorkOrderShortcut: true, shortcutOrder: 3 });
  const cRow = await prisma.route.findUnique({ where: { id: c }, select: { isWorkOrderShortcut: true, shortcutOrder: true } });
  check("§7 geçersiz sıra 400; geçerli güncelleme yazar", p7.status === 400 && p7b.status === 200 && cRow?.isWorkOrderShortcut === true && cRow.shortcutOrder === 3, `${p7.status} ${p7b.status} ${p7b.code ?? ""}`);
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
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } }).catch(swallow);
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge formdan iş emri (OIE) bekçisi ===\n");
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
