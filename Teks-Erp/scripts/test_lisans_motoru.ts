// =============================================================================
// BEKÇİ — LİSANS MOTORU (fabrika): depo · durum kaydı · etkinleştirme · yoklama · zil · proxy
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_motoru   (kendi _test DB'si; ~25 sn)
//
// NE ÖLÇER: gerçek servis + işler, SAHTE SATICIYA karşı yerel HTTPS üzerinden (öz-imzalı
// sertifika, `openssl`); satıcı imzalı isteği protokolün doğrulayıcısıyla denetler, gövdeyi
// KATI şemadan geçirir. Audit yazımı bellekte yakalanır (defter satırı yazılmaz). DB'ye tek
// yazım kurulum kimliği satırıdır (sunucu açılışının yaptığının aynısı, idempotent).
//   ⭐ depo atomik ve app\/BACKUP_DIR içine kurulamaz · bozuk anahtar kenara alınır
//   ⭐ yalnız ENOENT "yok": boş/büyük/izinsiz anahtar OKUNAMADI (üretilmez) · okunamayan kira ÖLÇÜLEMEDİ (D1)
//   ⭐ durum.json bozuk/başka anahtarla imzalı → ÖLÇÜLEMEDİ ve aynı kira için SIFIRDAN başlatılmaz
//   ⭐ etkinleştirme uçtan uca; kurcalı/başka kuruluma ait/eski kira RED
//   ⭐ lisans kimliği etkinleştirme yanıtından LICENSE_DIR'e; DB kimliği yalnız bilgi, DB kopyası taşımaz (D14)
//   ⭐ etkinleşmemiş kurulum yoklamaz · zil(lisans) yoklatır, başka konu yoklatmaz
//   ⭐ yoklama CONNECT proxy üzerinden; proxy kimlik bilgisi ekrana/audit'e sızmaz
//   ⭐ gözlem kipinde K5 bile uygulanmaz (sıfır fark)
//   ⭐ satıcının HER hata kodu tanınır (TR mesaj; TEKRAR_DENEYIN tekrar denenebilir, BULUNAMADI adres ipucu)
//   ⭐ kira alışverişleri (yoklama · etkinleştirme · DR · taşıma · aktarma) süreç içinde SIRALI
//   ⭐ ISTEK_ZAMAN'da BİR KEZ düzeltilmiş damga, SAAT_KAYIK bilgi, kademe düşmez (D4)
//   ⭐ eski kira dosyası / silinip yapıştırılan eski yanıt yaptırımı kaldırmaz (D2)
//   ⭐ kira dosyası yokluğu "yoklama başarısız" değil; HAK/durum varken yoklanır (D3)
//   ⭐ uzatma dosyası İSTEK gerektirmez; eski dosya RED; ikinci anahtar imzalı kayıttan (L2-5, §24 · §13a)
//   ⭐ donanım değişikliği bildirimi (K8, §25): parmak izi yeniden okunur · imzalı KATI `donanim` gövdesi · kayıp listesi
//      kiradaki kümeye göre · ONAYLANDI kirası doğrulanıp kabul · eski satıcı BULUNAMADI · etkinleşmemiş 409
//   ⭐ motor pes etmez, sağlıkta durum (D5) · gözlem sayacı istek başına · zil fırtınası yok ·
//      ortam künyesinde makine adı yok · kapalı kalan makineye sahte SAAT_İLERİ yok · taşıma onayı kod bekler (D8)
//   ⭐ yeni HAK kabul edilince bütünlük HEMEN yeniden koşar (hazırlık anahtarının sınıf kararı, §22)
//   ⭐ ilk etkinleştirmede sınıf kararı yeniden denetimi beklemez: yanıt · yoklama gövdesi · satıcıya giden
//      yoklama GECERLI; bütünlük sonucu durumu tik beklemeden değerlendirir (§23)
//   ⭐ G12 (L2-6): DB izi kopya (§26) · K7 kirasız kayıt, tespit anı sonraki yazımlarda da kalıcı (§27) · anahtar
//      okunamaz (§28) · parmak izi v2 merdiveni (§29) · DB okunamazsa iz BİLİNMİYOR, son bilinen tavan uçtan uca
//      (durum kaydı pini → DB izi), saatlik yazım parmak izi önbellek kopyasını taşır (§30)
//   ⭐ G4 iptal belgesi (L2-7, §31): kabul + DB kopyası · düşük/eşit sıra RED · dosya ↔ DB onarımı · iki kopya silinip pin
//      varken IPTAL_BELGESI_KAYIP (birikime girer) · ARA'sı iptal edilen HAK gözlemde sıfır fark, kira yaşar · reddedilen
//      yanıtta ALT-iptali ertelenir · saati geri fabrika taze HAK'ı kabul eder · biçimsiz iptal kirayı düşürmez · eski satıcı
//      yanıtı sıfır fark · detay zinciri
//   ⭐ tel (L2-7 B, §32): yetenekler yoklama + etkinleştirme gövdesinde · çekirdek yokken yalnız iki · küme süreçte kararlı ·
//      eski satıcı yeteneği yok sayar · her imzalı istek kendi ucunun yolunu imzalar, yanlış uca 401 ISTEK_YOL · çevrimdışı
//      donanım zarfı (parmak izi yeniden okunur, /v1/cevrimdisi): BEKLIYOR ve REDDEDILDI reddedilir, ONAYLANDI kira kabulü ·
//      etkinleşmemiş kurulum zarf üretmez
//   ⭐ kabulde saat sürekliliği (L2-9, §33): taşınmış (dosya · QR · donanım zarfı) kira tahmini geri çekemez → SAAT_İLERİ yok,
//      P ileri, EK_SURE kalkar · kabulden önceki ileri sıçrama aklanmaz · kapalı süre kredisi devreder · eski kayıt bugünkü
//      · süreklilik YALNIZ taşınmışta (§33f–h): canlı yoklama şişik tabanı sıfırlar · dosya max'ı korur · canlıda eski ya da
//      tekrar eden yanıt durum kaydını (taban dahil) değiştirmez
//   ⭐ doğrulama kipi YAN ETKİSİZ (§34): açılış + kapanış sonrası lisans dizini + DB izi + iptal kopyası bayt-eşit, yoklama
//      yok; karşı: aynı açılış normal kipte yazar (ölçüm kör değil)
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; sonuçlar commit
// mesajında): M1 persistAccumulation bozuk kayıtta sıfırdan başlatır · M2 kabulde kurulum
// bağı denetimi kaldırılır · M3 zil konusu süzgeci kaldırılır · M4 proxy ayarı ajanı değiştirmez ·
// M5 TEKRAR_DENEYIN tekrar denenebilir kümesinden çıkarılır (§8b) · M6 `runLeaseExchange` kuyruğu
// atlanır (§9 kırmızı: LICENSE_LEASE_STALE).
// F1a (her biri uygulandı/geri alındı sha ile ölçüldü): N1 kimlik dosyası yazılmaz (§10a) · N2 yoklama
// DB kimliğiyle imzalanır (§2l · §10c) · N3 etkinleştirme gövdesi DB kimliği taşır (§10b) · N4 yeniden
// imza yok (§11a/b/d/e) · N5 ikinci ISTEK_ZAMAN'da da yeniden (§11e) · N6 zincir ucu durum kaydını
// yok sayar (§12c/§12d/§13c) · N7 geri alma denetimi kalkar (§12a/b) · N8 kira yokluğu "başarısız"
// (işlevde §13a, durum girdisinde §13a2; L2-5'te bellek işlevi kalktı, §13a imzalı kayıttan ölçer) · N9 etkin = kira dosyası var (§12e · §13b/§13a2/§13c · §14 ·
// §17b) · N10 her okuma hatası "yok" (§1h–§1l · §14a) ·
// N11 okunamayan belge YOK sayılır (§14a) · N12 kimlik yoksa motor pes eder (§15c) · N13 sayaç çağrı
// başına (§16a) · N14 veri gelince geri çekilme sıfırlanır (§17b) · N15 makine adı silinmez (§18a) ·
// N16 kapalı süre kredisi 0 (§19a/b) · N17 onaylanan taşıma lisans ister (§20c).
// I3-2 V1: N18 dikiş DB olgusundan okur (§21a/§21b) · N19 uygunluk dosyasına `getLicenseDbFacts`
// (§21c/§21e) · V6 N20 gözlem özeti kira dosyasına bakar (§13b2) — üçü de kırmızı, geri alınınca yeşil.
// L2-5 (uzatma dosyası · ikinci anahtar): L1 dosya yanıtı bekleyen istek ister (§24a) · L2 dosya ayak izi
// QR'la karışır (§24b) · L3 eski kira kapısı kalktı (§2k · §12d · §24e) · L4 ikinci anahtar durum kaydını
// saymaz (§13a/§13a2) — dördü de kırmızı, geri alınınca yeşil (sha ile ölçüldü).
// L2-10 (donanım bildirimi): N11 ONAYLANDI yanıtının kirası kabul edilmedi (§25e) · N12 bildirim yeniden ölçmedi (§25c)
// — ikisi de kırmızı, geri alınınca yeşil (sha ile ölçüldü).
// L2-7 (G4 iptal belgesi, §31; KAYNAK dosyada mutasyon, sha eşit geri alındı): S2 yeni kirada benimseme yok (§31b/c/d/d2/e3/j)
// · S3 aynı-kira tekrarında benimseme yok (§31k) · S4 düşük/eşit sıra kapısı kalktı (§31c/d/d2) · S5 onarım yok (§31d/d2) ·
// S6 pin yazılmaz (§31b/e/e3/j) · S7 değerlendirici susar (§31e/e2) · S8 birikime girmez (§31e) · S9 retteki ALT-iptali de
// benimsenir (§31g/i) · S10 retteki belge hiç benimsenmez (§31f) · S11 kabulde kira saati şimdiye girmez (§31h) · S12 durumda
// kira saati şimdiye girmez (§31h) · S13 doğrulanmamış iptal çekirdeğe geçer (§31i) · S14 eski satıcıya da bulgu (§31a + 8
// eski bölüm) · S15 detay KAYIP göstermez (§31e) · S16 durum iptalsiz doğrular (§31f) — 15'i de kırmızı, geri alınınca yeşil.
// L2-7 B (§32; KAYNAK dosyada mutasyon, sha eşit geri alındı): S17 canlı sonda kalktı (§32b) · S18 küme kararsız (§32c) ·
// S19 yoklamada yetenek yok (§32a) · S20 etkinleştirmede yok (§32a) · S21 parmak-izi-v2 düştü (§32a/b) · S22 satıcı isteği
// yolsuz (§32e/f) · S23 zil yolsuz (§32e) · S24 zarf donanım ucuna imzalı (§32g/h/i/j) · S28 donanım yanıtı tanınmaz
// (§32h/i/j) · S29 onaylı kiranın kaynağı (§32j) · S30 zarf yeniden ölçmez (§32g) · S31 BEKLIYOR kodu (§32h) — 12'si kırmızı.
// L2-9 (§33; `saat.ts` mutasyonu, sha eşit geri alındı): N1 max kaldırıldı → 8 ❌ (§33a ×3 · a2 · b · c · c2 · e) · N2 kabul
// anında duvar tabana girdi → 2 ❌ (§33b · e) · N3 kredi devri yok → 1 ❌ (§33e).
// Süreklilik yalnız taşınmışta (aynı yöntem): NA canlı yol da max'a girer → 2 ❌ (§33f · §32d — şişik taban sonraki bölüme
// sızar, canlı yoklama da söndüremez: cırcırın kendisi) · NB taşınmış yol da sunucu saatine iner → 9 ❌ (§33a ×3 · a2 · b · c · c2 · e · g).
// D8e-1c (§34; kaynakta mutasyon, md5 eşit geri alındı): Y1 kip dalı açılış yazımından sonraya → §34b (durum.json, iz) ·
// Y2 kapanış kapısı kalktı → §34b (durum.json, iz) · Y3 iptal onarım kapısı kalktı → §34b (iptal) · Y4 parmak izi önbellek
// kapısı kalktı → §34b (parmak-izi-onbellek.json) — dördü de kırmızı, geri alınınca yeşil.
// ⭐ KALICI SONDA ✓K1 (her koşumda): bilinmeyen kod genel mesaja düşer — §8a'nın "her kodun kendi
// mesajı var" karşılaştırıcısı kör değil.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { ensureInstallationIdentity, identityRetryDelayMs, __resetInstallationIdentityForTests } from "../src/jobs/installation-identity.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INSTALLATION_ID_SETTING_KEY, LICENSE_REVOCATION_SETTING_KEY, LICENSE_TRACE_SETTING_KEY, isReservedSettingKey } from "../src/constants/reserved-settings";
import { getLicenseStore, loadLicenseStoreSync, resolveLicenseDir, writeFileAtomicSync, LICENSE_FILES } from "../src/lib/license/store";
import {
  configureLicenseRuntimeForTests,
  getLicenseInstallationId,
  getLicenseSnapshot,
  getMeasuredFingerprint,
  peekObservationCounters,
  resetObservationCounters,
  setMeasuredFingerprint,
  invalidateLicenseSnapshot,
} from "../src/lib/license/runtime";
import { licenseHealthBlock } from "../src/lib/license/license-health";
import { applyModuleCeiling } from "../src/lib/license/module-ceiling";
import { runWithRequestContext } from "../src/lib/request-context";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import {
  DAY_MS,
  ENDPOINTS,
  HardwareReportRequestSchema,
  LicenseResponseSchema,
  VENDOR_ERROR_CODES,
  msToIso,
  openEnvelope,
  parseJws,
  verifyRequest,
  type Fingerprint,
  type LeaseDoc,
} from "../src/lib/license/protocol";
import {
  buildEnvironment,
  currentFingerprintDigest,
  describeOperatingSystem,
  egressTransport,
  requireReady,
  vendorFailureToError,
  vendorPost,
} from "../src/services/helpers/license-wire.helper";
import { capabilitiesFor, licenseCapabilities } from "../src/lib/license/capabilities";
import { tsLicenseCore, type LicenseCore } from "../src/lib/license/license-core";
import { unavailableCore } from "../src/lib/license/native-adapter";
import { configureLicenseCoreForTests, getLicenseCore } from "../src/lib/license/native";
import { signStateRecord, type EntitlementPin, type StateRecord } from "../src/lib/license/saat";
import { flushLicenseTraceWrites, lastKnownCeiling, type RecordView } from "../src/lib/license/accumulation";
import { persistAccumulation, setFingerprintCacheCopy } from "../src/lib/license/record-writer";
import { markLicenseTraceUnknown } from "../src/lib/license/trace-row";
import { ceilingAllows, verifyLicenseDocuments } from "../src/lib/license/state";
import { adoptRevocation, flushRevocationWrites } from "../src/lib/license/revocation-store";
import { refreshLicenseRevocation } from "../src/services/license-revocation.service";
import { verifyResponseDocuments } from "../src/services/helpers/license-accept.helper";
import { __resetLadderCountersForTests, __setLadderClockForTests } from "../src/lib/license/ladder-counters";
import {
  activateLicense,
  acceptOfflineResponse,
  buildOfflineRequest,
  getLicenseDetail,
  getLicenseStatus,
  getProxySettings,
  requestTransfer,
  updateProxySettings,
} from "../src/services/license.service";
import { buildPollBody, pollLicenseOnce, refreshLicenseDbFacts } from "../src/services/license-sync.service";
import { currentSignedSkew } from "../src/lib/license/signed-skew";
import { buildHardwareReportBody, reportHardwareChange } from "../src/services/license-hardware.service";
import { awaitIntegrityRefreshForTests, refreshLicenseIntegrity } from "../src/services/license-integrity.service";
import { configureIntegrityForTests, getIntegrityOutcome } from "../src/lib/license/integrity-state";
import { generatePackageKey, signPackageDirectory } from "./lib/butunluk-imza";
import {
  configureLicensePollForTests,
  nextPollDelayMs,
  runLicensePollOnce,
  startLicensePoll,
  __resetLicensePollForTests,
} from "../src/jobs/license-poll.job";
import {
  STABLE_CONNECTION_MS,
  kickLicenseDoorbell,
  reconnectAttempt,
  startLicenseDoorbell,
  __resetLicenseDoorbellForTests,
} from "../src/jobs/license-doorbell.job";
import { fiksturKur, kiraBas, hakBas, anahtarUret, araHakBas, araSertifikasi, iptalBas, iptalYuku, sertifikaBas, sertifikaYuku, type Fikstur } from "./lib/lisans-fikstur";
import { sahteSaticiBaslat, sahteProxyBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";
import { scanLicenseIdentitySeam } from "./lib/lisans-kimlik-dikisi";
import { kabulEt, temizleKabuller } from "./lib/lisans-kabul-fikstur";
import { logObservationSummaryIfDue, refreshLicenseTrace, __resetLicenseTrailForTests } from "../src/services/license-trail.service";
import { VERIFICATION_MODE_ENV } from "../src/lib/dogrulama-kipi";

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

const olaylar: Array<{ action: string; payload: unknown }> = [];
AuditService.logEvent = async (p) => {
  olaylar.push({ action: p.action, payload: p.payload ?? null });
};
for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"]) delete process.env[k];

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-motoru-"));
const bekle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function bekleKadar(kosul: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if (kosul()) return true;
    await bekle(100);
  }
  return kosul();
}
async function hataKodu(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "HATA_YOK";
  } catch (e) {
    const d = (e as { details?: { code?: string; vendorCode?: string } }).details;
    return [d?.code, d?.vendorCode].filter(Boolean).join("/") || String(e);
  }
}
function bozuk(jws: string): string {
  const [b, y, s] = jws.split(".");
  const imza = Buffer.from(s, "base64url");
  imza[5] ^= 0x01;
  return `${b}.${y}.${imza.toString("base64url")}`;
}

function nedenVar(s: { nedenler: readonly { kod: string }[] }, kod: string): boolean {
  return s.nedenler.some((n) => n.kod === kod);
}

function nedenAyrinti(s: { nedenler: readonly { kod: string; ayrinti: string | null }[] }, kod: string): string {
  return s.nedenler.find((n) => n.kod === kod)?.ayrinti ?? "";
}

function depoBolumu(): void {
  console.log("\n§1 — depo: yer, atomik yazım, anahtar");
  check("§1a varsayılan = kurulum kökü\\lisans (app\\ dışında)", resolveLicenseDir({}, "/k/app").dir === path.resolve("/k/lisans"));
  check("§1b ⭐ app\\ içi RED (kurulum app\\'i değiştirir)", resolveLicenseDir({ LICENSE_DIR: "/k/app/lisans" }, "/k/app").problem === "APP_ICINDE");
  check("§1c ⭐ BACKUP_DIR içi RED (offsite süpürücü Drive'a kopyalar)", resolveLicenseDir({ LICENSE_DIR: "/k/backups/l", BACKUP_DIR: "/k/backups" }, "/k/app").problem === "YEDEK_ICINDE");
  const dosya = path.join(GECICI, "a.json");
  writeFileAtomicSync(dosya, "bir");
  writeFileAtomicSync(dosya, "iki");
  const artik = fs.readdirSync(GECICI).filter((n) => n.includes(".tmp-"));
  check("§1d atomik yazım: içerik son yazım, geçici dosya kalmaz", fs.readFileSync(dosya, "utf8") === "iki" && artik.length === 0, artik.join(","));
  fs.mkdirSync(path.join(GECICI, "dizin"));
  let firladi = false;
  try {
    writeFileAtomicSync(path.join(GECICI, "dizin"), "x");
  } catch {
    firladi = true;
  }
  check("§1e yeniden adlandırma düşerse geçici dosya silinir", firladi && fs.readdirSync(GECICI).every((n) => !n.includes(".tmp-")));
  const d1 = path.join(GECICI, "d1");
  const a = loadLicenseStoreSync({ dir: d1 }).key?.kid;
  const b = loadLicenseStoreSync({ dir: d1 }).key?.kid;
  const mod = fs.statSync(path.join(d1, LICENSE_FILES.KEY)).mode & 0o777;
  check("§1f anahtar bir kez doğar, yeniden yüklemede aynı; dosya 0600", a !== undefined && a === b && (process.platform === "win32" || mod === 0o600), `mod=${mod.toString(8)}`);
  fs.writeFileSync(path.join(d1, LICENSE_FILES.KEY), "{bozuk");
  const c = loadLicenseStoreSync({ dir: d1 });
  check("§1g bozuk anahtar kenara alınır, yenisi üretilir", c.setAsideKeyFile !== null && c.key?.kid !== a && fs.existsSync(c.setAsideKeyFile ?? ""));

  // D1: yalnız ENOENT "yok"tur — boş / aşırı büyük / okunamayan anahtar dosyası sessizce DEĞİŞTİRİLMEZ.
  const anahtarDizini = (ad: string, icerik: string | null): { dizin: string; dosya: string } => {
    const dizin = path.join(GECICI, ad);
    fs.mkdirSync(dizin, { recursive: true });
    const dosya = path.join(dizin, LICENSE_FILES.KEY);
    if (icerik !== null) fs.writeFileSync(dosya, icerik, { mode: 0o600 });
    return { dizin, dosya };
  };
  const bos = anahtarDizini("d-bos", "");
  const e = loadLicenseStoreSync({ dir: bos.dizin });
  check(
    "§1h ⭐ boş anahtar dosyası → OKUNAMADI, anahtar ÜRETİLMEZ, dosya yerinde (sessiz anahtar değişimi yok)",
    e.problem === "OKUNAMADI" && e.key === null && fs.readFileSync(bos.dosya, "utf8") === "" && fs.readdirSync(bos.dizin).length === 1,
    `${e.problem} ${fs.readdirSync(bos.dizin).join(",")}`,
  );
  const buyuk = anahtarDizini("d-buyuk", "x".repeat(9 * 1024));
  const g = loadLicenseStoreSync({ dir: buyuk.dizin });
  check("§1i aşırı büyük anahtar dosyası → OKUNAMADI, üzerine yazılmaz", g.problem === "OKUNAMADI" && g.key === null && fs.statSync(buyuk.dosya).size === 9 * 1024);
  const dizinAnahtar = anahtarDizini("d-dizin", null);
  fs.mkdirSync(dizinAnahtar.dosya);
  check("§1j anahtar yerinde dizin → OKUNAMADI (yok sayılmaz)", loadLicenseStoreSync({ dir: dizinAnahtar.dizin }).problem === "OKUNAMADI");
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const kilitli = anahtarDizini("d-kilit", fs.readFileSync(path.join(d1, LICENSE_FILES.KEY), "utf8"));
    fs.chmodSync(kilitli.dosya, 0o000);
    try {
      const k = loadLicenseStoreSync({ dir: kilitli.dizin });
      check("§1k ⭐ okunamayan (izinsiz) anahtar → OKUNAMADI, yenisi ÜRETİLMEZ", k.problem === "OKUNAMADI" && k.key === null && fs.readdirSync(kilitli.dizin).length === 1);
    } finally {
      fs.chmodSync(kilitli.dosya, 0o600);
    }
    check("§1l karşı: izin dönünce AYNI anahtar yüklenir", loadLicenseStoreSync({ dir: kilitli.dizin }).key?.kid === c.key?.kid);
  } else {
    console.log("⏭️  §1k/§1l atlandı (Windows ya da root: izin kilidi ölçülemez)");
  }
}

