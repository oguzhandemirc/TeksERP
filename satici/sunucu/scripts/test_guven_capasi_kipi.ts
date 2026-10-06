// =============================================================================
// BEKÇİ — SATICININ GÜVEN ÇAPASI KİPİ (G3): satıcı YALNIZ gömülü üretim köklerine güvenir (tek kip; hazırlık kipi
// kalktı); üretimde dosya çapası ve geçersiz çapa açılışı DURDURUR — uyarıyla sürmez (fail-closed).
//   §1 GUVEN_CAPASI=uretim → gömülü çapa üretim listesi · eski `hazirlik` ve tanınmayan kip yapılandırmada RED
//   §2 ⭐ uretim + GUVEN_CAPASI_DOSYASI → yapılandırma RED ve KeyStore.load RED
//   §3 kip yok + dosya → dosya çapası (yalnız test) kabul, uyarıyla
//   §4 ⭐ kip yok + dosya yok → RED (örtük birleşik çapa yok)
//   §5 ⭐ dosya çapası geçersiz (eski `hazirlik-*` aile kökü) → yükleme RED GUVEN_CAPASI_BICIM
//   §6 compose: satıcı servisi kipi ORTAM'dan alır, ⑪ denetimi eşitliği ölçer
//   §7 CLI kip çıkarımı (`anchorModeOfKeyDir`): yalnız kok-* → uretim; başka aile ya da boş → null
//   §8 ⭐ anahtar dizinindeki eski `hazirlik-*` kök dosyası YÜKLENMEZ (uyarı; künyeye/imzaya girmez), `kok-*` yüklenir
//   §9 ⭐ YENİ YAZIM YOK: `AnahtarTuru.HAZIRLIK_KOK` ve `KanalTuru.hazirlik` şemada `/// EMEKLİ DEĞER`; satıcı sunucu
//      (src · scripts) · web/src · deploy/satici kaynaklarında o değerleri yazan/okuyan ifade yok (yalnız migration'lar);
//      tarayıcı kör değil — üç ihlal kalıbı sentetik metinde yakalanır, temiz metin 0
// Koşum: npx tsx scripts/test_guven_capasi_kipi.ts   (DB GEREKMEZ)
// =============================================================================
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore, anchorModeOfKeyDir } from "../src/keys/key-store";
import { PRODUCTION_ROOT_PUBLIC_KEYS, publicKeyX } from "../src/lisans-protokol";
import { SATICI_KOKU, TEST_KOK_PAROLASI, kontrol, sonuc } from "./lib/test-ortam";

