// =============================================================================
// GELEN BELGE — ŞABLON KURALI (`rules.multiParty`), düzenleme birleşimi (drop/rules), kip çözücü, tanıma özeti (B2, 2026-11-09)
// =============================================================================
// Saf bölüm + HTTP/gerçek DB bölümü. Sınanan:
//   §1 ⭐ validateTemplate rules FAIL-CLOSED: nesne değil / bilinmeyen anahtar / bilinmeyen değer / null → hata; geçerli kural geçer
//   §2 ⭐ mergeTemplateForUpdate: `next.rules ?? old.rules` (eski istemci kuralı silmez); drop budaması alan + bölüm alanı/rolü +
//      metre kaynağı + parti no adayı; boşalan bölüm kalkar
//   §3 ⭐ editTemplateDefinition: ad, kimlik (boş → hata), olmayan alan → hata, `multiParty: null` kaldırır, değişiklik yoksa boş
//   §4 suggestTemplate kural yazar (yoksa alan yok)
//   §5 ⭐ `readMultiPartyWorkOrder(` gelen belge yolunda yalnız `gelen-belge-parti-kipi.service` (+ ayar ekranı, ayar tanımı)
//   §6 ⭐ kip çözücü: kural yok → FACTORY; PATCH /tanim PER_PARTY → v2 okunan belge TEMPLATE; v1'de okunmuş belge FACTORY kalır
//      (geçmiş değişmez); sürüm satırı yok + sürüm farklı → FACTORY
//   §7 ⭐ form ucu: mode'suz → şablon kuralı (2 İE); gövde mode SINGLE kurala üstün (1 İE); "Toplar ayrı" → SINGLE zorlaması
//   §8 ⭐ tanıma özeti biçimi (okuma özeti + detay aynı): şablon + sürüm, eşleme (metre hücresi kg'si null), kurallar metni
// Negatif sondalar (2026-11-09, ölçüldü): merge'de `old.rules` korunmazsa §2 kırmızı; çözücü güncel sürümden okursa §6 "geçmiş" kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import bcrypt from "bcryptjs";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { editTemplateDefinition, mergeTemplateForUpdate, suggestTemplate, validateTemplate, type DocumentTemplate, type OcrResult } from "../src/lib/gelen-belge/motor";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
// Metin iş emri adını rejimden çözer (K20); beklenti aynı kaynaktan kurulur.
import { TERIM } from "../src/constants/terim";

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

const TAG = `TEST-GSK${Date.now().toString(36).toUpperCase()}`;
const roi = (x: number, y: number) => [{ kind: "roi" as const, roi: { x, y, w: 0.2, h: 0.05 } }];
const BASE: DocumentTemplate = {
  id: "u-test", name: "Test tipi", version: 1,
  identifiers: { keywords: ["TEST KIMLIK", "ÇEKİ LİSTESİ"], minScore: 0.6 },
  fields: [
    { key: "musteri", label: "Müşteri", type: "text", strategies: roi(0, 0) },
    { key: "toplamMetre", label: "Gelen metre", type: "decimal", strategies: roi(0.5, 0.5) },
    { key: "hedefKg", label: "Hedef kg", type: "decimal", strategies: roi(0, 0.8) },
    { key: "partiNo", label: "Parti No", type: "alnum", strategies: roi(0.5, 0.1) },
  ],
  tables: [{ key: "toplar", columns: [{ key: "m", label: "Metre", type: "decimal", headers: ["Metre"], required: true }], totals: { labels: ["T.Adet"] } }],
  sections: { startLabels: ["PARTİ NO"], fields: ["partiNo"], batchField: "partiNo", table: "toplar" },
  meterSources: { output: ["$tableTotal"], total: ["toplamMetre"] },
  batchNoCandidates: [{ field: "partiNo", kind: "BATCH" }],
};