interface Hazir {
  f: Fikstur;
  satici: SahteSatici;
  dizin: string;
  /** Fabrika DB'sinin `system.installationId`si — lisans kimliğinden (`f.kurulumId`, portal) AYRI. */
  dbKimligi: string;
}

async function kurulumuHazirla(): Promise<Hazir> {
  const dizin = path.join(GECICI, "motor");
  const key = loadLicenseStoreSync({ dir: dizin }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const kimlik = await ensureInstallationIdentity();
  const f0 = fiksturKur(Date.now());
  // Lisans kimliği portalda doğar (fikstürün rastgele kimliği) — DB kimliğiyle AYNI DEĞİL (D14).
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const satici = await sahteSaticiBaslat(f);
  satici.kod = "TKS-7K3M-9QRT-2XWZ-4HJN";
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: satici.url });
  setEgressTrustForTests(satici.ca);
  await refreshLicenseDbFacts(kimlik.installationId);
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date().toISOString() });
  return { f, satici, dizin, dbKimligi: kimlik.installationId };
}

function yeniden(dizin: string): void {
  loadLicenseStoreSync({ dir: dizin });
  invalidateLicenseSnapshot();
}

/** EN SONDA koşar: HAK sınıfını değiştirir (sonraki bölümler URETIM HAK'ına dayanır). */
async function hakButunlukBolumu(x: Hazir): Promise<void> {
  console.log("\n§22 — yeni HAK kabul edilince bütünlük HEMEN yeniden koşar (hazırlık anahtarının sınıf kararı)");
  const hazirlik = await hazirlikPaketi();
  try {
    await refreshLicenseIntegrity();
    const once = getIntegrityOutcome()?.kod ?? null;
    const simdi = new Date().toISOString();
    const hak = hakBas(x.f, { surum: 2, sinif: "TEST" });
    const kira = kiraBas(x.f, { hakSurum: 2, parmakIzi: x.f.parmakIzi, zorlama: false, verilis: simdi, sunucuSaati: simdi });
    await acceptOfflineResponse({ v: 1, hak, kira, indirmeBelirtecleri: [], sunucuSaati: simdi }, "aktarma", null);
    await awaitIntegrityRefreshForTests();
    const sonra = getIntegrityOutcome();
    check(
      "§22a ⭐ ÜRETİM HAK'ında hazırlık imzası RED → TEST sınıflı yeni HAK kabul edilir edilmez bütünlük yeniden koşar (günlük tur beklenmez)",
      once === "BUTUNLUK_HAZIRLIK_ANAHTARI" && sonra?.durum === "GECERLI",
      `önce ${once} · sonra ${sonra?.durum}/${sonra?.kod}`,
    );
    const b = getLicenseDetail().butunluk;
    check(
      "§22b detay ucu (license:view): çekirdek kaynağı + bütünlük durumu + imzalı paketId; dosya adı YOK, yalnız sayılar",
      (b.cekirdek === "native" || b.cekirdek === "ts") && b.durum === "GECERLI" && b.paketId !== null && b.paketId === sonra?.rapor?.paket?.paketId &&
        b.sayilar?.dosya === 1 && b.sayilar.fazla === 0 && !JSON.stringify(b).includes("server.js"),
      JSON.stringify(b),
    );
  } finally {
    configureIntegrityForTests(null);
    fs.rmSync(hazirlik, { recursive: true, force: true });
  }
}

/**
 * §22'den SONRA: etkinleşmemiş yeni makinede hazırlık paketi (sınıf bilinmiyor → OLCULEMEDI) ve ilk etkinleştirme.
 * Arka plandaki yeniden denetim BEKLENMEDEN yanıt, yoklama gövdesi ve satıcıya giden yoklama yeni sınıfın kararını taşır.
 */
async function etkinlestirmeButunlukBolumu(x: Hazir): Promise<void> {
  console.log("\n§23 — ilk etkinleştirmede bütünlük kararı HEMEN yeni HAK'ın sınıfıyla (yanıt · yoklama gövdesi · ayak izi)");
  const hazirlik = await hazirlikPaketi();
  const onceki = { kod: x.satici.kod, hakEk: x.satici.hakEk };
  try {
    yeniden(path.join(GECICI, "hazirlik-makine"));
    await kabulEt();
    await refreshLicenseIntegrity();
    const once = getIntegrityOutcome();
    x.satici.hakEk = { sinif: "TEST" };
    x.satici.kod = "TKS-HZRK-4K0D-9QRT-7PVW";
    const d = await activateLicense(x.satici.kod, null);
    // Gövde ve yoklama, arka plandaki yeniden denetim başlamadan (aynı tikte) kurulur — sahadaki etkinleştirme + zil yoklaması.
    const [govde, y] = await Promise.all([buildPollBody(), pollLicenseOnce()]);
    const nedenler = d.durum.nedenler.map((n) => n.kod);
    const bayat = ["BUTUNLUK_OLCULEMEDI", "DERLEME_TARIHI_YOK"];
    check(
      "§23a ⭐ etkinleştirme yanıtı: sınıfsız OLCULEMEDI kalmaz — bütünlük GECERLI, durum GECERLI, BUTUNLUK_OLCULEMEDI/DERLEME_TARIHI_YOK yok",
      once?.kod === "BUTUNLUK_SINIF_BILINMIYOR" && d.butunluk.durum === "GECERLI" && d.durum.gecerlilik === "GECERLI" && !nedenler.some((n) => bayat.includes(n)),
      `önce ${once?.kod} · sonra ${d.butunluk.durum}/${d.durum.gecerlilik} ${nedenler.join(",")}`,
    );
    check(
      "§23b ⭐ yoklama gövdesi taze durumu taşır (satıcıya OLCULEMEDI raporlanmaz)",
      govde.durum.gecerlilik === "GECERLI" && !govde.durum.nedenler.some((n) => bayat.includes(n)),
      `${govde.durum.gecerlilik} ${govde.durum.nedenler.join(",")}`,
    );
    const alinan = x.satici.yoklamaGovdeleri.at(-1) as { durum?: { gecerlilik?: string; nedenler?: string[] } } | undefined;
    check(
      "§23c ⭐ satıcının aldığı ilk yoklama GECERLI (portala OLCULEMEDI düşmez)",
      y.outcome === "BASARILI" && alinan?.durum?.gecerlilik === "GECERLI" && !(alinan.durum.nedenler ?? []).some((n) => bayat.includes(n)),
      `${y.outcome} ${alinan?.durum?.gecerlilik} ${(alinan?.durum?.nedenler ?? []).join(",")}`,
    );
    await awaitIntegrityRefreshForTests();
    const iz = olaylar.length;
    fs.appendFileSync(path.join(hazirlik, "dist", "server.js"), "// yama\n");
    await refreshLicenseIntegrity();
    const gecis = olaylar.slice(iz).find((o) => o.action === "LICENSE_STATE_CHANGED")?.payload as { yeni?: { gecerlilik?: string } } | undefined;
    check(
      "§23d ⭐ bütünlük sonucu durumu HEMEN değerlendirir: uyuşmazlık ayak izine yoklama/bakım tikini beklemeden düşer",
      getIntegrityOutcome()?.durum === "GECERSIZ" && gecis?.yeni?.gecerlilik === "GECERSIZ",
      `${getIntegrityOutcome()?.kod} · geçiş ${gecis?.yeni?.gecerlilik ?? "YOK"}`,
    );
  } finally {
    x.satici.kod = onceki.kod;
    x.satici.hakEk = onceki.hakEk;
    configureIntegrityForTests(null);
    fs.rmSync(hazirlik, { recursive: true, force: true });
    yeniden(x.dizin);
  }
}

/** Hazırlık PAKET anahtarıyla imzalı küçük paket; bütünlük hedefi olarak kurulur (sınıf kuralı HAK'a bağlı). */
async function hazirlikPaketi(): Promise<string> {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-motor-hazirlik-"));
  fs.mkdirSync(path.join(kok, "dist"));
  fs.writeFileSync(path.join(kok, "dist", "server.js"), "// hazırlık paketi\n");
  const k = generatePackageKey("paket-hazirlik-motor", ["TEST"]);
  const key = { kid: k.kid, x: k.x, privateKey: createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x, d: k.d }, format: "jwk" }) };
  await signPackageDirectory({ root: kok, key, urun: "backend", surum: "2.12.0", derlemeTarihi: new Date().toISOString(), musteri: null });
  configureIntegrityForTests({ root: kok, keys: [{ kid: k.kid, x: k.x }] });
  return kok;
}

async function etkinlestirmeBolumu(x: Hazir): Promise<void> {
  console.log("\n§2 — etkinleştirme uçtan uca (sahte satıcı, yerel HTTPS)");
  check("§2a kimliksiz durum çağrısına ayrıntı YOK", JSON.stringify(getLicenseStatus(false)) === '{"ayrinti":false}');
  const once = await pollLicenseOnce();
  check("§2b ⭐ etkinleşmemiş kurulum YOKLAMAZ (satıcıya istek gitmez)", once.outcome === "ETKIN_DEGIL" && x.satici.sayac.yokla === 0, once.outcome);
  const kabulsuz = await hataKodu(activateLicense(x.satici.kod, null));
  check("§2b2 ⭐ sözleşme kabulü yokken etkinleştirme satıcıya GİTMEDEN 409 (Ek-7)", kabulsuz === "LICENSE_ACCEPTANCE_REQUIRED" && x.satici.sayac.etkinlestir === 0, kabulsuz);
  await kabulEt();
  check("§2c yanlış kod → satıcı reddi TR mesajla", (await hataKodu(activateLicense("TKS-1111-1111-1111-1111", null))) === "LICENSE_VENDOR_REJECTED/ETKINLESTIRME_KODU_GECERSIZ");
  const d = await activateLicense(x.satici.kod.toLowerCase().replace(/-/g, " "), null);
  check("§2d ⭐ doğru kod (elle yazım normalleşir) → etkin, GEÇERLİ, gözlem", d.kurulum.etkin && d.durum.gecerlilik === "GECERLI" && d.durum.kip === "gozlem", `${d.durum.gecerlilik}/${d.durum.nedenler.map((n) => n.kod).join(",")}`);
  check("§2e HAK + kira + durum kaydı diske yazıldı", [LICENSE_FILES.ENTITLEMENT, LICENSE_FILES.LEASE, LICENSE_FILES.STATE].every((n) => fs.existsSync(path.join(x.dizin, n))));
  check("§2f ayak izi: kira kabulü + yönetici eylemi", olaylar.some((o) => o.action === "LICENSE_LEASE_ACCEPTED") && olaylar.some((o) => o.action === "LICENSE_ADMIN_ACTION"));
  const s = getLicenseStatus(true);
  check("§2g durum özeti: lisans no + sahip (Hakkında filigranı)", s.ayrinti && s.lisansNo === "TKS-2026-0001" && s.lisansSahibi?.musteri === "Deneme Tekstil");
  check("§2h ikinci etkinleştirme 409", (await hataKodu(activateLicense(x.satici.kod, null))) === "LICENSE_ALREADY_ACTIVE");
  const hak = hakBas(x.f);
  const kira = kiraBas(x.f, { parmakIzi: x.f.parmakIzi, zorlama: false });
  check("§2i ⭐ kurcalı kira (imza) RED", (await hataKodu(acceptOfflineResponse({ v: 1, hak, kira: bozuk(kira), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() }, "aktarma", null))) === "LICENSE_RESPONSE_INVALID");
  const baska = { ...x.f, kurulumId: randomUUID() };
  const yabanci = { v: 1, hak: hakBas(baska), kira: kiraBas(baska, { zorlama: false }), indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() };
  check("§2j ⭐ başka kuruluma ait kira RED", (await hataKodu(acceptOfflineResponse(yabanci, "cevrimdisi", null))) === "LICENSE_RESPONSE_INVALID");
  const eski = kiraBas(x.f, { verilis: new Date(Date.now() - 3 * 86_400_000).toISOString(), sunucuSaati: new Date(Date.now() - 3 * 86_400_000).toISOString(), zorlama: false });
  check("§2k eski kira geri oynatılamaz", (await hataKodu(acceptOfflineResponse({ v: 1, hak, kira: eski, indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() }, "aktarma", null))) === "LICENSE_LEASE_STALE");
  const cv = await buildOfflineRequest({ amac: "yokla" });
  const z = openEnvelope(cv.zarf);
  const dog = z.ok ? verifyRequest(z.value.request, { publicKeyX: x.f.kurulum.x, body: z.value.body, nowMs: Date.now(), purposes: ["yokla"], installationId: x.f.kurulumId }) : null;
  check("§2l çevrimdışı zarf: kurulum anahtarıyla imzalı yoklama isteği", dog?.ok === true && cv.istekGovdesi.zarf === cv.zarf);
}

async function durumKaydiBolumu(x: { f: Fikstur; dizin: string }): Promise<void> {
  console.log("\n§3 — durum.json: imzalı birikim; bozuk/yabancı kayıt kullanılmaz, DB izindeki kopya sürdürür (G12)");
  const sira0 = getLicenseSnapshot().durumKaydi.sira ?? -1;
  check("§3a geçerli kayıt; saatlik yazım sırayı artırır", persistAccumulation() && (getLicenseSnapshot().durumKaydi.sira ?? -1) === sira0 + 1);
  await flushLicenseTraceWrites();
  const yol = path.join(x.dizin, LICENSE_FILES.STATE);
  const asil = fs.readFileSync(yol, "utf8");
  const jws = (JSON.parse(asil) as { jws: string }).jws;
  const kopyaBirikim = getLicenseSnapshot().view.record?.birikenMs ?? -1;
  fs.writeFileSync(yol, JSON.stringify({ v: 1, jws: bozuk(jws) }));
  yeniden(x.dizin);
  const s = getLicenseSnapshot();
  check(
    "§3b ⭐ bozuk imzalı durum.json kullanılmaz → LISANS_IZI_KAYIP(DURUM), ÖLÇÜLEMEDİ; DB izindeki kopya geçerli (monotonik ölçülür)",
    s.state.gecerlilik === "OLCULEMEDI" && nedenAyrinti(s.state, "LISANS_IZI_KAYIP").includes("DURUM") && !s.view.fileValid && s.view.traceValid && !nedenVar(s.state, "DURUM_DOSYASI"),
    s.state.nedenler.map((n) => `${n.kod}:${n.ayrinti ?? ""}`).join(","),
  );
  const yazdi = persistAccumulation();
  const yeni = durumKaydiAlani(x.dizin);
  check(
    "§3c ⭐ bozuk kayıt aynı kira için SIFIRDAN başlatılmaz: birikim DB izindeki kopyadan SÜRER, iz kaybı kalıcı bayrakla yazılır",
    yazdi && Number(yeni.birikenMs) >= kopyaBirikim && kopyaBirikim >= 0 && JSON.stringify(yeni.izKaybi ?? {}).includes("DURUM"),
    `birikim ${String(yeni.birikenMs)} ≥ ${kopyaBirikim} · iz ${JSON.stringify(yeni.izKaybi)}`,
  );
  const yabanci = anahtarUret("kur-yabanci");
  const kayit = { v: 1 as const, kurulumId: x.f.kurulumId, kiraId: getLicenseSnapshot().lease?.document.kiraId ?? randomUUID(), birikenMs: 0, yazildi: new Date().toISOString(), yuksekSu: new Date().toISOString(), sonKiraZorlamasi: false, sonYaptirim: null, sira: 99 };
  fs.writeFileSync(yol, JSON.stringify({ v: 1, jws: signStateRecord(kayit, yabanci.privateKey, yabanci.x) }));
  yeniden(x.dizin);
  const d = getLicenseSnapshot();
  check("§3d başka anahtarla imzalı kayıt kullanılmaz (sıra 99 kazanmaz) → ÖLÇÜLEMEDİ", !d.view.fileValid && d.durumKaydi.sira !== 99 && d.state.gecerlilik === "OLCULEMEDI", `sıra ${String(d.durumKaydi.sira)}`);
}

