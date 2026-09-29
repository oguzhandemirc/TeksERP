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
//   ⭐ durum.json bozuk/başka anahtarla imzalı → ÖLÇÜLEMEDİ ve aynı kira için SIFIRDAN başlatılmaz
//   ⭐ etkinleştirme uçtan uca; kurcalı/başka kuruluma ait/eski kira RED
//   ⭐ etkinleşmemiş kurulum yoklamaz · zil(lisans) yoklatır, başka konu yoklatmaz
//   ⭐ yoklama CONNECT proxy üzerinden; proxy kimlik bilgisi ekrana/audit'e sızmaz
//   ⭐ gözlem kipinde K5 bile uygulanmaz (sıfır fark)
//   ⭐ satıcının HER hata kodu tanınır (TR mesaj; TEKRAR_DENEYIN tekrar denenebilir, BULUNAMADI adres ipucu)
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; sonuçlar commit
// mesajında): M1 persistAccumulation bozuk kayıtta sıfırdan başlatır · M2 kabulde kurulum
// bağı denetimi kaldırılır · M3 zil konusu süzgeci kaldırılır · M4 proxy ayarı ajanı değiştirmez ·
// M5 TEKRAR_DENEYIN tekrar denenebilir kümesinden çıkarılır (§8b).
// ⭐ KALICI SONDA ✓K1 (her koşumda): bilinmeyen kod genel mesaja düşer — §8a'nın "her kodun kendi
// mesajı var" karşılaştırıcısı kör değil.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { ensureInstallationIdentity } from "../src/jobs/installation-identity.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INSTALLATION_ID_SETTING_KEY, isReservedSettingKey } from "../src/constants/reserved-settings";
import { loadLicenseStoreSync, resolveLicenseDir, writeFileAtomicSync, LICENSE_FILES } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, getLicenseSnapshot, persistAccumulation, setMeasuredFingerprint, invalidateLicenseSnapshot } from "../src/lib/license/runtime";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import { VENDOR_ERROR_CODES, openEnvelope, verifyRequest, type Fingerprint } from "../src/lib/license/protocol";
import { vendorFailureToError } from "../src/services/helpers/license-wire.helper";
import { signStateRecord } from "../src/lib/license/saat";
import { activateLicense, acceptOfflineResponse, buildOfflineRequest, getLicenseStatus, getProxySettings, updateProxySettings } from "../src/services/license.service";
import { pollLicenseOnce, refreshLicenseDbFacts } from "../src/services/license-sync.service";
import { runLicensePollOnce, startLicensePoll, __resetLicensePollForTests } from "../src/jobs/license-poll.job";
import { startLicenseDoorbell, __resetLicenseDoorbellForTests } from "../src/jobs/license-doorbell.job";
import { fiksturKur, kiraBas, hakBas, anahtarUret, type Fikstur } from "./lib/lisans-fikstur";
import { sahteSaticiBaslat, sahteProxyBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";

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
}

async function kurulumuHazirla(): Promise<{ f: Fikstur; satici: SahteSatici; dizin: string }> {
  const dizin = path.join(GECICI, "motor");
  const key = loadLicenseStoreSync({ dir: dizin }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const kimlik = await ensureInstallationIdentity();
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulumId: kimlik.installationId, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const satici = await sahteSaticiBaslat(f);
  satici.kod = "TKS-7K3M-9QRT-2XWZ";
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: satici.url });
  setEgressTrustForTests(satici.ca);
  await refreshLicenseDbFacts(kimlik.installationId);
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date().toISOString() });
  return { f, satici, dizin };
}

async function etkinlestirmeBolumu(x: { f: Fikstur; satici: SahteSatici; dizin: string }): Promise<void> {
  console.log("\n§2 — etkinleştirme uçtan uca (sahte satıcı, yerel HTTPS)");
  check("§2a kimliksiz durum çağrısına ayrıntı YOK", JSON.stringify(getLicenseStatus(false)) === '{"ayrinti":false}');
  const once = await pollLicenseOnce();
  check("§2b ⭐ etkinleşmemiş kurulum YOKLAMAZ (satıcıya istek gitmez)", once.outcome === "ETKIN_DEGIL" && x.satici.sayac.yokla === 0, once.outcome);
  check("§2c yanlış kod → satıcı reddi TR mesajla", (await hataKodu(activateLicense("TKS-1111-1111-1111", null))) === "LICENSE_VENDOR_REJECTED/ETKINLESTIRME_KODU_GECERSIZ");
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
  console.log("\n§3 — durum.json: imzalı birikim; bozuk/yabancı → ÖLÇÜLEMEDİ");
  const sira0 = getLicenseSnapshot().durumKaydi.sira ?? -1;
  check("§3a geçerli kayıt; saatlik yazım sırayı artırır", persistAccumulation() && (getLicenseSnapshot().durumKaydi.sira ?? -1) === sira0 + 1);
  const yol = path.join(x.dizin, LICENSE_FILES.STATE);
  const asil = fs.readFileSync(yol, "utf8");
  const jws = (JSON.parse(asil) as { jws: string }).jws;
  fs.writeFileSync(yol, JSON.stringify({ v: 1, jws: bozuk(jws) }));
  loadLicenseStoreSync({ dir: x.dizin });
  invalidateLicenseSnapshot();
  const s = getLicenseSnapshot().state;
  check("§3b ⭐ bozuk imza → ÖLÇÜLEMEDİ(DURUM_DOSYASI)", s.gecerlilik === "OLCULEMEDI" && s.nedenler.some((n) => n.kod === "DURUM_DOSYASI"), s.nedenler.map((n) => n.kod).join(","));
  check("§3c ⭐ bozuk kayıt aynı kira için SIFIRDAN başlatılmaz (saat hilesi kapalı)", !persistAccumulation() && fs.readFileSync(yol, "utf8").includes(bozuk(jws)));
  const yabanci = anahtarUret("kur-yabanci");
  const kayit = { v: 1 as const, kurulumId: x.f.kurulumId, kiraId: getLicenseSnapshot().lease?.document.kiraId ?? randomUUID(), birikenMs: 0, yazildi: new Date().toISOString(), yuksekSu: new Date().toISOString(), sonKiraZorlamasi: false, sonYaptirim: null, sira: 99 };
  fs.writeFileSync(yol, JSON.stringify({ v: 1, jws: signStateRecord(kayit, yabanci.privateKey, yabanci.x) }));
  loadLicenseStoreSync({ dir: x.dizin });
  invalidateLicenseSnapshot();
  check("§3d başka anahtarla imzalı kayıt → ÖLÇÜLEMEDİ", getLicenseSnapshot().state.nedenler.some((n) => n.kod === "DURUM_DOSYASI"));
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

async function main(): Promise<void> {
  let satici: SahteSatici | null = null;
  try {
    saticiKodlariBolumu();
    depoBolumu();
    const hazir = await kurulumuHazirla();
    satici = hazir.satici;
    await etkinlestirmeBolumu(hazir);
    await durumKaydiBolumu(hazir);
    await yoklamaBolumu(hazir);
    await zilBolumu(hazir);
    await proxyBolumu(hazir);
    sozlesmeBolumu();
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    await satici?.kapat();
    fs.rmSync(GECICI, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
