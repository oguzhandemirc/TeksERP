// =============================================================================
// BEKÇİ — İLK KURULUM SÖZLEŞME KABULÜ (Ek-7 §5; kullanıcı kararı 2026-09-30) — fabrika tarafı, sahte satıcıyla
// Çalıştır: npx tsx scripts/run-all-tests.ts test_lisans_kabul   (kendi _test DB'si; sahte satıcı yerel HTTPS)
// =============================================================================
// NE ÖLÇER: ① kabul görünümü güncel metni (kimlik · sha256 · bloklar · kutular) belgeden üretilmiş metinden verir
// ② kabulsüz etkinleştirme SATICIYA GİTMEDEN 409 LICENSE_ACCEPTANCE_REQUIRED — çevrimiçi, QR ve panel aktarması
// (üçü de aynı zarf kurucusu) · ③ kabul defteri: metin/kutu kapıları, KURULUM imzalı belge (kurulum anahtarıyla
// doğrulanır, satır = belge), clientToken replay'i + çakışma, audit · ④ etkinleştirme isteği (çevrimiçi gövde ve
// çevrimdışı zarf) defterdeki belgeyi AYNEN taşır, yönetici ayak izi kabul kimliğini · ⑤ anahtar değişince
// ANAHTAR_DEGISTI, metin değişince METIN_DEGISTI (yeniden kabul).
// NEGATİF SONDA (dosya dışı mutasyon, geri alındı; sonuç commit mesajında): N1 etkinleştirme kabulü atladı ·
// N2 zarf kurucusu kabulü koymadı · N3 geçerlilik anahtarı değil yalnız "son satır"a baktı.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { ensureInstallationIdentity } from "../src/jobs/installation-identity.job";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, invalidateLicenseSnapshot, setMeasuredFingerprint } from "../src/lib/license/runtime";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import { ACCEPTANCE_TEXTS, openEnvelope, verifyAcceptance, type Fingerprint } from "../src/lib/license/protocol";
import { currentAcceptanceText } from "../src/lib/license/acceptance-text";
import { activateLicense, buildOfflineRequest } from "../src/services/license.service";
import { refreshLicenseDbFacts } from "../src/services/license-sync.service";
import { activationAcceptance, getLicenseAcceptanceView, recordLicenseAcceptance } from "../src/services/license-acceptance.service";
import { fiksturKur, type Fikstur } from "./lib/lisans-fikstur";
import { sahteSaticiBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";
import { kabulAnahtariIzle, kabulEt, temizleKabuller } from "./lib/lisans-kabul-fikstur";
import { testActorId } from "./fixture-test-user";

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

const auditLar: Array<{ tableName: string; recordId: string; newData: unknown }> = [];
const olaylar: Array<{ action: string; payload: unknown }> = [];
AuditService.log = async (p) => {
  auditLar.push({ tableName: p.tableName, recordId: p.recordId, newData: p.newData ?? null });
};
AuditService.logEvent = async (p) => {
  olaylar.push({ action: p.action, payload: p.payload ?? null });
};
for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"]) delete process.env[k];

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-kabul-"));

async function hataKodu(p: Promise<unknown>): Promise<{ kod: string; ayrinti: Record<string, unknown>; mesaj: string }> {
  try {
    await p;
    return { kod: "HATA_YOK", ayrinti: {}, mesaj: "" };
  } catch (e) {
    const d = ((e as { details?: Record<string, unknown> }).details ?? {}) as Record<string, unknown>;
    return { kod: [d.code, d.vendorCode].filter(Boolean).join("/") || String(e), ayrinti: d, mesaj: e instanceof Error ? e.message : String(e) };
  }
}

interface Hazir {
  f: Fikstur;
  satici: SahteSatici;
  kid: string;
  x: string;
}

async function hazirla(dizinAdi: string): Promise<Hazir> {
  const store = loadLicenseStoreSync({ dir: path.join(GECICI, dizinAdi) });
  const key = store.key;
  if (!key) throw new Error("depo anahtarı yok");
  invalidateLicenseSnapshot();
  kabulAnahtariIzle(key.kid);
  const kimlik = await ensureInstallationIdentity();
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const satici = await sahteSaticiBaslat(f);
  satici.kod = "TKS-7K3M-9QRT-2XWZ-4HJN";
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: satici.url });
  setEgressTrustForTests(satici.ca);
  await refreshLicenseDbFacts(kimlik.installationId);
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date().toISOString() });
  return { f, satici, kid: key.kid, x: key.x };
}