async function yoklamaBolumu(x: { satici: SahteSatici }): Promise<void> {
  console.log("\n§4 — yoklama: yeni kira kabul, durum kaydı yeni kiraya sıfırlanır");
  const eskiKira = getLicenseSnapshot().lease?.document.kiraId;
  const sonuc = await runLicensePollOnce();
  const snap = getLicenseSnapshot();
  check("§4a ⭐ yoklama BAŞARILI → yeni kira", sonuc === "BASARILI" && snap.lease?.document.kiraId !== eskiKira, String(sonuc));
  check("§4b yeni kirayla durum kaydı yeniden geçerli (monotonik ölçülür)", snap.durumKaydi.gecerli && !snap.state.nedenler.some((n) => n.kod === "DURUM_DOSYASI"));
  x.satici.kiraEk = { zorlama: false, yaptirim: { kademe: "K5", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
  await runLicensePollOnce();
  const s = getLicenseStatus(true);
  const h = getLicenseSnapshot().state.hesaplananKademe;
  check("§4c ⭐ gözlemde K5 hesaplanır ama UYGULANMAZ (sıfır fark)", h === "DURDURULMUS" && s.ayrinti && s.kademe === "NORMAL" && s.bant === null, `${h}→${s.ayrinti ? s.kademe : "?"}`);
  check("§4d yaptırım değişimi deftere", olaylar.some((o) => o.action === "LICENSE_SANCTION_CHANGED"));
  x.satici.kiraEk = {};
  await runLicensePollOnce();
}

async function zilBolumu(x: { satici: SahteSatici }): Promise<void> {
  console.log("\n§5 — kapı zili: bağlan, zil(lisans) → hemen yokla");
  startLicensePoll();
  startLicenseDoorbell();
  const bagli = await bekleKadar(() => x.satici.sayac.zil >= 1, 15_000);
  const ilk = x.satici.sayac.yokla;
  await bekleKadar(() => x.satici.sayac.yokla > ilk, 8000);
  await bekle(5500);
  const oncesi = x.satici.sayac.yokla;
  x.satici.zil("ozet");
  await bekle(6000);
  check("§5a zil aboneliği kuruldu (imzalı SSE)", bagli);
  check("§5b karşı: başka konulu zil (ozet) lisans yoklatmaz", x.satici.sayac.yokla === oncesi, `${oncesi}→${x.satici.sayac.yokla}`);
  x.satici.zil("lisans");
  const yoklandi = await bekleKadar(() => x.satici.sayac.yokla > oncesi, 10_000);
  check("§5c ⭐ zil(lisans) → yoklama saniyeler içinde", yoklandi, `${oncesi}→${x.satici.sayac.yokla}`);
  __resetLicenseDoorbellForTests();
  __resetLicensePollForTests();
}

async function proxyBolumu(x: { dizin: string }): Promise<void> {
  console.log("\n§6 — proxy: panel ayarı → CONNECT tüneli; kimlik bilgisi sızmaz");
  const px = await sahteProxyBaslat();
  try {
    const olaySayisi = olaylar.length;
    const ayar = updateProxySettings({ adres: px.adres.replace("http://", "http://kullanici:gizli-parola@"), atla: null }, null);
    check("§6a ekran/uç kimlik bilgisini maskeler", ayar.kaynak === "panel" && ayar.adres !== null && ayar.adres.includes("***") && !ayar.adres.includes("gizli"), String(ayar.adres));
    check("§6b ⭐ audit yükünde parola YOK", !JSON.stringify(olaylar.slice(olaySayisi)).includes("gizli-parola"));
    const mod = fs.statSync(path.join(x.dizin, LICENSE_FILES.PROXY)).mode & 0o777;
    check("§6c proxy.json 0600 (kimlik bilgisi taşıyabilir)", process.platform === "win32" || mod === 0o600, mod.toString(8));
    const sonuc = await runLicensePollOnce();
    check("§6d ⭐ yoklama proxy TÜNELİ üzerinden (yeniden başlatmasız)", sonuc === "BASARILI" && px.tuneller >= 1, `${String(sonuc)} tünel=${px.tuneller}`);
    check("§6e proxy kimlik doğrulaması iletildi", px.yetkiBasliklari.some((b) => b.startsWith("Basic ")));
    updateProxySettings({ adres: null, atla: null }, null);
    const t = px.tuneller;
    await runLicensePollOnce();
    check("§6f karşı: ayar kaldırılınca doğrudan (tünel yok)", px.tuneller === t && getProxySettings().kaynak === "yok");
  } finally {
    await px.kapat();
  }
}

async function siraBolumu(x: { satici: SahteSatici }): Promise<void> {
  console.log("\n§9 — kira alışverişleri SIRALI: eşzamanlı iki yoklama ters sırada kabul edilmez");
  // İlk yoklamanın kirası ÖNCE basılır ama yanıtı geç gelir; ikincisi hemen döner. Sırasız motorda
  // yeni kira önce yazılır, eskisi LICENSE_LEASE_STALE ile düşer (zil + "şimdi yokla" / DR yarışı).
  const once = getLicenseSnapshot().lease?.document.kiraId;
  x.satici.sonrakiYanitGecikmesiMs = 800;
  const [r1, r2] = await Promise.all([pollLicenseOnce(), pollLicenseOnce()]);
  check(
    "§9a ⭐ eşzamanlı iki yoklama: ikisi de BAŞARILI (sahte LICENSE_LEASE_STALE / başarısız yoklama yok)",
    r1.outcome === "BASARILI" && r2.outcome === "BASARILI",
    `${r1.outcome}${r1.code ? ` ${r1.code}` : ""} / ${r2.outcome}${r2.code ? ` ${r2.code}` : ""}`,
  );
  check("§9b ikinci yoklama birincinin kirasını sundu (zincir ucu ilerledi)", getLicenseSnapshot().lease?.document.kiraId !== once);
}

async function kimlikBolumu(x: Hazir): Promise<void> {
  console.log("\n§10 — lisans kimliği LICENSE_DIR'de (D14): etkinleştirme yanıtından öğrenilir, DB kimliği yalnız bilgi");
  const d = getLicenseDetail();
  const kimlikYolu = path.join(x.dizin, LICENSE_FILES.IDENTITY);
  const dosya = (fs.existsSync(kimlikYolu) ? JSON.parse(fs.readFileSync(kimlikYolu, "utf8")) : {}) as { kurulumId?: string };
  check(
    "§10a ⭐ lisans kimliği etkinleştirme yanıtından öğrenildi, LICENSE_DIR'e yazıldı (DB kimliği DEĞİL)",
    d.kurulum.kurulumId === x.f.kurulumId && dosya.kurulumId === x.f.kurulumId && x.f.kurulumId !== x.dbKimligi && d.kurulum.veritabaniKimligi === x.dbKimligi,
    `${d.kurulum.kurulumId?.slice(0, 8)} / db ${x.dbKimligi.slice(0, 8)}`,
  );
  const et = x.satici.istekler.filter((i) => i.amac === "etkinlestir");
  check("§10b etkinleştirme isteği kimlik TAŞIMAZ (imza + gövde)", et.length >= 1 && et.every((i) => i.kimlik === null && i.govdeKimligi === null), JSON.stringify(et.slice(-1)));
  const baskaDb = randomUUID();
  await refreshLicenseDbFacts(baskaDb);
  const r = await pollLicenseOnce();
  const son = x.satici.istekler.filter((i) => i.amac === "yokla").at(-1);
  const govde = (x.satici.yoklamaGovdeleri.at(-1) ?? {}) as { ortam?: { installationId?: string } };
  check(
    "§10c ⭐ DB kimliği değişse de (döküm/DR kopyası) lisans kimliği aynı; yoklama lisans kimliğiyle imzalı → BASARILI",
    r.outcome === "BASARILI" && getLicenseDetail().kurulum.kurulumId === x.f.kurulumId && son?.kimlik === x.f.kurulumId,
    `${r.outcome} ${r.code ?? ""} imza=${son?.kimlik?.slice(0, 8)}`,
  );
  check("§10d ortam.installationId = DB kimliği (yalnız bilgi)", govde.ortam?.installationId === baskaDb);
  await refreshLicenseDbFacts(x.dbKimligi);
  yeniden(path.join(GECICI, "db-kopyasi"));
  const k = getLicenseDetail();
  const once = x.satici.sayac.yokla;
  const kp = await pollLicenseOnce();
  check(
    "§10e ⭐ aynı DB + taze LICENSE_DIR (DB kopyası) → lisans kimliği YOK, etkin değil, dışarı istek yok",
    k.kurulum.kurulumId === null && !k.kurulum.etkin && k.kurulum.veritabaniKimligi === x.dbKimligi && kp.outcome === "ETKIN_DEGIL" && x.satici.sayac.yokla === once,
    `${k.kurulum.kurulumId} ${kp.outcome}`,
  );
  yeniden(x.dizin);
}

/** §21 — tek dikiş (I3-2 V1): lisans, zil, eşitleme ve gelen kutusu AYNI kimliği okur. */
function tekDikisBolumu(x: Hazir): void {
  console.log("\n§21 — lisans kimliği TEK dikişten: imza · zil · patron bulutu eşitleme · gelen kutusu");
  const dikis = getLicenseInstallationId();
  check(
    "§21a ⭐ getLicenseInstallationId = anlık görüntünün lisans kimliği = requireReady().licenseId (DB kimliği DEĞİL)",
    dikis === x.f.kurulumId && dikis === getLicenseSnapshot().licenseId && requireReady().licenseId === dikis && dikis !== x.dbKimligi,
    `${dikis?.slice(0, 8)} / db ${x.dbKimligi.slice(0, 8)}`,
  );
  const t = scanLicenseIdentitySeam();
  check("§21b ⭐ dikişin gövdesi LICENSE_DIR kimliğini okur, DB olgusuna dokunmaz", t.seamReadsLicenseStore);
  check("§21c ⭐ getLicenseDbFacts yalnız BEYANLI bilgi yüzeylerinde (yeni okuyucu = kırmızı)", t.undeclaredDbFactsReaders.length === 0, t.undeclaredDbFactsReaders.join(","));
  check("§21d beyan ölü değil (okumayan dosya beyandan düşer)", t.staleDeclarations.length === 0, t.staleDeclarations.join(","));
  check(
    "§21e ⭐ kimlik kanalları (eşitleme · gelen kutusu · zil · uygunluk) DB kimliği kaynağı almaz; dosyaları yerinde",
    t.channelViolations.length === 0 && t.missingChannelFiles.length === 0,
    [...t.channelViolations, ...t.missingChannelFiles.map((f) => `YOK:${f}`)].join(","),
  );
}

function durumKaydiAlani(dizin: string): Record<string, unknown> {
  const jws = (JSON.parse(fs.readFileSync(path.join(dizin, LICENSE_FILES.STATE), "utf8")) as { jws: string }).jws;
  const p = parseJws(jws);
  return p.ok ? (p.value.payload as Record<string, unknown>) : {};
}

async function saatKaymasiBolumu(x: Hazir): Promise<void> {
  console.log("\n§11 — satıcı saati (D4): ISTEK_ZAMAN'da BİR KEZ düzeltilmiş damga; SAAT_KAYIK bilgi, kademe düşmez");
  const once = getLicenseSnapshot().state;
  x.satici.saatKaymasiMs = 20 * 60_000;
  const z0 = x.satici.sayac.zaman;
  const y0 = x.satici.sayac.yokla;
  const r = await pollLicenseOnce();
  const s = getLicenseSnapshot().state;
  const govde = (x.satici.yoklamaGovdeleri.at(-1) ?? {}) as { saat?: { saticiSapmaSn?: number } };
  check(
    "§11a ⭐ ISTEK_ZAMAN + sunucuSaati → sapma öğrenilir, istek BİR KEZ düzeltilmiş damgayla → BASARILI",
    r.outcome === "BASARILI" && x.satici.sayac.zaman === z0 + 1 && x.satici.sayac.yokla === y0 + 1,
    `${r.outcome} ${r.code ?? ""} red=${x.satici.sayac.zaman - z0}`,
  );
  check(
    "§11b SAAT_KAYIK nedeni + yoklamada saticiSapmaSn ≈ −1200 (duvar − satıcı)",
    s.nedenler.some((n) => n.kod === "SAAT_KAYIK") && Math.abs((govde.saat?.saticiSapmaSn ?? 0) + 1200) <= 5,
    `${s.nedenler.map((n) => n.kod).join(",")} sapma=${govde.saat?.saticiSapmaSn}`,
  );
  check(
    "§11c ⭐ kademe ve geçerlilik saat kaymasından DÜŞMEZ (güvenilir saat satıcı saatine yaslanmaz)",
    s.hesaplananKademe === once.hesaplananKademe && s.gecerlilik === once.gecerlilik && Math.abs(s.saat.trustedMs - Date.now()) < 60_000,
    `${once.gecerlilik}/${once.hesaplananKademe} → ${s.gecerlilik}/${s.hesaplananKademe}`,
  );
  const kayitSapma = durumKaydiAlani(x.dizin).saticiSapmaSn;
  check("§11d sapma durum kaydında (yeniden başlatmada kaybolmaz)", typeof kayitSapma === "number" && Math.abs(kayitSapma + 1200) <= 5, String(kayitSapma));
  x.satici.sunucuSaatiYalaniMs = 30 * 60_000;
  const z1 = x.satici.sayac.zaman;
  const r2 = await pollLicenseOnce();
  check("§11e ⭐ ikinci ISTEK_ZAMAN'da DURUR (tam iki deneme)", r2.outcome === "BASARISIZ" && r2.code === "ISTEK_ZAMAN" && x.satici.sayac.zaman === z1 + 2, `${r2.outcome} ${r2.code ?? ""} red=${x.satici.sayac.zaman - z1}`);
  x.satici.sunucuSaatiYalaniMs = 0;
  x.satici.sunucuSaatiDondur = false;
  const z2 = x.satici.sayac.zaman;
  const r3 = await pollLicenseOnce();
  check("§11f karşı: eski satıcı (sunucuSaati yok) → yeniden imza YOK, tek deneme", r3.outcome === "BASARISIZ" && x.satici.sayac.zaman === z2 + 1, `${r3.outcome} red=${x.satici.sayac.zaman - z2}`);
  x.satici.sunucuSaatiDondur = true;
  // Zil de aynı kuralla: ilk bağlantı ISTEK_ZAMAN alır, düzeltilmiş damgayla bağlanır.
  const zil0 = x.satici.sayac.zil;
  const zz = x.satici.sayac.zaman;
  startLicenseDoorbell();
  kickLicenseDoorbell();
  const bagli = await bekleKadar(() => x.satici.sayac.zil > zil0, 10_000);
  check("§11g zil: ISTEK_ZAMAN → bir kez düzeltilmiş damgayla abone olur", bagli && x.satici.sayac.zaman === zz + 1, `bağlandı=${bagli} red=${x.satici.sayac.zaman - zz}`);
  __resetLicenseDoorbellForTests();
  x.satici.saatKaymasiMs = 0;
  const z3 = x.satici.sayac.zaman;
  const r4 = await pollLicenseOnce();
  const s4 = getLicenseSnapshot().state;
  check(
    "§11h karşı: saat tutarlıya dönünce düzeltmesiz damga kabul → SAAT_KAYIK kalkar",
    r4.outcome === "BASARILI" && x.satici.sayac.zaman === z3 && !s4.nedenler.some((n) => n.kod === "SAAT_KAYIK"),
    `${r4.outcome} ${s4.nedenler.map((n) => n.kod).join(",")}`,
  );
  // İmzalı saat sapması (§B-3): canlı yeni kiranın imzalı `sunucuSaati`nden ölçülür; yalnız bilgi, kademeye girmez.
  const imzOnce = getLicenseSnapshot().state;
  x.satici.kiraSaatiKaymasiMs = -7 * 60_000;
  const r5 = await pollLicenseOnce();
  const s5 = getLicenseSnapshot().state;
  const imz = currentSignedSkew();
  check("§11i ⭐ canlı yeni kira imzalı saati 7 dk geride → sapma UYARI ≈ +420 sn", r5.outcome === "BASARILI" && imz.durum === "UYARI" && Math.abs((imz.sapmaSn ?? 0) - 420) <= 5, `${r5.outcome} ${imz.durum} ${imz.sapmaSn}`);
  check(
    "§11j ⭐ karşı: imzalı sapma kademe/geçerlilik/nedenlere GİRMEZ",
    s5.hesaplananKademe === imzOnce.hesaplananKademe && s5.gecerlilik === imzOnce.gecerlilik && s5.nedenler.map((n) => n.kod).join() === imzOnce.nedenler.map((n) => n.kod).join(),
    `${imzOnce.gecerlilik}/${imzOnce.hesaplananKademe}/${imzOnce.nedenler.map((n) => n.kod).join()} → ${s5.gecerlilik}/${s5.hesaplananKademe}/${s5.nedenler.map((n) => n.kod).join()}`,
  );
  const saglikSapma = (licenseHealthBlock().saatSapmasi ?? null) as { durum?: string; sapmaSn?: number } | null;
  check("§11k sağlık bloğunda saatSapmasi UYARI", saglikSapma?.durum === "UYARI" && Math.abs((saglikSapma.sapmaSn ?? 0) - 420) <= 5, JSON.stringify(saglikSapma));
  const saatBandiMi = (b: { metin: string }): boolean => b.metin.startsWith("Sunucu saati lisans sunucusunun imzalı saatinden");
  const durumUcu = getLicenseStatus(true);
  const saatBandi = durumUcu.ayrinti ? durumUcu.bantlar.find(saatBandiMi) : undefined;
  check(
    "§11l ⭐ /durum bantlar[] saat bandını taşır (ayrı alan değil) ve bant = bantlar[0]",
    !!saatBandi && saatBandi.ton === "uyari" && saatBandi.metin.includes("7 dk ileride") && durumUcu.ayrinti && durumUcu.bant === durumUcu.bantlar[0] && !("saatSapmasi" in durumUcu),
    saatBandi?.metin ?? "bant yok",
  );
  const sonrakiGovde = await buildPollBody();
  check("§11m sonraki yoklama gövdesinde saat.imzaliSapmaSn ≈ +420", Math.abs((sonrakiGovde.saat.imzaliSapmaSn ?? 0) - 420) <= 5, String(sonrakiGovde.saat.imzaliSapmaSn));
  x.satici.kiraSaatiKaymasiMs = -4 * 60_000;
  await pollLicenseOnce();
  const imz4 = currentSignedSkew();
  const durum4 = getLicenseStatus(true);
  check(
    "§11n karşı: eşik altı (4 dk) → TUTARLI, saat bandı kalkar, alan yine gider",
    imz4.durum === "TUTARLI" && Math.abs((imz4.sapmaSn ?? 0) - 240) <= 5 && durum4.ayrinti && !durum4.bantlar.some(saatBandiMi) && (await buildPollBody()).saat.imzaliSapmaSn !== undefined,
    `${imz4.durum} ${imz4.sapmaSn}`,
  );
  x.satici.kiraSaatiKaymasiMs = 0;
  await pollLicenseOnce();
  // Taşınmış kira (dosya/QR) ölçmez: imzalı saati geçmiştedir.
  const tasOnce = currentSignedSkew();
  const tasKiraOnce = getLicenseSnapshot().lease?.document.kiraId;
  const tasSimdi = Date.now();
  const tasKira = kiraBas(x.f, { parmakIzi: currentFingerprintDigest(), zorlama: false, verilis: msToIso(tasSimdi), sunucuSaati: msToIso(tasSimdi - 7 * 60_000) });
  await acceptOfflineResponse({ v: 1, hak: getLicenseStore()?.entitlementJws ?? hakBas(x.f), kira: tasKira, indirmeBelirtecleri: [], sunucuSaati: msToIso(tasSimdi) }, "aktarma", null);
  const tasSonra = currentSignedSkew();
  const tasKiraSonra = getLicenseSnapshot().lease?.document.kiraId;
  check(
    "§11o karşı: taşınmış kira imzalı sapmayı ölçmez (ölçüm anı değişmez, TUTARLI kalır)",
    tasKiraOnce !== tasKiraSonra && tasOnce.olcumAni !== null && tasSonra.olcumAni === tasOnce.olcumAni && tasSonra.durum === "TUTARLI",
    `kira ${tasKiraOnce?.slice(0, 8)}→${tasKiraSonra?.slice(0, 8)} · ${tasOnce.olcumAni} → ${tasSonra.olcumAni} ${tasSonra.durum}`,
  );
}

async function geriAlmaBolumu(x: Hazir): Promise<void> {
  console.log("\n§12 — geri alma (D2): eski kira dosyası yaptırımı kaldırmaz; silip eski yanıtı yapıştırmak da");
  const kiraYolu = path.join(x.dizin, LICENSE_FILES.LEASE);
  const eskiKira = fs.readFileSync(kiraYolu, "utf8").trim();
  x.satici.kiraEk = { zorlama: false, yaptirim: { kademe: "K5", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
  const r = await pollLicenseOnce();
  x.satici.kiraEk = {};
  const k5Kira = getLicenseSnapshot().lease?.document.kiraId;
  check("§12 ön koşul: K5 kirası kabul edildi (hesaplanan DURDURULMUŞ)", r.outcome === "BASARILI" && getLicenseSnapshot().state.hesaplananKademe === "DURDURULMUS");
  fs.writeFileSync(kiraYolu, eskiKira);
  yeniden(x.dizin);
  const s = getLicenseSnapshot().state;
  check(
    "§12a ⭐ eski kira geri konunca → KIRA_GERI_ALINDI, geçerlilik ÖLÇÜLEMEDİ (kira kullanılmaz)",
    s.nedenler.some((n) => n.kod === "KIRA_GERI_ALINDI") && s.gecerlilik === "OLCULEMEDI" && getLicenseSnapshot().lease === null,
    `${s.gecerlilik} ${s.nedenler.map((n) => n.kod).join(",")}`,
  );
  check("§12b ⭐ geri alınan kira yaptırımı kaldırmaz: K5 durum kaydından sürer (DURDURULMUŞ)", s.hesaplananKademe === "DURDURULMUS", s.hesaplananKademe);
  check("§12c yoklama zincir ucu olarak durum kaydının son kirasını sunar", (await buildPollBody()).sonKiraId === k5Kira);
  fs.rmSync(kiraYolu);
  yeniden(x.dizin);
  const hak = hakBas(x.f);
  const eskiYanit = { v: 1, hak, kira: eskiKira, indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString() };
  check("§12d ⭐ kira silinip ESKİ yanıt yapıştırılsa da RED (durum kaydının son kabulüne göre LICENSE_LEASE_STALE)", (await hataKodu(acceptOfflineResponse(eskiYanit, "aktarma", null))) === "LICENSE_LEASE_STALE");
  const p = await pollLicenseOnce();
  const s2 = getLicenseSnapshot().state;
  check(
    "§12e karşı: yeni kira kabulüyle geri alma bulgusu kalkar, yaptırım yeni kiradan (NORMAL)",
    p.outcome === "BASARILI" && !s2.nedenler.some((n) => n.kod === "KIRA_GERI_ALINDI") && s2.hesaplananKademe === "NORMAL",
    `${p.outcome} ${s2.hesaplananKademe} ${s2.nedenler.map((n) => n.kod).join(",")}`,
  );
}

async function etkinTanimiBolumu(x: Hazir): Promise<void> {
  console.log("\n§13 — 'etkin' tanımı (D3): kira dosyası yokluğu yoklama başarısızlığı SAYILMAZ; HAK/durum varken yoklanır");
  const oncekiKira = getLicenseSnapshot().lease?.document.kiraId;
  fs.rmSync(path.join(x.dizin, LICENSE_FILES.LEASE), { force: true });
  yeniden(x.dizin);
  const bag = getLicenseSnapshot().state.baglanti;
  check(
    "§13a ⭐ kira dosyası yok ama durum kaydının son kirası taze → internet VAR (ikinci anahtar imzalı kayıttan, bellekteki yoklama sinyalinden değil)",
    bag.internetVar && bag.sonAlisverisMs === getLicenseSnapshot().lastKnownLease?.verilisMs,
    JSON.stringify(bag),
  );
  check("§13b ⭐ HAK + durum kaydı varken etkin sayılır (kira dosyası yokken de)", getLicenseSnapshot().activated && getLicenseDetail().kurulum.etkin);
  __resetLicenseTrailForTests();
  const gozlemde = getLicenseSnapshot().state.kip === "gozlem";
  check(
    "§13b2 gözlem özeti aynı 'etkin' tanımıyla (D3): kira dosyası yokken de günlük özet yazılır",
    gozlemde && logObservationSummaryIfDue(Date.now() + 25 * 60 * 60 * 1000),
    `kip gözlem=${gozlemde}`,
  );
  // HAK 40 gün önce verilmiş: v1'de kirasız ek süre (HAK verilişi) bitmiş sayılırdı. v2 (G12): silinen kiranın süre
  // çapası ayakta kalan izlerden (durum kaydı + DB izi) okunur — silmek süreyi ne uzatır ne kısaltır; iz kaybı merdivene girer.
  fs.writeFileSync(path.join(x.dizin, LICENSE_FILES.ENTITLEMENT), hakBas(x.f, { verilis: msToIso(Date.now() - 40 * DAY_MS) }));
  yeniden(x.dizin);
  const s = getLicenseSnapshot().state;
  check(
    "§13a2 ⭐ kira dosyası yok → çapa izlerin hatırladığı kira çapası (HAK verilişi DEĞİL): ek süre YOK, LISANS_IZI_KAYIP(KIRA), internet VAR",
    s.hesaplananKademe === "UYARI" && !nedenVar(s, "EK_SURE_BITTI") && nedenAyrinti(s, "LISANS_IZI_KAYIP").includes("KIRA") && s.baglanti.internetVar,
    `${s.hesaplananKademe} ${s.nedenler.map((n) => `${n.kod}:${n.ayrinti ?? ""}`).join(",")}`,
  );
  const r = await pollLicenseOnce();
  const govde = (x.satici.yoklamaGovdeleri.at(-1) ?? {}) as { sonKiraId?: string | null };
  check(
    "§13c kira dosyası yokken yoklar, zincir ucunu durum kaydından sunar ve kirayı onarır",
    r.outcome === "BASARILI" && govde.sonKiraId === oncekiKira && fs.existsSync(path.join(x.dizin, LICENSE_FILES.LEASE)),
    `${r.outcome} ${String(govde.sonKiraId).slice(0, 8)} / ${oncekiKira?.slice(0, 8)}`,
  );
}

async function depoOkumaBolumu(x: Hazir): Promise<void> {
  console.log("\n§14 — okunamayan belge (D1): yok sayılmaz → ÖLÇÜLEMEDİ; sunucu kararı durum kaydından sürer");
  if (process.platform === "win32" || process.getuid?.() === 0) {
    console.log("⏭️  §14 atlandı (Windows ya da root: izin kilidi ölçülemez)");
    return;
  }
  x.satici.kiraEk = { zorlama: false, yaptirim: { kademe: "K4", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
  await pollLicenseOnce();
  x.satici.kiraEk = {};
  const kiraYolu = path.join(x.dizin, LICENSE_FILES.LEASE);
  if (!fs.existsSync(kiraYolu)) {
    check("§14 ön koşul: kira dosyası var", false);
    return;
  }
  fs.chmodSync(kiraYolu, 0o000);
  try {
    yeniden(x.dizin);
    const s = getLicenseSnapshot().state;
    const d = getLicenseDetail();
    check(
      "§14a ⭐ okunamayan kira → DEPO_OKUNAMADI, geçerlilik ÖLÇÜLEMEDİ (YOK/GEÇERSİZ sayılmaz)",
      s.nedenler.some((n) => n.kod === "DEPO_OKUNAMADI") && s.gecerlilik === "OLCULEMEDI" && !s.nedenler.some((n) => n.kod === "KIRA_YOK") && d.depo.sorun === "OKUNAMADI",
      `${s.gecerlilik} ${s.nedenler.map((n) => n.kod).join(",")} sorun=${d.depo.sorun}`,
    );
    check("§14b ⭐ kira okunamasa da K4 durum kaydından sürer (KISITLI) — okuma hatası yaptırım kaçışı değil", s.hesaplananKademe === "KISITLI", s.hesaplananKademe);
    check("§14c motor hazır kalır (depo tümden OKUNAMADI değil — tek dosya)", getLicenseSnapshot().imzaHazir && getLicenseSnapshot().durumHazir && getLicenseStore()?.problem === null);
  } finally {
    fs.chmodSync(kiraYolu, 0o600);
  }
  yeniden(x.dizin);
  await pollLicenseOnce();
}

/**
 * L2-5 (tasarım §1.4): portalın "çevrimdışı uzatma dosyası" imzalı bir LicenseResponse'tur ve İSTEK
 * gerektirmez — Lisans ekranı onu çevrimdışı yanıtla aynı uca yollar. Ödenmiş tarih (P) belgelerden gelir.
 */
async function uzatmaDosyasiBolumu(x: Hazir): Promise<void> {
  console.log("\n§24 — uzatma dosyası: istek-siz kabul · eski dosya RED · ayak izi 'dosya' · P detayda · adres kapalıyken de");
  const once = getLicenseSnapshot().lease?.document.kiraId;
  const simdi = Date.now();
  const P = simdi + 200 * DAY_MS;
  const yanit = (verilisMs: number, ek: { odenmisTarih?: string } = {}) => ({
    v: 1,
    hak: hakBas(x.f, { cevrimdisiUfukGun: 400 }),
    kira: kiraBas(x.f, {
      parmakIzi: x.f.parmakIzi, zorlama: false, verilis: msToIso(verilisMs), sunucuSaati: msToIso(verilisMs),
      odenmisTarih: msToIso(P), gecerlilikBitis: msToIso(P), ...ek,
    }),
    indirmeBelirtecleri: [],
    sunucuSaati: msToIso(verilisMs),
  });
  const ilk = yanit(simdi);
  const dosya = path.join(GECICI, "uzatma.json");
  fs.writeFileSync(dosya, `\uFEFF${JSON.stringify(ilk, null, 2)}\n`);
  const iz = olaylar.length;
  // Panelin yaptığı: dosya metni (BOM'suz) — bu süreçte bekleyen bir çevrimdışı istek YOK.
  let d: Awaited<ReturnType<typeof acceptOfflineResponse>> | null = null;
  const sonuc = await hataKodu(
    acceptOfflineResponse(fs.readFileSync(dosya, "utf8").replace(/^\uFEFF/, ""), "dosya", null).then((r) => {
      d = r;
    }),
  );
  const kabulDetay = d as Awaited<ReturnType<typeof acceptOfflineResponse>> | null;
  check(
    "§24a ⭐ istek-siz uzatma dosyası KABUL: yeni kira, P detayda (sözleşme sonu), HAK ufku detayda",
    kabulDetay !== null && kabulDetay.kira?.kiraId !== once && kabulDetay.durum.odenmisTarih?.tarih === msToIso(P) && kabulDetay.durum.odenmisTarih.kaynak === "ODEME" &&
      kabulDetay.durum.odenmisTarih.sozlesmeSonu && kabulDetay.kira?.odenmisTarih === msToIso(P) && kabulDetay.hak?.cevrimdisiUfukGun === 400,
    `${sonuc} ${JSON.stringify(kabulDetay?.durum.odenmisTarih ?? null)}`,
  );
  if (!kabulDetay) return;
  const yeni = olaylar.slice(iz);
  const kabul = yeni.find((o) => o.action === "LICENSE_LEASE_ACCEPTED")?.payload as { kaynak?: string } | undefined;
  const eylem = yeni.find((o) => o.action === "LICENSE_ADMIN_ACTION")?.payload as { eylem?: string; sonuc?: string } | undefined;
  check("§24b ayak izi: kira kabulü kaynak 'dosya' + yönetici eylemi 'lisans-dosyasi' kabul", kabul?.kaynak === "dosya" && eylem?.eylem === "lisans-dosyasi" && eylem.sonuc === "kabul", JSON.stringify({ kabul, eylem }));
  check(
    "§24c ⭐ dosyayla gelen kira 'internet var' sayılır: son alışveriş = kiranın sunucu saati",
    kabulDetay.durum.baglanti.internetVar && kabulDetay.durum.baglanti.sonAlisveris === msToIso(simdi),
    JSON.stringify(kabulDetay.durum.baglanti),
  );
  const iz2 = olaylar.length;
  const tekrar = await hataKodu(acceptOfflineResponse(ilk, "dosya", null).then(() => undefined));
  check("§24d aynı dosya (JSON nesnesi olarak) ikinci kez → hata yok, 'ayni-kira'", tekrar === "HATA_YOK" && JSON.stringify(olaylar.slice(iz2)).includes("ayni-kira"), tekrar);
  check("§24e ⭐ ESKİ dosya RED (LICENSE_LEASE_STALE)", (await hataKodu(acceptOfflineResponse(yanit(simdi - 2 * DAY_MS), "dosya", null))) === "LICENSE_LEASE_STALE");
  const kurcali = { ...ilk, kira: bozuk(yanit(simdi + 1).kira) };
  check("§24f kurcalı dosya RED (LICENSE_RESPONSE_INVALID)", (await hataKodu(acceptOfflineResponse(JSON.stringify(kurcali), "dosya", null))) === "LICENSE_RESPONSE_INVALID");
  const adres = x.satici.url;
  configureLicenseRuntimeForTests({ vendorUrl: null });
  try {
    // Bir sonraki yoklamanın kirasından (verilişi "şimdi") eski kalmalı: +1 ms.
    const k = await acceptOfflineResponse(yanit(simdi + 1, { odenmisTarih: msToIso(P + 30 * DAY_MS) }), "dosya", null);
    check("§24g ⭐ satıcı adresi KAPALI kurulum da dosyayla uzar (yeni P)", k.durum.odenmisTarih?.tarih === msToIso(P + 30 * DAY_MS), JSON.stringify(k.durum.odenmisTarih));
  } finally {
    configureLicenseRuntimeForTests({ vendorUrl: adres });
  }
  const r = await pollLicenseOnce();
  const s = getLicenseSnapshot().state;
  check("§24h karşı: satıcı P taşımayan kira verince eski çapaya döner (v1 belgeyle sıfır fark)", r.outcome === "BASARILI" && s.odenmisTarih === null && s.hesaplananKademe === "NORMAL", `${r.outcome} ${JSON.stringify(s.odenmisTarih)}`);
}

// ── L2-9 kabulde saat sürekliliği (§33): taşınmış (dosya/QR) kira tahmini geri çekemez, ileri sıçrama aklanmaz ──
const DAKIKA = 60_000;

/** Taşınmış kiralar fikstürün ALT penceresinden (−10 g) eski: ALT 400 gün geriden başlar. */
const uzunAlt = (f: Fikstur): string => sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(f.simdi - 400 * DAY_MS), bitis: msToIso(f.simdi + 170 * DAY_MS) }));

/** Fabrika durumu: kira L0 `calisan` boyunca çalıştı, son yazımdan beri `kapali` kapalı, duvar gerçeğin `ileri` önünde; P geçti. */
interface SaatDurumu {
  readonly calisan: number;
  readonly kapali?: number;
  readonly ileri?: number;
  /** L0'ın sunucu saati (yoksa gerçek − kapalı − çalışan) ve kayda yazılacak süreklilik tabanı. */
  readonly sunucu?: number;
  readonly taban?: number;
}

async function saatDurumuKur(x: Hazir, ent: Pick<EntitlementPin, "hakId" | "surum" | "sinif">, d: SaatDurumu): Promise<number> {
  const key = getLicenseStore()?.key;
  if (!key) throw new Error("depo anahtarı yok");
  const simdi = Date.now();
  const gercek = simdi - (d.ileri ?? 0);
  const s0 = d.sunucu ?? gercek - (d.kapali ?? 0) - d.calisan;
  const kiraId = randomUUID();
  const P0 = msToIso(gercek - 2 * DAY_MS);
  const kira = kiraBas(x.f, { kiraId, altSertifika: uzunAlt(x.f), parmakIzi: currentFingerprintDigest(), verilis: msToIso(s0), sunucuSaati: msToIso(s0), bitis: msToIso(s0 + 44 * DAY_MS), zorlama: false, odenmisTarih: P0, gecerlilikBitis: P0, yoklamaAraligiDk: 5 });
  const kayit: StateRecord = {
    v: 1, kurulumId: x.f.kurulumId, kiraId, birikenMs: d.calisan, yazildi: msToIso(simdi - (d.kapali ?? 0)), yuksekSu: msToIso(s0),
    sonKiraZorlamasi: false, sonYaptirim: null, sira: 900, sonKira: { kiraId, verilis: msToIso(s0) },
    sonHak: { hakId: ent.hakId, surum: ent.surum, sinif: ent.sinif, kokTuru: "kok" }, kapaliMs: 0, duvarTutarli: true,
    ...(d.taban === undefined ? {} : { saatTabani: msToIso(d.taban) }),
  };
  await flushLicenseTraceWrites();
  const jws = signStateRecord(kayit, key.privateKey, key.x);
  fs.writeFileSync(path.join(x.dizin, LICENSE_FILES.LEASE), kira);
  fs.writeFileSync(path.join(x.dizin, LICENSE_FILES.STATE), JSON.stringify({ v: 1, jws }));
  await prisma.systemSetting.update({ where: { key: LICENSE_TRACE_SETTING_KEY }, data: { value: { v: 1, kurulumId: x.f.kurulumId, anahtar: key.x, durum: jws } } });
  await yenidenBaslat(x.dizin);
  return gercek;
}

/** Taşınmış yanıt (uzatma dosyası · QR): `verilisMs` anında üretilmiş kira, P = `odenmisMs`, yoklama aralığı 5 dk. */
function tasinmisYanit(f: Fikstur, g: { readonly hak: string; readonly alt: string; readonly odenmisMs: number }, verilisMs: number): Record<string, unknown> {
  return {
    v: 1,
    hak: g.hak,
    kira: kiraBas(f, {
      altSertifika: g.alt, parmakIzi: currentFingerprintDigest(), zorlama: false, verilis: msToIso(verilisMs), sunucuSaati: msToIso(verilisMs), bitis: msToIso(verilisMs + 44 * DAY_MS),
      odenmisTarih: msToIso(g.odenmisMs), gecerlilikBitis: msToIso(g.odenmisMs), yoklamaAraligiDk: 5,
    }),
    indirmeBelirtecleri: [],
    sunucuSaati: msToIso(verilisMs),
  };
}

async function saatSurekliligiBolumu(x: Hazir): Promise<void> {
  console.log("\n§33 — kabulde saat sürekliliği: taşınmış (dosya/QR) kira SAAT_İLERİ doğurmaz · ileri sıçrama yine yakalanır · eski kayıt bugünkü");
  const hak = hakBas(x.f, { cevrimdisiUfukGun: 400 });
  const alt = uzunAlt(x.f);
  const P = Date.now() + 200 * DAY_MS;
  const yanit = (verilisMs: number): Record<string, unknown> => tasinmisYanit(x.f, { hak, alt, odenmisMs: P }, verilisMs);
  await acceptOfflineResponse(yanit(Date.now()), "dosya", null);
  const e = getLicenseSnapshot().entitlement?.document;
  if (!e) {
    check("§33 ön koşul: HAK (ufuk 400 g)", false);
    return;
  }
  const ent = { hakId: e.hakId, surum: e.surum, sinif: e.sinif };
  const ozetle = (st: ReturnType<typeof getLicenseSnapshot>["state"]): string =>
    `${st.saat.finding ?? "-"}/${st.saat.source} ${st.hesaplananKademe} P=${st.odenmisTarih?.tarihMs ? msToIso(st.odenmisTarih.tarihMs) : null} [${st.nedenler.map((n) => n.kod).join(",")}]`;
  const tasinmis = async (etiket: string, d: SaatDurumu, yasMs: number, gonder: (y: Record<string, unknown>) => Promise<unknown>): Promise<{ once: ReturnType<typeof getLicenseSnapshot>["state"]; sonra: ReturnType<typeof getLicenseSnapshot>["state"]; gercek: number; kod: string }> => {
    const gercek = await saatDurumuKur(x, ent, d);
    const once = getLicenseSnapshot().state;
    const kod = await hataKodu(Promise.resolve(gonder(yanit(gercek - yasMs))));
    const sonra = getLicenseSnapshot().state;
    console.log(`   · ${etiket}: önce ${ozetle(once)} → ${kod} → sonra ${ozetle(sonra)}`);
    return { once, sonra, gercek, kod };
  };
  const dosya = (y: Record<string, unknown>): Promise<unknown> => acceptOfflineResponse(JSON.stringify(y), "dosya", null);
  const qr = (y: Record<string, unknown>): Promise<unknown> => acceptOfflineResponse(Buffer.from(JSON.stringify(y), "utf8").toString("base64url"), "cevrimdisi", null);
  // Tahmin (alt sınır) dosyanın saatine GERİ ÇEKİLMEZ: kabul anındaki ölçülmüş tahminden sürer (kapalı süre hariç).
  const tamam = (r: { once: { hesaplananKademe: string; saat: { finding: string | null } }; sonra: ReturnType<typeof getLicenseSnapshot>["state"]; kod: string; gercek: number }, kapaliMs = 0): boolean =>
    r.kod === "HATA_YOK" && r.once.hesaplananKademe === "EK_SURE" && r.once.saat.finding === null && r.sonra.saat.finding === null &&
    r.sonra.odenmisTarih?.tarihMs === P && r.sonra.hesaplananKademe === "NORMAL" && Math.abs(r.sonra.saat.trustedMs - Date.now()) < DAKIKA &&
    r.sonra.saat.estimateMs !== null && Math.abs(r.sonra.saat.estimateMs - (r.gercek - kapaliMs)) < DAKIKA;
  for (const [ad, yas] of [["30 gün", 30 * DAY_MS], ["3 gün", 3 * DAY_MS], ["16 dk (yoklama 5 dk + 10 dk payın ötesi)", 16 * DAKIKA]] as const) {
    const r = await tasinmis(`dosya ${ad}`, { calisan: 31 * DAY_MS }, yas, dosya);
    check(
      `§33a ⭐ ${ad} önce üretilmiş uzatma DOSYASI (fabrika sürekli çalışıyor) → SAAT_İLERİ YOK, P ileri, EK_SURE kalkar, tahmin dosyanın saatine geri çekilmez`,
      tamam(r),
      `${r.kod} ${ozetle(r.once)} → ${ozetle(r.sonra)} tahmin−gerçek=${Math.round(((r.sonra.saat.estimateMs ?? 0) - r.gercek) / 1000)} sn`,
    );
  }
  const taban = Number(Date.parse(String(durumKaydiAlani(x.dizin).saatTabani)));
  check("§33a2 kabul kaydı süreklilik tabanını taşır (≈ kabul anındaki ölçülmüş tahmin, dosyanın saati değil)", Math.abs(taban - Date.now()) < DAKIKA, String(durumKaydiAlani(x.dizin).saatTabani));
  const ileri = await tasinmis("duvar 2 gün ileri + 16 dk'lık dosya", { calisan: 31 * DAY_MS, ileri: 2 * DAY_MS }, 16 * DAKIKA, dosya);
  check(
    "§33b ⭐ dosyayı yüklemeden ÖNCE duvarı 2 gün ileri alan fabrika → kabul edilir ama SAAT_İLERİ(DUVAR) SÜRER, güvenilir saat duvar değil tahmin (kabul aklamaz)",
    ileri.kod === "HATA_YOK" && ileri.once.saat.finding === "SAAT_ILERI" && ileri.sonra.saat.finding === "SAAT_ILERI" && ileri.sonra.saat.findingSource === "DUVAR" &&
      Math.abs(ileri.sonra.saat.trustedMs - ileri.gercek) < DAKIKA && ileri.sonra.odenmisTarih?.tarihMs === P,
    `${ileri.kod} ${ozetle(ileri.once)} → ${ozetle(ileri.sonra)} güvenilir−gerçek=${Math.round((ileri.sonra.saat.trustedMs - ileri.gercek) / 1000)} sn`,
  );
  const q = await tasinmis("QR 3 gün", { calisan: 31 * DAY_MS }, 3 * DAY_MS, qr);
  check("§33c ⭐ QR yolu (base64url metin, kaynak 'cevrimdisi') aynı sınıf: 3 gün önceki yanıt → SAAT_İLERİ YOK, P ileri, EK_SURE kalkar", tamam(q), `${q.kod} ${ozetle(q.once)} → ${ozetle(q.sonra)}`);
  const zarf = await tasinmis("donanım zarfı (ONAYLANDI) QR 3 gün", { calisan: 31 * DAY_MS }, 3 * DAY_MS, (y) => qr({ v: 1, talepId: randomUUID(), durum: "ONAYLANDI", lisans: y }));
  check("§33c2 donanım zarfı (ONAYLANDI, QR) aynı kabul noktası: SAAT_İLERİ YOK, EK_SURE kalkar", tamam(zarf), `${zarf.kod} ${ozetle(zarf.once)} → ${ozetle(zarf.sonra)}`);
  const kapali = await tasinmis("2 gün kapalı + kapanmadan önce üretilmiş dosya", { calisan: 31 * DAY_MS, kapali: 2 * DAY_MS }, 2 * DAY_MS + 60 * DAKIKA, dosya);
  const devreden = Number(durumKaydiAlani(x.dizin).kapaliMs);
  check(
    "§33e ⭐ hafta sonu kapalı (2 gün, kredili) fabrikaya kapanmadan önce üretilmiş dosya → SAAT_İLERİ YOK; duvarın kredili kısmı yeni kiraya devreder (kapaliMs ≈ 2 gün)",
    tamam(kapali, 2 * DAY_MS) && Math.abs(devreden - 2 * DAY_MS) < DAKIKA,
    `${kapali.kod} ${ozetle(kapali.once)} → ${ozetle(kapali.sonra)} kapaliMs=${devreden}`,
  );
  // Eski kayıt (taban alanı yok): kira 3 gün önceki sunucu saatiyle az önce kabul edilmiş → bugünkü sonuç SAAT_İLERİ.
  await saatDurumuKur(x, ent, { calisan: 0, sunucu: Date.now() - 3 * DAY_MS });
  const eski = getLicenseSnapshot().state;
  await saatDurumuKur(x, ent, { calisan: 0, sunucu: Date.now() - 3 * DAY_MS, taban: Date.now() });
  const tabanli = getLicenseSnapshot().state;
  check(
    "§33d ⭐ eski kayıt (saatTabani YOK) → bugünkü sonuç: taban = kiranın sunucu saati, SAAT_İLERİ(DUVAR); aynı kayıt tabanla → bulgu yok (tek anahtar alan)",
    eski.saat.finding === "SAAT_ILERI" && eski.saat.findingSource === "DUVAR" && Math.abs(eski.saat.trustedMs - (Date.now() - 3 * DAY_MS)) < DAKIKA && tabanli.saat.finding === null,
    `${ozetle(eski)} · tabanlı ${ozetle(tabanli)}`,
  );
  const p = await pollLicenseOnce();
  const alan = durumKaydiAlani(x.dizin);
  check("§33d2 taze çevrimiçi kira (sunucu saati ≥ tahmin) → kayıtta saatTabani YOK (eski biçimle aynı alan kümesi)", p.outcome === "BASARILI" && !("saatTabani" in alan) && getLicenseSnapshot().state.saat.finding === null, `${p.outcome} ${Object.keys(alan).includes("saatTabani")}`);
}

/**
 * §33f–h: süreklilik YALNIZ taşınmış kirada. Şişik taban (satıcı saati ileri kaçmışken alınmış kiradan devreden) canlı
 * yoklamada söner; taşınmış dosya max'ı korur; canlı yolda eski ya da tekrar eden yanıt zincir kuralıyla reddedilir.
 */
async function saatCanliBolumu(x: Hazir): Promise<void> {
  console.log("\n§33f–h — süreklilik yalnız taşınmış kirada: canlı yoklama şişik tabanı sıfırlar · dosya max'ı korur · canlıda eski yanıt tabanı çekemez");
  const e = getLicenseSnapshot().entitlement?.document;
  if (!e) {
    check("§33f ön koşul: HAK", false);
    return;
  }
  const ent = { hakId: e.hakId, surum: e.surum, sinif: e.sinif };
  const SAAT_MS = 60 * DAKIKA;
  // 1 gün çalışmış kira; kayıttaki taban gerçeğin 1 sa önünde (tahmin = taban + 1 g = şimdi + 1 sa → SAAT_GERİ).
  const sisik = (): SaatDurumu => ({ calisan: DAY_MS, taban: Date.now() - DAY_MS + SAAT_MS });
  const ozetle = (st: ReturnType<typeof getLicenseSnapshot>["state"]): string =>
    `${st.saat.finding ?? "-"}/${st.saat.source} tahmin−şimdi=${st.saat.estimateMs === null ? "?" : Math.round((st.saat.estimateMs - Date.now()) / 60_000)} dk`;
  const tabanFarki = (): number | null => {
    const t = durumKaydiAlani(x.dizin).saatTabani;
    return typeof t === "string" ? Math.round((Date.parse(t) - Date.now()) / 60_000) : null;
  };

  await saatDurumuKur(x, ent, sisik());
  const once = getLicenseSnapshot().state;
  const p = await pollLicenseOnce();
  const sonra = getLicenseSnapshot().state;
  check(
    "§33f ⭐ şişik taban (SAAT_GERİ) + CANLI yoklama → taban sıfırlanır (kayıtta saatTabani YOK, tahmin = yeni kiranın sunucu saati), SAAT_GERİ söner",
    once.saat.finding === "SAAT_GERI" && p.outcome === "BASARILI" && tabanFarki() === null && sonra.saat.finding === null &&
      sonra.saat.estimateMs !== null && Math.abs(sonra.saat.estimateMs - Date.now()) < DAKIKA,
    `${ozetle(once)} → ${p.outcome}${p.code ? `/${p.code}` : ""} → ${ozetle(sonra)} taban=${tabanFarki()}`,
  );

  await saatDurumuKur(x, ent, sisik());
  const dOnce = getLicenseSnapshot().state;
  const dosya = tasinmisYanit(x.f, { hak: hakBas(x.f, { cevrimdisiUfukGun: 400 }), alt: uzunAlt(x.f), odenmisMs: Date.now() + 200 * DAY_MS }, Date.now() - 16 * DAKIKA);
  const dKod = await hataKodu(acceptOfflineResponse(JSON.stringify(dosya), "dosya", null));
  const dSonra = getLicenseSnapshot().state;
  const dTaban = tabanFarki();
  check(
    "§33g ⭐ aynı şişik taban + TAŞINMIŞ uzatma dosyası → max korunur (saatTabani ≈ şimdi + 1 sa), SAAT_GERİ sürer",
    dOnce.saat.finding === "SAAT_GERI" && dKod === "HATA_YOK" && dTaban !== null && Math.abs(dTaban - 60) <= 1 && dSonra.saat.finding === "SAAT_GERI",
    `${ozetle(dOnce)} → ${dKod} → ${ozetle(dSonra)} taban=${dTaban} dk`,
  );

  // Canlı yolda zincir: bilinen kiradan ESKİ verilişli yanıt ve aynı kiranın tekrarı kabul edilmez, kayıt değişmez.
  await saatDurumuKur(x, ent, sisik());
  const kayit0 = JSON.stringify(durumKaydiAlani(x.dizin));
  const kiraId = String(durumKaydiAlani(x.dizin).kiraId);
  const s0 = Date.now() - DAY_MS;
  const canliYanit = async (ek: Partial<LeaseDoc>): Promise<Awaited<ReturnType<typeof pollLicenseOnce>>> => {
    x.satici.kiraEk = ek;
    try {
      return await pollLicenseOnce();
    } finally {
      x.satici.kiraEk = {};
    }
  };
  const eski = await canliYanit({ verilis: msToIso(s0 - SAAT_MS), sunucuSaati: msToIso(s0 - SAAT_MS), bitis: msToIso(s0 + 20 * DAY_MS) });
  const eskiSonra = JSON.stringify(durumKaydiAlani(x.dizin));
  const tekrar = await canliYanit({ kiraId, verilis: msToIso(s0), sunucuSaati: msToIso(s0), bitis: msToIso(s0 + 20 * DAY_MS) });
  const tekrarSonra = JSON.stringify(durumKaydiAlani(x.dizin));
  check(
    "§33h ⭐ canlı yolda eski (bilinen kiradan önce verilmiş) yanıt LICENSE_LEASE_STALE, aynı kiranın tekrarı yeni değil → durum kaydı (taban dahil) BAYT-EŞİT, SAAT_GERİ sürer",
    eski.outcome === "BASARISIZ" && eski.code === "LICENSE_LEASE_STALE" && tekrar.outcome === "BASARISIZ" && tekrar.code === "KIRA_YENILENMEDI" &&
      eskiSonra === kayit0 && tekrarSonra === kayit0 && getLicenseSnapshot().state.saat.finding === "SAAT_GERI",
    `eski=${eski.outcome}/${eski.code} tekrar=${tekrar.outcome}/${tekrar.code} kayıt eşit=${eskiSonra === kayit0}/${tekrarSonra === kayit0}`,
  );
  // Sonraki bölümler şişik tabanı devralmasın: canlı yoklama sıfırlar.
  await pollLicenseOnce();
}

const ayniKume = (a: Fingerprint | undefined, b: Fingerprint): boolean => !!a && (["f1", "f2", "f3", "f4", "f5"] as const).every((k) => a[k] === b[k]);

// ── Lisans v2 G12 (L2-6): DB izi · belirsizlik birikimi · iz kaybı · üç iz (K7) · anahtar okunamaz · parmak izi v2 ──
/** Sahte hrtime: merdiven sayaçlarını (çalışma süresi) ileri sarar; monotonik kira birikimi gerçek saatle kalır. */
let sahteNs = 0n;
function merdivenSaatiKur(): void {
  sahteNs = process.hrtime.bigint();
  __setLadderClockForTests(() => sahteNs);
}
function ileriSar(gun: number): void {
  sahteNs += BigInt(Math.round(gun * DAY_MS)) * 1_000_000n;
  invalidateLicenseSnapshot();
}

async function izSatiri(): Promise<{ kurulumId?: string; anahtar?: string; durum?: string } | null> {
  const r = await prisma.systemSetting.findUnique({ where: { key: LICENSE_TRACE_SETTING_KEY }, select: { value: true } });
  return (r?.value as { kurulumId?: string; anahtar?: string; durum?: string } | undefined) ?? null;
}

/** Süreç yeniden başlamış gibi: bellek sayaçları gider, depo ve DB izi yeniden okunur. */
async function yenidenBaslat(dizin: string): Promise<void> {
  __resetLadderCountersForTests();
  loadLicenseStoreSync({ dir: dizin });
  await refreshLicenseTrace();
  invalidateLicenseSnapshot();
}

function kayitAlani(jws: string | undefined): Record<string, unknown> {
  const p = jws ? parseJws(jws) : null;
  return p?.ok ? (p.value.payload as Record<string, unknown>) : {};
}

async function izKopyasiBolumu(x: Hazir): Promise<void> {
  console.log("\n§26 — DB izi (G12): durum kaydının imzalı kopyası; tek iz kaybı kalıcı, birikim çalışma süresiyle ve iki kopyanın büyüğü");
  await pollLicenseOnce();
  await flushLicenseTraceWrites();
  const satir = await izSatiri();
  const dosyaJws = (JSON.parse(fs.readFileSync(path.join(x.dizin, LICENSE_FILES.STATE), "utf8")) as { jws: string }).jws;
  check(
    "§26a ⭐ kira kabulüyle DB izi yazılır: lisans kimliği + kurulum açık anahtarı + durum.json ile AYNI imzalı JWS; ham ayar ucundan yazılamaz",
    satir?.kurulumId === x.f.kurulumId && satir.anahtar === getLicenseStore()?.key?.x && satir.durum === dosyaJws && isReservedSettingKey(LICENSE_TRACE_SETTING_KEY),
    `${String(satir?.kurulumId).slice(0, 8)}`,
  );
  const govde = await buildPollBody();
  check(
    "§26b ⭐ yoklama durum kaydı sırasını ve HAK bayt özetini taşır; birikim/kayıp yokken o alanlar GİTMEZ (yalnız doluysa)",
    govde.durumKaydi?.sira === getLicenseSnapshot().view.record?.sira && govde.durumKaydi?.gecerli === true && govde.hak?.ozet === getLicenseSnapshot().entitlement?.digest &&
      !("belirsizlik" in govde) && !("parmakIziKayip" in govde),
    JSON.stringify(govde.durumKaydi),
  );
  merdivenSaatiKur();
  try {
    fs.rmSync(path.join(x.dizin, LICENSE_FILES.STATE));
    yeniden(x.dizin);
    const s = getLicenseSnapshot();
    check("§26c ⭐ durum.json silindi → kopya DB izinden sürer (monotonik ölçülür), LISANS_IZI_KAYIP(DURUM), birikim akar", nedenAyrinti(s.state, "LISANS_IZI_KAYIP") === "DURUM" && s.view.traceValid && s.state.belirsizlik.suruyor && !nedenVar(s.state, "DURUM_DOSYASI"), s.state.nedenler.map((n) => n.kod).join(","));
    ileriSar(15);
    const s15 = getLicenseSnapshot().state;
    check("§26d ⭐ 15 gün çalışma süresi → BELIRSIZLIK_SURUYOR EK_SÜRE 29 (hesaplanan); gözlem kirasında uygulanan NORMAL (sıfır fark)", s15.hesaplananKademe === "EK_SURE" && s15.ekSureKalanGun === 29 && s15.uygulananKademe === "NORMAL", `${s15.hesaplananKademe}/${s15.uygulananKademe} kalan=${s15.ekSureKalanGun}`);
    persistAccumulation();
    await flushLicenseTraceWrites();
    const dosya = durumKaydiAlani(x.dizin);
    const db = kayitAlani((await izSatiri())?.durum);
    check("§26e ⭐ yazım dosyayı KOPYADAN geri kurar; iz kaybı ve birikim (≈15 g) iki kopyada da", JSON.stringify(dosya.izKaybi).includes("DURUM") && Number((db.belirsizlik as { birikenMs?: number } | undefined)?.birikenMs) >= 15 * DAY_MS, JSON.stringify(dosya.belirsizlik));
    await yenidenBaslat(x.dizin);
    const r = getLicenseSnapshot().state;
    check("§26f ⭐ yeniden başlatma birikimi SIFIRLAMAZ, dosya geri gelse de iz kaybı KALICI → EK_SÜRE sürer", r.hesaplananKademe === "EK_SURE" && nedenAyrinti(r, "LISANS_IZI_KAYIP") === "DURUM" && r.belirsizlik.birikenMs >= 15 * DAY_MS, `${r.hesaplananKademe} ${Math.round(r.belirsizlik.birikenMs / DAY_MS)} g`);
    const g = await buildPollBody();
    check("§26g yoklama birikimi (ms + ilk) ve iz kaybını taşır (satıcıda yerel müdahale şüphesi)", (g.belirsizlik?.birikenMs ?? 0) >= 15 * DAY_MS && g.belirsizlik?.ilk !== null && g.durum.nedenler.includes("LISANS_IZI_KAYIP"), JSON.stringify(g.belirsizlik));
    await izBuyukKopyaBolumu(x);
    const p = await pollLicenseOnce();
    const y = getLicenseSnapshot().state;
    check("§26j ⭐ YALNIZ yeni kira kabulü birikimi ve iz kaybını sıfırlar → GEÇERLİ, NORMAL", p.outcome === "BASARILI" && y.belirsizlik.birikenMs === 0 && !nedenVar(y, "LISANS_IZI_KAYIP") && y.hesaplananKademe === "NORMAL", `${p.outcome} ${y.hesaplananKademe} ${y.nedenler.map((n) => n.kod).join(",")}`);
  } finally {
    __setLadderClockForTests(null);
  }
}

/** İki kopyanın BÜYÜĞÜ geçerli: DB izine (aynı dönem) daha büyük birikimli kopya konur; DB izi silinirse dosyadan sürer. */
async function izBuyukKopyaBolumu(x: Hazir): Promise<void> {
  const key = getLicenseStore()?.key;
  const dosya = durumKaydiAlani(x.dizin) as unknown as StateRecord;
  if (!key) return void check("§26h ön koşul: kurulum anahtarı", false);
  const buyuk = signStateRecord({ ...dosya, belirsizlik: { birikenMs: 30 * DAY_MS, ilk: dosya.belirsizlik?.ilk ?? null } }, key.privateKey, key.x);
  await prisma.systemSetting.update({ where: { key: LICENSE_TRACE_SETTING_KEY }, data: { value: { v: 1, kurulumId: x.f.kurulumId, anahtar: key.x, durum: buyuk } } });
  await refreshLicenseTrace();
  invalidateLicenseSnapshot();
  const b = getLicenseSnapshot().state;
  check("§26h ⭐ DB izinde daha büyük birikim (30 g) → büyüğü geçerli: EK_SÜRE 14", b.belirsizlik.birikenMs >= 30 * DAY_MS && b.ekSureKalanGun === 14, `${Math.round(b.belirsizlik.birikenMs / DAY_MS)} g kalan=${b.ekSureKalanGun}`);
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_TRACE_SETTING_KEY } });
  await refreshLicenseTrace();
  invalidateLicenseSnapshot();
  const c = getLicenseSnapshot().state;
  check("§26i ⭐ DB izi silindi (kurulmuştu) → LISANS_IZI_KAYIP(IZ) eklenir, birikim GERİLEMEZ (sayaç yalnız büyür)", nedenAyrinti(c, "LISANS_IZI_KAYIP").includes("IZ") && c.belirsizlik.birikenMs >= 30 * DAY_MS, `${nedenAyrinti(c, "LISANS_IZI_KAYIP")} ${Math.round(c.belirsizlik.birikenMs / DAY_MS)} g`);
}

