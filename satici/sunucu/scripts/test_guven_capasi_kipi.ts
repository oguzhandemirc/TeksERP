// =============================================================================
// BEKÇİ — SATICININ GÜVEN ÇAPASI KİPİ (G3): satıcı YALNIZ kendi ortamının köklerine güvenir (fabrikanın o kipteki
// derlemesi gibi); üretimde dosya çapası ve geçersiz çapa açılışı DURDURUR — uyarıyla sürmez (fail-closed).
//   §1 GUVEN_CAPASI=uretim → gömülü çapa üretim listesi (hazırlık kökü YOK) · hazirlik → yalnız hazırlık kökleri
//   §2 ⭐ uretim + GUVEN_CAPASI_DOSYASI → yapılandırma RED ve KeyStore.load RED
//   §3 hazirlik + dosya → dosya çapası (hazırlık/test) kabul, uyarıyla
//   §4 ⭐ kip yok + dosya yok → RED (örtük birleşik çapa yok)
//   §5 ⭐ dosya çapası geçersiz (hazırlık kökü ÜRETİM'e genişletilmiş) → yükleme RED (eskiden yalnız uyarı)
//   §6 compose: satıcı servisi kipi ORTAM'dan alır, ⑪ denetimi eşitliği ölçer
//   §7 CLI kip çıkarımı (`anchorModeOfKeyDir`): anahtar dizininde tek aile → o kip; karışık ya da boş → null
// Koşum: npx tsx scripts/test_guven_capasi_kipi.ts   (DB GEREKMEZ)
// =============================================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { KeyStore, anchorModeOfKeyDir } from "../src/keys/key-store";
import { PRODUCTION_ROOT_PUBLIC_KEYS, STAGING_ROOT_PUBLIC_KEYS } from "../src/lisans-protokol";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

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

function capaDosyasi(ad: string, icerik: unknown): string {
  const f = path.join(TEMP, ad);
  writeFileSync(f, JSON.stringify(icerik));
  return f;
}

function main(): void {
  console.log("\n§1 gömülü çapa ortamın kipinden");
  const u = KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI: "uretim" }, TEMP));
  const h = KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI: "hazirlik" }, TEMP));
  kontrol(
    "§1a ⭐ GUVEN_CAPASI=uretim → üretim kökleri; hazırlık kökü YOK (üretim satıcısı hazırlık köküyle imzalamaz, bayi bağlamaz)",
    u.anchor === PRODUCTION_ROOT_PUBLIC_KEYS && u.anchorSource === "gomulu" && !u.anchor.some((r) => r.kid.startsWith("hazirlik-")),
    u.anchor.map((r) => r.kid).join(","),
  );
  kontrol("§1b GUVEN_CAPASI=hazirlik → yalnız hazırlık kökleri", h.anchor === STAGING_ROOT_PUBLIC_KEYS && h.anchor.every((r) => r.kid.startsWith("hazirlik-")), h.anchor.map((r) => r.kid).join(","));
  kontrol("§1c tanınmayan kip yapılandırmada RED", hata(() => loadConfig({ ...TABAN, GUVEN_CAPASI: "test" }, TEMP)) !== null);

  console.log("\n§2 üretimde dosya çapası RED");
  const gecerli = capaDosyasi("capa.json", STAGING_ROOT_PUBLIC_KEYS);
  const cfgHata = hata(() => loadConfig({ ...TABAN, GUVEN_CAPASI: "uretim", GUVEN_CAPASI_DOSYASI: gecerli }, TEMP));
  const ksHata = hata(() => KeyStore.load({ ANAHTAR_DIZINI: TEMP, GUVEN_CAPASI: "uretim", GUVEN_CAPASI_DOSYASI: gecerli }));
  kontrol("§2a ⭐ GUVEN_CAPASI=uretim + GUVEN_CAPASI_DOSYASI → yapılandırma açılışı DURUR", cfgHata !== null && cfgHata.includes("GUVEN_CAPASI_DOSYASI"), cfgHata ?? "kabul edildi");
  kontrol("§2b ⭐ aynı ikili KeyStore.load'a doğrudan verilse de RED (CLI yolu yapılandırmayı atlasa da)", ksHata !== null && ksHata.includes("uretim"), ksHata ?? "kabul edildi");

  console.log("\n§3 hazırlıkta dosya çapası");
  const d = KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI: "hazirlik", GUVEN_CAPASI_DOSYASI: gecerli }, TEMP));
  kontrol("§3 hazirlik + dosya → dosya çapası, uyarıyla", d.anchorSource === "dosya" && d.warnings.some((w) => w.startsWith("Güven çapası DOSYADAN")));

  console.log("\n§4 kip yok");
  const kipsiz = hata(() => KeyStore.load(loadConfig({ ...TABAN }, TEMP)));
  kontrol("§4 ⭐ kip yok + dosya yok → RED (birleşik çapaya düşülmez)", kipsiz !== null && kipsiz.includes("GUVEN_CAPASI"), kipsiz ?? "kabul edildi");

  console.log("\n§5 geçersiz çapa açılışı durdurur");
  const genis = capaDosyasi("genis.json", STAGING_ROOT_PUBLIC_KEYS.map((r) => ({ ...r, classes: [...r.classes, "URETIM"] })));
  const gecersiz = hata(() => KeyStore.load(loadConfig({ ...TABAN, GUVEN_CAPASI: "hazirlik", GUVEN_CAPASI_DOSYASI: genis }, TEMP)));
  kontrol("§5 ⭐ hazırlık kökü ÜRETİM'e genişletilmiş dosya çapası → yükleme RED (GUVEN_CAPASI_BICIM), uyarıyla sürmez", gecersiz !== null && gecersiz.includes("GUVEN_CAPASI_BICIM"), gecersiz ?? "kabul edildi");

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
    "§7 tek aile → kip (kok-* üretim · hazirlik-* hazırlık) · karışık ya da kök yok → null (CLI --capa ister)",
    anchorModeOfKeyDir(dizin("kok-2026-1.kok.json", "alt-2026-1.anahtar.json")) === "uretim" &&
      anchorModeOfKeyDir(dizin("hazirlik-2026-1.kok.json")) === "hazirlik" &&
      anchorModeOfKeyDir(dizin("kok-2026-1.kok.json", "hazirlik-2026-1.kok.json")) === null &&
      anchorModeOfKeyDir(dizin("alt-2026-1.anahtar.json")) === null,
  );
}

try {
  main();
} finally {
  rmSync(TEMP, { recursive: true, force: true });
}
sonuc();
