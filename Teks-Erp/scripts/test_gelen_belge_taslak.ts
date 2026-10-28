// =============================================================================
// GELEN BELGE — D2 taslak uçları bekçisi (HTTP, gerçek DB)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §4 (veri modeli) + §6 D2 satırı. Sınanan:
//   §1 modül kapısı: gelenBelge kapalı → 403 MODULE_DISABLED; ön koşul emanet kapalı → 403 MODULE_DISABLED
//   §2 izin: gelen-belge:read ile yazma 403 · ilgisiz izinle liste 403 · okur liste 200
//   §3 tarama sınırı: 5 MB + 1 bayt → 413 DOCUMENT_SCAN_TOO_LARGE · MZ baytı → 400 DOCUMENT_SCAN_TYPE · bozuk base64 → 400
//   §4 sha256 dedup: aynı fotoğraf ikinci kez → 200 duplicate:true, TEK document_scans satırı
//   §5 taslak: numara DOĞUŞTA `GB` serisinden · tarama bağlanır · satırlar lineNo sıralı
//   §6 liste + cursor + özet TEK where'den: iki sayfa ∪ = kayıtlar, summary.total = sayfa toplamı
//   §7 DRAFT dışı: status DB'den APPROVED'a çekilince DELETE/PATCH/satır ekle → 409 DELIVERY_NOTE_NOT_DRAFT
//   §8 audit yükü: DOCUMENT_SCAN ve CUSTOMER_DELIVERY_NOTE satırlarında fotoğraf baytı / "content" yok
//   §10 yarış: iki PATCH farklı alan → ikisi de korunur (kayıp güncelleme yok) · aynı clientToken iki POST → tek kayıt · aynı parti kimliğiyle iki toplu satır ekleme → satırlar ikilenmez · aynı tarama iki taslak → biri 409
//   §9 DRAFT silme: 200, satırlar Cascade, tarama çözülür (noteId null), top doğmaz (DEFTER-ÖNCELİKLİ)
// Emsal: scripts/test_sertifika.ts (app.listen(0) + ensureTestAdmin + ayar()).
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

// Hedef DB kapısı fail-closed: engel varsa main HİÇ çağrılmaz (process.exit yok — `test_process_exit_kalibi`).
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