async function ucIzBolumu(x: Hazir): Promise<void> {
  console.log("\n§27 — üç iz birden yok (K7): 14 günlük uyarı atlanır, EK_SÜRE tespit anından; yeniden başlatmak ek süreyi tazelemez");
  merdivenSaatiKur();
  try {
    await flushLicenseTraceWrites();
    fs.rmSync(path.join(x.dizin, LICENSE_FILES.LEASE), { force: true });
    fs.rmSync(path.join(x.dizin, LICENSE_FILES.STATE), { force: true });
    await prisma.systemSetting.deleteMany({ where: { key: LICENSE_TRACE_SETTING_KEY } });
    await yenidenBaslat(x.dizin);
    const a = getLicenseSnapshot();
    check(
      "§27a ⭐ kira + durum kaydı + DB izi yok → hemen EK_SÜRE 30 (BELIRSIZLIK_SURUYOR), LISANS_IZI_KAYIP(KIRA,DURUM,IZ), yaptırım kaynağı yok",
      a.state.belirsizlik.ucIzYok && a.state.hesaplananKademe === "EK_SURE" && a.state.ekSureKalanGun === 30 && nedenAyrinti(a.state, "LISANS_IZI_KAYIP") === "KIRA,DURUM,IZ" && a.state.yaptirimKademesi === null,
      `${a.state.hesaplananKademe} kalan=${a.state.ekSureKalanGun} ${a.state.nedenler.map((n) => n.kod).join(",")}`,
    );
    check("§27b etkin kurulum yoklamayı sürdürür (HAK var) ve zincir ucunu sunamaz (sonKiraId null)", a.activated && (await buildPollBody()).sonKiraId === null);
    ileriSar(5);
    check("§27c ⭐ K7 kalıcı olur: KİRASIZ kayıt (kiraId null, sıra 0, tespit anı) dosyaya ve DB izine", persistAccumulation());
    await flushLicenseTraceWrites();
    const k = durumKaydiAlani(x.dizin);
    const db = kayitAlani((await izSatiri())?.durum);
    check("§27d kayıt içeriği: kiraId null · sıra 0 · ekSureCapasi · birikim ≥ 19 g · DB kopyası aynı", k.kiraId === null && k.sira === 0 && typeof k.ekSureCapasi === "string" && Number((k.belirsizlik as { birikenMs: number }).birikenMs) >= 19 * DAY_MS && db.sira === 0, JSON.stringify({ kira: k.kiraId, sira: k.sira, ek: k.ekSureCapasi }));
    await yenidenBaslat(x.dizin);
    const b = getLicenseSnapshot().state;
    check("§27e ⭐ yeniden başlatma ek süreyi YENİDEN BAŞLATMAZ: kalan 25 gün (HAK verilişi çapası da uygulanmaz)", b.hesaplananKademe === "EK_SURE" && b.ekSureKalanGun === 25 && !b.belirsizlik.ucIzYok && !nedenVar(b, "KIRASIZ_EK_SURE"), `${b.hesaplananKademe} kalan=${b.ekSureKalanGun} ${b.nedenler.map((n) => n.kod).join(",")}`);
    const govde = await buildPollBody();
    check("§27f yoklama sıra 0 bildirir (satıcıda SIRA_GERILEDI/SIFIRLANDI) ve LISANS_IZI_KAYIP nedenini taşır", govde.durumKaydi?.sira === 0 && govde.durum.nedenler.includes("LISANS_IZI_KAYIP"));
    persistAccumulation();
    await flushLicenseTraceWrites();
    await yenidenBaslat(x.dizin);
    const k2 = durumKaydiAlani(x.dizin);
    const b2 = getLicenseSnapshot().state;
    check(
      "§27f2 ⭐ tespit anı SONRAKİ yazımlarda da kalıcı (üç iz artık yokken yazılan kayıt da aynı ekSureCapasi'yı taşır): yeniden başlatma yine tazelemez",
      k2.ekSureCapasi === k.ekSureCapasi && b2.hesaplananKademe === "EK_SURE" && b2.ekSureKalanGun === 25 && !nedenVar(b2, "KIRASIZ_EK_SURE"),
      `${String(k2.ekSureCapasi)} / ${String(k.ekSureCapasi)} kalan=${b2.ekSureKalanGun}`,
    );
    const p = await pollLicenseOnce();
    const y = getLicenseSnapshot().state;
    check("§27g yeni kira → kayıt kiraya bağlanır, merdiven kapanır (NORMAL)", p.outcome === "BASARILI" && y.hesaplananKademe === "NORMAL" && getLicenseSnapshot().view.record?.kiraId !== null, `${p.outcome} ${y.hesaplananKademe}`);
  } finally {
    __setLadderClockForTests(null);
  }
}

