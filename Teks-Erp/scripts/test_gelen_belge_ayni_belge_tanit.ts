// =============================================================================
// GELEN BELGE — aynı belge üstünde tanıt → yeniden oku (Gülkesim ayarları, sahte loopback sidecar, gerçek DB)
// =============================================================================
// Soru (Gülkesim sabahı 2026-11-04): tablet iş emri formunda hiç görülmemiş belge okutulur (PER_DOCUMENT + SORMA → BLIND),
// aynı belge üstünde rehberli tanıtma yapılır (`POST /sablonlar/oneri` + `/sablonlar/ozel`), tablet `POST /taramalar/:id/oku`
// ile yeniden okutur (`TeachBanner.refill`). GENEL yedek sözlüğün tablosu ilk okumada satır doğurur → bugüne dek 409.
// =============================================================================
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

const TAG = `GBA${Date.now().toString(36).toUpperCase()}`;
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "sentetik");
const FIX = "sevk-irsaliyesi-01-clean";
type Line = { text: string; rect: unknown; elements?: Array<{ text: string; rect: unknown }> };
const ocrFix = JSON.parse(readFileSync(join(FIKSTUR, `${FIX}.ocr.json`), "utf8")) as { blocks: { lines: Line[] }[] };
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} FIX ${salt}`)]);
const made = { notes: [] as string[], scans: [] as string[], templates: [] as string[], items: [] as string[], customers: [] as string[] };
const OWNER_NAME = "ÇINAR DOKUMA SAN. VE TİC. A.Ş.";
type Resp = { status: number; code?: string; data?: Record<string, unknown> & { scan?: { id: string; status: string }; id?: string } };

const fake = { hits: 0 };
function startFakeSidecar(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", engine: "sahte-paddle", version: "0.0-test" }));
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    req.on("data", () => undefined);
    req.on("end", () => {
      fake.hits++;
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(ocrFix));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge aynı belge tanıt → yeniden oku bekçisi ===\n");
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sidecar = await startFakeSidecar();
  // Ayar ucu birden çok anahtar yazar: tablonun tamamı birebir geri yüklenir (yeni anahtar silinir, değişen eski değerine döner).
  const priorSettings = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "mobile" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  let tk = "";
  const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  try {
    for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) {
      await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    }
    setReaderUrlForTests(sidecar.url);
    __resetDocumentReaderForTests();
    tk = await login(admin.username, admin.password);
    check("admin login", tk.length > 0);
    // Fikstürün müşteri satırı; aynı adlı canlı cari varsa o kullanılır.
    const same = await prisma.customer.findMany({ where: { name: OWNER_NAME, isActive: true, mergedIntoId: null }, select: { id: true } });
    let ownerId = same[0]?.id ?? "";
    if (!ownerId) {
      ownerId = (await prisma.customer.create({ data: { code: `TEST-${TAG}-OWN`, name: OWNER_NAME }, select: { id: true } })).id;
      made.customers.push(ownerId);
    }
    // Gülkesim demo ayarları (birebir); PER_DOCUMENT top doğurabilen fabrika varsayılan ürünü ister.
    const item = (await prisma.item.create({ data: { code: `TEST-${TAG}-MM`, name: `TEST ${TAG} Müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    made.items.push(item);
    const gk = await call("PUT", "/api/gelen-belge/ayarlar", {
      defaultItemId: item, entryMode: "PER_DOCUMENT", batchNumberSource: "DOCUMENT", autoWorkOrder: true, autoWorkOrderPatternless: "OPEN",
      formApproval: "WITH_WORK_ORDER", duplicateDocNo: "WARN", stationDocLookup: true, desenRenkEslesme: "ONER", tabletIeGirisi: "BELGE", tanitimGuveni: "SORMA",
    });
    check("Gülkesim ayarları yazıldı", gk.status === 200, `${gk.status} ${gk.code ?? ""}`);

    const linesOf = (noteId: string) => prisma.customerDeliveryNoteLine.findMany({ where: { noteId }, select: { id: true, scanId: true, meters: true }, orderBy: { lineNo: "asc" } });
    const scanRow = (id: string) => prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, noteId: true } });
    const summary = (noteId: string) => call("GET", `/api/gelen-belge/irsaliyeler/${noteId}/okuma-ozeti`);
    const okut = (scanId: string) => call("POST", `/api/gelen-belge/taramalar/${scanId}/oku`);
    /** Tablet sırası (`docScan.submitDocScan`): MANUAL taslak → fotoğraf bu taslağa → okuma işi. */
    const tabletScan = async (salt: string): Promise<{ noteId: string; scanId: string }> => {
      const n = await call("POST", "/api/gelen-belge/irsaliyeler", { clientToken: randomUUID(), sourceKind: "MANUAL" });
      const noteId = String(n.data?.id ?? "");
      if (noteId) made.notes.push(noteId);
      const u = await call("POST", "/api/gelen-belge/taramalar", { contentBase64: jpeg(salt).toString("base64"), noteId, pageNo: 1 });
      const scanId = u.data?.scan?.id ?? "";
      if (scanId) made.scans.push(scanId);
      await runReaderOnce();
      return { noteId, scanId };
    };

    console.log("§1 hiç görülmemiş belge (SORMA → BLIND)");
    const a = await tabletScan("s1");
    const l1 = await linesOf(a.noteId);
    const oz1 = await summary(a.noteId);
    check("§1 ön koşul: GENEL tablo ilk okumada bu taramadan satır doğurur (PER_DOCUMENT + BLIND)", l1.length > 0 && l1.every((l) => l.scanId === a.scanId), String(l1.length));
    check("§1 ön koşul: tanıtılmamış + tahmin yok (sahip önerisi yok, parti adayı yok)", (oz1.data?.tanitim as { durum?: string } | undefined)?.durum === "TANITILMAMIS" && oz1.data?.ownerSuggestion === null && (oz1.data?.batchNoCandidates as unknown[]).length === 0, JSON.stringify({ t: oz1.data?.tanitim, o: oz1.data?.ownerSuggestion, b: oz1.data?.batchNoCandidates }));

    console.log("§2 aynı belge üstünde tanıt → yeniden oku");
    const all = ocrFix.blocks.flatMap((b) => b.lines);
    const lineRect = (t: string) => all.find((l) => l.text === t)!.rect;
    const elRect = (t: string) => all.flatMap((l) => l.elements ?? []).find((e) => e.text === t)!.rect;
    const name = `${TAG} yeni belge`;
    const p = await call("POST", "/api/gelen-belge/sablonlar/oneri", {
      scanId: a.scanId, name, identifiers: ["YENİÇAĞ TEKSTİL SAN. TİC. A.Ş.", "SEVK İRSALİYESİ", "TOP LİSTESİ"],
      assignments: [{ field: "musteri", rect: lineRect(OWNER_NAME) }, { field: "partiNo", rect: elRect("P636249") }, { field: "evrakNo", rect: elRect("IRS-596394") }],
      table: { columns: [{ key: "topNo", header: "Top No" }, { key: "m", header: "Metraj (m)" }, { key: "kg", header: "Kg" }], totalsLabel: "TOPLAM" },
    });
    const c = await call("POST", "/api/gelen-belge/sablonlar/ozel", { name, template: p.data?.template, clientToken: randomUUID() });
    const code = String(c.data?.code ?? "");
    const tpl = code ? await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } }) : null;
    if (tpl) made.templates.push(tpl.id);
    check("§2 tanıtma: öneri 200 + kayıt 201 (u-…)", p.status === 200 && c.status === 201 && code.startsWith("u-"), `${p.status} ${c.status} ${c.code ?? ""} ${JSON.stringify(p.data?.errors)}`);
    // Kimlik yazısı tavanı (MAX_TEMPLATE_IDENTIFIERS=30): canlı demoda 13 seçim eski 12 tavanına çarpıp yalnız "Validasyon hatası" gösterdi.
    const kimlikler = (n: number) => Array.from({ length: n }, (_, i) => `${TAG} KIMLIK ${i + 1}`);
    const oneriGovde = (identifiers: string[]) => ({ scanId: a.scanId, name: `${TAG} kimlik tavani`, identifiers, assignments: [{ field: "partiNo", rect: elRect("P636249") }] });
    const k13 = await call("POST", "/api/gelen-belge/sablonlar/oneri", oneriGovde(kimlikler(13)));
    check("§2 13 kimlik yazısıyla öneri 200", k13.status === 200, `${k13.status} ${k13.code ?? ""}`);
    const r31 = await fetch(`${url}/api/gelen-belge/sablonlar/oneri`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify(oneriGovde(kimlikler(31))) });
    const j31 = (await r31.json().catch(() => ({}))) as { errors?: { field?: string; message?: string }[] };
    check("§2 31 kimlik yazısı → 400 + Türkçe tavan mesajı", r31.status === 400 && (j31.errors ?? []).some((e) => e.field === "identifiers" && e.message === "En çok 30 kimlik yazısı seçilebilir"), `${r31.status} ${JSON.stringify(j31.errors)}`);
    const o2 = await okut(a.scanId);
    const q2 = await scanRow(a.scanId);
    const l2a = await linesOf(a.noteId);
    check("§2 ⭐ dokunulmamış OCR satırlı sayfa okut → 202 (409 DEĞİL), tarama PENDING/0, eski satırlar silindi", o2.status === 202 && q2.status === "PENDING" && q2.attempts === 0 && q2.noteId === a.noteId && l2a.length === 0, `${o2.status} ${o2.code ?? ""} ${JSON.stringify(q2)} satır ${l2a.length}`);
    const dropLogs = await prisma.systemLog.count({ where: { tableName: "CUSTOMER_DELIVERY_NOTE_LINE", action: "DELETE", recordId: { in: l1.map((l) => l.id) } } });
    check("§2 silinen satırlar audit'e düşer (DELETE, satır başına)", dropLogs === l1.length, `${dropLogs}/${l1.length}`);
    await runReaderOnce();
    const l2 = await linesOf(a.noteId);
    const oz2 = await summary(a.noteId);
    const batch2 = (oz2.data?.batchNoCandidates ?? []) as Array<{ kind: string; value: string }>;
    check("§2 ⭐ yeni şablonla okundu: TANITILDI + şablon kodu, satırlar yalnız bu taramadan (ikilenmez)",
      (oz2.data?.tanitim as { durum?: string; sablonKodu?: string } | undefined)?.durum === "TANITILDI" && (oz2.data?.tanitim as { sablonKodu?: string }).sablonKodu === code && l2.length > 0 && l2.length <= l1.length + 1 && l2.every((l) => l.scanId === a.scanId),
      JSON.stringify({ t: oz2.data?.tanitim, n: l2.length }));
    check("§2 ⭐ form sorusuz dolar: sahip kesin (OWNER_TEXT), parti tek aday P636249 + kolon yazıldı",
      (oz2.data?.ownerSuggestion as { customerId?: string } | null)?.customerId === ownerId && batch2.length === 1 && batch2[0]!.value === "P636249" && oz2.data?.ourBatchNo === "P636249",
      JSON.stringify({ o: oz2.data?.ownerSuggestion, b: batch2, p: oz2.data?.ourBatchNo }));
    const o2b = await okut(a.scanId);
    check("§2 ikinci okut (yeni satırlar da dokunulmamış) yine 202 — satırlar ikilenmez", o2b.status === 202 && (await linesOf(a.noteId)).length === 0, `${o2b.status} ${o2b.code ?? ""}`);
    await runReaderOnce();
    check("§2 ikinci okuma sonrası satır sayısı aynı", (await linesOf(a.noteId)).length === l2.length, String((await linesOf(a.noteId)).length));

    console.log("§3 kullanıcı düzenlemişse 409 aynen");
    const b = await tabletScan("s3");
    const lb = await linesOf(b.noteId);
    const e3 = await call("PATCH", `/api/gelen-belge/irsaliyeler/${b.noteId}/satirlar/${lb[0]!.id}`, { meters: 77 });
    const o3 = await okut(b.scanId);
    const lb3 = await linesOf(b.noteId);
    check("§3 ⭐ düzeltilmiş OCR satırı → okut 409 DOCUMENT_SCAN_ALREADY_READ, satırlar ve düzeltme durur, tarama READ",
      e3.status === 200 && o3.status === 409 && o3.code === "DOCUMENT_SCAN_ALREADY_READ" && lb3.length === lb.length && Number(lb3[0]!.meters) === 77 && (await scanRow(b.scanId)).status === "READ",
      `${e3.status} ${o3.status} ${o3.code ?? ""} ${lb3.length}/${lb.length}`);
    const c3 = await tabletScan("s3b");
    const add = await call("POST", `/api/gelen-belge/irsaliyeler/${c3.noteId}/satirlar`, { meters: 50 });
    const o3b = await okut(c3.scanId);
    check("§3 ⭐ elle satır eklenmiş taslak (OCR satırları dokunulmamış) → okut 409, satırlar durur",
      add.status === 201 && o3b.status === 409 && o3b.code === "DOCUMENT_SCAN_ALREADY_READ" && (await scanRow(c3.scanId)).status === "READ" && (await linesOf(c3.noteId)).some((l) => l.scanId === null),
      `${add.status} ${o3b.status} ${o3b.code ?? ""}`);
    await prisma.customerDeliveryNote.update({ where: { id: c3.noteId }, data: { status: "CANCELLED" } });
    const o3c = await okut(c3.scanId);
    check("§3 taslak değil → 409 DELIVERY_NOTE_NOT_DRAFT (satırlar durur)", o3c.status === 409 && o3c.code === "DELIVERY_NOTE_NOT_DRAFT" && (await linesOf(c3.noteId)).length > 0, `${o3c.status} ${o3c.code ?? ""}`);

    console.log("§4 şablonu güncelle: dokunulmayan eski alan birebir korunur (tablet güncelle kipi, 2026-11-04 Gülkesim)");
    type Spec = { key: string; strategies?: Array<{ maxWords?: number; valueShape?: string }> };
    const tplOf = async () => (await call("GET", `/api/gelen-belge/sablonlar/ozel/${code}`)).data as { version: number; template: { fields: Spec[] } };
    const before = await tplOf();
    const specOf = (fs: Spec[] | undefined, k: string) => JSON.stringify((fs ?? []).find((f) => f.key === k) ?? null);
    const oldKeys = before.template.fields.map((f) => f.key);
    check("§4 ön koşul: kayıtlı şablonda parti no değer sınırı (maxWords) taşır", before.template.fields.some((f) => f.key === "partiNo" && f.strategies?.[0]?.maxWords !== undefined), specOf(before.template.fields, "partiNo"));
    const updBody = (assignments: unknown[], base = true) => ({ scanId: a.scanId, name, identifiers: ["YENİÇAĞ TEKSTİL SAN. TİC. A.Ş.", "SEVK İRSALİYESİ"], assignments, ...(base ? { base: { code, keep: ["tables"] } } : {}) });
    const u0 = await call("POST", "/api/gelen-belge/sablonlar/oneri", updBody([]));
    const t0 = u0.data?.template as { fields: Spec[] } | undefined;
    check("§4 ⭐ yeni atamasız güncelle önizlemesi 200 + hatasız + önizleme var", u0.status === 200 && (u0.data?.errors as unknown[]).length === 0 && !!u0.data?.preview, `${u0.status} ${u0.code ?? ""} ${JSON.stringify(u0.data?.errors)}`);
    check("§4 ⭐ atamasız güncellemede HER eski alan birebir (strateji/maxWords/valueShape) korunur", oldKeys.length > 0 && oldKeys.every((k) => specOf(t0?.fields, k) === specOf(before.template.fields, k)), JSON.stringify(t0?.fields?.map((f) => f.key)));
    const rects = ((u0.data?.preview as { fieldRects?: Record<string, { x: number; y: number; width: number; height: number }> } | undefined)?.fieldRects) ?? {};
    const pr = rects.partiNo;
    const want = elRect("P636249");
    const cx = want.x + want.width / 2;
    const cy = want.y + want.height / 2;
    check("§4 ⭐ önizleme okunan değerin kutusunu (fieldRects, sayfa çerçevesi) döner — parti no P636249 kutusunda", !!pr && cx >= pr.x && cx <= pr.x + pr.width && cy >= pr.y && cy <= pr.y + pr.height, JSON.stringify({ pr, want }));
    const u1 = await call("POST", "/api/gelen-belge/sablonlar/oneri", updBody([{ field: "musteri", rect: lineRect(OWNER_NAME) }]));
    const t1 = u1.data?.template as { fields: Spec[] } | undefined;
    check("§4 ⭐ yalnız müşteri yeniden atanınca diğer eski alanlar birebir korunur", u1.status === 200 && oldKeys.filter((k) => k !== "musteri").every((k) => specOf(t1?.fields, k) === specOf(before.template.fields, k)) && specOf(t1?.fields, "musteri") !== "null", `${u1.status} ${JSON.stringify(t1?.fields?.map((f) => f.key))}`);
    const u2 = await call("POST", "/api/gelen-belge/sablonlar/oneri", updBody([], false));
    check("§4 yeni belge tipinde (base'siz) atamasız öneri yine 400", u2.status === 400, `${u2.status} ${u2.code ?? ""}`);
    const put = await call("PUT", `/api/gelen-belge/sablonlar/ozel/${code}`, { expectedVersion: before.version, template: t0, name });
    const after = await tplOf();
    check("§4 ⭐ atamasız güncelleme kaydedilir: sürüm +1, eski alanlar kayıpsız", put.status === 200 && after.version === before.version + 1 && oldKeys.every((k) => specOf(after.template.fields, k) === specOf(before.template.fields, k)), `${put.status} ${put.code ?? ""} v${after.version}`);
  } finally {
    setReaderUrlForTests(null);
    __resetDocumentReaderForTests();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => sidecar.server.close(() => r()));
    const now = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
    for (const row of now) {
      const prev = priorSettings.find((x) => x.key === row.key);
      if (!prev) await prisma.systemSetting.delete({ where: { key: row.key } });
      else if (JSON.stringify(prev.value) !== JSON.stringify(row.value)) await prisma.systemSetting.update({ where: { key: row.key }, data: { value: prev.value as never } });
    }
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: made.notes } } });
    await prisma.documentScan.updateMany({ where: { id: { in: made.scans } }, data: { noteId: null } });
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
    await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } });
    await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } });
    await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } });
    await prisma.item.deleteMany({ where: { id: { in: made.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

if (!engel) {
  main()
    .catch((e) => { console.error("❌ beklenmeyen hata:", e); process.exitCode = 1; })
    .finally(async () => { stopNotificationJobs(); await prisma.$disconnect(); });
}
