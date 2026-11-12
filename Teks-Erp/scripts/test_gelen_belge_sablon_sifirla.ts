// =============================================================================
// GELEN BELGE — BELGE TİPİ SIFIRLA (= pasif, "bu tipi unut") + FOTOĞRAFSIZ DÜZENLE (PATCH /tanim) (B2, 2026-11-09)
// =============================================================================
// HTTP + gerçek DB + gerçek motor (fikstür 0245, yalnız GENEL + kullanıcı şablonu). Sınanan:
//   §1 tanıtılmış tip: 0245 bu tiple okunur, `tanitim` TANITILDI
//   §2 ⭐ önizleme YAZMAZ (şablon/sürüm/audit sayımı önce = sonra); taslak listesi + belge durumları + bilinmeyen kod failed;
//      route sırası: `sifirla-onizleme` `/:code` sanılmaz
//   §3 ⭐ sıfırla atomik: yanlış expectedVersion → failed VERSION_CHANGED (aktif kalır); doğru → done + audit RESET; ikinci çağrı
//      ALREADY_INACTIVE (yan etkisiz); tekrarlı kod 400
//   §4 ⭐ sıfırlanan tip motora girmez → yeni okuma GENEL/TANITILMAMIS; eski belge TANITILDI kalır ve adı okunur
//   §5 ⭐ aynı adla yeniden tanıtım `-2` kodu alır (eski kod/okumalar dokunulmaz); aktif ad çakışması hâlâ 409
//   §6 ⭐ geri al (PATCH /sablonlar/:code isActive true) → motora döner
//   §7 ⭐ PATCH /tanim: ad değişir kod değişmez, sürüm+1 + sürüm satırı + audit (fromVersion/toVersion/changes); bayat sürüm 409;
//      boş kimlik 400; olmayan alan 400; değişiklik yok → sürüm artmaz; sıfırlanmış tip 409 USER_TEMPLATE_INACTIVE; izinsiz 403
// Negatif sonda (2026-11-09, ölçüldü): sıfırla WHERE'inden `version` çıkarılınca §3 VERSION_CHANGED kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { engineTemplates } from "../src/services/gelen-belge-ozel-sablon.service";
import { buildDraft, fillBoundDraftTx } from "../src/services/gelen-belge-taslak-doldur.service";
import type { OcrResult } from "../src/lib/gelen-belge/motor";
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

const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const OCR = JSON.parse(readFileSync(join(FIKSTUR, "0245-ceki-listesi-a.json"), "utf8")) as OcrResult;
const TAG = `TEST-GSS${Date.now().toString(36).toUpperCase()}`;
const made = { notes: [] as string[], scans: [] as string[], users: [] as string[], codes: [] as string[] };
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI];
type Resp = { status: number; code?: string; data?: Record<string, unknown> };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string | null, ocrResult: unknown): Promise<string> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
  return s.id;
}