const TEMP = mkdtempSync(path.join(tmpdir(), "satici-capa-kipi-"));
const TABAN = { DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test", ANAHTAR_DIZINI: TEMP };

function hata(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Test kökü: gerçek çapadaki hiçbir anahtar değil; yalnız biçim için geçerli bir Ed25519 açık yarısı. */
function testKoku(kid: string): { kid: string; x: string; classes: string[] } {
  return { kid, x: publicKeyX(generateKeyPairSync("ed25519").publicKey), classes: ["TEST", "DEMO"] };
}

function capaDosyasi(ad: string, icerik: unknown): string {
  const f = path.join(TEMP, ad);
  writeFileSync(f, JSON.stringify(icerik));
  return f;
}

/** Emekli enum değerini yazan/okuyan ifade kalıpları (yorum satırı dahil — emekli değer kaynakta anılmaz). */
const EMEKLI_YAZIM: readonly RegExp[] = [/\bHAZIRLIK_KOK\b/, /\bKanalTuru\.hazirlik\b/, /\btur\s*:\s*["'`]hazirlik["'`]/];
const KAYNAK_UZANTI = /\.(?:ts|tsx|mjs|js)$/;
const BU_DOSYA = path.resolve(__filename);

function emekliYazimIhlalleri(metin: string): string[] {
  return metin.split("\n").flatMap((satir, i) => (EMEKLI_YAZIM.some((k) => k.test(satir)) ? [`${i + 1}: ${satir.trim().slice(0, 120)}`] : []));
}

function kaynaklar(kok: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(kok)) {
    if (ad === "node_modules" || ad === "dist" || ad === "migrations") continue;
    const yol = path.join(kok, ad);
    if (statSync(yol).isDirectory()) out.push(...kaynaklar(yol));
    else if (KAYNAK_UZANTI.test(ad) && path.resolve(yol) !== BU_DOSYA) out.push(yol);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("\n§1 gömülü çapa ortamın kipinden");
  const u = KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI: "uretim" }, TEMP));
  kontrol(
    "§1a ⭐ GUVEN_CAPASI=uretim → üretim kökleri; hazırlık kökü YOK (üretim satıcısı hazırlık köküyle imzalamaz, bayi bağlamaz)",
    u.anchor === PRODUCTION_ROOT_PUBLIC_KEYS && u.anchorSource === "gomulu" && !u.anchor.some((r) => r.kid.startsWith("hazirlik-")),
    u.anchor.map((r) => r.kid).join(","),
  );
  const eskiKip = hata(() => loadConfig({ ...TABAN, GUVEN_CAPASI: "hazirlik" }, TEMP));
  kontrol("§1b ⭐ eski GUVEN_CAPASI=hazirlik yapılandırmada RED (hazırlık kipi kalktı; açılış durur)", eskiKip !== null && eskiKip.includes("GUVEN_CAPASI"), eskiKip ?? "kabul edildi");
  kontrol("§1c tanınmayan kip yapılandırmada RED", hata(() => loadConfig({ ...TABAN, GUVEN_CAPASI: "test" }, TEMP)) !== null);

  console.log("\n§2 üretimde dosya çapası RED");
  const gecerli = capaDosyasi("capa.json", [testKoku("kok-test-1")]);
  const cfgHata = hata(() => loadConfig({ ...TABAN, GUVEN_CAPASI: "uretim", GUVEN_CAPASI_DOSYASI: gecerli }, TEMP));
  const ksHata = hata(() => KeyStore.load({ ANAHTAR_DIZINI: TEMP, GUVEN_CAPASI: "uretim", GUVEN_CAPASI_DOSYASI: gecerli }));
  kontrol("§2a ⭐ GUVEN_CAPASI=uretim + GUVEN_CAPASI_DOSYASI → yapılandırma açılışı DURUR", cfgHata !== null && cfgHata.includes("GUVEN_CAPASI_DOSYASI"), cfgHata ?? "kabul edildi");
  kontrol("§2b ⭐ aynı ikili KeyStore.load'a doğrudan verilse de RED (CLI yolu yapılandırmayı atlasa da)", ksHata !== null && ksHata.includes("uretim"), ksHata ?? "kabul edildi");

  console.log("\n§3 kipsiz dosya çapası (yalnız test)");
  const d = KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI_DOSYASI: gecerli }, TEMP));
  kontrol("§3 kip yok + dosya → dosya çapası, uyarıyla", d.anchorSource === "dosya" && d.warnings.some((w) => w.startsWith("Güven çapası DOSYADAN")));

  console.log("\n§4 kip yok");
  const kipsiz = hata(() => KeyStore.load(loadConfig({ ...TABAN }, TEMP)));
  kontrol("§4 ⭐ kip yok + dosya yok → RED (birleşik çapaya düşülmez)", kipsiz !== null && kipsiz.includes("GUVEN_CAPASI"), kipsiz ?? "kabul edildi");

  console.log("\n§5 geçersiz çapa açılışı durdurur");
  const eskiAile = capaDosyasi("eski-aile.json", [testKoku("hazirlik-2026-1")]);
  const gecersiz = hata(() => KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI_DOSYASI: eskiAile }, TEMP)));
  kontrol("§5 ⭐ eski hazirlik-* aile kökü taşıyan dosya çapası → yükleme RED (GUVEN_CAPASI_BICIM), uyarıyla sürmez", gecersiz !== null && gecersiz.includes("GUVEN_CAPASI_BICIM"), gecersiz ?? "kabul edildi");

  console.log("\n§6 compose");
  const compose = readFileSync(path.join(SATICI_KOKU, "..", "..", "deploy", "satici", "docker-compose.yml"), "utf8");
  const denetim = readFileSync(path.join(SATICI_KOKU, "..", "..", "deploy", "satici", "compose-denetle.mjs"), "utf8");
  const saticiBlok = /\n {2}satici:\n([\s\S]*?)\n {2}[a-z-]+:\n/.exec(compose)?.[1] ?? "";
  kontrol("§6a satıcı servisi kipi ORTAM'dan alır (GUVEN_CAPASI: ${ORTAM}), dosya çapası YOK", /\n {6}GUVEN_CAPASI: \$\{ORTAM\}\n/.test(saticiBlok) && !saticiBlok.includes("GUVEN_CAPASI_DOSYASI"));
  kontrol("§6b compose denetimi ⑪ kipi projenin ORTAMIYLA kıyaslar", /ortam\.GUVEN_CAPASI === projeOrtami/.test(denetim) && /!\("GUVEN_CAPASI_DOSYASI" in ortam\)/.test(denetim));

  console.log("\n§7 CLI kip çıkarımı");
  const dizin = (...adlar: string[]): string => {
    const d0 = mkdtempSync(path.join(TEMP, "anahtar-"));
    for (const a of adlar) writeFileSync(path.join(d0, a), "{}");
    return d0;
  };
  kontrol(
    "§7 yalnız kok-* → uretim · eski hazirlik-* (tek başına ya da karışık) ya da kök yok → null (CLI --capa ister)",
    anchorModeOfKeyDir(dizin("kok-2026-1.kok.json", "alt-2026-1.anahtar.json")) === "uretim" &&
      anchorModeOfKeyDir(dizin("hazirlik-2026-1.kok.json")) === null &&
      anchorModeOfKeyDir(dizin("kok-2026-1.kok.json", "hazirlik-2026-1.kok.json")) === null &&
      anchorModeOfKeyDir(dizin("alt-2026-1.anahtar.json")) === null,
  );

  console.log("\n§8 eski aile kök dosyası yüklenmez");
  const kd = mkdtempSync(path.join(TEMP, "kok-dizin-"));
  const uret = generateKeyPairSync("ed25519").privateKey;
  const eski = generateKeyPairSync("ed25519").privateKey;
  writeKeyFileExclusive(path.join(kd, "kok-sonda-1.kok.json"), await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: "kok-sonda-1", siniflar: ["TEST", "DEMO"] }, uret, passwordBuffer(TEST_KOK_PAROLASI)));
  writeKeyFileExclusive(path.join(kd, "hazirlik-2026-1.kok.json"), await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: "hazirlik-2026-1", siniflar: ["TEST", "DEMO"] }, eski, passwordBuffer(TEST_KOK_PAROLASI)));
  const kdCapa = capaDosyasi("kd-capa.json", [{ kid: "kok-sonda-1", x: publicKeyX(uret), classes: ["TEST", "DEMO"] }]);
  const ks = KeyStore.load(loadConfig({ ...TABAN, ANAHTAR_DIZINI: kd, GUVEN_CAPASI_DOSYASI: kdCapa }, TEMP));
  const kayitlar = ks.publicRecords().map((r) => `${r.kid}:${r.kind}`);
  kontrol(
    "§8 ⭐ `hazirlik-*` kök dosyası yüklenmez (uyarı, künyede/imzada yok) · `kok-*` kök yüklenir ve imzaya açık",
    kayitlar.join() === "kok-sonda-1:KOK" && ks.warnings.some((w) => w.startsWith("hazirlik-2026-1.kok.json kök ailesinde değil")) && ks.rootFileFor("TEST")?.kid === "kok-sonda-1",
    `${kayitlar.join()} · ${ks.warnings.join(" | ")}`,
  );

  console.log("\n§9 emekli enum değerlerine yeni yazım yok");
  const sema = readFileSync(path.join(SATICI_KOKU, "prisma", "schema.prisma"), "utf8");
  const emekliMi = (govde: string, deger: string): boolean => new RegExp(`\\n {2}/// EMEKLİ DEĞER[^\\n]*\\n {2}${deger}\\n`).test(govde);
  const enumGovde = (ad: string): string => new RegExp(`\\nenum ${ad} \\{[\\s\\S]*?\\n\\}`).exec(sema)?.[0] ?? "";
  kontrol("§9a şemada AnahtarTuru.HAZIRLIK_KOK ve KanalTuru.hazirlik `/// EMEKLİ DEĞER` işaretli (DB değeri kalır)",
    emekliMi(enumGovde("AnahtarTuru"), "HAZIRLIK_KOK") && emekliMi(enumGovde("KanalTuru"), "hazirlik"));
  const kokler = [path.join(SATICI_KOKU, "src"), path.join(SATICI_KOKU, "scripts"), path.join(SATICI_KOKU, "..", "web", "src"), path.join(SATICI_KOKU, "..", "..", "deploy", "satici")];
  const dosyalar = kokler.flatMap((k) => kaynaklar(k));
  const ihlaller = dosyalar.flatMap((f) => emekliYazimIhlalleri(readFileSync(f, "utf8")).map((x) => `${path.relative(path.join(SATICI_KOKU, "..", ".."), f)}:${x}`));
  kontrol(`§9b ⭐ ${dosyalar.length} kaynak dosyada emekli değeri yazan/okuyan ifade yok`, dosyalar.length > 100 && ihlaller.length === 0, ihlaller.slice(0, 5).join(" ; "));
  const sentetik = ['kind: "HAZIRLIK_KOK",', "where: { tur: KanalTuru.hazirlik }", "create: { kod, tur: 'hazirlik' }"];
  kontrol("§9c ✓K tarayıcı kör değil: üç ihlal kalıbının her biri sentetik satırda yakalanır, temiz satır 0",
    sentetik.every((x) => emekliYazimIhlalleri(x).length === 1) && emekliYazimIhlalleri('tur: "uretim", GUVEN_CAPASI: "uretim"').length === 0);
}

main()
  .catch((e: unknown) => kontrol("beklenmeyen hata", false, (e as Error).stack ?? String(e)))
  .finally(() => {
    rmSync(TEMP, { recursive: true, force: true });
    sonuc();
  });
