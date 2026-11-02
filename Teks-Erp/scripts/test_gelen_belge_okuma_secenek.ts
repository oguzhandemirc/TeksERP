// =============================================================================
// GELEN BELGE — okuma seçenekleri bekçisi (S3b şablondan gönderen · S5 tablosuz fişte metre kaynağı; sahte sidecar, gerçek DB)
// =============================================================================
// Kaynak: tasarım notu KURSUN-ONCELIKLI-OCR-TASARIM-2026-11-02 §7 S3(b)/S5. İki fabrika ayarı, tek yazar `PUT /ayarlar`:
//   §1 ayar ucu: varsayılanlar (OUTPUT · false = bugünkü), geçersiz değer 400, ham ayar ucu iki anahtara 400 SETTING_KEY_RESERVED
//   §2 S5: okuma katmanı (`buildDraft`) ayarı okur — OUTPUT 200 m / 36 kg (bugünkü), INPUT 198,1 m / 35,7 kg
//   §3 S3b: ayar KAPALI → şablonun gönderen carisi bağlı olsa da gönderen DOLMAZ (bugünkü); AÇIK → yeni taslak gönderen =
//      şablonun carisi + audit künyesi; bağlı taslakta operatörün göndereni EZİLMEZ, boşsa dolar; pasif şablon / pasif cari → dolmaz;
//      sahip hiçbir durumda dolmaz
// NEGATİF SONDA (2026-11-02): `templateSender` ayar okuması kapatılınca (hep açık) §3a düşer; `fillEmptyHeader` boşluk koşulu
//   kaldırılınca §3d düşer; pasif cari koşulu kaldırılınca §3f düşer; `buildDraft` metre kaynağı geçirilmeyince §2b düşer.
// Emsal: scripts/test_gelen_belge_yeniden_oku.ts (sahte sidecar + app.listen(0) + ensureTestAdmin).
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { __resetDocumentReaderForTests, runReaderOnce } from "../src/jobs/gelen-belge-okuma.job";
import { splitRegions, type OcrResult } from "../src/lib/gelen-belge/motor";
import { buildDraft } from "../src/services/gelen-belge-taslak-doldur.service";

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

