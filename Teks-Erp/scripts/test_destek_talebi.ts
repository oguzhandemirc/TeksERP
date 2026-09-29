// =============================================================================
// BEKÇİ — DESTEK TALEBİ (3d-2), fabrika tarafı
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts destek_talebi   (kendi _test DB'si)
//
// NE ÖLÇER: panelden açılan talep ① clientToken'la idempotent doğar (aynı kimlik + başka gövde 409),
// ② satıcıya KURULUM İMZALI (`destek` amacı, gövde özeti) KATI protokol gövdesiyle gider — sağlık özeti
// otomatik, ek baytı birebir, ③ satıcıya ulaşılamazsa GONDERILMEDI kalır (sayaç + hata KODU) ve
// yoklama sonrası giden kutusundan gönderilir, ④ ekran görüntüsü yalnız beyan edilen türde ve ≤700 KB,
// ⑤ yoklama yanıtının `destek` alanı yerel duruma + yanıt kopyasına yazılır (tekrar gelen yanıt tek
// satır; biçimsiz alan yok sayılır), ⑥ lisans kapısında her kademede açık.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): B1 ek imza baytı denetimi kaldırıldı → §4b ❌ ·
//   B2 yoklama sonrası giden kutusu gönderilmedi → §3b/§3c ❌ · B3 kapının açık listesinden destek düştü → §6a ❌ ·
//   B4 istek `yokla` amacıyla imzalandı → §1d ❌ (ISTEK_AMAC).
// =============================================================================
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, setLicenseDbFacts, setMeasuredFingerprint } from "../src/lib/license/runtime";
import { REQUEST_HEADER, SupportRequestSchema, readSupportUpdates, verifyRequest, type Fingerprint } from "../src/lib/license/protocol";
import { acceptLicenseResponse } from "../src/services/license-sync.service";
import { createSupportTicket } from "../src/services/support.service";
import { applySupportUpdates, sendPendingSupportTickets, syncSupportAfterPoll } from "../src/services/support-sync.service";
import type { VendorTransport } from "../src/services/helpers/license-wire.helper";
import { isOpenInTier } from "../src/constants/license-routes";
import { fiksturKur, hakBas, kiraBas, type Fikstur } from "./lib/lisans-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "destek-talebi-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const olusanlar: string[] = [];

interface Gonderim {
  readonly baslik: string;
  readonly govde: string;
}

/** Sahte satıcı: gövdeyi ve imzalı başlığı kaydeder, `DST-…` döner (ya da ağ hatası taklidi). */
function sahteSatici(kayit: Gonderim[], g: { bozuk?: boolean } = {}): VendorTransport {
  return async (req) => {
    kayit.push({ baslik: req.headers[REQUEST_HEADER] ?? "", govde: req.body ?? "" });
    if (g.bozuk) throw new Error("ağ yok");
    const b = JSON.parse(req.body ?? "{}") as { talepId: string };
    return { status: 200, body: JSON.stringify({ v: 1, talepId: b.talepId, talepNo: "DST-000042", durum: "ACIK" }) };
  };
}

async function kur(): Promise<{ f: Fikstur; userId: string }> {
  const key = loadLicenseStoreSync({ dir: path.join(KOK, "lisans") }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: "https://satici.test" });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 86_400_000, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  await acceptLicenseResponse({ v: 1, hak: hakBas(f), kira: kiraBas(f, { zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString(), kurulumId: f.kurulumId }, "cevrimdisi");
  const u = await ensureTestAdmin();
  return { f, userId: u.id };
}

function girdi(ek: Partial<{ konu: string; aciklama: string; ekranGoruntusu: { tur: "image/png" | "image/jpeg"; veri: string } | null }> = {}) {
  return { clientToken: randomUUID(), konu: "Tartı ekranı donuyor", aciklama: "Sevkiyat tartısı 2 dk donuyor.", ekranGoruntusu: { tur: "image/png" as const, veri: PNG.toString("base64") }, ...ek };
}

async function hataKodu(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const d = (e as { details?: { code?: unknown }; statusCode?: number }).details;
    return String(d?.code ?? (e as Error).message);
  }
}

