// =============================================================================
// GELEN BELGE — okunmuş sayfanın yeniden kullanımı + "Yeniden oku" + fotoğraf kaynağı (sahte loopback sidecar, gerçek DB)
// =============================================================================
// Kanıt: Gülkesim demo 2026-11-02 (GB0211260012): silinen taslağın fotoğrafı yeniden yüklenince tarama READ hâliyle yeni
// taslağa bağlanıyor, satır üretmiyordu; "Okut" 409 — çıkışsız kapı. Panel/tablet yükleme taslağı MANUAL açtığı için "Kaynak: Elle".
//   §1 ⭐ silinen taslağın okunmuş fotoğrafı yeni taslağa yüklenir → satırlar SAKLI ZARFTAN kurulur (sidecar isabeti 0),
//      boş başlık dolar, satırlar o taramayı taşır, yanıt `restored` REBUILT, audit `OCR_STORED` ham OCR taşımaz
//   §2 satırı taslakta olan okunmuş sayfa yeniden okunmaz → 409 DOCUMENT_SCAN_ALREADY_READ
//   §3 ⭐ eski sürümün bıraktığı boş taslak (okunmuş sayfa bağlı, satır yok): okuma özeti yeniden okutmayı söyler; okut → 202
//      PENDING/0, okuma işi 21 satırı ekler; ikinci okut 409
//   §4 ⭐ eşzamanlı iki okut → tek geçiş, satırlar İKİLENMEZ (21), sidecar tek isabet
//   §5 serbest okunmuş tarama okut → 409 ALREADY_READ · bağlı taslak DRAFT değil → 409 DELIVERY_NOTE_NOT_DRAFT · yalnız read → 403
//   §6 elle satırlı taslağa yeniden bağlama satır eklemez (elle iş ezilmez), kaynak MANUAL kalır
//   §7 zarfı olmayan okunmuş tarama → aynı tx'te PENDING/0 (REQUEUED), okuma işi satırları yazar
//   §8 POST /irsaliyeler `scanIds` ile okunmuş serbest tarama → satırlar zarftan, kaynak OCR
//   §9 ⭐ kaynak: fotoğraf bağlanan satırsız MANUAL taslak → OCR (okuma beklemeden); PDF bağlanan → MANUAL; liste süzgeci
//      `sourceKind=OCR` sunucuda bulur
// Emsal: scripts/test_gelen_belge_okuma.ts (sahte sidecar + app.listen(0)).
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { __resetDocumentReaderForTests, runReaderOnce } from "../src/jobs/gelen-belge-okuma.job";

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