function metinBolumu(): void {
  console.log("\n§1 — kabul metni: belgeden üretilen güncel metin, katalogun son satırı");
  const t = currentAcceptanceText();
  const son = ACCEPTANCE_TEXTS.at(-1);
  check("§1a güncel metin protokol kataloğunun SON satırı (satıcı tanıyacak)", t.katalogda && son?.kimlik === t.kimlik && son.ozet === t.ozet, `${t.kimlik} ${t.ozet.slice(0, 12)}`);
  check("§1b metin kutuları bloklarda sırayla (☐ 1…n) + ad/unvan alanı", t.kutular.length >= 1 && t.bloklar.some((b) => b.tur === "alanlar") && t.bloklar.filter((b) => b.tur === "kutu").length === t.kutular.length, t.kutular.join(","));
}

async function kapiBolumu(x: Hazir): Promise<void> {
  console.log("\n§2 — ⭐ kabulsüz etkinleştirme satıcıya GİTMEZ (çevrimiçi · QR · panel aktarması)");
  const v = await getLicenseAcceptanceView(null);
  check("§2a görünüm: bu anahtarın kabulü yok (durum YOK/ANAHTAR_DEGISTI, gecerli null)", v.durum !== "GECERLI" && v.gecerli === null && v.anahtarKimligi === x.kid, v.durum);
  const once = x.satici.istekler.length;
  const cevrimici = await hataKodu(activateLicense(x.satici.kod, null));
  check(
    "§2b çevrimiçi → 409 LICENSE_ACCEPTANCE_REQUIRED (+ kabulDurumu), TR cümle",
    cevrimici.kod === "LICENSE_ACCEPTANCE_REQUIRED" && typeof cevrimici.ayrinti.kabulDurumu === "string" && /sözleşme/i.test(cevrimici.mesaj),
    `${cevrimici.kod} ${String(cevrimici.ayrinti.kabulDurumu)}`,
  );
  const zarf = await hataKodu(buildOfflineRequest({ amac: "etkinlestir", kod: x.satici.kod }));
  check("§2c QR / panel aktarması zarfı (aynı kurucu) → 409, zarf ÜRETİLMEZ", zarf.kod === "LICENSE_ACCEPTANCE_REQUIRED", zarf.kod);
  check("§2d satıcıya hiç istek gitmedi", x.satici.istekler.length === once && x.satici.sayac.etkinlestir === 0, `${once}→${x.satici.istekler.length}`);
  const yenile = await buildOfflineRequest({ amac: "yokla" }).then(() => "ZARF", (e: { details?: { code?: string } }) => e.details?.code ?? "?");
  check("§2e karşı: kabul yalnız etkinleştirmeyi keser (yenileme zarfı etkinleşmemişte zaten LICENSE_NOT_ACTIVE)", yenile === "LICENSE_NOT_ACTIVE", yenile);
}

