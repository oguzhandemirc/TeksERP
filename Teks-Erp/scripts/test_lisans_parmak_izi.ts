// =============================================================================
// BEKÇİ — LİSANS PARMAK İZİ TOPLAMA (K8, L2-10): çok yollu okuma · 24 sa önbellek · sonda hijyeni
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_parmak_izi   (kendi _test DB'si — yalnız F5 SQL okuması)
//
// NE ÖLÇER:
//   §1 seçim (`fingerprint-paths.ts`): tür içinde ilk kullanılabilir değer · önceki tür yalnız HATA verdiyse etken
//      OKUNAMADI (geçici arıza başka türdeki değere kaymaz) · kesin anlamsız cevapta sonraki tür · çelişki/hata bilgisi ·
//      ⭐ RAID (SAHINSRV RST RAID-1: seriler genel desende) → UniqueId türü · yol tablosu: win32 ve linux'ta her etkenin
//      en az iki yolu, kimlikler etken önekli ve platform içinde tekil
//   §2 Windows sondası hijyeni: Get-PhysicalDisk ve Get-NetAdapter -IncludeHidden YOK (TS + Rust kaynak), her CIM
//      çağrısı zaman aşımlı (`-OperationTimeoutSec`), eski WMI yolu zaman aşımlı arayıcıdan, zaman aşımsız tek çağrı
//      (Get-Partition | Get-Disk) EN SON; ASCII; kodlanmış komut CreateProcess sınırının altında
//   §3 sonda çıktısı: zaman aşımında yarım kalan çıktıda gelen yollar sayılır, gelmeyenler OKUNAMADI
//   §4 ⭐ 24 sa önbellek kararı: canlı okuma tazeler · okunamayan etken < 24 sa önbellekten · ≥ 24 sa KAYIP (v2
//      kararında uyuşmazlık) · saat 10 dk'ya dek geri giderse geçerli, fazlası süresi dolmuş
//   §5 önbellek dosyası: gidiş-dönüş · kurcalı özet/an · başka tuz · fazla alan · aşırı büyük → BOZUK (yok sayılır) ·
//      ham değer dosyada YOK
//   §6 ⭐ uçtan uca `measureFingerprint` (sahte çekirdek, geçici dizin, denetimli saat): okunamayan f3 1 sa sonra önbellekten, 25 sa
//      sonra kayıp → v2 kararı `lost` · bozuk önbellek bildirilir · F5 SQL yolundan (gerçek DB)
//   §7 parmak izi tazeleme aralığı kayıp süresinin en az 12'de biri (24 sa'te ≥ 12 deneme)
//
// NEGATİF SONDA — dosya DIŞI mutasyon (uygulandı → kırmızı → geri alındı, sha eşit; sayılar commit mesajında):
//   bkz. Teks-Erp/docs/BEKCI-HARITASI.md `## lisans` satırı.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import prisma, { pool } from "../src/lib/prisma";
import {
  FINGERPRINT_LOSS_AFTER_MS,
  compareFingerprints,
  digestFingerprint,
  type Fingerprint,
  type FingerprintFactor,
} from "../src/lib/license/protocol";
import { FINGERPRINT_PATHS, UNREAD_OS_READINGS, parseWindowsProbeOutput, pathsFor, selectFactor, selectOsFactors, type FactorReading } from "../src/lib/license/fingerprint-paths";
import { WINDOWS_PROBE_LINES } from "../src/lib/license/fingerprint-os";
import {
  CACHE_CLOCK_BACK_TOLERANCE_MS,
  FINGERPRINT_CACHE_FILE,
  applyFingerprintCache,
  readFingerprintCache,
  writeFingerprintCache,
  type FingerprintCache,
} from "../src/lib/license/fingerprint-cache";
import { measureFingerprint } from "../src/lib/license/fingerprint";
import { tsLicenseCore, type CollectedFingerprint, type LicenseCore } from "../src/lib/license/license-core";
import { FINGERPRINT_REFRESH_MS } from "../src/jobs/license-poll.job";

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

const FACTORS: readonly FingerprintFactor[] = ["f1", "f2", "f3", "f4", "f5"];
const HOUR = 60 * 60 * 1000;
const TUZ = Buffer.alloc(32, 0x24);
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-parmak-izi-"));
const RUST_COLLECT = fs.readFileSync(path.join(__dirname, "..", "native", "lisans-cekirdek", "src", "collect.rs"), "utf8");

function secimBolumu(): void {
  console.log("\n§1 — çok yollu seçim");
  const f3 = pathsFor("win32").filter((p) => p.factor === "f3");
  const yalnizHata = selectFactor("f3", f3, { "f3.disk-seri": null, "f3.msft-disk-seri": null, "f3.win32-disk-seri": null, "f3.disk-kimlik": "eui.0025388191B45C67" });
  check("§1a ⭐ seri türü yalnız HATA verdi → UniqueId'ye GEÇİLMEZ, etken OKUNAMADI (önbellek köprüler)", yalnizHata.raw === null && yalnizHata.reading.durum === "OKUNAMADI", JSON.stringify(yalnizHata.reading));
  const raid = selectFactor("f3", f3, { "f3.disk-seri": "Volume0", "f3.msft-disk-seri": "Volume0", "f3.win32-disk-seri": "", "f3.disk-kimlik": "SCSI\\Disk&Ven_Intel&Prod_Raid_1_Volume\\4&2b4d3e7f&0&000100" });
  check("§1b ⭐ RAID: seriler kesin cevapla genel desende → UniqueId türü devreye girer", raid.reading.durum === "OKUNDU" && raid.reading.yol === "f3.disk-kimlik", JSON.stringify(raid.reading));
  const yarim = selectFactor("f3", f3, { "f3.disk-seri": null, "f3.msft-disk-seri": "Volume0", "f3.disk-kimlik": "eui.00ab" });
  check("§1c bir yol hata, öteki kesin anlamsız → tür kesin cevap verdi sayılır, sonraki tür denenir", yarim.reading.yol === "f3.disk-kimlik");
  const cel = selectFactor("f2", pathsFor("win32").filter((p) => p.factor === "f2"), { "f2.cim": "7c3e91d2-58af-4b06-9e21-c4d8a1f05b37", "f2.wmi": "8d4fa2e3-69b0-4c17-af32-d5e9b2016c48", "f2.donanim-kaydi": "{7C3E91D2-58AF-4B06-9E21-C4D8A1F05B37}" });
  check("§1d tür içinde ilk yol kazanır; farklı değer veren yol çelişki (bilgi), aynı değer veren değil", cel.reading.yol === "f2.cim" && JSON.stringify(cel.reading.celiski) === '["f2.wmi"]');
  const hata = selectFactor("f1", pathsFor("win32").filter((p) => p.factor === "f1"), { "f1.kayit-net64": "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d" });
  check("§1e gelmeyen yol hata sayılır ve raporlanır; ikinci yol okur", hata.reading.yol === "f1.kayit-net64" && JSON.stringify(hata.reading.hatali) === '["f1.kayit"]');
  const bos = selectOsFactors("win32", {});
  check("§1f hiç çıktı yok → dört etken OKUNAMADI (DEGER_YOK değil)", Object.values(bos.okuma).every((o) => o.durum === "OKUNAMADI") && Object.values(bos.raw).every((v) => v === null));
  const eksik: string[] = [];
  for (const platform of ["win32", "linux"] as const) {
    for (const f of ["f1", "f2", "f3", "f4"] as const) if (pathsFor(platform).filter((p) => p.factor === f).length < 2) eksik.push(`${platform}/${f}`);
  }
  const ids = FINGERPRINT_PATHS.map((p) => `${p.platform}|${p.id}`);
  check(
    "§1g yol tablosu: win32 ve linux'ta her etkenin ≥ 2 yolu; kimlik etken önekli ve platform içinde tekil",
    eksik.length === 0 && FINGERPRINT_PATHS.every((p) => p.id.startsWith(`${p.factor}.`)) && new Set(ids).size === ids.length,
    eksik.join(", ") || `${FINGERPRINT_PATHS.length} yol`,
  );
  check("§1h boş okuma raporu sabiti dört etkende OKUNAMADI", Object.values(UNREAD_OS_READINGS).every((o) => o.durum === "OKUNAMADI" && o.yol === null));
}

function sondaHijyeniBolumu(): void {
  console.log("\n§2 — Windows sondası hijyeni (TS + Rust kaynak)");
  const metinler = [WINDOWS_PROBE_LINES.join("\n"), RUST_COLLECT];
  const yasak = metinler.some((m) => /Get-PhysicalDisk|Get-NetAdapter[^\n]*-IncludeHidden/i.test(m.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\/\/.*$/gm, "")));
  check("§2a ⭐ asılan iki komut (Get-PhysicalDisk · Get-NetAdapter -IncludeHidden) sondada YOK (TS ve Rust)", !yasak && !WINDOWS_PROBE_LINES.join(" ").includes("Get-PhysicalDisk"));
  const cim = WINDOWS_PROBE_LINES.flatMap((l) => l.match(/Get-Cim(?:Instance|AssociatedInstance)[^;|}]*/g) ?? []);
  const zamansizCim = cim.filter((c) => !/-OperationTimeoutSec\s+\d+/.test(c));
  check("§2b her CIM çağrısı zaman aşımlı (-OperationTimeoutSec)", cim.length >= 7 && zamansizCim.length === 0, zamansizCim.join(" | ") || `${cim.length} çağrı`);
  const wmi = WINDOWS_PROBE_LINES.filter((l) => /wmisearcher|Get-WmiObject/i.test(l));
  check("§2c eski WMI yolu yalnız zaman aşımlı arayıcıdan (Get-WmiObject yok)", wmi.length >= 1 && wmi.every((l) => !/Get-WmiObject/i.test(l)) && wmi.some((l) => /Options\.Timeout=/.test(l)));
  const getDisk = WINDOWS_PROBE_LINES.findIndex((l) => /Get-Partition/.test(l));
  check("§2d zaman aşımsız tek çağrı (Get-Partition | Get-Disk) EN SON satır", getDisk === WINDOWS_PROBE_LINES.length - 1);
  const metin = WINDOWS_PROBE_LINES.join("; ");
  const kodlu = Buffer.from(metin, "utf16le").toString("base64");
  check("§2e sonda ASCII; kodlanmış komut CreateProcess sınırının (32767) altında", /^[\x20-\x7e]*$/.test(metin) && kodlu.length < 30_000, `${kodlu.length} karakter`);
}