const TAG = `GBY${Date.now().toString(36).toUpperCase()}`;
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const fixtureOf = (no: string): unknown => JSON.parse(readFileSync(join(FIKSTUR, readdirSync(FIKSTUR).find((f) => f.startsWith(no))!), "utf8"));
const jpeg = (no: string, salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} FIX:${no} ${salt}`)]);
const PDF = (salt: string) => Buffer.from(`%PDF-1.4\n% ${TAG} ${salt}\n%%EOF\n`);
const made = { users: [] as string[], notes: [] as string[], scans: [] as string[] };
type Restored = { scanId: string; mode: "REBUILT" | "REQUEUED"; lines?: number };
type Resp = { status: number; code?: string; details?: Record<string, unknown>; data?: Record<string, unknown> & { scan?: { id: string; status: string }; id?: string; restored?: Restored[]; boundTo?: string | null; duplicate?: boolean } };

async function ayar(key: string, v: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

const fake = { hits: 0, delayMs: 0 };
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
      fake.hits++;
      setTimeout(() => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
        const m = /FIX:(\d{4})/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
        if (!m) { res.writeHead(400); res.end(); return; }
        res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
        res.end(JSON.stringify(fixtureOf(m[1]!)));
      }, fake.delayMs);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge yeniden kullanım / yeniden oku / kaynak bekçisi ===\n");
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const tplPrior = await prisma.senderTemplate.findMany({ select: { id: true, hitCount: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sidecar = await startFakeSidecar();
  const rollsBefore = await prisma.roll.count();
  try {
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    setReaderUrlForTests(sidecar.url);
    __resetDocumentReaderForTests();
    const login = async (username: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const callAs = async (token: string, method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: Record<string, unknown> & { code?: string } };
      return { status: r.status, code: j.details?.code, details: j.details, data: j.data };
    };
    const tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
    const call = (method: string, path: string, body?: unknown) => callAs(tk, method, path, body);
    const up = async (bytes: Buffer, extra: Record<string, unknown> = {}): Promise<Resp> => {
      const r = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: bytes.toString("base64"), ...extra });
      const id = r.data?.scan?.id;
      if (id && !made.scans.includes(id)) made.scans.push(id);
      return r;
    };
    const newNote = async (suffix: string, extra: Record<string, unknown> = {}): Promise<string> => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-${suffix}`, ...extra });
      const id = r.data?.id as string;
      if (id) made.notes.push(id);
      return id;
    };
    const scanRow = (id: string) => prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, noteId: true } });
    const noteRow = (id: string) => prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id }, select: { sourceKind: true, ownerText: true, customerBatchNo: true, senderDocNo: true, totalsDeclared: true, lines: { select: { scanId: true, meters: true, ocrRaw: true } } } });
    const okut = (scanId: string, token = tk) => callAs(token, "POST", `/api/gelen-belge/taramalar/${scanId}/oku`);
    const del = (noteId: string) => call("DELETE", `/api/gelen-belge/irsaliyeler/${noteId}`);

    // ── §1 silinen taslağın fotoğrafı yeniden yüklenir ─────────────────────────
    const b45 = jpeg("0245", "s1");
    const u1 = await up(b45);
    const s45 = u1.data?.scan?.id ?? "";
    await runReaderOnce();
    const first = await scanRow(s45);
    const noteA = first.noteId ?? "";
    if (noteA) made.notes.push(noteA);
    check("§1a ön koşul: ilk okuma 21 satırlı OCR taslağı doğurur (sidecar 1 isabet)", first.status === "READ" && !!noteA && (await noteRow(noteA)).lines.length === 21 && fake.hits === 1, `${first.status} ${fake.hits}`);
    const dA = await del(noteA);
    const freed = await scanRow(s45);
    check("§1b ön koşul: taslak silinince tarama serbest + READ kalır", dA.status === 200 && freed.noteId === null && freed.status === "READ", JSON.stringify(freed));
    const noteB = await newNote("B");
    const hitsBefore = fake.hits;
    const u1b = await up(b45, { noteId: noteB, pageNo: 1 });
    const nB = await noteRow(noteB);
    const rb = u1b.data?.restored ?? [];
    check("§1c ⭐ aynı fotoğraf yeni taslağa: 200 duplicate, boundTo yeni taslak, restored REBUILT 21", u1b.status === 200 && u1b.data?.duplicate === true && u1b.data?.boundTo === noteB && rb.length === 1 && rb[0]!.mode === "REBUILT" && rb[0]!.lines === 21, JSON.stringify({ s: u1b.status, rb }));
    check("§1d ⭐ satırlar saklı zarftan: 21 satır, hepsi bu taramayı taşır, sidecar isabeti YOK", nB.lines.length === 21 && nB.lines.every((l) => l.scanId === s45 && l.ocrRaw !== null) && fake.hits === hitsBefore, `${nB.lines.length} hits ${hitsBefore}→${fake.hits}`);
    const blocksB = (nB.totalsDeclared as { blocks?: unknown[] } | null)?.blocks ?? [];
    check("§1e boş başlık dolar, operatörün yazdığı korunur; blok beyanı gelir; kaynak OCR; tarama READ", nB.senderDocNo === `${TAG}-B` && nB.ownerText === "ÖRNEK TEKSTİL A" && nB.customerBatchNo === "P9918733" && blocksB.length === 2 && nB.sourceKind === "OCR" && (await scanRow(s45)).status === "READ", JSON.stringify({ o: nB.ownerText, p: nB.customerBatchNo, b: blocksB.length, k: nB.sourceKind }));
    const logs = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: noteB }, select: { newData: true } });
    const stored = logs.map((l) => JSON.stringify(l.newData)).filter((t) => t.includes("OCR_STORED"));
    check("§1f audit `OCR_STORED` künye (satır sayısı) — ham OCR/blok/metin yok", stored.length === 1 && stored[0]!.includes("\"lineCount\":21") && !stored[0]!.includes("blocks") && !stored[0]!.includes("\"text\""), stored.join(" | "));

    // ── §2 satırı olan sayfa yeniden okunmaz ───────────────────────────────────
    const o2 = await okut(s45);
    check("§2 satırı taslakta olan okunmuş sayfa → 409 DOCUMENT_SCAN_ALREADY_READ (satır ikilenmez)", o2.status === 409 && o2.code === "DOCUMENT_SCAN_ALREADY_READ" && (await noteRow(noteB)).lines.length === 21 && (await scanRow(s45)).status === "READ", `${o2.status} ${o2.code}`);

    // ── §3 eski sürümün boş taslağı: "Yeniden oku" çıkış yolu ───────────────────
    // Eski sürüm: okunmuş tarama satırsız bağlanırdı — durum DB'den kurulur (bağlı, READ, 0 satır).
    await del(noteB);
    const noteC = await newNote("C");
    await prisma.documentScan.update({ where: { id: s45 }, data: { noteId: noteC } });
    const oz = await call("GET", `/api/gelen-belge/irsaliyeler/${noteC}/okuma-ozeti`);
    check("§3a okuma özeti: READ + 0 satır → neden yeniden okutmayı söyler", oz.data?.state === "READ" && oz.data?.lineCount === 0 && /yeniden okutun/.test(String(oz.data?.reason)), JSON.stringify(oz.data?.reason));
    const o3 = await okut(s45);
    const q3 = await scanRow(s45);
    check("§3b ⭐ okut → 202, tarama PENDING / deneme 0, aynı taslağa bağlı", o3.status === 202 && q3.status === "PENDING" && q3.attempts === 0 && q3.noteId === noteC, `${o3.status} ${o3.code} ${JSON.stringify(q3)}`);
    const h3 = fake.hits;
    await runReaderOnce();
    const nC = await noteRow(noteC);
    check("§3c okuma işi satırları boş taslağa yazar (21) + tarama READ", nC.lines.length === 21 && (await scanRow(s45)).status === "READ" && fake.hits === h3 + 1, `${nC.lines.length}`);
    const o3d = await okut(s45);
    check("§3d satırlar geldikten sonra ikinci okut → 409 ALREADY_READ", o3d.status === 409 && o3d.code === "DOCUMENT_SCAN_ALREADY_READ", `${o3d.status} ${o3d.code}`);

    // ── §4 eşzamanlı iki okut ─────────────────────────────────────────────────
    await del(noteC);
    const noteD = await newNote("D");
    await prisma.documentScan.update({ where: { id: s45 }, data: { noteId: noteD } });
    const [p1, p2] = await Promise.all([okut(s45), okut(s45)]);
    const statuses = [p1.status, p2.status].sort();
    const h4 = fake.hits;
    const r4a = await runReaderOnce();
    const r4b = await runReaderOnce();
    const nD = await noteRow(noteD);
    check("§4 ⭐ eşzamanlı iki okut → en az biri 202, öteki 202 (zaten kuyrukta) ya da 409; okuma TEK, satır 21 (ikilenmez)",
      statuses.includes(202) && statuses.every((s) => s === 202 || s === 409) && nD.lines.length === 21 && fake.hits === h4 + 1 && r4b.outcome === "BOS",
      `${statuses.join(",")} ${p1.code ?? ""}/${p2.code ?? ""} satır ${nD.lines.length} isabet +${fake.hits - h4} ${r4a.outcome}/${r4b.outcome}`);

    // ── §5 kapılar ────────────────────────────────────────────────────────────
    await del(noteD);
    const o5a = await okut(s45);
    check("§5a serbest okunmuş tarama okut → 409 ALREADY_READ (taslak yok)", o5a.status === 409 && o5a.code === "DOCUMENT_SCAN_ALREADY_READ" && (await scanRow(s45)).status === "READ", `${o5a.status} ${o5a.code}`);
    const noteE = await newNote("E");
    await prisma.documentScan.update({ where: { id: s45 }, data: { noteId: noteE } });
    await prisma.customerDeliveryNote.update({ where: { id: noteE }, data: { status: "APPROVING" } });
    const o5b = await okut(s45);
    check("§5b bağlı taslak DRAFT değil → 409 DELIVERY_NOTE_NOT_DRAFT, tarama READ kalır", o5b.status === 409 && o5b.code === "DELIVERY_NOTE_NOT_DRAFT" && (await scanRow(s45)).status === "READ", `${o5b.status} ${o5b.code}`);
    await prisma.customerDeliveryNote.update({ where: { id: noteE }, data: { status: "DRAFT" } });
    const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read"] } }, select: { id: true } });
    const parola = kosumaOzguParola();
    const ro = await prisma.user.create({ data: { username: `${TAG}-ro`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ro`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } }, select: { id: true, username: true } });
    made.users.push(ro.id);
    const roTk = await login(ro.username, parola);
    const o5c = await okut(s45, roTk);
    check("§5c yalnız `gelen-belge:read` → okut 403", o5c.status === 403 && (await scanRow(s45)).status === "READ", `${o5c.status}`);
    await prisma.documentScan.update({ where: { id: s45 }, data: { noteId: null } });

    // ── §6 elle satırlı taslak ezilmez ───────────────────────────────────────
    const noteF = await newNote("F", { lines: [{ senderRollNo: "EL-1", meters: 50 }] });
    const u6 = await up(b45, { noteId: noteF });
    const nF = await noteRow(noteF);
    const r6 = u6.data?.restored ?? [];
    check("§6 elle satırlı taslağa yeniden bağlama: REBUILT 0 satır, elle satır korunur, kaynak MANUAL", u6.status === 200 && r6[0]?.mode === "REBUILT" && r6[0]?.lines === 0 && nF.lines.length === 1 && Number(nF.lines[0]!.meters) === 50 && nF.sourceKind === "MANUAL", JSON.stringify({ r6, l: nF.lines.length, k: nF.sourceKind }));
    await del(noteF);

    // ── §7 zarfsız okunmuş tarama → yeniden okumaya döner ─────────────────────
    await prisma.documentScan.update({ where: { id: s45 }, data: { ocrResult: Prisma.DbNull } });
    const noteG = await newNote("G");
    const u7 = await up(b45, { noteId: noteG });
    const q7 = await scanRow(s45);
    const r7 = u7.data?.restored ?? [];
    check("§7a zarf yok → REQUEUED, tarama PENDING/0 bu taslağa bağlı (fail-closed: boş taslak bırakmaz)", u7.status === 200 && r7[0]?.mode === "REQUEUED" && q7.status === "PENDING" && q7.attempts === 0 && q7.noteId === noteG, JSON.stringify({ r7, q7 }));
    await runReaderOnce();
    check("§7b okuma işi satırları yazar (21), zarf yeniden saklanır", (await noteRow(noteG)).lines.length === 21 && (await prisma.documentScan.findUniqueOrThrow({ where: { id: s45 }, select: { ocrResult: true } })).ocrResult !== null);
    await del(noteG);

    // ── §8 POST /irsaliyeler scanIds ──────────────────────────────────────────
    const c8 = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-H`, scanIds: [s45] });
    const noteH = c8.data?.id as string;
    if (noteH) made.notes.push(noteH);
    const nH = noteH ? await noteRow(noteH) : null;
    check("§8 `scanIds` ile okunmuş serbest tarama → 201, satırlar zarftan (21), kaynak OCR", c8.status === 201 && nH?.lines.length === 21 && nH.sourceKind === "OCR", `${c8.status} ${nH?.lines.length} ${nH?.sourceKind}`);

    // ── §9 kaynak: fotoğrafla açılan taslak ─────────────────────────────────────
    const noteI = await newNote("I");
    const u9 = await up(jpeg("0244", "s9"), { noteId: noteI });
    check("§9a ⭐ satırsız MANUAL taslağa fotoğraf → kaynak OCR, okuma beklemeden (tarama PENDING)", u9.status === 201 && u9.data?.scan?.status === "PENDING" && (await noteRow(noteI)).sourceKind === "OCR", `${u9.status} ${(await noteRow(noteI)).sourceKind}`);
    const noteJ = await newNote("J");
    const u9b = await up(PDF("s9"), { noteId: noteJ });
    check("§9b PDF bağlanan taslak MANUAL kalır (PDF okunmaz, satırlar elle)", u9b.status === 201 && (await noteRow(noteJ)).sourceKind === "MANUAL", `${u9b.status} ${(await noteRow(noteJ)).sourceKind}`);
    const lst = await call("GET", `/api/gelen-belge/irsaliyeler?sourceKind=OCR&q=${encodeURIComponent(`${TAG}-`)}&limit=200`);
    const items = ((lst.data as { items?: Array<{ id: string }> } | undefined)?.items ?? []).map((i) => i.id);
    check("§9c liste süzgeci sourceKind=OCR sunucuda: fotoğraflı taslak VAR, PDF'li taslak YOK", lst.status === 200 && items.includes(noteI) && !items.includes(noteJ), `${lst.status} ${items.length}`);
    const s9logs = await prisma.systemLog.findMany({ where: { tableName: "CUSTOMER_DELIVERY_NOTE", recordId: noteI }, select: { newData: true } });
    check("§9d kaynak geçişi audit'e düşer (PHOTO_BOUND)", s9logs.some((l) => JSON.stringify(l.newData).includes("PHOTO_BOUND")));
    check("§9e roll sayısı değişmedi (taslak deftere yazmaz)", (await prisma.roll.count()) === rollsBefore);
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
    // Şablon isabet sayaçları birebir geri; bu koşumun doğurduğu şablon satırı silinir.
    for (const t of tplPrior) await prisma.senderTemplate.updateMany({ where: { id: t.id }, data: { hitCount: t.hitCount } });
    const born = await prisma.senderTemplate.findMany({ where: { id: { notIn: [...tplPrior.map((t) => t.id), "00000000-0000-4000-8000-000000000000"] } }, select: { id: true } });
    for (const b of born) await prisma.senderTemplate.delete({ where: { id: b.id } }).catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

if (!engel) {
  main()
    .catch((e) => { console.error("❌ beklenmeyen hata:", e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