async function defterBolumu(x: Hazir): Promise<string> {
  console.log("\n§3 — kabul defteri: metin/kutu kapısı, imzalı belge, replay");
  const t = currentAcceptanceText();
  const userId = await testActorId();
  const girdi = { clientToken: randomUUID(), metinKimligi: t.kimlik, metinOzeti: t.ozet, kutular: [...t.kutular], adSoyad: "Ayşe Yılmaz", unvan: "Genel Müdür" };
  const eskiMetin = await hataKodu(recordLicenseAcceptance({ userId, input: { ...girdi, metinOzeti: "0".repeat(64) }, panelVersion: null }));
  check("§3a ⭐ ekranda gösterilen metin güncel değil → 409 LICENSE_ACCEPTANCE_TEXT_CHANGED", eskiMetin.kod === "LICENSE_ACCEPTANCE_TEXT_CHANGED", eskiMetin.kod);
  const eksik = await hataKodu(recordLicenseAcceptance({ userId, input: { ...girdi, kutular: t.kutular.slice(1) }, panelVersion: null }));
  check("§3b ⭐ kutu eksik → 400 LICENSE_ACCEPTANCE_BOXES", eksik.kod === "LICENSE_ACCEPTANCE_BOXES", eksik.kod);
  const fazla = await hataKodu(recordLicenseAcceptance({ userId, input: { ...girdi, kutular: [...t.kutular, "9"] }, panelVersion: null }));
  check("§3c metinde olmayan kutu → 400", fazla.kod === "LICENSE_ACCEPTANCE_BOXES", fazla.kod);
  check("§3d reddedilen denemeler satır YAZMADI", (await prisma.licenseAcceptance.count({ where: { installationKeyId: x.kid } })) === 0);

  const v = await recordLicenseAcceptance({ userId, input: girdi, panelVersion: "1.5.0" });
  const satir = await prisma.licenseAcceptance.findFirstOrThrow({ where: { installationKeyId: x.kid } });
  check("§3e kabul → GECERLI, görünüm ad/unvan/metin taşır", v.durum === "GECERLI" && v.gecerli?.adSoyad === "Ayşe Yılmaz" && v.gecerli.unvan === "Genel Müdür" && v.gecerli.metinOzeti === t.ozet && v.gecerli.kabulId === satir.id);
  const oturum = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  check("§3e2 form önerisi oturumdaki kullanıcının adı (kabul eden değiştirebilir)", v.oneri.adSoyad === oturum.fullName && v.gecerli?.kabulEden.id === userId, String(v.oneri.adSoyad));
  const sistem = await prisma.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } });
  if (sistem) check("§3e3 satıcı (sistem) hesabına ad önerisi YOK (Lisans Alan yetkilisi değil)", (await getLicenseAcceptanceView(sistem.id)).oneri.adSoyad === null);
  else console.log("⏭ §3e3 ölçülmedi: bu DB'de sistem hesabı yok (tek yazarı superadmin betiği; bekçi yaratmaz)");
  const dogru = verifyAcceptance(satir.document, { publicKeyX: x.x });
  check(
    "§3f ⭐ satırın belgesi KURULUM anahtarıyla doğrulanır; belge = satır (kabulId · kullanıcı · ad/unvan · zaman · kutular)",
    dogru.ok && dogru.doc.kabulId === satir.id && dogru.doc.kabulEden.kullaniciId === userId && dogru.doc.kabulEden.ad === satir.acceptorName &&
      Date.parse(dogru.doc.zaman) === satir.createdAt.getTime() && dogru.doc.kutular.join(",") === satir.boxes.join(",") && dogru.doc.istemci.surum === "1.5.0",
    dogru.ok ? "" : dogru.neden,
  );
  check("§3g audit: LICENSE_ACCEPTANCE CREATE (ayak izi), kabul kimliğiyle", auditLar.some((a) => a.tableName === "LICENSE_ACCEPTANCE" && a.recordId === satir.id));
  const tekrar = await recordLicenseAcceptance({ userId, input: girdi, panelVersion: "1.5.0" });
  check("§3h aynı işlem kimliği + aynı yük → aynı görünüm, İKİNCİ satır yok", tekrar.gecerli?.kabulId === satir.id && (await prisma.licenseAcceptance.count({ where: { installationKeyId: x.kid } })) === 1);
  const cakisma = await hataKodu(recordLicenseAcceptance({ userId, input: { ...girdi, unvan: "Muhasebe" }, panelVersion: null }));
  check("§3i aynı işlem kimliği + başka unvan → 409 CLIENT_TOKEN_COLLISION", cakisma.kod === "CLIENT_TOKEN_COLLISION", cakisma.kod);
  return satir.document;
}