/** G12 §3.1-1 / Z9: anahtar okunamazsa YALNIZ imza durur; kararlar DB izindeki açık anahtarla doğrulanıp sürer. */
async function anahtarOkunamazBolumu(x: Hazir): Promise<void> {
  console.log("\n§28 — anahtar okunamaz (Z9): imza (yoklama, kayıt yazımı) durur, kapı · tavan · yaptırım DB izindeki açık anahtarla SÜRER");
  if (process.platform === "win32" || process.getuid?.() === 0) {
    console.log("⏭️  §28 atlandı (Windows ya da root: izin kilidi ölçülemez)");
    return;
  }
  x.satici.kiraEk = { yaptirim: { kademe: "K4", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
  await pollLicenseOnce();
  x.satici.kiraEk = {};
  await flushLicenseTraceWrites();
  const anahtar = path.join(x.dizin, LICENSE_FILES.KEY);
  fs.chmodSync(anahtar, 0o000);
  try {
    yeniden(x.dizin);
    const s = getLicenseSnapshot();
    check(
      "§28a ⭐ anahtar OKUNAMADI → imzaHazir=false · durumHazir=true; kira DB izindeki açık anahtarla bağlanır (kullanılabilir)",
      getLicenseStore()?.problem === "OKUNAMADI" && getLicenseStore()?.key === null && !s.imzaHazir && s.durumHazir && s.lease !== null,
      `imza=${s.imzaHazir} durum=${s.durumHazir} kira=${s.lease !== null}`,
    );
    check(
      "§28b ⭐ yaptırım SÜRER (K4 → KISITLI hesaplanır), DEPO_OKUNAMADI birikime girer, internet YOK sayılır",
      s.state.hesaplananKademe === "KISITLI" && nedenVar(s.state, "DEPO_OKUNAMADI") && s.state.belirsizlik.suruyor && !s.state.baglanti.internetVar,
      `${s.state.hesaplananKademe} ${s.state.nedenler.map((n) => n.kod).join(",")}`,
    );
    const p = await pollLicenseOnce();
    check("§28c ⭐ imza yok: yoklama dışarı ÇIKMAZ (HAZIR_DEGIL), kayıt yazılmaz", p.outcome === "HAZIR_DEGIL" && !persistAccumulation(), p.outcome);
    check("§28d sağlık bloğu iki hazırlığı ayrı bildirir", licenseHealthBlock().hazir === false && licenseHealthBlock().durumHazir === true);
  } finally {
    fs.chmodSync(anahtar, 0o600);
  }
  yeniden(x.dizin);
  const r = await pollLicenseOnce();
  check("§28e anahtar dönünce imza ve yoklama sürer, yaptırım yeni kiradan kalkar", r.outcome === "BASARILI" && getLicenseSnapshot().state.hesaplananKademe === "NORMAL", r.outcome);
}

const BASKA = (c: string): string => c.repeat(43);

/** K8 / §3.1-6 motorda: kural kiradan; eşiğin altı çalışma süresiyle merdiven, eşik tutunca kapanır; kayıp etken yoklamada. */
async function parmakIziMerdiveniBolumu(x: Hazir): Promise<void> {
  console.log("\n§29 — parmak izi v2 (K8) motorda: kural kiradan; eşiğin altı merdiven (çalışma süresi), eşik tutunca kapanır");
  const asil = getMeasuredFingerprint();
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  const olc = (digest: Fingerprint): void => setMeasuredFingerprint({ digest, measured: tum, measuredAt: new Date().toISOString() });
  merdivenSaatiKur();
  try {
    olc(x.f.parmakIzi as Fingerprint);
    x.satici.kiraEk = { parmakIziKurali: "standart" };
    await pollLicenseOnce();
    olc({ ...(x.f.parmakIzi as Fingerprint), f4: null });
    const a = getLicenseSnapshot();
    const govde = await buildPollBody();
    check(
      "§29a ⭐ kira `standart` kural taşır; f4 KAYIP ama eşik tutuyor (4 eşleşme, güçlü 2) → GEÇERLİ, yoklamada parmakIziKayip [f4] (portal notu)",
      a.fingerprintDecision?.rule === "standart" && a.fingerprintDecision.result === "ESLESTI" && !nedenVar(a.state, "PARMAK_IZI_UYUSMAZ") && JSON.stringify(govde.parmakIziKayip) === '["f4"]',
      `${a.fingerprintDecision?.rule}/${a.fingerprintDecision?.result} ${JSON.stringify(govde.parmakIziKayip)}`,
    );
    olc({ ...(x.f.parmakIzi as Fingerprint), f2: BASKA("A"), f3: BASKA("B") });
    const b = getLicenseSnapshot().state;
    check("§29b ⭐ güçlülerden ikisi değişti (f1 + f4 + f5 tutsa da) → PARMAK_IZI_UYUSMAZ UYARI, merdiven akar", nedenVar(b, "PARMAK_IZI_UYUSMAZ") && b.hesaplananKademe === "UYARI" && b.parmakIziMerdiveni.uyusmaz, b.nedenler.map((n) => n.kod).join(","));
    ileriSar(15);
    const c = getLicenseSnapshot().state;
    check("§29c ⭐ 15 gün çalışma süresi → EK_SÜRE 29 (hesaplanan; gözlem kirasında uygulanan NORMAL)", c.hesaplananKademe === "EK_SURE" && c.ekSureKalanGun === 29 && c.uygulananKademe === "NORMAL", `${c.hesaplananKademe} kalan=${c.ekSureKalanGun}`);
    persistAccumulation();
    check("§29d birikim imzalı kayda yazılır (≥ 15 g)", Number(durumKaydiAlani(x.dizin).parmakIziUyusmazMs) >= 15 * DAY_MS);
    olc(x.f.parmakIzi as Fingerprint);
    const d = getLicenseSnapshot().state;
    ileriSar(1);
    persistAccumulation();
    check("§29e ⭐ eşik yeniden TUTTU → merdiven KAPANIR: bulgu yok, birikim 0 (kayıtta da)", !nedenVar(d, "PARMAK_IZI_UYUSMAZ") && d.hesaplananKademe === "NORMAL" && Number(durumKaydiAlani(x.dizin).parmakIziUyusmazMs) === 0, `${d.hesaplananKademe} ${String(durumKaydiAlani(x.dizin).parmakIziUyusmazMs)}`);
  } finally {
    __setLadderClockForTests(null);
    x.satici.kiraEk = {};
    setMeasuredFingerprint(asil);
  }
  await pollLicenseOnce();
}

/** G12 §3.1-1/§3.1-2 motorda: DB okunamazsa iz BİLİNMİYOR; HAK doğrulanamazsa son bilinen tavan; önbellek kopyası taşınır. */
async function sonBilinenBolumu(x: Hazir): Promise<void> {
  console.log("\n§30 — DB okunamazsa iz BİLİNMİYOR · HAK doğrulanamazsa SON BİLİNEN tavan (durum kaydı pini → DB izi) · önbellek kopyası taşınır");
  await pollLicenseOnce();
  await flushLicenseTraceWrites();
  persistAccumulation();
  await flushLicenseTraceWrites();
  await refreshLicenseTrace();
  invalidateLicenseSnapshot();
  markLicenseTraceUnknown();
  invalidateLicenseSnapshot();
  const a = getLicenseSnapshot();
  check(
    "§30a ⭐ DB izi kurulmuşken DB okunamadı → iz BİLİNMİYOR: LISANS_IZI_KAYIP YOK, birikim akmaz (kayıp yalnız okunup YOK bulunan iz)",
    a.view.record?.izKurulu === true && !nedenVar(a.state, "LISANS_IZI_KAYIP") && !a.state.belirsizlik.suruyor,
    `izKurulu=${String(a.view.record?.izKurulu)} ${a.state.nedenler.map((n) => n.kod).join(",")}`,
  );
  await refreshLicenseTrace();
  invalidateLicenseSnapshot();

  const kopya = { f3: { ozet: BASKA("C"), an: new Date().toISOString(), yol: "f3.sahte" } };
  setFingerprintCacheCopy(kopya);
  persistAccumulation();
  setFingerprintCacheCopy(undefined);
  persistAccumulation();
  await flushLicenseTraceWrites();
  const dbKayit = kayitAlani((await izSatiri())?.durum);
  check(
    "§30b ⭐ saatlik yazım parmak izi önbellek kopyasını imzalı kayda ve DB izine yazar; yeni ölçüm yokken önceki kopyayı TAŞIR (düşürmez)",
    JSON.stringify(durumKaydiAlani(x.dizin).parmakIziOnbellegi) === JSON.stringify(kopya) && JSON.stringify(dbKayit.parmakIziOnbellegi) === JSON.stringify(kopya),
  );

  const hakYolu = path.join(x.dizin, LICENSE_FILES.ENTITLEMENT);
  const asilHak = fs.readFileSync(hakYolu);
  const pinModulleri = (durumKaydiAlani(x.dizin).sonHak as { moduller?: string[] } | undefined)?.moduller ?? [];
  try {
    fs.writeFileSync(hakYolu, "bozuk");
    yeniden(x.dizin);
    const b = getLicenseSnapshot();
    const tb = b.state.hesaplanan.modulTavani;
    check(
      "§30c ⭐ HAK bozuk → durum kaydı pininin modülleri: pindeki finans AÇIK, pinde olmayan iplik KAPALI (ham bayrağa düşülmez), üretim açık",
      b.entitlement === null && pinModulleri.includes("finance.enabled") && !pinModulleri.includes("iplik.enabled") &&
        ceilingAllows(tb, "finance.enabled") && !ceilingAllows(tb, "iplik.enabled") && ceilingAllows(tb, "production.enabled"),
      JSON.stringify(tb),
    );
    fs.rmSync(path.join(x.dizin, LICENSE_FILES.STATE));
    yeniden(x.dizin);
    const c = getLicenseSnapshot();
    const tc = c.state.hesaplanan.modulTavani;
    check(
      "§30d ⭐ durum.json da yok → DB izindeki pinin modülleri (iplik KAPALI, finans açık)",
      !c.view.fileValid && c.view.traceValid && ceilingAllows(tc, "finance.enabled") && !ceilingAllows(tc, "iplik.enabled"),
      JSON.stringify(tc),
    );
  } finally {
    fs.writeFileSync(hakYolu, asilHak);
    yeniden(x.dizin);
  }
  const pinsiz = { sonHak: null } as unknown as StateRecord;
  const pinli = { sonHak: { moduller: ["production.enabled", "finance.enabled"] } } as unknown as StateRecord;
  const gorunum = { record: pinsiz, copies: [pinsiz, pinli] } as unknown as RecordView;
  check(
    "§30e son bilinen tavan: en yeni kopyada pin yoksa ÖTEKİ kopyanınki (durum kaydı → DB izi yedeği)",
    JSON.stringify(lastKnownCeiling(gorunum)) === JSON.stringify(["production.enabled", "finance.enabled"]),
  );
  const p = await pollLicenseOnce();
  check("§30f HAK geri gelince yeni kira iz kaybını kapatır (NORMAL)", p.outcome === "BASARILI" && getLicenseSnapshot().state.hesaplananKademe === "NORMAL", p.outcome);
}

// ── §31 G4 iptal belgesi (L2-7) ─────────────────────────────────────────────────
async function iptalSatiri(): Promise<{ v?: number; jws?: string } | null> {
  const r = await prisma.systemSetting.findUnique({ where: { key: LICENSE_REVOCATION_SETTING_KEY }, select: { value: true } });
  return (r?.value as { v?: number; jws?: string } | undefined) ?? null;
}
function iptalDosyasi(dizin: string): string | null {
  const yol = path.join(dizin, LICENSE_FILES.REVOCATION);
  return fs.existsSync(yol) ? fs.readFileSync(yol, "utf8").trim() : null;
}
function iptalBelgesi(f: Fikstur, sira: number, kayit: { kid: string; kullanim: "ALT" | "HAK" | "INDIRME"; sertifikaId?: string }): string {
  const tarih = msToIso(Date.now() - DAY_MS);
  return iptalBas(f.kok, iptalYuku(f, { sira, iptaller: [{ kid: kayit.kid, sertifikaId: kayit.sertifikaId ?? randomUUID(), kullanim: kayit.kullanim, tarih, neden: "bekci" }] }));
}
const benimsemeler = (): Array<{ sira?: number; kayitSayisi?: number }> =>
  olaylar.filter((o) => o.action === "LICENSE_REVOCATION_ADOPTED").map((o) => o.payload as { sira?: number; kayitSayisi?: number });

async function iptalKabulBolumu(x: Hazir): Promise<void> {
  console.log("\n§31 — iptal belgesi (G4): kabul + DB kopyası · düşük sıra RED · onarım · pin + kayıp · ARA iptali gözlemde sıfır fark · ret erteleme · saat · biçimsiz");
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_REVOCATION_SETTING_KEY } });
  Object.assign(x.satici, { kiraEk: {}, hakEk: {}, hakMetni: null, iptal: null });
  await refreshLicenseRevocation();
  const eski = await pollLicenseOnce();
  const s0 = getLicenseSnapshot();
  const kayit0 = durumKaydiAlani(x.dizin);
  check(
    "§31a ⭐ ESKİ satıcı yanıtı (iptal yok, iptalSira yok) sıfır fark: kabul, HAK + kira yaşar, NORMAL, iptal dosyası/satırı ve kayıtta pin alanı YOK",
    eski.outcome === "BASARILI" && s0.entitlement !== null && s0.lease !== null && s0.state.hesaplananKademe === "NORMAL" &&
      !nedenVar(s0.state, "IPTAL_BELGESI_KAYIP") && iptalDosyasi(x.dizin) === null && (await iptalSatiri()) === null && !("iptalSira" in kayit0),
    `${eski.outcome} ${s0.state.nedenler.map((n) => n.kod).join(",")}`,
  );
  const iptal2 = iptalBelgesi(x.f, 2, { kid: "ind-eski-1", kullanim: "INDIRME" });
  Object.assign(x.satici, { iptal: iptal2, kiraEk: { iptalSira: 2 } });
  const ilk = benimsemeler().length;
  const p2 = await pollLicenseOnce();
  await flushRevocationWrites();
  const s2 = getLicenseSnapshot();
  check(
    "§31b ⭐ yanıttaki iptal (sıra 2) doğrulanıp BENİMSENİR: dosya + DB kopyası aynı metin, ayak izi (sıra · kayıt sayısı), kayıtta pin 2, bulgu yok",
    p2.outcome === "BASARILI" && iptalDosyasi(x.dizin) === iptal2 && (await iptalSatiri())?.jws === iptal2 && s2.iptal.sira === 2 &&
      benimsemeler().length === ilk + 1 && benimsemeler().at(-1)?.sira === 2 && benimsemeler().at(-1)?.kayitSayisi === 1 &&
      durumKaydiAlani(x.dizin).iptalSira === 2 && !nedenVar(s2.state, "IPTAL_BELGESI_KAYIP"),
    `${p2.outcome} sira=${String(s2.iptal.sira)} pin=${String(durumKaydiAlani(x.dizin).iptalSira)}`,
  );
  check("§31b2 DB kopyası ayrılmış ayar: ham ayar ucundan yazılamaz", isReservedSettingKey(LICENSE_REVOCATION_SETTING_KEY));
  x.satici.iptal = iptalBelgesi(x.f, 1, { kid: "ind-eski-2", kullanim: "INDIRME" });
  const p1 = await pollLicenseOnce();
  const dusukDogrudan = adoptRevocation(iptalBelgesi(x.f, 2, { kid: "ind-eski-3", kullanim: "INDIRME" }), x.f.kokler);
  check(
    "§31c ⭐ düşük (1) ve eşit (2) sıralı belge RED: kira kabul edilir ama belge benimsenmez, dosya sıra 2'de kalır",
    p1.outcome === "BASARILI" && iptalDosyasi(x.dizin) === iptal2 && !dusukDogrudan.adopted && benimsemeler().length === ilk + 1,
    `${p1.outcome} benimsendi=${String(dusukDogrudan.adopted)}`,
  );
  x.satici.iptal = iptal2;
}