const TAG = `GBT${Date.now().toString(36).toUpperCase()}`;
const MB5 = 5 * 1024 * 1024;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} irsaliye fotoğrafı`)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${TAG} png`)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90), Buffer.from(`${TAG} exe`)]);
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], scans: [] as string[] };

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { scan?: Record<string, unknown>; duplicate?: boolean; items?: Array<{ id: string }>; nextCursor?: string | null; summary?: Record<string, number> } };

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function mkCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} cari ${suffix}` }, select: { id: true } });
  made.customers.push(c.id);
  return c.id;
}

const line = (n: number) => ({ senderRollNo: `${TAG}-R${n}`, meters: 100 + n, weightKg: 20 + n, itemText: "Pamuklu", colorText: "Beyaz" });

async function main(): Promise<void> {
  console.log("=== Gelen belge D2 taslak bekçisi ===\n");
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
    const mk = async (suffix: string, perms: string[]) => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola);
    };
    const up = (buf: Buffer, extra: Record<string, unknown> = {}, token = tk) => call("POST", "/api/gelen-belge/taramalar", token, { contentBase64: buf.toString("base64"), ...extra });
    const owner = await mkCustomer("OWN");

    // §1 modül kapısı
    console.log("§1 modül kapısı");
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
    const off = await call("GET", "/api/gelen-belge/irsaliyeler", tk);
    check("gelenBelge kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code}`);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    await ayar(SETTING_KEYS.EMANET_ENABLED, false);
    const offDep = await call("GET", "/api/gelen-belge/irsaliyeler", tk);
    check("ön koşul emanet kapalı → 403 MODULE_DISABLED (gelenBelge açık olsa da)", offDep.status === 403 && offDep.code === "MODULE_DISABLED", `${offDep.status} ${offDep.code}`);
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    check("iki anahtar açık → liste 200", (await call("GET", "/api/gelen-belge/irsaliyeler", tk)).status === 200);

    // §2 izin
    console.log("§2 izin");
    const reader = await mk("okur", ["gelen-belge:read"]);
    const none = await mk("yok", ["roll:read"]);
    check("gelen-belge:read ile liste 200", (await call("GET", "/api/gelen-belge/irsaliyeler", reader)).status === 200);
    check("gelen-belge:read ile taslak açma 403", (await call("POST", "/api/gelen-belge/irsaliyeler", reader, { sourceKind: "MANUAL" })).status === 403);
    check("gelen-belge:read ile tarama yükleme 403", (await up(JPEG, {}, reader)).status === 403);
    check("ilgisiz izinle liste 403", (await call("GET", "/api/gelen-belge/irsaliyeler", none)).status === 403);

    // §3 tarama sınırı
    console.log("§3 tarama sınırı");
    const big = await up(Buffer.concat([JPEG, Buffer.alloc(MB5 + 1 - JPEG.length, 0x20)]));
    check("⭐ 5 MB + 1 bayt → 413 DOCUMENT_SCAN_TOO_LARGE", big.status === 413 && big.code === "DOCUMENT_SCAN_TOO_LARGE", `${big.status} ${big.code}`);
    const exe = await up(EXE);
    check("MZ baytı → 400 DOCUMENT_SCAN_TYPE", exe.status === 400 && exe.code === "DOCUMENT_SCAN_TYPE", `${exe.status} ${exe.code}`);
    const bad = await call("POST", "/api/gelen-belge/taramalar", tk, { contentBase64: "%%%bozuk" });
    check("bozuk base64 → 400 DOCUMENT_SCAN_INVALID", bad.status === 400 && bad.code === "DOCUMENT_SCAN_INVALID", `${bad.status} ${bad.code}`);
    const strict = await call("POST", "/api/gelen-belge/taramalar", tk, { contentBase64: JPEG.toString("base64"), bogus: 1 });
    check("strict gövde: tanınmayan alan → 400", strict.status === 400, `${strict.status}`);

    // §4 sha256 dedup
    console.log("§4 sha256 dedup");
    const first = await up(JPEG, { barcodeText: `${TAG}-BC` });
    const scanId = String(first.data?.scan?.id ?? "");
    if (scanId) made.scans.push(scanId);
    check("JPEG → 201, tür sihirli bayttan, yanıtta bayt yok", first.status === 201 && first.data?.scan?.mimeType === "image/jpeg" && first.data?.duplicate === false && !JSON.stringify(first.data).includes("\"content\""), `${first.status} ${first.code ?? ""}`);
    const again = await up(JPEG);
    const sha = String(first.data?.scan?.sha256 ?? "");
    const scanCount = await prisma.documentScan.count({ where: { sha256: sha } });
    check("⭐ aynı fotoğraf → 200 duplicate:true, aynı id, TEK document_scans satırı", again.status === 200 && again.data?.duplicate === true && again.data?.scan?.id === scanId && scanCount === 1, `${again.status} dup=${again.data?.duplicate} satır=${scanCount}`);
    const png = await up(PNG);
    if (png.data?.scan?.id) made.scans.push(String(png.data.scan.id));
    check("farklı içerik → yeni kayıt 201", png.status === 201 && png.data?.scan?.id !== scanId);
    const dl = await fetch(`${url}/api/gelen-belge/taramalar/${scanId}/icerik`, { headers: { Authorization: `Bearer ${tk}` } });
    check("içerik indirme bayt-eşit + image/jpeg", dl.status === 200 && dl.headers.get("content-type") === "image/jpeg" && Buffer.from(await dl.arrayBuffer()).equals(JPEG), `${dl.status} ${dl.headers.get("content-type")}`);

    // §5 taslak doğuşu
    console.log("§5 taslak");
    const created = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} gönderen`, senderDocNo: `${TAG}-1`, scanIds: [scanId], lines: [line(1), line(2)] });
    const noteId = String(created.data?.id ?? "");
    if (noteId) made.notes.push(noteId);
    const noteNo = String(created.data?.noteNo ?? "");
    check("taslak 201 + status DRAFT", created.status === 201 && created.data?.status === "DRAFT", `${created.status} ${created.code ?? ""}`);
    check("⭐ numara doğuşta GB serisinden (GB + DDMMYY + 4 hane)", /^GB\d{6}\d{4}$/.test(noteNo), noteNo);
    const bound = await prisma.documentScan.findUnique({ where: { id: scanId }, select: { noteId: true } });
    check("tarama taslağa bağlandı", bound?.noteId === noteId);
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId }, orderBy: { lineNo: "asc" }, select: { lineNo: true, meters: true } });
    check("2 satır lineNo 1..2, metraj korunur", lines.length === 2 && lines[0]?.lineNo === 1 && lines[1]?.lineNo === 2 && Number(lines[1]?.meters) === 102, JSON.stringify(lines));
    const rebind = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", scanIds: [scanId] });
    check("bağlı taramayla ikinci taslak → 409 DOCUMENT_SCAN_NOT_FREE", rebind.status === 409 && rebind.code === "DOCUMENT_SCAN_NOT_FREE", `${rebind.status} ${rebind.code}`);
    const dupDoc = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", ownerCustomerId: owner, senderDocNo: `${TAG}-1` });
    check("aynı sahip + aynı belge no → 409 (partial unique)", dupDoc.status === 409, `${dupDoc.status} ${dupDoc.code}`);
    const addLine = await call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar`, tk, { lines: [line(3)] });
    check("satır ekleme (toplu) 201/200", addLine.status === 201 || addLine.status === 200, `${addLine.status} ${addLine.code ?? ""}`);
    const zero = await call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar`, tk, { ...line(4), meters: 0 });
    check("metraj 0 → 400 (Türkçe doğrulama)", zero.status === 400, `${zero.status}`);

    // §6 liste + cursor + özet
    console.log("§6 liste + cursor + özet");
    for (const n of [2, 3]) {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "IMPORT", ownerCustomerId: owner, senderDocNo: `${TAG}-${n}` });
      if (r.data?.id) made.notes.push(String(r.data.id));
    }
    const p1 = await call("GET", `/api/gelen-belge/irsaliyeler?ownerCustomerId=${owner}&limit=2`, tk);
    const p2 = await call("GET", `/api/gelen-belge/irsaliyeler?ownerCustomerId=${owner}&limit=2&cursor=${encodeURIComponent(p1.data?.nextCursor ?? "")}`, tk);
    const ids = new Set([...(p1.data?.items ?? []), ...(p2.data?.items ?? [])].map((i) => i.id));
    check("iki sayfa ∪ = 3 ayrı taslak, ikinci sayfada cursor biter", p1.data?.items?.length === 2 && !!p1.data?.nextCursor && p2.data?.items?.length === 1 && p2.data?.nextCursor === null && ids.size === 3, `${p1.data?.items?.length}/${p2.data?.items?.length} ∪${ids.size}`);
    const s = p1.data?.summary ?? {};
    check("özet şeridi aynı where'den: DRAFT=3, total=3 (sayfa boyundan bağımsız)", s.DRAFT === 3 && s.total === 3, JSON.stringify(s));
    const byKind = await call("GET", `/api/gelen-belge/irsaliyeler?ownerCustomerId=${owner}&sourceKind=IMPORT`, tk);
    check("sourceKind süzgeci sunucuda: 2 IMPORT, özet 2", byKind.data?.items?.length === 2 && byKind.data?.summary?.total === 2);
    const bogus = await call("GET", "/api/gelen-belge/irsaliyeler?status=bogus", tk);
    check("tanınmayan durum süzgeci → 400 (fail-closed)", bogus.status === 400, `${bogus.status}`);

    // §7 DRAFT dışı
    console.log("§7 DRAFT dışı");
    const approvedId = made.notes[1]!;
    await prisma.customerDeliveryNote.update({ where: { id: approvedId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: admin.id } });
    const delNo = await call("DELETE", `/api/gelen-belge/irsaliyeler/${approvedId}`, tk);
    check("⭐ APPROVED silme → 409 DELIVERY_NOTE_NOT_DRAFT", delNo.status === 409 && delNo.code === "DELIVERY_NOTE_NOT_DRAFT", `${delNo.status} ${delNo.code}`);
    const patchNo = await call("PATCH", `/api/gelen-belge/irsaliyeler/${approvedId}`, tk, { senderText: "x" });
    check("APPROVED başlık düzeltme → 409", patchNo.status === 409 && patchNo.code === "DELIVERY_NOTE_NOT_DRAFT");
    const lineNo = await call("POST", `/api/gelen-belge/irsaliyeler/${approvedId}/satirlar`, tk, line(9));
    check("APPROVED satır ekleme → 409", lineNo.status === 409 && lineNo.code === "DELIVERY_NOTE_NOT_DRAFT");
    const scanNo = await up(Buffer.concat([PNG, Buffer.from("v2")]), { noteId: approvedId });
    check("APPROVED taslağa tarama → 409", scanNo.status === 409 && scanNo.code === "DELIVERY_NOTE_NOT_DRAFT", `${scanNo.status} ${scanNo.code}`);
    check("kayıt yerinde (409 silmedi)", (await prisma.customerDeliveryNote.count({ where: { id: approvedId } })) === 1);

    // §8 audit yükü
    console.log("§8 audit yükü");
    const logs = await prisma.systemLog.findMany({ where: { tableName: { in: ["DOCUMENT_SCAN", "CUSTOMER_DELIVERY_NOTE"] }, recordId: { in: [scanId, noteId] } }, select: { tableName: true, oldData: true, newData: true } });
    const logText = JSON.stringify(logs);
    check("⭐ audit yükünde fotoğraf baytı / content yok, künye var (sha256 + noteNo)", logs.length >= 2 && !logText.includes(JPEG.toString("base64")) && !logText.includes("\"content\"") && logText.includes("sha256") && logText.includes(noteNo), `${logs.length} satır`);

    // §10 yarış: iki yazar farklı alan → ikisi de korunur; aynı clientToken → tek kayıt; aynı tarama → biri 409
    console.log("§10 yarış");
    const [pA, pB] = await Promise.all([
      call("PATCH", `/api/gelen-belge/irsaliyeler/${noteId}`, tk, { customerBatchNo: `${TAG}-PARTI` }),
      call("PATCH", `/api/gelen-belge/irsaliyeler/${noteId}`, tk, { processText: "Kurşun" }),
    ]);
    const hdr = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { customerBatchNo: true, processText: true, senderText: true } });
    check("⭐ eşzamanlı iki başlık PATCH'i (farklı alan) → ikisi de korunur, üçüncü alan dokunulmadı", pA.status === 200 && pB.status === 200 && hdr?.customerBatchNo === `${TAG}-PARTI` && hdr?.processText === "Kurşun" && hdr?.senderText === `${TAG} gönderen`, JSON.stringify(hdr));
    const l1 = await prisma.customerDeliveryNoteLine.findFirst({ where: { noteId, lineNo: 1 }, select: { id: true } });
    const [lA, lB] = await Promise.all([
      call("PATCH", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar/${l1?.id}`, tk, { colorText: "Lacivert" }),
      call("PATCH", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar/${l1?.id}`, tk, { widthCm: 150 }),
    ]);
    const ln = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: l1?.id ?? "" }, select: { colorText: true, widthCm: true, meters: true, senderRollNo: true } });
    check("⭐ eşzamanlı iki satır PATCH'i (farklı alan) → ikisi de korunur, metraj/rulo no dokunulmadı", lA.status === 200 && lB.status === 200 && ln?.colorText === "Lacivert" && Number(ln?.widthCm) === 150 && Number(ln?.meters) === 101 && ln?.senderRollNo === `${TAG}-R1`, JSON.stringify(ln));
    const token = crypto.randomUUID();
    const twin = { clientToken: token, sourceKind: "MANUAL", ownerCustomerId: owner, senderDocNo: `${TAG}-TOKEN` };
    const [cA, cB] = await Promise.all([call("POST", "/api/gelen-belge/irsaliyeler", tk, twin), call("POST", "/api/gelen-belge/irsaliyeler", tk, twin)]);
    const twinId = String(cA.data?.id ?? "");
    if (twinId) made.notes.push(twinId);
    check("⭐ aynı clientToken ile eşzamanlı iki POST → aynı id, TEK satır", cA.status === 201 && cB.status === 201 && cA.data?.id === cB.data?.id && (await prisma.customerDeliveryNote.count({ where: { clientToken: token } })) === 1, `${cA.status}/${cB.status} ${cA.data?.id === cB.data?.id}`);
    const batch = { clientToken: crypto.randomUUID(), lines: [line(21), line(22), line(23)] };
    const [bA, bB] = await Promise.all([
      call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar`, tk, batch),
      call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar`, tk, batch),
    ]);
    const bRows = await prisma.customerDeliveryNoteLine.count({ where: { noteId, clientToken: batch.clientToken } });
    const bIds = (x: Resp) => ((x.data as unknown as Array<{ id: string }> | undefined) ?? []).map((r) => r.id).join(",");
    check("⭐ aynı clientToken ile eşzamanlı iki toplu satır ekleme → 3 satır (ikilenmez), aynı id'ler", bA.status === 201 && bB.status === 201 && bRows === 3 && bIds(bA) === bIds(bB) && bIds(bA).length > 0, `${bA.status}/${bB.status} satır=${bRows}`);
    const bAgain = await call("POST", `/api/gelen-belge/irsaliyeler/${noteId}/satirlar`, tk, batch);
    check("aynı parti kimliği SIRALI üçüncü kez → 201 replay, satır sayısı 3", bAgain.status === 201 && (await prisma.customerDeliveryNoteLine.count({ where: { noteId, clientToken: batch.clientToken } })) === 3);
    const freeScan = await up(Buffer.concat([PNG, Buffer.from("yarış")]));
    const freeId = String(freeScan.data?.scan?.id ?? "");
    if (freeId) made.scans.push(freeId);
    const [sA, sB] = await Promise.all([
      call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", scanIds: [freeId] }),
      call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", scanIds: [freeId] }),
    ]);
    for (const r of [sA, sB]) if (r.data?.id) made.notes.push(String(r.data.id));
    check("⭐ aynı taramayla eşzamanlı iki taslak → biri 201 biri 409 DOCUMENT_SCAN_NOT_FREE", [sA.status, sB.status].sort().join("/") === "201/409" && [sA.code, sB.code].includes("DOCUMENT_SCAN_NOT_FREE"), `${sA.status}/${sB.status}`);

    // §9 DRAFT silme
    console.log("§9 DRAFT silme");
    const rollsBefore = await prisma.roll.count();
    const del = await call("DELETE", `/api/gelen-belge/irsaliyeler/${noteId}`, tk);
    check("DRAFT silme 200", del.status === 200, `${del.status} ${del.code ?? ""}`);
    check("satırlar Cascade ile gitti, tarama çözüldü (noteId null) ama silinmedi", (await prisma.customerDeliveryNoteLine.count({ where: { noteId } })) === 0 && (await prisma.documentScan.findUnique({ where: { id: scanId }, select: { noteId: true } }))?.noteId === null);
    check("taslak top doğurmaz (roll sayısı değişmedi)", (await prisma.roll.count()) === rollsBefore);
    check("silinen taslak → 404", (await call("GET", `/api/gelen-belge/irsaliyeler/${noteId}`, tk)).status === 404);
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