async function run(url: string, adminId: string, tk: string, call: (m: string, p: string, t: string, b?: unknown) => Promise<Resp>, otherTk: string): Promise<void> {
  /** Okuma anı (okuma işinin yazdığı kolonlar): boş taslak → buildDraft → tarama bağla; bölge şablonu + özet `tanitim`. */
  const read = async () => {
    const n = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN` });
    const id = String(n.data?.id ?? "");
    made.notes.push(id);
    const built = await buildDraft(OCR, adminId, { bumpHit: false });
    const scanId = await addScan(id, built.envelope);
    await prisma.$transaction((tx) => fillBoundDraftTx(tx, id, { id: scanId, pageNo: 1 }, built));
    const region = ((built.envelope as { regions?: Array<{ templateId?: string | null }> }).regions ?? [])[0]?.templateId ?? null;
    return { id, region };
  };
  const tanitimOf = async (id: string) => ((await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`, tk)).data as { tanitim?: { durum?: string; sablonKodu?: string; sablonAdi?: string } } | undefined)?.tanitim;
  const rectOf = (t: string) => OCR.blocks.flatMap((b) => b.lines).find((l) => l.text === t)!.rect;
  const scan = await addScan(null, { ocr: OCR });
  const name = `${TAG} Sıfırla çeki`;
  const create = async (clientToken = randomUUID()) => {
    const sug = await call("POST", "/api/gelen-belge/sablonlar/oneri", tk, { scanId: scan, name, assignments: [{ field: "evrakNo", rect: rectOf("914279") }], identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"] });
    const c = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: sug.data?.template, clientToken });
    if (c.data?.code) made.codes.push(String(c.data.code));
    return c;
  };

  console.log("§1 tanıtılmış tip");
  const c1 = await create();
  const code = String(c1.data?.code ?? "");
  check("§1 tip 201 (u-…)", c1.status === 201 && code.startsWith("u-"), `${c1.status} ${c1.code ?? ""}`);
  const r1 = await read();
  const t1 = await tanitimOf(r1.id);
  check("§1 0245 bu tiple okunur; TANITILDI", r1.region === code && t1?.durum === "TANITILDI", JSON.stringify({ r: r1.region, t1 }));

  console.log("§2 önizleme");
  const count = async () => ({
    active: await prisma.senderTemplate.count({ where: { code, isActive: true } }),
    versions: await prisma.senderTemplateVersion.count({ where: { senderTemplate: { code } } }),
    audit: await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE" } }),
    v: (await prisma.senderTemplate.findUnique({ where: { code }, select: { version: true } }))?.version,
  });
  const before = await count();
  const pv = await call("GET", `/api/gelen-belge/sablonlar/ozel/sifirla-onizleme?codes=${code},u-yok-boyle-${Date.now()}`, tk);
  const after = await count();
  const item = ((pv.data?.items ?? []) as Array<{ code: string; name: string; version: number; isActive: boolean; drafts: Array<{ id: string; documentNo: string }>; draftsTotal: number; notesByStatus: Record<string, number> }>)[0];
  const failed = (pv.data?.failed ?? []) as Array<{ reason: string }>;
  check("§2 ⭐ önizleme 200 (route sırası), tip satırı: ad, sürüm, aktif, okunan taslak listede, durum sayımı",
    pv.status === 200 && item?.code === code && item.name === name && item.version === 1 && item.isActive && item.drafts.some((d) => d.id === r1.id && !!d.documentNo) && item.draftsTotal >= 1 && (item.notesByStatus.DRAFT ?? 0) >= 1,
    `${pv.status} ${pv.code ?? ""} ${JSON.stringify(item)}`);
  check("§2 ⭐ bilinmeyen kod failed NOT_FOUND (fail-closed)", failed.length === 1 && failed[0]!.reason === "NOT_FOUND", JSON.stringify(failed));
  check("§2 ⭐ önizleme YAZMAZ (aktiflik/sürüm/audit aynı)", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
  const pvBad = await call("GET", "/api/gelen-belge/sablonlar/ozel/sifirla-onizleme?codes=genel", tk);
  check("§2 kullanıcı şablonu olmayan kod 400", pvBad.status === 400, `${pvBad.status}`);

  console.log("§3 sıfırla");
  const s0 = await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", tk, { items: [{ code, expectedVersion: 7 }] });
  const s0f = (s0.data?.failed ?? []) as Array<{ code: string; reason: string }>;
  check("§3 ⭐ yanlış sürüm → failed VERSION_CHANGED, tip aktif kalır", s0.status === 200 && (s0.data?.done as unknown[]).length === 0 && s0f[0]?.reason === "VERSION_CHANGED" && (await count()).active === 1, JSON.stringify(s0.data));
  const auditBefore = await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE" } });
  const s1 = await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", tk, { items: [{ code, expectedVersion: 1 }] });
  const resetLog = await prisma.systemLog.findFirst({ where: { tableName: "SENDER_TEMPLATE", createdAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newData: true } });
  check("§3 ⭐ doğru sürüm → done, pasif, audit RESET", s1.status === 200 && JSON.stringify(s1.data?.done) === JSON.stringify([{ code, version: 1 }]) && (await count()).active === 0
    && (await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE" } })) === auditBefore + 1 && (resetLog?.newData as { reason?: string } | null)?.reason === "RESET", JSON.stringify(s1.data));
  const s2 = await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", tk, { items: [{ code, expectedVersion: 1 }] });
  check("§3 ⭐ ikinci çağrı idempotent: ALREADY_INACTIVE, yeni audit yok", ((s2.data?.failed ?? []) as Array<{ reason: string }>)[0]?.reason === "ALREADY_INACTIVE" && (await prisma.systemLog.count({ where: { tableName: "SENDER_TEMPLATE" } })) === auditBefore + 1, JSON.stringify(s2.data));
  const sDup = await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", tk, { items: [{ code, expectedVersion: 1 }, { code, expectedVersion: 1 }] });
  const sNo = await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", otherTk, { items: [{ code, expectedVersion: 1 }] });
  check("§3 tekrarlı kod 400 · izinsiz 403", sDup.status === 400 && sNo.status === 403, `${sDup.status} ${sNo.status}`);

  console.log("§4 motor + geçmiş");
  check("§4 ⭐ sıfırlanan tip motor kümesinde yok", !(await engineTemplates()).some((t) => t.id === code));
  const r4 = await read();
  const t4 = await tanitimOf(r4.id);
  check("§4 ⭐ yeni okuma GENEL → TANITILMAMIS", r4.region === "genel" && t4?.durum === "TANITILMAMIS", JSON.stringify({ r: r4.region, t4 }));
  const t1b = await tanitimOf(r1.id);
  check("§4 ⭐ eski belge TANITILDI kalır, adı okunur", t1b?.durum === "TANITILDI" && t1b.sablonKodu === code && t1b.sablonAdi === name, JSON.stringify(t1b));

  console.log("§5 yeniden tanıt");
  const c5 = await create();
  check("§5 ⭐ aynı ad → sonekli kod (-2), 201; eski kod pasif kalır", c5.status === 201 && c5.data?.code === `${code}-2` && (await count()).active === 0, `${c5.status} ${c5.code ?? ""} ${String(c5.data?.code)}`);
  const c5b = await create();
  check("§5 aktif aynı ad hâlâ 409 USER_TEMPLATE_CODE_TAKEN", c5b.status === 409 && c5b.code === "USER_TEMPLATE_CODE_TAKEN", `${c5b.status} ${c5b.code ?? ""}`);
  const tokenAgain = randomUUID();
  await call("POST", "/api/gelen-belge/sablonlar/ozel/sifirla", tk, { items: [{ code: `${code}-2`, expectedVersion: 1 }] });
  const c5c = await create(tokenAgain);
  const c5d = await create(tokenAgain);
  check("§5 sonekli doğuş replay'i aynı satır (-3)", c5c.status === 201 && c5c.data?.code === `${code}-3` && c5d.status === 201 && c5d.data?.id === c5c.data?.id, `${c5c.status} ${String(c5c.data?.code)} ${c5d.status} ${c5d.code ?? ""}`);

  console.log("§6 geri al");
  const g = await call("PATCH", `/api/gelen-belge/sablonlar/${code}`, tk, { isActive: true });
  check("§6 ⭐ geri al 200 → motora döner", g.status === 200 && (await engineTemplates()).some((t) => t.id === code), `${g.status} ${g.code ?? ""}`);

  console.log("§7 PATCH /tanim");
  const newName = `${TAG} Yeni ad`;
  const e1 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 1, name: newName, identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO"], rules: { multiParty: "PER_PARTY" } });
  const row = await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true, version: true, template: true, _count: { select: { versions: true } } } });
  const tpl = row?.template as { name?: string; identifiers?: { keywords?: string[] }; rules?: { multiParty?: string } } | undefined;
  const editLog = row ? await prisma.systemLog.findFirst({ where: { tableName: "SENDER_TEMPLATE", recordId: row.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newData: true } }) : null;
  const nd = editLog?.newData as { fromVersion?: number; toVersion?: number; changes?: { name?: unknown; identifiers?: { removed?: string[] }; rules?: unknown } } | null;
  check("§7 ⭐ ad değişir, KOD değişmez, v2 + sürüm satırı, kimlik + kural yazıldı",
    e1.status === 200 && e1.data?.code === code && e1.data?.version === 2 && row?.version === 2 && row._count.versions === 2 && tpl?.name === newName && JSON.stringify(tpl?.identifiers?.keywords) === JSON.stringify(["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO"]) && tpl?.rules?.multiParty === "PER_PARTY",
    `${e1.status} ${e1.code ?? ""} ${JSON.stringify({ v: row?.version, n: tpl?.name, r: tpl?.rules })}`);
  check("§7 ⭐ audit: fromVersion 1 → toVersion 2 + changes", nd?.fromVersion === 1 && nd.toVersion === 2 && !!nd.changes?.name && JSON.stringify(nd.changes?.identifiers?.removed) === JSON.stringify(["Ham PartiNo"]) && !!nd.changes?.rules, JSON.stringify(nd));
  const e2 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 1, name: `${TAG} bayat` });
  check("§7 ⭐ bayat sürüm 409 USER_TEMPLATE_VERSION_CHANGED", e2.status === 409 && e2.code === "USER_TEMPLATE_VERSION_CHANGED", `${e2.status} ${e2.code ?? ""}`);
  const e3 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 2, identifiers: [] });
  const e4 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 2, dropFields: ["yokBoyle"] });
  const e4b = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 2, rules: { multiParty: "HER_PARTI" } });
  check("§7 ⭐ boş kimlik 400 · olmayan alan 400 USER_TEMPLATE_EDIT_INVALID · bilinmeyen kural 400", e3.status === 400 && e4.status === 400 && e4.code === "USER_TEMPLATE_EDIT_INVALID" && e4b.status === 400, `${e3.status} ${e4.status} ${e4.code ?? ""} ${e4b.status}`);
  const e5 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 2, name: newName });
  check("§7 değişiklik yok → 200, sürüm artmaz", e5.status === 200 && e5.data?.version === 2 && (await prisma.senderTemplate.findUnique({ where: { code }, select: { version: true } }))?.version === 2, `${e5.status} ${String(e5.data?.version)}`);
  const e6 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, tk, { expectedVersion: 2, rules: { multiParty: null } });
  const tpl6 = (await prisma.senderTemplate.findUnique({ where: { code }, select: { template: true } }))?.template as { rules?: unknown } | undefined;
  check("§7 ⭐ multiParty null → kural kalkar (fabrika ayarı), v3", e6.status === 200 && e6.data?.version === 3 && tpl6 !== undefined && !("rules" in tpl6), `${e6.status} ${e6.code ?? ""} ${JSON.stringify(tpl6?.rules)}`);
  const e7 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}-2/tanim`, tk, { expectedVersion: 1, name: `${TAG} pasif` });
  const e8 = await call("PATCH", `/api/gelen-belge/sablonlar/ozel/${code}/tanim`, otherTk, { expectedVersion: 3, name: `${TAG} izinsiz` });
  check("§7 sıfırlanmış tip 409 USER_TEMPLATE_INACTIVE · izinsiz 403", e7.status === 409 && e7.code === "USER_TEMPLATE_INACTIVE" && e8.status === 403, `${e7.status} ${e7.code ?? ""} ${e8.status}`);
  void url;
}

async function main(): Promise<void> {
  console.log("=== Gelen belge belge tipi sıfırla + düzenle (B2) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
    for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
    await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, null);
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
    const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write"] } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${TAG}-r`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} R`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(u.id);
    await run(url, admin.id, tk, call, await login(u.username, parola));
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
    const swallow = () => undefined;
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
    await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: made.notes } } }).catch(swallow);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
    await prisma.senderTemplateVersion.deleteMany({ where: { senderTemplate: { code: { in: made.codes } } } }).catch(swallow);
    await prisma.senderTemplate.deleteMany({ where: { code: { in: made.codes } } }).catch(swallow);
    await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
    await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
