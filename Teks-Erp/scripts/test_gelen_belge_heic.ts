// =============================================================================
// GELEN BELGE — HEIC/HEIF yükleme bekçisi (sahte loopback okuma servisi `POST /donustur`, gerçek DB, HTTP)
// =============================================================================
// Karar 2026-11-02 (kullanıcı, şıklı): HEIC okuma servisinde pi-heif ile JPEG'e çevrilir, SİSTEM JPEG SAKLAR.
//   §1 `isHeic` sihirli bayt: ftyp heic/heix/mif1/msf1 → HEIC · avif/isom/JPEG/kısa → değil (MIME/uzantı okunmaz)
//   §2 ⭐ FAIL-CLOSED servis adresi yok → 503 HEIC_CONVERT_UNAVAILABLE, tarama satırı YAZILMAZ, okumaya istek yok
//   §3 ⭐ HEIC → 201 `image/jpeg`, saklanan içerik = servisin JPEG'i, sha256 JPEG'in, taslağa bağlı; audit künyesi
//      `convertedFrom` taşır, baytsız
//   §4 aynı HEIC ikinci kez → 200 duplicate (dönüşüm belirlenimli → aynı JPEG özeti), satır tek
//   §5 istemci sha256'sı GELEN baytındır: HEIC özeti → 201; yanlış özet → 400 MISMATCH ve okumaya gidilmez
//   §6 ⭐ servis 5xx / 404 (eski sürüm) / kapalı port / şema dışı / JPEG olmayan çıktı → 503, satır yazılmaz
//   §7 servis 415/400 → 400 HEIC_CONVERT_FAILED · servis 413 → 413 DOCUMENT_SCAN_TOO_LARGE
//   §8 ⭐ dönüşen JPEG 5 MB'ı aşarsa → 413 (tavan dönüşümden sonra da), satır yazılmaz
//   §9 ftyp avif → 400 DOCUMENT_SCAN_TYPE, okumaya gitmez · JPEG/PNG yolu okumaya hiç gitmez
//   §10 İSTEĞE BAĞLI `OKUMA_GERCEK_URL`: gerçek okuma + `okuma/tests/fikstur/belge-duz.heic` → 201 JPEG
// Emsal: scripts/test_gelen_belge_okuma.ts (sahte sidecar) · test_gelen_belge_taslak.ts (HTTP + temizlik).
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { isHeic } from "../src/lib/gelen-belge/heic";

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