function ciktiBolumu(): void {
  console.log("\n§3 — sonda çıktısı (zaman aşımı)");
  const yarim = parseWindowsProbeOutput('{"y":"f1.kayit","v":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}\r\n{"h":1,"y":"f2.donanim-kaydi"}\r\n{"y":"f2.cim","v":"7C3E');
  const s = selectOsFactors("win32", yarim);
  check(
    "§3a ⭐ öldürülen sondanın o ana dek bastığı yol sayılır; yarım satır ve gelmeyen yollar OKUNAMADI",
    s.okuma.f1.durum === "OKUNDU" && s.okuma.f2.durum === "OKUNAMADI" && JSON.stringify(s.okuma.f2.hatali) === '["f2.cim","f2.wmi","f2.donanim-kaydi"]',
    JSON.stringify(s.okuma.f2),
  );
}

const yollar = (yol: string | null): Record<FingerprintFactor, string | null> => ({ f1: yol, f2: yol, f3: yol, f4: yol, f5: yol });
const ozetler = (ham: Partial<Record<FingerprintFactor, string>>): Fingerprint => digestFingerprint(ham, TUZ);
const TAM = { f1: "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d", f2: "7c3e91d2-58af-4b06-9e21-c4d8a1f05b37", f3: "S4EVNX0N912345", f4: "PF2ABCDE", f5: "7412345678901234567" };