const TAG = `GBS${Date.now().toString(36).toUpperCase()}`;
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const fixtureOf = (no: string): unknown => JSON.parse(readFileSync(join(FIKSTUR, readdirSync(FIKSTUR).find((f) => f.startsWith(no))!), "utf8"));
const jpeg = (no: string, salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} FIX:${no} ${salt}`)]);
const TPL = "ceki-listesi-a"; // 0245 fikstürünün şablonu
const made = { customers: [] as string[], notes: [] as string[], scans: [] as string[] };
type Resp = { status: number; code?: string; data?: Record<string, unknown> & { scan?: { id: string }; id?: string } };

async function ayar(key: string, v: boolean | string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

function startFakeSidecar(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", engine: "sahte-paddle", version: "0.0-test" }));
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
      const m = /FIX:(\d{4})/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
      if (!m) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(fixtureOf(m[1]!)));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

type Call = (method: string, path: string, body?: unknown) => Promise<Resp>;

async function section1(call: Call): Promise<void> {
  console.log("§1 ayar ucu");
  const g = (await call("GET", "/api/gelen-belge/ayarlar")).data as { headerLineMeterSource?: string; defaultHeaderLineMeterSource?: string; autoSenderFromTemplate?: boolean };
  check("§1a varsayılanlar: metre kaynağı OUTPUT, şablondan gönderen false (bugünkü)", g.headerLineMeterSource === "OUTPUT" && g.defaultHeaderLineMeterSource === "OUTPUT" && g.autoSenderFromTemplate === false, JSON.stringify(g));
  const bad = await Promise.all([{ headerLineMeterSource: "GIRIS" }, { autoSenderFromTemplate: "evet" }].map((b) => call("PUT", "/api/gelen-belge/ayarlar", b)));
  check("§1b geçersiz değer 400", bad.every((r) => r.status === 400), bad.map((r) => r.status).join(","));
  const okW = await call("PUT", "/api/gelen-belge/ayarlar", { headerLineMeterSource: "INPUT", autoSenderFromTemplate: true });
  const d = okW.data as { headerLineMeterSource?: string; autoSenderFromTemplate?: boolean };
  check("§1c yazılır, geri okunur", okW.status === 200 && d.headerLineMeterSource === "INPUT" && d.autoSenderFromTemplate === true, `${okW.status} ${JSON.stringify(d)}`);
  await ayar(SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, "çöp");
  check("§1d çöp kayıt varsayılana (OUTPUT) düşer", ((await call("GET", "/api/gelen-belge/ayarlar")).data as { headerLineMeterSource?: string }).headerLineMeterSource === "OUTPUT");
  const raws = await Promise.all([SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, SETTING_KEYS.GELEN_BELGE_AUTO_SENDER].map((k) => call("PUT", `/api/admin/settings/${k}`, { value: "INPUT" })));
  check("§1e ham ayar ucu iki anahtarı da yazamaz (400 SETTING_KEY_RESERVED)", raws.every((r) => r.status === 400 && r.code === "SETTING_KEY_RESERVED"), raws.map((r) => `${r.status} ${r.code}`).join(","));
  await call("PUT", "/api/gelen-belge/ayarlar", { headerLineMeterSource: "OUTPUT", autoSenderFromTemplate: false });
}

async function section2(): Promise<void> {
  console.log("§2 S5 tablosuz sevk fişi metre kaynağı (okuma katmanı ayarı okur)");
  const alt = splitRegions(fixtureOf("0246") as OcrResult)[1]!.ocr;
  const mv = async () => (await buildDraft(alt, undefined, { bumpHit: false })).draft.lines.map((l) => `${l.meters}/${l.weightKg}`);
  const out = await mv();
  check("§2a OUTPUT (varsayılan) → çıkış toplamı 200 m / 36 kg", JSON.stringify(out) === JSON.stringify(["200/36"]), JSON.stringify(out));
  await ayar(SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, "INPUT");
  const inp = await mv();
  check("§2b ⭐ INPUT → giriş toplamı 198,1 m / 35,7 kg", JSON.stringify(inp) === JSON.stringify(["198.1/35.7"]), JSON.stringify(inp));
  await ayar(SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, "OUTPUT");
}

async function main(): Promise<void> {
  console.log("=== Gelen belge okuma seçenekleri bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, SETTING_KEYS.GELEN_BELGE_AUTO_SENDER];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const tplPrior = await prisma.senderTemplate.findMany({ select: { id: true, code: true, isActive: true, senderCustomerId: true, hitCount: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sidecar = await startFakeSidecar();
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    setReaderUrlForTests(sidecar.url);
    __resetDocumentReaderForTests();
    const r0 = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await r0.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call: Call = async (method, path, body) => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    await section1(call);
    await section2();

    // ── §3 S3b şablondan gönderen ──────────────────────────────────────────
    console.log("§3 S3b şablonun gönderen carisi");
    const mkC = async (name: string) => {
      const c = await prisma.customer.create({ data: { code: `${TAG}-${made.customers.length}`, name: `${TAG} ${name}` }, select: { id: true } });
      made.customers.push(c.id);
      return c.id;
    };
    const boya = await mkC("Boyahane");
    const elle = await mkC("Elle Seçilen Gönderen");
    const tpl = await call("PATCH", `/api/gelen-belge/sablonlar/${TPL}`, { senderCustomerId: boya, isActive: true });
    check("§3 hazırlık: şablon gönderen carisine bağlandı", tpl.status === 200, `${tpl.status} ${tpl.code}`);
    let n = 0;
    const readNew = async (): Promise<{ id: string; senderCustomerId: string | null; ownerCustomerId: string | null }> => {
      const r = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: jpeg("0245", `yeni-${n++}`).toString("base64") });
      const sid = r.data?.scan?.id ?? "";
      if (sid) made.scans.push(sid);
      await runReaderOnce();
      const noteId = (await prisma.documentScan.findUniqueOrThrow({ where: { id: sid }, select: { noteId: true } })).noteId ?? "";
      if (noteId) made.notes.push(noteId);
      const row = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { senderCustomerId: true, ownerCustomerId: true } });
      return { id: noteId, ...row };
    };
    const off = await readNew();
    check("§3a ayar KAPALI (varsayılan): şablon bağlı olsa da gönderen dolmaz (bugünkü)", off.senderCustomerId === null && off.ownerCustomerId === null, JSON.stringify(off));
    await ayar(SETTING_KEYS.GELEN_BELGE_AUTO_SENDER, true);
    const on = await readNew();
    const created = await prisma.systemLog.findFirst({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: on.id, action: "CREATE" }, select: { newData: true } });
    const cnd = (created?.newData ?? {}) as Record<string, unknown>;
    check("§3b ⭐ ayar AÇIK: yeni taslağın göndereni = şablonun carisi; sahip yine boş", on.senderCustomerId === boya && on.ownerCustomerId === null, JSON.stringify(on));
    check("§3c audit künyesi gönderen + kaynak TEMPLATE taşır", cnd.senderCustomerId === boya && cnd.senderFrom === "TEMPLATE", JSON.stringify(cnd));
    // Bağlı taslak: operatörün göndereni ezilmez, boş gönderen dolar.
    const mkDraft = async (extra: Record<string, unknown>) => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-${n++}`, ...extra });
      const id = (r.data?.id as string) ?? "";
      if (id) made.notes.push(id);
      return id;
    };
    const bound = async (noteId: string) => {
      const r = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: jpeg("0245", `bagli-${n++}`).toString("base64"), noteId });
      const sid = r.data?.scan?.id ?? "";
      if (sid) made.scans.push(sid);
      await runReaderOnce();
      return (await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { senderCustomerId: true } })).senderCustomerId;
    };
    const withSender = await mkDraft({ senderCustomerId: elle });
    check("§3d bağlı taslakta operatörün seçtiği gönderen EZİLMEZ", (await bound(withSender)) === elle);
    const empty = await mkDraft({});
    const filled = await bound(empty);
    const upd = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: empty, action: "UPDATE" }, select: { newData: true } });
    check("§3e bağlı taslakta boş gönderen şablondan dolar + audit künyesi", filled === boya && upd.some((u) => (u.newData as Record<string, unknown> | null)?.senderFrom === "TEMPLATE"), String(filled));
    await call("PATCH", `/api/gelen-belge/sablonlar/${TPL}`, { isActive: true });
    await prisma.customer.update({ where: { id: boya }, data: { isActive: false } });
    const pasifC = await readNew();
    await prisma.customer.update({ where: { id: boya }, data: { isActive: true } });
    check("§3f pasif gönderen cari → dolmaz", pasifC.senderCustomerId === null, JSON.stringify(pasifC));
    await call("PATCH", `/api/gelen-belge/sablonlar/${TPL}`, { isActive: false });
    const pasifT = await readNew();
    check("§3g pasif şablon → dolmaz", pasifT.senderCustomerId === null, JSON.stringify(pasifT));
  } finally {
    stopNotificationJobs();
    __resetDocumentReaderForTests();
    setReaderUrlForTests(null);
    await new Promise<void>((r) => sidecar.server.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as object } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.documentScan.updateMany({ where: { id: { in: made.scans } }, data: { noteId: null } });
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
    await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } });
    for (const t of tplPrior) await prisma.senderTemplate.updateMany({ where: { id: t.id }, data: { isActive: t.isActive, senderCustomerId: t.senderCustomerId, hitCount: t.hitCount } });
    const priorIds = tplPrior.map((t) => t.id);
    await prisma.senderTemplate.deleteMany({ where: priorIds.length ? { id: { notIn: priorIds } } : {} });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.notes, ...made.scans] } } });
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