async function main(): Promise<void> {
  try {
    const { f, userId } = await kur();

    console.log("§1 talep doğar ve satıcıya imzalı gider");
    const g1: Gonderim[] = [];
    const in1 = girdi();
    const t1 = await createSupportTicket({ userId, input: in1, panelVersion: "1.3.2", transport: sahteSatici(g1) });
    olusanlar.push(t1.id);
    check("§1a ⭐ satıcı yanıtıyla durum ACIK + numara", t1.status === "ACIK" && t1.ticketNo === "DST-000042" && t1.sentAt !== null, `${t1.status} ${t1.ticketNo}`);
    const govde = SupportRequestSchema.safeParse(JSON.parse(g1[0]?.govde ?? "{}"));
    check("§1b ⭐ gövde KATI protokol şemasından geçer, talepId = yerel kimlik, sağlık özeti otomatik", govde.success && govde.data.talepId === t1.id && govde.data.saglik.surum.length > 0 && govde.data.panelSurum === "1.3.2");
    check("§1c ek baytı birebir", govde.success && govde.data.ek?.tur === "image/png" && Buffer.from(govde.data.ek.veri, "base64").equals(PNG));
    const imza = verifyRequest(g1[0]?.baslik, { publicKeyX: f.kurulum.x, body: Buffer.from(g1[0]?.govde ?? ""), nowMs: Date.now(), purposes: ["destek"], installationId: f.kurulumId });
    check("§1d ⭐ istek KURULUM imzalı, amaç `destek`, gövde özeti tutar, lisans kimliği bağlı", imza.ok, imza.ok ? "" : imza.code);

    console.log("\n§2 idempotency (clientToken)");
    const tekrar = await createSupportTicket({ userId, input: in1, panelVersion: "1.3.2", transport: sahteSatici(g1) });
    const adet = await prisma.supportTicket.count({ where: { clientToken: in1.clientToken } });
    check("§2a ⭐ aynı kimlik + aynı gövde → aynı talep, satıcıya İKİNCİ gönderim yok", tekrar.id === t1.id && adet === 1 && g1.length === 1, `${adet} · ${g1.length}`);
    const cakisma = await hataKodu(createSupportTicket({ userId, input: { ...in1, konu: "başka konu" }, panelVersion: null, transport: sahteSatici(g1) }));
    check("§2b ⭐ aynı kimlik + başka gövde → 409 CLIENT_TOKEN_COLLISION", cakisma === "CLIENT_TOKEN_COLLISION", String(cakisma));

    console.log("\n§3 giden kutusu");
    const g3: Gonderim[] = [];
    const t3 = await createSupportTicket({ userId, input: girdi({ ekranGoruntusu: null }), panelVersion: null, transport: sahteSatici(g3, { bozuk: true }) });
    olusanlar.push(t3.id);
    check("§3a ⭐ satıcıya ulaşılamazsa GONDERILMEDI (sayaç + hata KODU, ham metin yok)", t3.status === "GONDERILMEDI" && t3.sendAttempts === 1 && t3.lastErrorCode === "EGRESS_NETWORK" && t3.ticketNo === null, `${t3.status} ${t3.lastErrorCode}`);
    const g3b: Gonderim[] = [];
    await syncSupportAfterPoll({ v: 1 }, sahteSatici(g3b));
    const t3b = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t3.id } });
    check("§3b ⭐ yoklama sonrası giden kutusu gönderir → ACIK + numara", t3b.status === "ACIK" && t3b.ticketNo === "DST-000042" && t3b.lastErrorCode === null && g3b.length >= 1, `${t3b.status}`);
    check("§3c gönderilmiş talep yeniden GÖNDERİLMEZ", (await sendPendingSupportTickets(sahteSatici(g3b))) === 0 && !g3b.slice(1).some((x) => x.govde.includes(t3.id)));

    console.log("\n§4 ekran görüntüsü kapısı");
    const buyuk = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(710 * 1024)]);
    check("§4a ≤700 KB (base64 1 MB gövdeye sığar)", (await hataKodu(createSupportTicket({ userId, input: girdi({ ekranGoruntusu: { tur: "image/png", veri: buyuk.toString("base64") } }), panelVersion: null, transport: sahteSatici([]) }))) === "SUPPORT_SCREENSHOT_TOO_LARGE");
    const sahte = Buffer.from("MZ-yurutulebilir-dosya").toString("base64");
    check("§4b ⭐ beyan edilen türde olmayan ek RED", (await hataKodu(createSupportTicket({ userId, input: girdi({ ekranGoruntusu: { tur: "image/png", veri: sahte } }), panelVersion: null, transport: sahteSatici([]) }))) === "SUPPORT_SCREENSHOT_INVALID");

    console.log("\n§5 yoklama yanıtındaki destek güncellemesi");
    const yanit = { yanitId: randomUUID(), metin: "Tartı sürücüsünü güncelleyin.", zaman: new Date().toISOString() };
    const guncel = { talepId: t1.id, talepNo: "DST-000042", durum: "YANITLANDI" as const, guncellendi: new Date().toISOString(), yanitlar: [yanit] };
    await applySupportUpdates(readSupportUpdates({ v: 1, destek: [guncel, { ...guncel, talepId: randomUUID() }] }));
    await applySupportUpdates(readSupportUpdates({ v: 1, destek: [guncel] }));
    const t5 = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t1.id }, include: { replies: true } });
    check("§5a ⭐ yanıt yerel kopyaya TEK satır, durum YANITLANDI (tekrar gelen yanıt çoğalmaz)", t5.status === "YANITLANDI" && t5.replies.length === 1 && t5.replies[0]?.body === yanit.metin, `${t5.status} ${t5.replies.length}`);
    check("§5b biçimsiz `destek` alanı yok sayılır (yoklamayı düşürmez)", readSupportUpdates({ destek: [{ talepId: "x" }] }).length === 0 && readSupportUpdates({ destek: "?" }).length === 0);

    console.log("\n§6 lisans kapısı");
    check("§6a ⭐ destek her kademede açık (K4 · K5)", ["KISITLI", "DURDURULMUS"].every((k) => isOpenInTier(k as "KISITLI", "POST", "/api/destek") && isOpenInTier(k as "KISITLI", "GET", `/api/destek/${t1.id}`)));
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await temizleDestek();
    fs.rmSync(KOK, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

/** Bekçinin kendi talepleri (yalnız bu koşumun kimlikleri). */
async function temizleDestek(): Promise<void> {
  if (olusanlar.length === 0) return;
  await prisma.supportTicketReply.deleteMany({ where: { ticketId: { in: olusanlar } } });
  await prisma.supportTicket.deleteMany({ where: { id: { in: olusanlar } } });
}

void main();