function onbellekKarariBolumu(): void {
  console.log("\n§4 — 24 sa önbellek kararı");
  const t0 = Date.UTC(2026, 9, 1, 8);
  const canli = ozetler(TAM);
  const d0 = applyFingerprintCache(canli, yollar("y"), {}, t0);
  check("§4a canlı okuma: kaynak 'okundu', önbellek tazelenir (beş etken, an = şimdi)", FACTORS.every((f) => d0.kaynak[f] === "okundu" && d0.next[f]?.an === t0) && d0.changed);
  const f3siz = { ...canli, f3: null };
  const d1 = applyFingerprintCache(f3siz, yollar("y"), d0.next, t0 + 24 * HOUR - 1);
  check("§4b ⭐ okunamayan etken 24 saatten 1 ms önce hâlâ önbellekten (kaynak 'onbellek', son okuma eski an)", d1.effective.f3 === canli.f3 && d1.kaynak.f3 === "onbellek" && d1.sonOkuma.f3 === t0);
  const d2 = applyFingerprintCache(f3siz, yollar("y"), d1.next, t0 + 24 * HOUR);
  const karar = compareFingerprints(canli, d2.effective, { rule: "standart" });
  check(
    "§4c ⭐ 24 sa üst üste okunamayan etken KAYIP: özet yok, v2 kararında uyuşmazlık (`lost`), kayıt silinmez (son okuma görünür)",
    d2.effective.f3 === null && d2.kaynak.f3 === "yok" && d2.next.f3?.an === t0 && JSON.stringify(karar.lost) === '["f3"]' && karar.result === "ESLESTI",
    `${karar.result} lost=${JSON.stringify(karar.lost)}`,
  );
  const geri = applyFingerprintCache(f3siz, yollar("y"), d0.next, t0 - CACHE_CLOCK_BACK_TOLERANCE_MS + 1);
  const cokGeri = applyFingerprintCache(f3siz, yollar("y"), d0.next, t0 - CACHE_CLOCK_BACK_TOLERANCE_MS - 1);
  check("§4d saat 10 dk'ya dek geri → önbellek geçerli; daha fazlası → süresi dolmuş", geri.kaynak.f3 === "onbellek" && cokGeri.kaynak.f3 === "yok");
  const hic = applyFingerprintCache({ ...canli, f2: null }, yollar("y"), {}, t0);
  check("§4e hiç okunmamış etken önbelleksiz: kaynak 'yok', son okuma yok", hic.kaynak.f2 === "yok" && hic.sonOkuma.f2 === null && hic.next.f2 === undefined);
}