async function iptalOnarimBolumu(x: Hazir): Promise<void> {
  const iptal2 = x.satici.iptal;
  fs.rmSync(path.join(x.dizin, LICENSE_FILES.REVOCATION), { force: true });
  invalidateLicenseSnapshot();
  await refreshLicenseRevocation();
  check("§31d ⭐ dosya silinince DB kopyasından GERİ YAZILIR (sessiz onarım), etkin belge sürer", iptalDosyasi(x.dizin) === iptal2 && getLicenseSnapshot().iptal.sira === 2);
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_REVOCATION_SETTING_KEY } });
  await refreshLicenseRevocation();
  await flushRevocationWrites();
  check("§31d2 DB satırı silinince dosyadan geri yazılır", (await iptalSatiri())?.jws === iptal2);
  Object.assign(x.satici, { iptal: null, kiraEk: {} });
  await pollLicenseOnce();
  fs.rmSync(path.join(x.dizin, LICENSE_FILES.REVOCATION), { force: true });
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_REVOCATION_SETTING_KEY } });
  await refreshLicenseRevocation();
  const s = getLicenseSnapshot();
  check(
    "§31e ⭐ iki kopya silinip kayıtta pin (2) varken → IPTAL_BELGESI_KAYIP (PIN) · ÖLÇÜLEMEDİ · birikime girer; gözlemde uygulanan NORMAL, HAK + kira yaşar",
    nedenAyrinti(s.state, "IPTAL_BELGESI_KAYIP") === "PIN" && s.state.gecerlilik === "OLCULEMEDI" && s.state.belirsizlik.suruyor &&
      s.state.uygulananKademe === "NORMAL" && s.entitlement !== null && s.lease !== null && getLicenseDetail().zincir.iptal.durum === "KAYIP",
    s.state.nedenler.map((n) => `${n.kod}:${n.ayrinti ?? ""}`).join(","),
  );
  x.satici.kiraEk = { iptalSira: 3 };
  const pk = await pollLicenseOnce();
  check("§31e2 kira sıra 3 beyan edip belge GELMEZSE kabul + kayıp (KIRA)", pk.outcome === "BASARILI" && nedenAyrinti(getLicenseSnapshot().state, "IPTAL_BELGESI_KAYIP") === "KIRA", pk.outcome);
  x.satici.iptal = iptalBelgesi(x.f, 3, { kid: "ind-eski-4", kullanim: "INDIRME" });
  await pollLicenseOnce();
  const t = getLicenseSnapshot();
  check("§31e3 belge (sıra 3) gelince kayıp kapanır, pin 3", !nedenVar(t.state, "IPTAL_BELGESI_KAYIP") && t.iptal.sira === 3 && durumKaydiAlani(x.dizin).iptalSira === 3);
}