function pureSections(): void {
  console.log("§1 rules doğrulama");
  const v = (rules: unknown) => validateTemplate({ ...BASE, rules } as unknown as DocumentTemplate);
  check("§1 geçerli kural ve kuralsız şablon geçer", v({ multiParty: "PER_PARTY" }).ok && v(undefined).ok && v({}).ok);
  const bad = [v("PER_PARTY"), v(null), v({ multiParty: "HER_PARTI" }), v({ multiParty: "SINGLE", gizli: true })];
  check("§1 ⭐ FAIL-CLOSED: nesne değil / null / bilinmeyen değer / bilinmeyen anahtar → hata", bad.every((r) => !r.ok), JSON.stringify(bad.map((r) => r.errors)));

  console.log("§2 güncelleme birleşimi");
  const old: DocumentTemplate = { ...BASE, rules: { multiParty: "PER_PARTY" } };
  const next: DocumentTemplate = { ...BASE, fields: [BASE.fields[0]!], tables: undefined, sections: undefined, meterSources: undefined, batchNoCandidates: undefined };
  delete next.tables; delete next.sections; delete next.meterSources; delete next.batchNoCandidates;
  const kept = mergeTemplateForUpdate(old, next, ["tables", "sections"]);
  check("§2 ⭐ kural göndermeyen güncelleme eski kuralı korur (next.rules ?? old.rules)", kept.rules?.multiParty === "PER_PARTY", JSON.stringify(kept.rules));
  const over = mergeTemplateForUpdate(old, { ...next, rules: { multiParty: "SINGLE" } }, ["tables", "sections"]);
  check("§2 yeni kural eskisini ezer", over.rules?.multiParty === "SINGLE");
  const dropped = mergeTemplateForUpdate(old, next, ["tables", "sections"], ["partiNo", "toplamMetre"]);
  const keys = dropped.fields.map((f) => f.key);
  check("§2 ⭐ drop: alan + bölüm (tek alanı gidince bölüm kalkar) + metre kaynağı + parti no adayı budanır; geçerli şablon",
    !keys.includes("partiNo") && !keys.includes("toplamMetre") && keys.includes("hedefKg") && !dropped.sections && JSON.stringify(dropped.meterSources) === JSON.stringify({ output: ["$tableTotal"] }) && !dropped.batchNoCandidates && validateTemplate(dropped).ok,
    JSON.stringify({ keys, s: dropped.sections, m: dropped.meterSources, b: dropped.batchNoCandidates, e: validateTemplate(dropped).errors }));
  const noDrop = mergeTemplateForUpdate(old, next, ["tables", "sections"]);
  check("§2 drop yokken atanmayan eski alan korunur (bugünkü davranış)", noDrop.fields.length === 4 && !!noDrop.sections);

  console.log("§3 fotoğrafsız düzenleme (saf)");
  const e1 = editTemplateDefinition(old, { name: "Yeni ad", identifiers: ["TEST KIMLIK", "YENİ YAZI"], dropFields: ["hedefKg"], rules: { multiParty: null } });
  check("§3 ⭐ ad + kimlik + alan kaldır + kural kaldır (fabrika ayarına dön); id/sürüm aynı",
    e1.errors.length === 0 && e1.template.name === "Yeni ad" && e1.template.id === old.id && e1.template.version === old.version && JSON.stringify(e1.template.identifiers.keywords) === JSON.stringify(["TEST KIMLIK", "YENİ YAZI"]) && e1.template.identifiers.minScore === 0.6
    && !e1.template.fields.some((f) => f.key === "hedefKg") && !e1.template.rules && e1.changes.rules?.multiParty.to === null && JSON.stringify(e1.changes.identifiers) === JSON.stringify({ added: ["YENİ YAZI"], removed: ["ÇEKİ LİSTESİ"] }),
    JSON.stringify({ e: e1.errors, c: e1.changes }));
  const e2 = editTemplateDefinition(old, { identifiers: ["  "] });
  const e3 = editTemplateDefinition(old, { dropFields: ["yokBoyle"] });
  check("§3 ⭐ boş kimlik listesi ve olmayan alan → hata", e2.errors.length === 1 && e3.errors.length === 1, JSON.stringify([e2.errors, e3.errors]));
  const e4 = editTemplateDefinition(old, { name: old.name, rules: { multiParty: "PER_PARTY" }, identifiers: [...old.identifiers.keywords] });
  check("§3 değişiklik yok → changes boş", e4.errors.length === 0 && Object.keys(e4.changes).length === 0, JSON.stringify(e4.changes));
  const e5 = editTemplateDefinition(BASE, { rules: { multiParty: "SINGLE" } });
  check("§3 kural ekle", e5.template.rules?.multiParty === "SINGLE" && e5.changes.rules?.multiParty.from === null);

  console.log("§4 öneri kural yazar");
  const ocr: OcrResult = { text: "", imageWidth: 1000, imageHeight: 1000, rotation: 0, blocks: [] } as unknown as OcrResult;
  const s1 = suggestTemplate({ code: "u-x", name: "X", ocr, assignments: [], identifiers: ["A B"], rules: { multiParty: "PER_PARTY" } });
  const s2 = suggestTemplate({ code: "u-x", name: "X", ocr, assignments: [], identifiers: ["A B"] });
  check("§4 kural verilirse şablonda, verilmezse alan yok", s1.template.rules?.multiParty === "PER_PARTY" && !("rules" in s2.template));

  console.log("§5 fabrika ayarı okuyucusu tek yerde");
  const src = join(__dirname, "..", "src");
  const allow = new Set(["services/gelen-belge-parti-kipi.service.ts", "services/gelen-belge-ayar.service.ts"]);
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(n) && /readMultiPartyWorkOrder\s*\(/.test(readFileSync(p, "utf8"))) hits.push(relative(src, p));
    }
  };
  walk(src);
  const stray = hits.filter((h) => !allow.has(h) && !h.startsWith("services/system-setting/"));
  check("§5 ⭐ readMultiPartyWorkOrder( yalnız kip çözücüde (+ ayar ekranı)", stray.length === 0 && hits.includes("services/gelen-belge-parti-kipi.service.ts"), JSON.stringify(hits));
}