async function istekBolumu(x: Hazir, belge: string): Promise<void> {
  console.log("\n§4 — ⭐ etkinleştirme isteği defterdeki kabul belgesini AYNEN taşır");
  const q = await buildOfflineRequest({ amac: "etkinlestir", kod: x.satici.kod });
  const acik = openEnvelope(q.zarf);
  const govde = acik.ok ? (JSON.parse(acik.value.body.toString("utf8")) as { kabul?: string }) : {};
  check("§4a QR/aktarma zarfının gövdesi kabul belgesini taşır (satır belgesiyle bayt-eşit)", acik.ok && govde.kabul === belge);
  const d = await activateLicense(x.satici.kod, null);
  check("§4b çevrimiçi etkinleştirme → etkin; sahte satıcının kapısı (gerçek satıcının doğrulayıcısı) belgeyi kabul etti", d.kurulum.etkin && x.satici.kabuller.at(-1) === belge, `${x.satici.kabuller.length} kabul`);
  const iz = olaylar.filter((o) => o.action === "LICENSE_ADMIN_ACTION").map((o) => o.payload as { eylem?: string; kabulId?: string });
  const kabulId = (await prisma.licenseAcceptance.findFirstOrThrow({ where: { installationKeyId: x.kid } })).id;
  check("§4c yönetici ayak izi (etkinlestir) kullanılan kabulün kimliğini taşır", iz.some((p) => p.eylem === "etkinlestir" && p.kabulId === kabulId));
}

async function gecerlilikBolumu(x: Hazir): Promise<void> {
  console.log("\n§5 — geçerlilik anahtara ve metne bağlı");
  const userId = await testActorId();
  // Metin değişti: aynı anahtarın EN SON kabulü eski bir metin sürümünü kapsıyor.
  await prisma.licenseAcceptance.create({
    data: {
      id: randomUUID(), textId: "KM-2025.9", textDigest: "e".repeat(64), boxes: ["1"], acceptorName: "Eski", acceptorTitle: "Eski",
      acceptedById: userId, installationKeyId: x.kid, serverVersion: "2.0.0", document: "eski.belge.yok", createdAt: new Date(Date.now() + 5_000),
    },
  });
  const metinDegisti = await getLicenseAcceptanceView(null);
  const kapi = await hataKodu(activationAcceptance(x.kid));
  check("§5a ⭐ en son kabul eski metin → METIN_DEGISTI, etkinleştirme 409", metinDegisti.durum === "METIN_DEGISTI" && metinDegisti.gecerli === null && kapi.kod === "LICENSE_ACCEPTANCE_REQUIRED" && kapi.ayrinti.kabulDurumu === "METIN_DEGISTI", `${metinDegisti.durum} ${String(kapi.ayrinti.kabulDurumu)}`);
  check("§5b defter görünümü eski ve yeni kabulü birlikte gösterir (yeniden eskiye)", metinDegisti.kayitlar.length >= 2 && metinDegisti.kayitlar[0]?.metinKimligi === "KM-2025.9");
  const y = await hazirla("yeni-makine");
  const anahtarDegisti = await getLicenseAcceptanceView(null);
  check("§5c ⭐ yeni kurulum anahtarı (taşıma/yeni makine/DB kopyası) → ANAHTAR_DEGISTI, eski kabul geçmez", anahtarDegisti.durum === "ANAHTAR_DEGISTI" && anahtarDegisti.anahtarKimligi === y.kid && y.kid !== x.kid, anahtarDegisti.durum);
  await kabulEt({ adSoyad: "Mehmet Kaya", unvan: "Fabrika Müdürü" });
  const yeniden = await getLicenseAcceptanceView(null);
  check("§5d yeni anahtarda yeniden kabul → GECERLI (yeni anahtara bağlı)", yeniden.durum === "GECERLI" && yeniden.gecerli?.anahtarKimligi === y.kid && yeniden.gecerli.adSoyad === "Mehmet Kaya");
  await y.satici.kapat();
}

async function main(): Promise<void> {
  let satici: SahteSatici | null = null;
  try {
    metinBolumu();
    const x = await hazirla("motor");
    satici = x.satici;
    await kapiBolumu(x);
    const belge = await defterBolumu(x);
    await istekBolumu(x, belge);
    await gecerlilikBolumu(x);
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await satici?.kapat();
    await temizleKabuller();
    fs.rmSync(GECICI, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