async function iptalAraBolumu(x: Hazir): Promise<void> {
  const araId = randomUUID();
  Object.assign(x.satici, { hakMetni: araHakBas(x.f, {}, { sertifika: araSertifikasi(x.f, { sertifikaId: araId }) }), kiraEk: {} });
  const pa = await pollLicenseOnce();
  const z = getLicenseDetail().zincir;
  check(
    "§31j ⭐ detay zinciri: ara imzalı HAK → imzacı ARA + gömülü sertifika künyesi, kira ALT'ı, iptal (sıra 3 · 1 kayıt · pin · GUNCEL)",
    pa.outcome === "BASARILI" && z.hakImzacisi?.kind === "ARA" && z.hakImzacisi.sertifika?.sertifikaId === araId && z.kiraAlt?.kid === x.f.alt.kid &&
      z.iptal.sira === 3 && z.iptal.kayitSayisi === 1 && (z.iptal.pin ?? 0) >= 3 && z.iptal.durum === "GUNCEL",
    JSON.stringify(z.iptal),
  );
  const iptalAra = iptalBelgesi(x.f, 4, { kid: x.f.ara.kid, kullanim: "HAK", sertifikaId: araId });
  x.satici.iptal = iptalAra;
  const kiraOnce = getLicenseSnapshot().lease?.document.kiraId;
  const pr = await pollLicenseOnce();
  const s = getLicenseSnapshot();
  check(
    "§31f ⭐ reddedilen yanıttaki ALT'a dokunmayan iptal BENİMSENİR; ARA'sı iptal edilen HAK → hesaplanan UYARI (HAK_GECERSIZ SERTIFIKA_IPTAL), gözlemde uygulanan NORMAL, kira YAŞAR",
    pr.outcome === "BASARISIZ" && iptalDosyasi(x.dizin) === iptalAra && nedenAyrinti(s.state, "HAK_GECERSIZ") === "SERTIFIKA_IPTAL" &&
      s.state.hesaplananKademe === "UYARI" && s.state.uygulananKademe === "NORMAL" && s.lease?.document.kiraId === kiraOnce,
    `${pr.outcome}/${pr.code ?? ""} ${s.state.nedenler.map((n) => `${n.kod}:${n.ayrinti ?? ""}`).join(",")}`,
  );
  x.satici.hakMetni = null;
  const geri = await pollLicenseOnce();
  check("§31f2 kök imzalı HAK'la yeni yanıt kabul edilir, durum NORMAL", geri.outcome === "BASARILI" && getLicenseSnapshot().state.hesaplananKademe === "NORMAL", geri.outcome);
  x.satici.iptal = iptalBelgesi(x.f, 5, { kid: x.f.alt.kid, kullanim: "ALT" });
  const kiraAlt = getLicenseSnapshot().lease?.document.kiraId;
  const pd = await pollLicenseOnce();
  const d = getLicenseSnapshot();
  check(
    "§31g ⭐ eldeki kiranın ALT'ını iptal eden belge reddedilen yanıttan BENİMSENMEZ (ertelenir): dosya sıra 4'te, kira yaşar, NORMAL",
    pd.outcome === "BASARISIZ" && iptalDosyasi(x.dizin) === iptalAra && d.lease?.document.kiraId === kiraAlt && d.state.hesaplananKademe === "NORMAL",
    `${pd.outcome}/${pd.code ?? ""}`,
  );
  x.satici.iptal = iptalAra;
}

async function iptalSaatBolumu(x: Hazir): Promise<void> {
  for (const govde of ["bozuk-metin", bozuk(iptalBelgesi(x.f, 9, { kid: "ind-eski-5", kullanim: "INDIRME" }))]) {
    x.satici.iptal = govde;
    const p = await pollLicenseOnce();
    check(`§31i ⭐ biçimsiz/imzası bozuk iptal (${govde.length} karakter) kirayı DÜŞÜRMEZ ve benimsenmez`, p.outcome === "BASARILI" && getLicenseSnapshot().iptal.sira === 4, p.outcome);
  }
  x.satici.iptal = null;
  const ileri = Date.now() + 2 * 60 * 60 * 1000;
  const hak = hakBas(x.f, { verilis: msToIso(ileri) });
  const kira = kiraBas(x.f, { kurulumAnahtarKimligi: getLicenseStore()?.key?.kid ?? "", verilis: msToIso(ileri), sunucuSaati: msToIso(ileri + 60_000) });
  const yanit = LicenseResponseSchema.parse({ v: 1, hak, kira, indirmeBelirtecleri: [], sunucuSaati: msToIso(ileri + 60_000) });
  let kabul = "HATA_YOK";
  try {
    verifyResponseDocuments(yanit, requireReady(), null);
  } catch (e) {
    kabul = String((e as { details?: { protocolCode?: string } }).details?.protocolCode ?? e);
  }
  const kirasiz = verifyLicenseDocuments({ entitlementJws: hak, leaseJws: null, roots: x.f.kokler, revocation: null, nowFloorMs: Date.now() });
  const kirali = verifyLicenseDocuments({ entitlementJws: hak, leaseJws: kira, roots: x.f.kokler, revocation: null, nowFloorMs: Date.now() });
  check(
    "§31h ⭐ saati 2 sa GERİ fabrika: taze HAK kabulde ve durumda geçerli (şimdi ⊇ kiranın imzalı sunucu saati); kirasız kontrol BELGE_ILERI_TARIHLI",
    kabul === "HATA_YOK" && kirali.hak.status === "GECERLI" && kirasiz.hak.status === "GECERSIZ" && kirasiz.hak.code === "BELGE_ILERI_TARIHLI",
    `kabul=${kabul} kirali=${kirali.hak.status} kirasiz=${kirasiz.hak.status}`,
  );
  const iptal6 = iptalBelgesi(x.f, 6, { kid: "ind-eski-6", kullanim: "INDIRME" });
  await acceptOfflineResponse({ v: 1, hak: null, kira: getLicenseStore()?.leaseJws, indirmeBelirtecleri: [], sunucuSaati: msToIso(Date.now()), iptal: iptal6 }, "aktarma", null);
  const sonuc = (olaylar.filter((o) => o.action === "LICENSE_ADMIN_ACTION").at(-1)?.payload as { sonuc?: string } | undefined)?.sonuc;
  check(
    "§31k ⭐ AYNI kiranın tekrarı (yeni kira değil) da yanıttaki yüksek sıralı iptali benimser",
    sonuc === "ayni-kira" && iptalDosyasi(x.dizin) === iptal6 && getLicenseSnapshot().iptal.sira === 6,
    String(sonuc),
  );
}

async function donanimBildirimiBolumu(x: Hazir): Promise<void> {
  console.log("\n§25 — donanım değişikliği bildirimi (K8): imzalı `donanim` isteği · BEKLIYOR · ONAYLANDI yeni kira · eski satıcı · etkinleşmemiş");
  const olcum = getMeasuredFingerprint();
  try {
    // Kira kümesi = fikstür (beş etken dolu): bildirim GERÇEK ölçümü gönderir, bu makinede okunamayan etken kayıptır.
    const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
    setMeasuredFingerprint({ digest: x.f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date(0).toISOString() });
    await pollLicenseOnce();
    const kabulKumesi = getLicenseSnapshot().lease?.document.parmakIzi as Fingerprint;
    x.satici.donanimDurumu = "BEKLIYOR";
    const iz = olaylar.length;
    const sayac0 = x.satici.sayac.donanim;
    const r = await reportHardwareChange("anakart değişti", null);
    const govde = x.satici.donanimGovdeleri.at(-1) as { parmakIzi?: Fingerprint; kayip?: string[]; gerekce?: unknown } | undefined;
    const son = x.satici.istekler.at(-1);
    const olculen = currentFingerprintDigest();
    check(
      "§25a ⭐ etkin kurulum: imzalı `donanim` isteği KATI gövdeyle (lisans kimliğiyle) gider, gövdedeki küme = ölçülen küme; BEKLIYOR + talep",
      r.durum === "BEKLIYOR" && x.satici.sayac.donanim === sayac0 + 1 && son?.amac === "donanim" && son.kimlik === x.f.kurulumId && ayniKume(govde?.parmakIzi, olculen) && govde?.gerekce === "anakart değişti" && r.talepId.length === 36,
      `${r.durum} ${JSON.stringify(son)}`,
    );
    const beklenenKayip = (["f1", "f2", "f3", "f4", "f5"] as const).filter((f) => olculen[f] === null && kabulKumesi[f] !== null);
    check(
      "§25b kayıp listesi (gövde = yanıt) = kira kümesinde değeri olup ölçümde (önbellek dahil) olmayan etkenler",
      ayniKume(kabulKumesi, x.f.parmakIzi as Fingerprint) && JSON.stringify(govde?.kayip) === JSON.stringify(r.kayip) && JSON.stringify(r.kayip) === JSON.stringify(beklenenKayip),
      `kayıp ${JSON.stringify(r.kayip)} · ölçülemeyen ${(["f1", "f2", "f3", "f4", "f5"] as const).filter((f) => olculen[f] === null).join(",") || "yok"} · kira kümesi ${getLicenseSnapshot().lease ? "var" : "YOK"}`,
    );
    const yeniOlcum = getMeasuredFingerprint();
    check("§25c bildirim parmak izini YENİDEN ölçer (çok yollu okuma raporuyla)", !!yeniOlcum?.okuma && yeniOlcum.measuredAt !== new Date(0).toISOString(), yeniOlcum?.measuredAt ?? "");
    const eylem = olaylar.slice(iz).find((o) => o.action === "LICENSE_ADMIN_ACTION")?.payload as { eylem?: string; sonuc?: string; talepId?: string } | undefined;
    check("§25d ayak izi: yönetici eylemi 'donanim-bildir' + sonuç + talep", eylem?.eylem === "donanim-bildir" && eylem.sonuc === "BEKLIYOR" && eylem.talepId === r.talepId, JSON.stringify(eylem));
    x.satici.donanimDurumu = "ONAYLANDI";
    const once = getLicenseSnapshot().lease?.document.kiraId;
    const iz2 = olaylar.length;
    const o = await reportHardwareChange(null, null);
    const kabul = olaylar.slice(iz2).find((e) => e.action === "LICENSE_LEASE_ACCEPTED")?.payload as { kaynak?: string } | undefined;
    check(
      "§25e ⭐ ONAYLANDI: satıcının yeni kirası doğrulanıp kabul edilir (kaynak 'donanim'), yeni kiranın kümesi bildirilen küme",
      o.durum === "ONAYLANDI" && o.lisans.kira?.kiraId !== once && kabul?.kaynak === "donanim" && ayniKume(getLicenseSnapshot().lease?.document.parmakIzi, currentFingerprintDigest()),
      `${o.durum} ${String(kabul?.kaynak)}`,
    );
    x.satici.donanimDurumu = "YOK";
    const kira = getLicenseSnapshot().lease?.document.kiraId;
    check(
      "§25f eski satıcı (uç yok) → LICENSE_VENDOR_REJECTED/BULUNAMADI, kira değişmez",
      (await hataKodu(reportHardwareChange(null, null))) === "LICENSE_VENDOR_REJECTED/BULUNAMADI" && getLicenseSnapshot().lease?.document.kiraId === kira,
    );
    yeniden(path.join(GECICI, "donanim-etkin-degil"));
    const istek0 = x.satici.istekler.length;
    check("§25g etkinleşmemiş kurulum → 409 LICENSE_NOT_ACTIVE, satıcıya istek gitmez", (await hataKodu(reportHardwareChange(null, null))) === "LICENSE_NOT_ACTIVE" && x.satici.istekler.length === istek0);
  } finally {
    yeniden(x.dizin);
    x.satici.donanimDurumu = "BEKLIYOR";
    if (olcum) setMeasuredFingerprint(olcum);
    // Kira kümesi fikstüre dönsün (sonraki bölümler fikstür kümesiyle GECERLI bekler).
    await pollLicenseOnce();
  }
}

// ── §32 tel: yetenekler · istek yolu · çevrimdışı donanım zarfı (L2-7 B) ───────────
const TUM_YETENEKLER = ["hak-ara", "odenmis-tarih", "iptal", "parmak-izi-v2"];
const IKI_YETENEK = ["odenmis-tarih", "parmak-izi-v2"];
const yetenekleri = (g: unknown): string => JSON.stringify((g as { yetenekler?: unknown } | undefined)?.yetenekler ?? null);

/** Zarfı sahte satıcının `/v1/cevrimdisi`ine taşır (QR sayfasının yaptığı) — yanıt metni ya da hata kodu. */
async function zarfiTasi(x: Hazir, istekGovdesi: { v: 1; zarf: string }): Promise<{ status: number; body: string }> {
  return egressTransport({ url: `${x.satici.url}${ENDPOINTS.OFFLINE}`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(istekGovdesi) });
}

async function telBolumu(x: Hazir): Promise<void> {
  console.log("\n§32 — tel (L2-7 B): yetenekler gövdede · çekirdek yokken iki yetenek · eski satıcı · imzada yol + ISTEK_YOL · çevrimdışı donanım zarfı");
  Object.assign(x.satici, { kiraEk: {}, hakEk: {}, hakMetni: null, iptal: null });
  const p = await pollLicenseOnce();
  const beklenen = JSON.stringify(capabilitiesFor(getLicenseCore()));
  const canli = getLicenseCore().source !== "yok";
  check(
    "§32a ⭐ yetenekler satıcıya giden yoklama VE etkinleştirme gövdesinde (canlı çekirdekte dördü, LICENSE_CAPABILITIES sırası)",
    p.outcome === "BASARILI" && canli && beklenen === JSON.stringify(TUM_YETENEKLER) &&
      yetenekleri(x.satici.yoklamaGovdeleri.at(-1)) === beklenen && yetenekleri(x.satici.etkinlestirmeGovdeleri.at(-1)) === beklenen,
    `${p.outcome} yoklama=${yetenekleri(x.satici.yoklamaGovdeleri.at(-1))} etkinleştirme=${yetenekleri(x.satici.etkinlestirmeGovdeleri.at(-1))}`,
  );
  const sagir: LicenseCore = { ...tsLicenseCore, verifyRevocation: () => ({ ok: false, code: "CEKIRDEK_YOK", message: "bekçi" }) };
  check(
    "§32b ⭐ çekirdek YOK (ya da canlı sondaya CEKIRDEK_YOK diyor) → yalnız odenmis-tarih + parmak-izi-v2; hak-ara/iptal bildirilmez",
    JSON.stringify(capabilitiesFor(unavailableCore("bekçi"))) === JSON.stringify(IKI_YETENEK) && JSON.stringify(capabilitiesFor(sagir)) === JSON.stringify(IKI_YETENEK),
    `${JSON.stringify(capabilitiesFor(unavailableCore("bekçi")))} ${JSON.stringify(capabilitiesFor(sagir))}`,
  );
  const once = licenseCapabilities();
  configureLicenseCoreForTests(unavailableCore("bekçi"));
  const sonra = licenseCapabilities();
  configureLicenseCoreForTests(null);
  invalidateLicenseSnapshot();
  check("§32c küme süreç içinde KARARLI: çekirdek sonradan düşse de yetenek listesi değişmez (satıcıda YETENEK_DUSUSU doğmaz)", once === sonra && JSON.stringify(sonra) === beklenen);
  check(
    "§32d eski satıcı yeteneği yok sayar (kök HAK, iptalsiz, iptalSira'sız yanıt): yoklama BAŞARILI, NORMAL — gövdede yetenek olması yolu bozmaz",
    p.outcome === "BASARILI" && getLicenseSnapshot().state.hesaplananKademe === "NORMAL" && getLicenseSnapshot().entitlement !== null,
    getLicenseSnapshot().state.nedenler.map((n) => n.kod).join(","),
  );

  const uyusmaz = x.satici.istekler.filter((i) => i.imzaliYol !== i.uc);
  const turler = new Set(x.satici.istekler.map((i) => i.amac));
  check(
    "§32e ⭐ her imzalı istek KENDİ ucunun yolunu imzalar (yokla · etkinleştir · zil · donanım); sahte satıcı yolu doğrular",
    uyusmaz.length === 0 && (["yokla", "etkinlestir", "zil", "donanim"] as const).every((a) => turler.has(a)),
    `${uyusmaz.length} uyuşmaz ${uyusmaz.slice(0, 3).map((i) => `${i.amac}:${String(i.imzaliYol)}→${i.uc}`).join(" ")} · türler ${[...turler].join(",")}`,
  );
  const yanlisUc = await vendorPost(ENDPOINTS.POLL, "donanim", buildHardwareReportBody(null), (req) =>
    egressTransport({ ...req, url: req.url.replace(ENDPOINTS.POLL, ENDPOINTS.HARDWARE) }),
  );
  check(
    "§32f ⭐ yanlış uca imzalı istek (yol /v1/yokla, gönderildiği uç /v1/donanim) → 401 ISTEK_YOL",
    !yanlisUc.ok && yanlisUc.status === 401 && yanlisUc.code === "ISTEK_YOL" && x.satici.sonRedKodu === "ISTEK_YOL",
    yanlisUc.ok ? "kabul edildi" : `${yanlisUc.status} ${yanlisUc.code}`,
  );

  const olcum = getMeasuredFingerprint();
  try {
    // Eski ölçüm damgası: zarf parmak izini YENİDEN ölçmeli (çevrimiçi bildirimle aynı, §25c).
    setMeasuredFingerprint({ digest: x.f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date(0).toISOString() });
    const cv = await buildOfflineRequest({ amac: "donanim", gerekce: "disk değişti" });
    const yeniOlcum = getMeasuredFingerprint();
    const z = openEnvelope(cv.zarf);
    const istek = z.ok ? parseJws(z.value.request) : null;
    const yuk = (istek?.ok ? istek.value.payload : {}) as { amac?: string; yol?: string; kurulumId?: string };
    const govde = z.ok ? HardwareReportRequestSchema.safeParse(JSON.parse(z.value.body.toString("utf8"))) : null;
    check(
      "§32g ⭐ çevrimdışı donanım zarfı: imzalı `donanim` isteği, yol /v1/cevrimdisi, lisans kimliğiyle, KATI donanım gövdesi (YENİDEN ölçülen küme + kayıp + gerekçe)",
      cv.amac === "donanim" && cv.hedefYol === ENDPOINTS.OFFLINE && yuk.amac === "donanim" && yuk.yol === ENDPOINTS.OFFLINE && yuk.kurulumId === x.f.kurulumId &&
        govde?.success === true && govde.data.gerekce === "disk değişti" && ayniKume(govde.data.parmakIzi, currentFingerprintDigest()) &&
        !!yeniOlcum?.okuma && yeniOlcum.measuredAt !== new Date(0).toISOString(),
      `${cv.amac} ${String(yuk.amac)} ${String(yuk.yol)} gövde=${String(govde?.success)} ölçüm=${yeniOlcum?.measuredAt ?? "yok"}`,
    );
    const kira0 = getLicenseSnapshot().lease?.document.kiraId;
    x.satici.donanimDurumu = "BEKLIYOR";
    const sayac0 = x.satici.sayac.cevrimdisi;
    const bekleyen = await zarfiTasi(x, cv.istekGovdesi);
    check(
      "§32h ⭐ satıcı zarfı /v1/cevrimdisi'den donanım bildirimine yönlendirir; BEKLIYOR yanıtı → 409 LICENSE_HARDWARE_PENDING, kira değişmez",
      bekleyen.status === 200 && x.satici.sayac.cevrimdisi === sayac0 + 1 && (await hataKodu(acceptOfflineResponse(bekleyen.body, "cevrimdisi", null))) === "LICENSE_HARDWARE_PENDING" &&
        getLicenseSnapshot().lease?.document.kiraId === kira0,
      `${bekleyen.status} ${bekleyen.body.slice(0, 120)}`,
    );
    x.satici.donanimDurumu = "REDDEDILDI";
    const ret = await zarfiTasi(x, (await buildOfflineRequest({ amac: "donanim" })).istekGovdesi);
    check("§32i REDDEDILDI yanıtı → 409 LICENSE_HARDWARE_REJECTED, kira değişmez", (await hataKodu(acceptOfflineResponse(ret.body, "cevrimdisi", null))) === "LICENSE_HARDWARE_REJECTED" && getLicenseSnapshot().lease?.document.kiraId === kira0);
    x.satici.donanimDurumu = "ONAYLANDI";
    const onay = await zarfiTasi(x, (await buildOfflineRequest({ amac: "donanim" })).istekGovdesi);
    const iz = olaylar.length;
    const qrMetni = Buffer.from(onay.body, "utf8").toString("base64url");
    // Ret bölümü düşürmesin (sonraki bölümler koşsun): kabul hatası kodla ölçülür.
    const onayHatasi = await hataKodu(acceptOfflineResponse(qrMetni, "cevrimdisi", null));
    const kabul = olaylar.slice(iz).find((e) => e.action === "LICENSE_LEASE_ACCEPTED")?.payload as { kaynak?: string } | undefined;
    const eylem = olaylar.slice(iz).find((e) => e.action === "LICENSE_ADMIN_ACTION")?.payload as { sonuc?: string; donanimTalebi?: string } | undefined;
    check(
      "§32j ⭐ ONAYLANDI yanıtı (QR metni) → içteki kira doğrulanıp kabul edilir (kaynak 'donanim'), ayak izinde talep",
      onayHatasi === "HATA_YOK" && getLicenseSnapshot().lease?.document.kiraId !== kira0 && kabul?.kaynak === "donanim" && eylem?.sonuc === "kabul" && typeof eylem.donanimTalebi === "string",
      `${onayHatasi} ${String(kabul?.kaynak)} ${JSON.stringify(eylem)}`,
    );
    yeniden(path.join(GECICI, "zarf-etkin-degil"));
    check("§32k etkinleşmemiş kurulum donanım zarfı üretmez → 409 LICENSE_NOT_ACTIVE", (await hataKodu(buildOfflineRequest({ amac: "donanim" }))) === "LICENSE_NOT_ACTIVE");
  } finally {
    yeniden(x.dizin);
    x.satici.donanimDurumu = "BEKLIYOR";
    if (olcum) setMeasuredFingerprint(olcum);
    await pollLicenseOnce();
  }
}