const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], templates: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI,
];
type Resp = { status: number; code?: string; data?: Record<string, unknown> };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string, ocrResult: unknown): Promise<void> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
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
  const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"] } }, select: { id: true } });
  const wu = await prisma.user.create({
    data: { username: `${TAG}-w`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} W`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(wu.id);
  const woUser = await login(wu.username, parola);
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  // Kullanıcı şablonu (kuralsız v1).
  const name = `${TAG} Kural tipi`;
  const c = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: BASE, clientToken: randomUUID() });
  const code = String(c.data?.code ?? "");
  const tplRow = code ? await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } }) : null;
  if (tplRow) made.templates.push(tplRow.id);
  check("şablon v1 201", c.status === 201 && !!tplRow, `${c.status} ${c.code ?? ""}`);
  if (!tplRow) return;

  /** İki partili belge (Güleçsoy kalıbı), okunduğu sürüm verilir; tek okunmuş tarama bölgesi bu şablonla. */
  const mkNote = async (version: number) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN`,
      lines: [100, 110, 120, 200, 210].map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = String(r.data?.id ?? "");
    made.notes.push(id);
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id }, orderBy: { lineNo: "asc" }, select: { id: true } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { id: { in: lines.slice(3).map((l) => l.id) } }, data: { blockNo: 2 } });
    const n = made.notes.length;
    await prisma.customerDeliveryNote.update({ where: { id }, data: { templateId: tplRow.id, templateVersion: version, kursunMeters: "740", kursunMetersSource: "LINE_SUM", totalsDeclared: { blocks: [
      { blockNo: 1, batchNo: `${TAG}-P${n}A`, orderNo: "1", topCount: 3, count: null, kg: null, m: "330" },
      { blockNo: 2, batchNo: `${TAG}-P${n}B`, orderNo: "2", topCount: 2, count: null, kg: null, m: "410" },
    ] } } });
    await addScan(id, { regions: [{ templateId: code, fields: { musteri: `${TAG} Müşteri`, toplamMetre: "740", hedefKg: "740", partiNo: `${TAG}-P${n}A` } }] });
    return { id, n };
  };
  const parties = async (id: string) => (await call("GET", `/api/gelen-belge/irsaliyeler/${id}/partiler`, tk)).data as { defaultMode?: string; defaultModeSource?: string } | undefined;

  console.log("§6 kip çözücü");
  const a = await mkNote(1);
  const pa = await parties(a.id);
  check("§6 kural yok → FACTORY SINGLE", pa?.defaultMode === "SINGLE" && pa.defaultModeSource === "FACTORY", JSON.stringify(pa));
  const e = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 1, rules: { multiParty: "PER_PARTY" } });
  check("§6 PATCH /tanim kural → v2", e.status === 200 && e.data?.version === 2 && e.data?.code === code, `${e.status} ${e.code ?? ""}`);
  const b = await mkNote(2);
  const pb = await parties(b.id);
  check("§6 ⭐ v2'de okunan belge → TEMPLATE PER_PARTY", pb?.defaultMode === "PER_PARTY" && pb.defaultModeSource === "TEMPLATE", JSON.stringify(pb));
  const pa2 = await parties(a.id);
  check("§6 ⭐ v1'de okunmuş belgenin kipi DEĞİŞMEZ (geçmiş)", pa2?.defaultMode === "SINGLE" && pa2.defaultModeSource === "FACTORY", JSON.stringify(pa2));
  const ghost = await mkNote(9);
  const pg = await parties(ghost.id);
  check("§6 sürüm satırı yok + sürüm farklı → FACTORY (kural uydurulmaz)", pg?.defaultModeSource === "FACTORY", JSON.stringify(pg));

  console.log("§7 form ucu öncelik");
  const body = (n: number, extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "740", routeTemplateId: route, parties: [{ blockNo: 1, batchNo: `${TAG}-P${n}A`, meters: 330 }, { blockNo: 2, batchNo: `${TAG}-P${n}B`, meters: 410 }], ...extra });
  const r1 = await call("POST", `/api/gelen-belge/irsaliyeler/${b.id}/is-emri`, woUser, body(b.n));
  check("§7 ⭐ mode'suz → şablon kuralı PER_PARTY, 2 İE", r1.status === 201 && r1.data?.mode === "PER_PARTY" && (r1.data?.workOrders as unknown[])?.length === 2, `${r1.status} ${r1.code ?? ""} ${String(r1.data?.mode)}`);
  const c7 = await mkNote(2);
  const r2 = await call("POST", `/api/gelen-belge/irsaliyeler/${c7.id}/is-emri`, woUser, body(c7.n, { mode: "SINGLE" }));
  check("§7 ⭐ gövde mode SINGLE kurala üstün → 1 İE", r2.status === 201 && r2.data?.mode === "SINGLE" && (r2.data?.workOrders as unknown[])?.length === 1, `${r2.status} ${r2.code ?? ""} ${String(r2.data?.mode)}`);
  const d7 = await mkNote(2);
  await prisma.customerDeliveryNote.update({ where: { id: d7.id }, data: { totalsDeclared: { blocks: [] } } });
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: d7.id }, data: { blockNo: 1 } });
  const r3 = await call("POST", `/api/gelen-belge/irsaliyeler/${d7.id}/is-emri`, woUser, { clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "740", routeTemplateId: route, rollMode: "SEPARATE", rolls: [{ meters: 300 }, { meters: 440 }] });
  check("§7 ⭐ \"Toplar ayrı\" şablon kuralı PER_PARTY olsa da SINGLE (1 İE)", r3.status === 201 && r3.data?.mode === "SINGLE" && (r3.data?.workOrders as unknown[] | undefined ?? [null]).length === 1, `${r3.status} ${r3.code ?? ""} ${String(r3.data?.mode)}`);

  console.log("§8 tanıma özeti");
  const sum = (await call("GET", `/api/gelen-belge/irsaliyeler/${b.id}/okuma-ozeti`, tk)).data as { tanima?: Record<string, unknown> } | undefined;
  const det = (await call("GET", `/api/gelen-belge/irsaliyeler/${b.id}`, tk)).data as { tanima?: Record<string, unknown> } | undefined;
  const t = sum?.tanima as { template?: { code?: string; name?: string; version?: number }; durum?: string; mapping?: Array<{ field: string; value: string | null; woLabel: string; group: string }>; rules?: Array<{ key: string; source: string; text: string; sourceText: string }> } | undefined;
  const m = new Map((t?.mapping ?? []).map((x) => [x.field, x]));
  check("§8 ⭐ şablon + okunduğu sürüm + durum", t?.durum === "TANITILDI" && t.template?.code === code && t.template.name === name && t.template.version === 2, JSON.stringify(t?.template));
  check("§8 ⭐ eşleme: grup sırası (Kimlik → Gelen → Hedef), İE adı, metre hücresinden kg null",
    JSON.stringify(t?.mapping?.map((x) => x.field)) === JSON.stringify(["musteri", "partiNo", "toplamMetre", "hedefKg"]) && m.get("toplamMetre")?.value === "740" && m.get("toplamMetre")?.woLabel === "Gelen metre" && m.get("hedefKg")?.value === null && m.get("hedefKg")?.group === "HEDEF",
    JSON.stringify(t?.mapping));
  const rules = new Map((t?.rules ?? []).map((x) => [x.key, x]));
  check("§8 ⭐ kurallar: '2 parti → 2 iş emri' (şablon kuralı), bölüm, toplam satırı, metre kaynağı (form kurşun metresini elle yazdı)",
    rules.get("multiParty")?.text === `2 parti → 2 ${TERIM.terbiyeIsEmri.tekilKucuk}` && rules.get("multiParty")?.source === "TEMPLATE" && rules.get("multiParty")?.sourceText === "şablon kuralı"
    && rules.get("sections")?.text === "Tekrar eden bölüm: PARTİ NO" && rules.get("totalsRow")?.text === "Toplam satırı: T.Adet" && rules.get("meterSource")?.text === "Gelen metre: elle girildi" && rules.get("meterSource")?.source === "MANUAL",
    JSON.stringify(t?.rules));
  check("§8 belge detayı aynı blok", JSON.stringify(det?.tanima) === JSON.stringify(sum?.tanima));
  const ta = ((await call("GET", `/api/gelen-belge/irsaliyeler/${a.id}/okuma-ozeti`, tk)).data as { tanima?: { rules?: Array<{ key: string; text: string; source: string }> } } | undefined)?.tanima;
  const mp = ta?.rules?.find((x) => x.key === "multiParty");
  const ms = ta?.rules?.find((x) => x.key === "meterSource");
  check("§8 v1 belgesi: '2 parti → 1 iş emri' (fabrika ayarı); metre satır toplamından", mp?.text === `2 parti → 1 ${TERIM.terbiyeIsEmri.tekilKucuk}` && mp.source === "FACTORY" && ms?.text === "Gelen metre: satır toplamından", JSON.stringify(ta?.rules));
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
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge şablon kuralı + düzenleme birleşimi + tanıma özeti (B2) bekçisi ===\n");
  pureSections();
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