const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const TAG = `GBH${Date.now().toString(36).toUpperCase()}`;
const MB5 = 5 * 1024 * 1024;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const ftyp = (brand: string, salt: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(12, 0), Buffer.from(`${TAG} ${salt}`)]);
/** Sahte servisin çıktısı: girdinin özetine bağlı, belirlenimli JPEG baytı. */
const fakeJpegOf = (input: Buffer) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} JPEG ${sha(input)}`)]);

type Mode = "ok" | "500" | "404" | "415" | "413" | "invalid" | "notjpeg" | "big";
const fake = { mode: "ok" as Mode, hits: 0 };
function startFakeReader(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/donustur") { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      fake.hits++;
      const input = Buffer.from((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string }).imageBase64, "base64");
      const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (fake.mode === "500") return send(500, { code: "CONVERT_FAILED" });
      if (fake.mode === "404") return send(404, { detail: "Not Found" });
      if (fake.mode === "415") return send(415, { code: "UNSUPPORTED_IMAGE" });
      if (fake.mode === "413") return send(413, { code: "IMAGE_TOO_LARGE" });
      if (fake.mode === "invalid") return send(200, { imageBase64: "eA==", mimeType: "image/png", width: 1, height: 1 });
      const out = fake.mode === "notjpeg" ? Buffer.from(`${TAG} değil-jpeg`) : fake.mode === "big" ? Buffer.concat([fakeJpegOf(input), Buffer.alloc(MB5, 0x41)]) : fakeJpegOf(input);
      return send(200, { imageBase64: out.toString("base64"), mimeType: "image/jpeg", width: 240, height: 120 });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

const made = { notes: [] as string[], shas: [] as string[] };
type Resp = { status: number; code?: string; data?: { scan?: { id: string; mimeType: string; sha256: string; sizeBytes: number; noteId: string | null }; duplicate?: boolean; id?: string } };

async function main(): Promise<void> {
  console.log("=== Gelen belge HEIC yükleme bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const reader = await startFakeReader();
  // Kapalı port: dinleyip hemen kapatılan sunucunun adresi.
  const closed = await new Promise<string>((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(`http://127.0.0.1:${p}`)); }); });
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const up = (buf: Buffer, extra: Record<string, unknown> = {}) => call("POST", "/api/gelen-belge/taramalar", { contentBase64: buf.toString("base64"), ...extra });
    const scanCount = () => prisma.documentScan.count({ where: { capturedById: admin.id } });
    const note = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-N1` });
    const noteId = String(note.data?.id ?? "");
    if (noteId) made.notes.push(noteId);
    check("taslak açıldı", note.status === 201 && noteId !== "", `${note.status}`);

    // §1 sihirli bayt
    console.log("§1 isHeic");
    for (const b of ["heic", "heix", "mif1", "msf1"]) check(`§1 ftyp ${b} → HEIC`, isHeic(ftyp(b, "x")));
    check("§1 ftyp avif → değil", !isHeic(ftyp("avif", "x")));
    check("§1 ftyp isom (mp4) → değil", !isHeic(ftyp("isom", "x")));
    check("§1 JPEG baytı → değil", !isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])));
    check("§1 11 bayt → değil", !isHeic(ftyp("heic", "").subarray(0, 11)));

    // §2 servis yok
    console.log("§2 servis adresi yok");
    setReaderUrlForTests(null);
    const before2 = await scanCount();
    const h2 = ftyp("heic", "s2");
    const r2 = await up(h2, { noteId, pageNo: 1 });
    check("⭐ §2 adres yok → 503 HEIC_CONVERT_UNAVAILABLE", r2.status === 503 && r2.code === "HEIC_CONVERT_UNAVAILABLE", `${r2.status} ${r2.code}`);
    check("⭐ §2 tarama satırı yazılmadı, okumaya istek yok", (await scanCount()) === before2 && fake.hits === 0);

    // §3 mutlu yol
    console.log("§3 HEIC → JPEG saklanır");
    setReaderUrlForTests(reader.url);
    const h3 = ftyp("heic", "s3");
    const j3 = fakeJpegOf(h3);
    made.shas.push(sha(j3));
    const r3 = await up(h3, { noteId, pageNo: 1 });
    const s3 = r3.data?.scan;
    check("⭐ §3 HEIC → 201 image/jpeg", r3.status === 201 && s3?.mimeType === "image/jpeg", `${r3.status} ${r3.code ?? ""} ${s3?.mimeType}`);
    check("§3 sha256 + boy dönüşen JPEG'in", s3?.sha256 === sha(j3) && s3?.sizeBytes === j3.length, `${s3?.sizeBytes}`);
    check("§3 taslağa bağlı", s3?.noteId === noteId);
    const content = s3 ? await fetch(`${url}/api/gelen-belge/taramalar/${s3.id}/icerik`, { headers: { Authorization: `Bearer ${tk}` } }) : null;
    const bytes = content ? Buffer.from(await content.arrayBuffer()) : Buffer.alloc(0);
    check("⭐ §3 indirilen içerik = servisin JPEG'i (HEIC saklanmaz), Content-Type image/jpeg", bytes.equals(j3) && content?.headers.get("content-type")?.startsWith("image/jpeg") === true);
    const audit = s3 ? await prisma.systemLog.findFirst({ where: { tableName: "DOCUMENT_SCAN", recordId: s3.id, action: "CREATE" }, select: { newData: true } }) : null;
    const auditText = JSON.stringify(audit?.newData ?? {});
    check("§3 audit künyesi convertedFrom image/heic + kaynak boyu, bayt yok", auditText.includes('"convertedFrom":"image/heic"') && auditText.includes(`"sourceSizeBytes":${h3.length}`) && !auditText.includes(h3.toString("base64").slice(0, 24)) && !auditText.includes(j3.toString("base64").slice(0, 24)), auditText.slice(0, 160));

    // §4 tekillik
    console.log("§4 aynı HEIC ikinci kez");
    const c4 = await scanCount();
    const r4 = await up(h3, { noteId });
    check("§4 → 200 duplicate, satır tek", r4.status === 200 && r4.data?.duplicate === true && r4.data?.scan?.id === s3?.id && (await scanCount()) === c4, `${r4.status}`);

    // §5 istemci özeti
    console.log("§5 istemci sha256");
    const h5 = ftyp("heix", "s5");
    made.shas.push(sha(fakeJpegOf(h5)));
    const r5 = await up(h5, { sha256: sha(h5) });
    check("§5 HEIC baytının özeti → 201", r5.status === 201 && r5.data?.scan?.sha256 === sha(fakeJpegOf(h5)), `${r5.status} ${r5.code ?? ""}`);
    const hits5 = fake.hits;
    const r5b = await up(ftyp("heic", "s5b"), { sha256: sha(h5) });
    check("§5 yanlış özet → 400 MISMATCH, okumaya gidilmedi", r5b.status === 400 && r5b.code === "DOCUMENT_SCAN_HASH_MISMATCH" && fake.hits === hits5, `${r5b.status} ${r5b.code}`);

    // §6 servis bozuk → 503
    console.log("§6 servis ulaşılamaz/eski/bozuk → 503");
    for (const [mode, label] of [["500", "5xx"], ["404", "404 eski sürüm"], ["invalid", "şema dışı yanıt"], ["notjpeg", "JPEG olmayan çıktı"]] as const) {
      fake.mode = mode;
      const c = await scanCount();
      const r = await up(ftyp("heic", `s6-${mode}`), { noteId });
      check(`⭐ §6 ${label} → 503 HEIC_CONVERT_UNAVAILABLE, satır yok`, r.status === 503 && r.code === "HEIC_CONVERT_UNAVAILABLE" && (await scanCount()) === c, `${r.status} ${r.code}`);
    }
    fake.mode = "ok";
    setReaderUrlForTests(closed);
    const c6 = await scanCount();
    const r6 = await up(ftyp("heic", "s6-kapali"));
    check("⭐ §6 kapalı port → 503, satır yok", r6.status === 503 && r6.code === "HEIC_CONVERT_UNAVAILABLE" && (await scanCount()) === c6, `${r6.status} ${r6.code}`);
    setReaderUrlForTests(reader.url);

    // §7 kalıcı 4xx
    console.log("§7 servis 4xx");
    fake.mode = "415";
    const r7 = await up(ftyp("heic", "s7"));
    check("§7 415 → 400 HEIC_CONVERT_FAILED", r7.status === 400 && r7.code === "HEIC_CONVERT_FAILED", `${r7.status} ${r7.code}`);
    fake.mode = "413";
    const r7b = await up(ftyp("heic", "s7b"));
    check("§7 413 → 413 DOCUMENT_SCAN_TOO_LARGE", r7b.status === 413 && r7b.code === "DOCUMENT_SCAN_TOO_LARGE", `${r7b.status} ${r7b.code}`);

    // §8 dönüşüm sonrası tavan
    console.log("§8 dönüşüm sonrası 5 MB");
    fake.mode = "big";
    const c8 = await scanCount();
    const r8 = await up(ftyp("heic", "s8"), { noteId });
    check("⭐ §8 dönüşen JPEG > 5 MB → 413, satır yok", r8.status === 413 && r8.code === "DOCUMENT_SCAN_TOO_LARGE" && (await scanCount()) === c8, `${r8.status} ${r8.code}`);
    fake.mode = "ok";

    // §9 HEIC olmayan
    console.log("§9 HEIC olmayan okumaya gitmez");
    const hits9 = fake.hits;
    const r9 = await up(ftyp("avif", "s9"));
    check("§9 ftyp avif → 400 DOCUMENT_SCAN_TYPE, okumaya gitmez", r9.status === 400 && r9.code === "DOCUMENT_SCAN_TYPE" && fake.hits === hits9, `${r9.status} ${r9.code}`);
    const jp = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} düz jpeg`)]);
    made.shas.push(sha(jp));
    const r9b = await up(jp);
    check("§9 JPEG → 201, okumaya gitmez, özet aynı bayt", r9b.status === 201 && r9b.data?.scan?.sha256 === sha(jp) && fake.hits === hits9, `${r9b.status}`);

    // §10 gerçek okuma
    const gercek = process.env.OKUMA_GERCEK_URL?.trim();
    if (gercek) {
      console.log(`§10 gerçek okuma servisi ${gercek}`);
      setReaderUrlForTests(gercek);
      const real = readFileSync(join(__dirname, "..", "..", "okuma", "tests", "fikstur", "belge-duz.heic"));
      const r10 = await up(real, { noteId });
      if (r10.data?.scan?.sha256) made.shas.push(r10.data.scan.sha256);
      check("§10 gerçek HEIC → 201 image/jpeg (200 duplicate da kabul)", (r10.status === 201 || r10.status === 200) && r10.data?.scan?.mimeType === "image/jpeg", `${r10.status} ${r10.code ?? ""}`);
    } else ATLAMA.atla("§10 gerçek okuma servisi", "OKUMA_GERCEK_URL yok (isteğe bağlı koşum)");
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    setReaderUrlForTests(null);
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => reader.server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } }).catch(() => undefined);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.documentScan.deleteMany({ where: { sha256: { in: made.shas } } }).catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