async function motorBolumu(): Promise<void> {
  console.log("\n§15 — motor dayanıklılığı (D5): kimlik gelmezse pes etmez; sağlıkta başlamadı/çalışıyor");
  const olcum = getMeasuredFingerprint();
  __resetLicensePollForTests();
  check("§15a başlatılmadan sağlık: motor BASLAMADI", licenseHealthBlock().motor === "BASLAMADI");
  __resetInstallationIdentityForTests();
  configureLicensePollForTests({ identityWaitMs: 300, bootRetryMs: 400, startupDelayMs: 60 * 60_000 });
  startLicensePoll();
  const bekledi = await bekleKadar(() => licenseHealthBlock().motorNeden === "KIMLIK_YOK", 5000);
  const h1 = licenseHealthBlock();
  check("§15b ⭐ kimlik gelmezse motor BAŞLAMADI (neden sağlıkta: KIMLIK_YOK)", bekledi && h1.motor === "BASLAMADI", `${String(h1.motor)} ${String(h1.motorNeden)}`);
  await bekle(900);
  await ensureInstallationIdentity();
  const calisti = await bekleKadar(() => licenseHealthBlock().motor === "CALISIYOR", 8000);
  check("§15c ⭐ PES ETMEZ: kimlik sonradan gelince yeniden denemede motor ÇALIŞIYOR", calisti, String(licenseHealthBlock().motor));
  __resetLicensePollForTests();
  if (olcum) setMeasuredFingerprint(olcum);
  const N = 60 * 60_000;
  check(
    "§15d başarısız yoklamadan sonra kısa aralık (2 · 4 · 8 dk…), olağan aralıkla tavanlı; başarıda/dışarı çıkılmayanda olağan",
    nextPollDelayMs("BASARISIZ", 1, N) === 2 * 60_000 && nextPollDelayMs("BASARISIZ", 2, N) === 4 * 60_000 && nextPollDelayMs("BASARISIZ", 9, N) === N &&
      nextPollDelayMs("BASARILI", 0, N) === N && nextPollDelayMs("ETKIN_DEGIL", 3, N) === N,
  );
  check("§15e kimlik işi pes etmez: hızlı denemeler tükenince seyrek aralık, sonsuza dek", identityRetryDelayMs(1) === 15_000 && identityRetryDelayMs(5) === 300_000 && identityRetryDelayMs(10_000) === 300_000);
}

type LisansDurumIzi = { readonly dosyalar: Record<string, string>; readonly iz: string | null; readonly iptal: string | null };

/** Lisans dizininin her dosyası (sha256) + DB izi ve iptal kopyası (değer + `updatedAt`): "yalnız okur" ölçüsü. */
async function lisansDurumIzi(dizin: string): Promise<LisansDurumIzi> {
  const dosyalar: Record<string, string> = {};
  for (const ad of fs.readdirSync(dizin).sort()) {
    const yol = path.join(dizin, ad);
    if (fs.statSync(yol).isFile()) dosyalar[ad] = createHash("sha256").update(fs.readFileSync(yol)).digest("hex");
  }
  const satir = async (key: string): Promise<string | null> => {
    const r = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true, updatedAt: true } });
    return r ? JSON.stringify([r.value, r.updatedAt.toISOString()]) : null;
  };
  return { dosyalar, iz: await satir(LICENSE_TRACE_SETTING_KEY), iptal: await satir(LICENSE_REVOCATION_SETTING_KEY) };
}

function durumFarki(a: LisansDurumIzi, b: LisansDurumIzi): string[] {
  const adlar = [...new Set([...Object.keys(a.dosyalar), ...Object.keys(b.dosyalar)])].sort();
  return [...adlar.filter((n) => a.dosyalar[n] !== b.dosyalar[n]), ...(a.iz !== b.iz ? ["iz"] : []), ...(a.iptal !== b.iptal ? ["iptal"] : [])];
}

/** Güncelleyicinin `--dogrulama` başlatması: sağlık düşerse DB yedekten döner — lisans durumu bir sıra önde kalmamalı. */
async function dogrulamaKipiBolumu(x: Hazir): Promise<void> {
  console.log("\n§34 — doğrulama kipi YAN ETKİSİZ: açılış + kapanış lisans durumunu yalnız OKUR (dizin + DB izi bayt-eşit)");
  const olcum = getMeasuredFingerprint();
  __resetLicensePollForTests();
  await flushLicenseTraceWrites();
  try {
    // İptal DB kopyası eksik: normal açılış onarır (karşı §34d), doğrulama kipi dokunmamalı.
    await prisma.systemSetting.deleteMany({ where: { key: LICENSE_REVOCATION_SETTING_KEY } });
    const once = await lisansDurumIzi(x.dizin);
    check(
      "§34 ön koşul: etkin kurulum; durum.json + DB izi + iptal dosyası var, iptal DB kopyası yok",
      getLicenseSnapshot().activated && LICENSE_FILES.STATE in once.dosyalar && once.iz !== null && LICENSE_FILES.REVOCATION in once.dosyalar && once.iptal === null,
      Object.keys(once.dosyalar).join(","),
    );
    const yokla0 = x.satici.sayac.yokla;
    process.env[VERIFICATION_MODE_ENV] = "1";
    configureLicensePollForTests({ identityWaitMs: 2000, bootRetryMs: 400, startupDelayMs: 60 * 60_000 });
    startLicensePoll();
    const hazir = await bekleKadar(() => licenseHealthBlock().motorNeden === "DOGRULAMA_KIPI", 15_000);
    const h = licenseHealthBlock();
    check("§34a doğrulama kipinde motor yerel ölçümü bitirir → CALISIYOR (DOGRULAMA_KIPI)", hazir && h.motor === "CALISIYOR", `${String(h.motor)} ${String(h.motorNeden)}`);
    // Kapanış da kipte: güncelleyici sınamadan sonra süreci durdurur.
    __resetLicensePollForTests();
    await flushLicenseTraceWrites();
    await flushRevocationWrites();
    delete process.env[VERIFICATION_MODE_ENV];
    const fark = durumFarki(once, await lisansDurumIzi(x.dizin));
    check("§34b ⭐ açılış + kapanış sonrası lisans dizini (durum.json · parmak izi önbelleği · iptal) ve DB izi + iptal kopyası BAYT-EŞİT", fark.length === 0, fark.join(", ") || "eşit");
    check("§34c doğrulama kipinde satıcıya istek gitmez", x.satici.sayac.yokla === yokla0, `${yokla0}→${x.satici.sayac.yokla}`);
    configureLicensePollForTests({ identityWaitMs: 2000, bootRetryMs: 400, startupDelayMs: 60 * 60_000 });
    startLicensePoll();
    const calisti = await bekleKadar(() => licenseHealthBlock().motor === "CALISIYOR", 15_000);
    await flushLicenseTraceWrites();
    await flushRevocationWrites();
    const nf = durumFarki(once, await lisansDurumIzi(x.dizin));
    check(
      "§34d karşı (ölçüm kör değil): AYNI açılış normal kipte durum.json + DB izini yazar, iptal kopyasını onarır",
      calisti && nf.includes(LICENSE_FILES.STATE) && nf.includes("iz") && nf.includes("iptal"),
      nf.join(", "),
    );
  } finally {
    delete process.env[VERIFICATION_MODE_ENV];
    __resetLicensePollForTests();
    await flushLicenseTraceWrites();
    // Silinen iptal kopyası her durumda dosyadan geri yazılır (sonraki bölümler iki kopyaya dayanır).
    await refreshLicenseRevocation();
    await flushRevocationWrites();
    if (olcum) setMeasuredFingerprint(olcum);
  }
}

function gozlemSayaciBolumu(): void {
  console.log("\n§16 — gözlem 'reddederdim' sayacı ÇAĞRI değil İSTEK × modül başına");
  const snap = getLicenseSnapshot();
  const onkosul = snap.durumHazir && snap.state.kip === "gozlem" && snap.state.hesaplanan.modulTavani.applies && !snap.state.hesaplanan.modulTavani.allowed?.includes("iplik.enabled");
  check("§16 ön koşul: gözlem + hesaplanan tavan iplik'i kapatıyor", Boolean(onkosul), `${snap.state.kip} ${JSON.stringify(snap.state.hesaplanan.modulTavani)}`);
  resetObservationCounters();
  const istek = {} as Request;
  runWithRequestContext(istek, () => {
    for (let i = 0; i < 5; i++) applyModuleCeiling("iplik.enabled", true);
  });
  const a = peekObservationCounters().reddedilecekModul;
  runWithRequestContext(istek, () => {
    for (let i = 0; i < 3; i++) applyModuleCeiling("iplik.enabled", true);
    applyModuleCeiling("dokuma.enabled", true);
  });
  const b = peekObservationCounters().reddedilecekModul;
  for (let i = 0; i < 4; i++) applyModuleCeiling("iplik.enabled", true);
  const c = peekObservationCounters().reddedilecekModul;
  check("§16a ⭐ bir istekte 5 çağrı = 1; ikinci istek iki modül = +2; bağlamsız 4 çağrı (aynı pencere) = +1", a === 1 && b === 3 && c === 4, `${a}/${b}/${c}`);
  resetObservationCounters();
}

async function zilGeriCekilmeBolumu(x: Hazir): Promise<void> {
  console.log("\n§17 — zil: kısa ömürlü bağlantı geri çekilmeyi sıfırlamaz (kesen vekilde fırtına yok)");
  check(
    "§17a sıra yalnız ≥ 1 dk yaşamış bağlantıda sıfırlanır",
    reconnectAttempt(4, 5_000) === 4 && reconnectAttempt(4, null) === 4 && reconnectAttempt(4, STABLE_CONNECTION_MS) === 0,
  );
  x.satici.zilOmruMs = 200;
  const z0 = x.satici.sayac.zil;
  startLicenseDoorbell();
  kickLicenseDoorbell();
  await bekle(6000);
  const baglanti = x.satici.sayac.zil - z0;
  __resetLicenseDoorbellForTests();
  x.satici.zilOmruMs = 0;
  check("§17b ⭐ her bağlantısı 200 ms'de kesilen satıcıya 6 sn'de ≤ 3 bağlantı (üstel geri çekilme sürer; sıfırlansaydı ≥ 5)", baglanti >= 2 && baglanti <= 3, `${baglanti} bağlantı`);
}

function ortamBolumu(): void {
  console.log("\n§18 — ortam künyesi: işletim sistemi metni makine adını İÇERMEZ");
  const ornek = describeOperatingSystem({ type: "Linux", release: "5.15.0-FABRIKA-SRV-01-generic", hostname: "fabrika-srv-01" });
  check("§18a ⭐ sürüm dizgesi makine adını taşısa da künyeye girmez (büyük/küçük harf duyarsız)", !ornek.toLowerCase().includes("fabrika-srv-01") && ornek.startsWith("Linux 5.15.0"), ornek);
  const gercek = buildEnvironment().isletimSistemi;
  check("§18b ölçüm: bu makinenin künyesi makine adını taşımıyor", !gercek.toLowerCase().includes(os.hostname().toLowerCase()), gercek);
}

async function kapaliSureBolumu(x: Hazir): Promise<void> {
  console.log("\n§19 — saat: makine günlerce KAPALI kaldıysa sahte SAAT_İLERİ yok; açıkken ileri sıçrama yakalanır");
  const key = getLicenseStore()?.key;
  const ent = getLicenseSnapshot().entitlement;
  if (!key || !ent) {
    check("§19 ön koşul: depo + HAK", false);
    return;
  }
  const simdi = Date.now();
  const verilis = simdi - 2 * DAY_MS - 60 * 60_000;
  const kiraId = randomUUID();
  const kira = kiraBas(x.f, { kiraId, parmakIzi: currentFingerprintDigest(), verilis: msToIso(verilis), sunucuSaati: msToIso(verilis), bitis: msToIso(simdi + 20 * DAY_MS), zorlama: false });
  const kayit = (tutarli: boolean): string =>
    signStateRecord(
      {
        v: 1, kurulumId: x.f.kurulumId, kiraId, birikenMs: 60 * 60_000, yazildi: msToIso(simdi - 2 * DAY_MS), yuksekSu: msToIso(verilis),
        sonKiraZorlamasi: false, sonYaptirim: null, sira: 900, sonKira: { kiraId, verilis: msToIso(verilis) },
        sonHak: { hakId: ent.document.hakId, surum: ent.document.surum, sinif: ent.document.sinif, kokTuru: "kok" }, kapaliMs: 0, duvarTutarli: tutarli,
      },
      key.privateKey,
      key.x,
    );
  // Kayıt İKİ kopyada (durum.json + DB izi) aynı yazılır — motorun kendi yazımı gibi; yalnız dosyayı eskitmek DB'deki
  // yeni kopyaya yenilirdi (G12: en yeni sıra esastır).
  const yaz = async (tutarli: boolean): Promise<void> => {
    await flushLicenseTraceWrites();
    const jws = kayit(tutarli);
    fs.writeFileSync(path.join(x.dizin, LICENSE_FILES.LEASE), kira);
    fs.writeFileSync(path.join(x.dizin, LICENSE_FILES.STATE), JSON.stringify({ v: 1, jws }));
    await prisma.systemSetting.update({ where: { key: LICENSE_TRACE_SETTING_KEY }, data: { value: { v: 1, kurulumId: x.f.kurulumId, anahtar: key.x, durum: jws } } });
    await refreshLicenseTrace();
    yeniden(x.dizin);
  };
  await yaz(true);
  const a = getLicenseSnapshot().state;
  check(
    "§19a ⭐ 1 sa çalışıp 2 gün kapalı kalan makine (son yazım tutarlı saatle) → SAAT_İLERİ YOK, güvenilir = duvar",
    a.saat.finding === null && Math.abs(a.saat.trustedMs - Date.now()) < 60_000,
    `${a.saat.finding} ${a.saat.source} ${a.nedenler.map((n) => n.kod).join(",")}`,
  );
  check("§19b kapalı süre kredisi kayda katlanır (kapaliMs ≈ 2 gün)", persistAccumulation() && Math.abs(Number(durumKaydiAlani(x.dizin).kapaliMs) - 2 * DAY_MS) < 60_000);
  await yaz(false);
  const b = getLicenseSnapshot().state;
  check("§19c ⭐ karşı: son yazım tutarsız saatle (ileri kaçmış saat kapanışa taşındı) → kredi yok → SAAT_İLERİ", b.saat.finding === "SAAT_ILERI", `${b.saat.finding}`);
  const p = await pollLicenseOnce();
  check("§19 temizlik: yeni kira", p.outcome === "BASARILI");
}

async function tasimaBolumu(x: Hazir): Promise<void> {
  console.log("\n§20 — taşıma (D8): yeni makine yalnız TALEP açar; onay taşıma kodu doğurur, kodla etkinleşir");
  const yeni = path.join(GECICI, "yeni-makine");
  yeniden(yeni);
  x.satici.tasimaDurumu = "BEKLIYOR";
  const t = await requestTransfer("disk değişimi", null);
  const son = x.satici.istekler.filter((i) => i.amac === "tasima").at(-1);
  check(
    "§20a ⭐ kimliği bilinmeyen makinenin taşıma talebi kimliksiz (imza + gövde) → BEKLIYOR",
    t.durum === "BEKLIYOR" && son?.kimlik === null && son?.govdeKimligi === null,
    `${t.durum} ${JSON.stringify(son)}`,
  );
  check("§20b bekleyen talep etkin sayılır (onay yoklanır)", getLicenseSnapshot().activated);
  x.satici.tasimaDurumu = "ONAYLANDI";
  const r = await pollLicenseOnce();
  const d = getLicenseDetail();
  check(
    "§20c ⭐ onay lisans DEĞİL: talep ONAYLANDI kalır, kod beklenir, artık yoklanmaz, kimlik yok",
    r.outcome === "BASARISIZ" && r.code === "TASIMA_KODU_BEKLENIYOR" && d.tasima?.durum === "ONAYLANDI" && !getLicenseSnapshot().activated && d.kurulum.kurulumId === null,
    `${r.outcome} ${r.code ?? ""} ${d.tasima?.durum}`,
  );
  x.satici.kod = "TKS-TASM-4K0D-9QRT-7PVW";
  // Yeni makine = yeni kurulum anahtarı: eski makinenin kabulü geçmez, sözleşme yeniden kabul edilir (Ek-7).
  await kabulEt();
  const e = await activateLicense(x.satici.kod, null);
  check(
    "§20d taşıma koduyla etkinleşme → aynı lisans kimliği yeni makinede, talep temizlendi",
    e.kurulum.kurulumId === x.f.kurulumId && e.kurulum.etkin && e.tasima === null && e.durum.gecerlilik === "GECERLI",
    `${e.kurulum.kurulumId?.slice(0, 8)} ${e.durum.gecerlilik} ${e.durum.nedenler.map((n) => n.kod).join(",")}`,
  );
  yeniden(x.dizin);
}

function sozlesmeBolumu(): void {
  console.log("\n§7 — kurulum kimliği ham ayar ucundan yazılamaz");
  check("§7a rezerve anahtar SETTING_KEYS ile aynı değer (döngüsüz literal)", INSTALLATION_ID_SETTING_KEY === SETTING_KEYS.SYSTEM_INSTALLATION_ID);
  check("§7b ⭐ system.installationId rezerve (PUT /api/admin/settings/:key RED)", isReservedSettingKey(SETTING_KEYS.SYSTEM_INSTALLATION_ID));
}

function saticiKodlariBolumu(): void {
  console.log("\n§8 — satıcı hata kodları: her kod tanınır");
  const ayrinti = (code: string) => {
    const e = vendorFailureToError({ status: 409, code });
    return { mesaj: e.message, d: (e.details ?? {}) as { code?: string; vendorCode?: string; tekrarDenenebilir?: boolean } };
  };
  const genel = ayrinti("BILINMEYEN_KOD_X").mesaj;
  const tanimsiz = VENDOR_ERROR_CODES.filter((k) => ayrinti(k).mesaj === genel);
  check("§8a ✓K bilinmeyen kod genel mesaja düşer; VENDOR_ERROR_CODES'un HER kodu kendi TR mesajını taşır", genel.includes("reddetti") && tanimsiz.length === 0, tanimsiz.join(","));
  const tekrar = ayrinti("TEKRAR_DENEYIN");
  check(
    "§8b TEKRAR_DENEYIN → LICENSE_VENDOR_REJECTED + vendorCode + tekrarDenenebilir",
    tekrar.d.code === "LICENSE_VENDOR_REJECTED" && tekrar.d.vendorCode === "TEKRAR_DENEYIN" && tekrar.d.tekrarDenenebilir === true && /tekrar deneyin/.test(tekrar.mesaj),
  );
  const yok = ayrinti("BULUNAMADI");
  check("§8c BULUNAMADI → kalıcı (tekrar denenmez), adres ipucu (LICENSE_SERVER_URL)", yok.d.tekrarDenenebilir === false && yok.mesaj.includes("LICENSE_SERVER_URL"));
}

/** Bekçinin kendi kurulumunun lisans izi satırı DB'de bırakılmaz. */
async function temizleLisansIzi(): Promise<void> {
  await flushLicenseTraceWrites();
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_TRACE_SETTING_KEY } });
  await flushRevocationWrites();
  await prisma.systemSetting.deleteMany({ where: { key: LICENSE_REVOCATION_SETTING_KEY } });
}

async function main(): Promise<void> {
  let satici: SahteSatici | null = null;
  try {
    saticiKodlariBolumu();
    depoBolumu();
    const hazir = await kurulumuHazirla();
    satici = hazir.satici;
    await etkinlestirmeBolumu(hazir);
    await kimlikBolumu(hazir);
    tekDikisBolumu(hazir);
    await durumKaydiBolumu(hazir);
    await yoklamaBolumu(hazir);
    await zilBolumu(hazir);
    await proxyBolumu(hazir);
    await siraBolumu(hazir);
    await saatKaymasiBolumu(hazir);
    await geriAlmaBolumu(hazir);
    await etkinTanimiBolumu(hazir);
    await depoOkumaBolumu(hazir);
    await izKopyasiBolumu(hazir);
    await ucIzBolumu(hazir);
    await anahtarOkunamazBolumu(hazir);
    await parmakIziMerdiveniBolumu(hazir);
    await sonBilinenBolumu(hazir);
    await iptalKabulBolumu(hazir);
    await iptalOnarimBolumu(hazir);
    await iptalAraBolumu(hazir);
    await iptalSaatBolumu(hazir);
    await uzatmaDosyasiBolumu(hazir);
    await saatSurekliligiBolumu(hazir);
    await saatCanliBolumu(hazir);
    await donanimBildirimiBolumu(hazir);
    await telBolumu(hazir);
    gozlemSayaciBolumu();
    await zilGeriCekilmeBolumu(hazir);
    ortamBolumu();
    await kapaliSureBolumu(hazir);
    await motorBolumu();
    await dogrulamaKipiBolumu(hazir);
    await tasimaBolumu(hazir);
    await hakButunlukBolumu(hazir);
    await etkinlestirmeButunlukBolumu(hazir);
    sozlesmeBolumu();
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await satici?.kapat();
    await temizleKabuller();
    await temizleLisansIzi();
    fs.rmSync(GECICI, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