function dosyaBolumu(): void {
  console.log("\n§5 — önbellek dosyası (HMAC'li)");
  const dizin = path.join(GECICI, "dosya");
  fs.mkdirSync(dizin);
  const dosya = path.join(dizin, FINGERPRINT_CACHE_FILE);
  check("§5a dosya yok → YOK (boş önbellek)", readFingerprintCache(dizin, TUZ).durum === "YOK");
  const t0 = Date.UTC(2026, 9, 1, 8);
  const cache: FingerprintCache = applyFingerprintCache(ozetler(TAM), yollar("f.yol"), {}, t0).next;
  writeFingerprintCache(dizin, TUZ, cache);
  const geri = readFingerprintCache(dizin, TUZ);
  check("§5b gidiş-dönüş: aynı kayıt GECERLI okunur", geri.durum === "GECERLI" && FACTORS.every((f) => geri.cache[f]?.ozet === cache[f]?.ozet && geri.cache[f]?.an === t0));
  const metin = fs.readFileSync(dosya, "utf8");
  check("§5c dosyada ham değer YOK (yalnız tuzlu özet)", Object.values(TAM).every((v) => !metin.toLowerCase().includes(v.toLowerCase())));
  const yaz = (m: string) => fs.writeFileSync(dosya, m);
  const j = JSON.parse(metin) as { onbellek: Record<string, { ozet: string; an: string }>; mac: string };
  const ozetKurcali = JSON.parse(metin) as typeof j;
  ozetKurcali.onbellek.f3.ozet = ozetler({ f3: "BASKADISK123" }).f3 ?? "";
  yaz(JSON.stringify(ozetKurcali));
  const r1 = readFingerprintCache(dizin, TUZ).durum;
  const anKurcali = JSON.parse(metin) as typeof j;
  anKurcali.onbellek.f3.an = new Date(t0 + 30 * 24 * HOUR).toISOString();
  yaz(JSON.stringify(anKurcali));
  const r2 = readFingerprintCache(dizin, TUZ).durum;
  yaz(metin);
  const r3 = readFingerprintCache(dizin, Buffer.alloc(32, 0x25)).durum;
  yaz(JSON.stringify({ ...j, fazla: 1 }));
  const r4 = readFingerprintCache(dizin, TUZ).durum;
  yaz("x".repeat(9 * 1024));
  const r5 = readFingerprintCache(dizin, TUZ).durum;
  check("§5d ⭐ kurcalı özet · ileri alınmış an · başka tuz · fazla alan · aşırı büyük → BOZUK (yok sayılır)", [r1, r2, r3, r4, r5].every((r) => r === "BOZUK"), [r1, r2, r3, r4, r5].join(","));
}

/** Sahte çekirdek: OS etkenlerini senaryo verir, F5 çağırandan (gerçek DB). */
function sahteCekirdek(os: () => Partial<Record<"f1" | "f2" | "f3" | "f4", string>>): LicenseCore {
  return {
    ...tsLicenseCore,
    collectFingerprint: async (salt: Uint8Array, f5: string | null): Promise<CollectedFingerprint> => {
      const ham = os();
      const digest = digestFingerprint({ ...ham, f5 }, salt);
      const okuma = Object.fromEntries(
        (["f1", "f2", "f3", "f4"] as const).map((f): [string, FactorReading] => [
          f,
          ham[f] ? { durum: "OKUNDU", yol: `${f}.sahte`, celiski: [], hatali: [] } : { durum: "OKUNAMADI", yol: null, celiski: [], hatali: [`${f}.sahte`] },
        ]),
      ) as unknown as CollectedFingerprint["okuma"];
      return { digest, measured: Object.fromEntries(FACTORS.map((f) => [f, digest[f] !== null])) as CollectedFingerprint["measured"], okuma };
    },
  };
}

async function olcumBolumu(): Promise<void> {
  console.log("\n§6 — ölçüm uçtan uca (sahte çekirdek · geçici dizin · denetimli saat)");
  const dizin = path.join(GECICI, "olcum");
  fs.mkdirSync(dizin);
  const t0 = Date.now();
  let os: Partial<Record<"f1" | "f2" | "f3" | "f4", string>> = { f1: TAM.f1, f2: TAM.f2, f3: TAM.f3, f4: TAM.f4 };
  const cekirdek = sahteCekirdek(() => os);
  const m0 = await measureFingerprint(TUZ, cekirdek, { cacheDir: dizin, nowMs: t0 });
  check("§6a ilk ölçüm: beş etken okundu, önbellek dosyası yazıldı, F5 SQL yolundan (gerçek DB)", FACTORS.every((f) => m0.okuma?.[f].kaynak === "okundu") && fs.existsSync(path.join(dizin, FINGERPRINT_CACHE_FILE)) && m0.okuma?.f5.yol === "f5.sql", JSON.stringify(m0.okuma?.f5));
  os = { f1: TAM.f1, f2: TAM.f2, f4: TAM.f4 };
  const m1 = await measureFingerprint(TUZ, cekirdek, { cacheDir: dizin, nowMs: t0 + HOUR });
  check(
    "§6b ⭐ 1 sa sonra f3 okunamadı → özet önbellekten (ölçüldü: hayır · kaynak: önbellek · son okuma ilk ölçüm · yol önbelleğin)",
    m1.digest.f3 === m0.digest.f3 && m1.measured.f3 === false && m1.okuma?.f3.kaynak === "onbellek" && m1.okuma.f3.sonOkuma === m0.measuredAt && m1.okuma.f3.yol === "f3.sahte" && m1.okuma.f3.durum === "OKUNAMADI",
    JSON.stringify(m1.okuma?.f3),
  );
  const m2 = await measureFingerprint(TUZ, cekirdek, { cacheDir: dizin, nowMs: t0 + 25 * HOUR });
  const karar = compareFingerprints(m0.digest, m2.digest, { rule: "standart" });
  check("§6c ⭐ 25 sa sonra hâlâ okunamıyor → KAYIP: özet yok, kaynak 'yok', kararda `lost`", m2.digest.f3 === null && m2.okuma?.f3.kaynak === "yok" && JSON.stringify(karar.lost) === '["f3"]', `${karar.result} ${JSON.stringify(karar.lost)}`);
  os = { f1: TAM.f1, f2: TAM.f2, f3: TAM.f3, f4: TAM.f4 };
  const m3 = await measureFingerprint(TUZ, cekirdek, { cacheDir: dizin, nowMs: t0 + 26 * HOUR });
  check("§6d etken yeniden okununca kayıp kapanır (kaynak 'okundu', özet ilk ölçümle aynı)", m3.digest.f3 === m0.digest.f3 && m3.okuma?.f3.kaynak === "okundu");
  fs.writeFileSync(path.join(dizin, FINGERPRINT_CACHE_FILE), "{bozuk");
  os = { f1: TAM.f1, f2: TAM.f2, f4: TAM.f4 };
  const m4 = await measureFingerprint(TUZ, cekirdek, { cacheDir: dizin, nowMs: t0 + 27 * HOUR });
  check("§6e bozuk önbellek bildirilir ve yok sayılır (okunamayan etken önbellekten GELMEZ), ölçüm yeniden yazar", m4.onbellekBozuk === true && m4.digest.f3 === null && readFingerprintCache(dizin, TUZ).durum === "GECERLI");
  const yok = await measureFingerprint(TUZ, cekirdek, { cacheDir: null, nowMs: t0 });
  check("§6f önbellek dizini yoksa (depo kullanılamıyor) yalnız canlı ölçüm", yok.okuma?.f3.kaynak === "yok" && yok.onbellekBozuk === undefined);
}

function aralikBolumu(): void {
  console.log("\n§7 — tazeleme aralığı");
  check(
    "§7a ⭐ parmak izi tazeleme aralığı ≤ kayıp süresi / 12 (24 sa'te en az 12 deneme; günlük tazeleme okunamayan etkeni hemen kayıp yapardı)",
    FINGERPRINT_REFRESH_MS > 0 && FINGERPRINT_REFRESH_MS <= FINGERPRINT_LOSS_AFTER_MS / 12,
    `${FINGERPRINT_REFRESH_MS / 60_000} dk`,
  );
}

async function main(): Promise<void> {
  try {
    secimBolumu();
    sondaHijyeniBolumu();
    ciktiBolumu();
    onbellekKarariBolumu();
    dosyaBolumu();
    await olcumBolumu();
    aralikBolumu();
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    fs.rmSync(GECICI, { recursive: true, force: true });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
