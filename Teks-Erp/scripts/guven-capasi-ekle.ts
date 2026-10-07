// =============================================================================
// GÜVEN ÇAPASI — tören sonrası kök / PAKET AÇIK anahtarını çapaya ekler (deterministik)
// =============================================================================
// Tek komut, dört yer, tek liste: çapa TEK kiptir (üretim) ve yalnız `kok-*` / `paket-<yıl>` kid'i kabul eder.
// Yerler: TS kök çapası (`PRODUCTION_ROOT_PUBLIC_KEYS`, + satıcı ve patron protokol aynası, bayt-eşit kopya) ·
// TS PAKET çapası (`PRODUCTION_PACKAGE_PUBLIC_KEYS`) · native gömülü çapa (`anchor.rs`, rustfmt düzeni, üretim
// bloğu). Yalnız AÇIK yarı okunur: parola istemez, özel yarıya dokunmaz, hiçbir sır basmaz.
//
//   npx tsx scripts/guven-capasi-ekle.ts kok --dosya=<kid>.kok.json [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts kok --kid=kok-2026-1 --x=<base64url> --siniflar=URETIM,DR,… [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts paket --kid=paket-2026 --x=<base64url> [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts paket --dosya=<kid>.paket.json [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts istemci-kok --kok-kid=kok-<yıl>-<n> [--yaz] (panel kök çapası: TS üretim kökü AYNEN)
//   Ortak: [--kok=<depo kökü>] (varsayılan bu deponun kökü)
// `istemci-kok` beşinci yerdir: panelin gömülü KÖK çapası (Electron/electron/guncelleme/imza-capasi.json; künye v:2'yi
// `ist-*` sertifikalı anahtar imzalar). Eski `panel` komutu KALKTI (panel çapasında gömülü imzacı anahtarı yok); `tablet`
// komutu KALKTI (ortak tablette APK künyesi yok, K-14).
//
// Varsayılan KURU: planı basar, dosya yazmaz; `--yaz` yazar. Aynı kid + aynı anahtar zaten çapadaysa
// değişiklik yok (idempotent); aynı kid başka anahtar/sınıf ya da aynı anahtar başka kid → RED (rotasyon YENİ
// kid'dir, satır değiştirilmez). Yeni satır listenin SONUNA eklenir. Başlangıçta dört yer tutarsızsa (ayna
// farkı, anchor.rs ≠ TS, listede biçim dışı kid, elle
// bozulmuş biçim) HİÇBİR ŞEY yazılmaz.
// Çıkış: 0 tamam (plan / yazıldı / zaten var) · 1 geçersiz ya da çakışma · 2 biçim (betik güncellenmeli) · 64 kullanım.
// Bekçi: test_guven_capasi_ekle (betik bugünkü dört dosyayı bayt-eşit yeniden üretir + geçici kopyada davranış).
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LicenseClass } from "../src/lib/license/protocol";
import {
  CapaHatasi,
  PANEL_CAPA_DOSYASI,
  capaDurumuOku,
  istemciKokCapasiOku,
  istemciKokEklePlani,
  kokEklePlani,
  paketEklePlani,
  type CapaDurumu,
  type EklemePlani,
} from "./lib/guven-capasi";

const CIKIS = { TAMAM: 0, RED: 1, BICIM: 2, KULLANIM: 64 } as const;

function arg(argv: readonly string[], ad: string): string | null {
  const p = argv.find((a) => a.startsWith(`--${ad}=`));
  return p ? p.slice(ad.length + 3) : null;
}
class KullanimHatasi extends Error {}

const evYolu = (p: string): string => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** Tören dosyasından YALNIZ açık alanlar (kid · x · sınıflar); başka alan okunmaz, basılmaz. */
function acikAlanlar(dosya: string, beklenenTur: string): { kid: string; x: string; siniflar: string[] | null } {
  const tam = path.resolve(evYolu(dosya));
  if (!existsSync(tam)) throw new CapaHatasi("GECERSIZ", `dosya yok: ${tam}`);
  let ham: unknown;
  try {
    ham = JSON.parse(readFileSync(tam, "utf8"));
  } catch {
    throw new CapaHatasi("GECERSIZ", `dosya JSON değil: ${tam}`);
  }
  const o = (typeof ham === "object" && ham !== null ? ham : {}) as Record<string, unknown>;
  if (o.tur !== beklenenTur || typeof o.kid !== "string" || typeof o.x !== "string") {
    throw new CapaHatasi("GECERSIZ", `beklenen tür ${beklenenTur} (kid + x) değil: ${path.basename(tam)}`);
  }
  const siniflar = Array.isArray(o.siniflar) && o.siniflar.every((s) => typeof s === "string") ? (o.siniflar as string[]) : null;
  return { kid: o.kid, x: o.x, siniflar };
}

function planla(argv: readonly string[], d: CapaDurumu, kok: string): { plan: EklemePlani; ozet: string } {
  const komut = argv[0];
  const dosya = arg(argv, "dosya");
  if (komut === "panel") throw new KullanimHatasi("panel komutu kalktı — panel çapası yalnız kök: istemci-kok --kok-kid=kok-<yıl>-<n>");
  if (komut === "istemci-kok") {
    const kokKid = arg(argv, "kok-kid");
    if (!kokKid) throw new KullanimHatasi("istemci-kok: --kok-kid=kok-<yıl>-<n> gerekli");
    const plan = istemciKokEklePlani(d, istemciKokCapasiOku(kok), kokKid);
    const r = d.kokler.uretim.find((k) => k.kid === kokKid)!;
    return { plan, ozet: `PANEL KÖK ${r.kid} [${r.classes.join(", ")}] x=${r.x}` };
  }
  if (komut === "tablet") throw new KullanimHatasi("tablet komutu kalktı — ortak tablette APK künyesi yok (K-14)");
  if (komut === "kok") {
    const ac = dosya ? acikAlanlar(dosya, "tekserp-kok-anahtar") : null;
    const kid = ac?.kid ?? arg(argv, "kid");
    const x = ac?.x ?? arg(argv, "x");
    const siniflar = ac?.siniflar ?? arg(argv, "siniflar")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
    if (!kid || !x || !siniflar) throw new KullanimHatasi("kok: --dosya=<kid>.kok.json ya da --kid + --x + --siniflar gerekli");
    const plan = kokEklePlani(d, { kid, x, classes: siniflar as LicenseClass[] });
    return { plan, ozet: `kök ${kid} [${siniflar.join(", ")}] → ${plan.kip} listesi · x=${x}` };
  }
  if (komut === "paket") {
    const ac = dosya ? acikAlanlar(dosya, "tekserp-paket-anahtar") : null;
    const kid = ac?.kid ?? arg(argv, "kid");
    const x = ac?.x ?? arg(argv, "x");
    if (!kid || !x) throw new KullanimHatasi("paket: --dosya=<kid>.paket.json ya da --kid + --x gerekli");
    const plan = paketEklePlani(d, { kid, x });
    return { plan, ozet: `PAKET ${kid} → ${plan.kip} listesi · x=${x}` };
  }
  throw new KullanimHatasi("komut: kok | paket | istemci-kok");
}

const PANEL_SONRAKI_ADIMLAR = [
  "Sonraki adımlar (panel kök çapası):",
  "  cd Teks-Erp && node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts panel_imza",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts guven_capasi_ekle",
  "  cd Electron && node ../scripts/agir-is.mjs -- npx vitest run src/test/panel-kunye.test.ts src/test/updater-imza-akisi.test.ts",
  "  node scripts/agir-is.mjs -- node scripts/test_grup_yayin_kapisi.mjs   (panel grup künyesi)",
  "Sonra: YENİ panel sürümü (çapa derlemede gömülür); yeni kök sahadaki panele ancak eski kökün imzaladığı sürümle ulaşır (rotasyon kök düzeyinde).",
];

const SONRAKI_ADIMLAR = [
  "Sonraki adımlar (sabiti OKUYAN her bekçi — kök kural):",
  "  cd Teks-Erp && node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_protokol   (protokol §0' + ayna)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz          (gömülü çapa vektörleri listenin İLK kid'iyle)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_native_kahin              (§0e gömülü çapa)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_butunluk                  (§2 PAKET çapası)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts guven_capasi_ekle",
  "  cd native && npm run denetle && npm test                                                          (rustfmt + clippy + cargo test, bütün çalışma alanı)",
  "  satici/sunucu ve patron/sunucu: npx tsc --noEmit (ayna)",
  "Sonra: native .node VE güncelleyici ikilisi YENİDEN derlenir (gömülü çapa ikisinde de: tekserp-dogrulama) → yeni backend paketi; satıcı/patron imajı yeni aynayla.",
  "Belgeler: docs/kurallar/lisans.md (güven çapası satırı) · docs/design/LISANS-PROTOKOLU.md §0 tablosu · docs/ops/SATICI-KURULUM.md anahtar tablosu.",
];

export function main(argv: readonly string[]): number {
  const kok = path.resolve(arg(argv, "kok") ?? path.join(__dirname, "..", ".."));
  const yaz = argv.includes("--yaz");
  try {
    const durum = capaDurumuOku(kok);
    const { plan, ozet } = planla(argv, durum, kok);
    if (!plan.degisir) {
      console.log(`✓ zaten çapada, değişiklik yok — ${ozet}`);
      return CIKIS.TAMAM;
    }
    console.log(`${yaz ? "▶ YAZ" : "▶ KURU (yazmak için --yaz)"} — ${ozet}`);
    for (const yol of plan.dosyalar.keys()) console.log(`  ${yaz ? "yazıldı" : "yazılacak"}: ${yol}`);
    if (!yaz) return CIKIS.TAMAM;
    for (const [yol, icerik] of plan.dosyalar) writeFileSync(path.join(kok, yol), icerik);
    // Son koşul: yazılan dört yer yeniden ayrıştırılır ve birbirine eşit (aksi hâlde yarım yazım görünür).
    capaDurumuOku(kok);
    if (plan.dosyalar.has(PANEL_CAPA_DOSYASI)) {
      istemciKokCapasiOku(kok);
      console.log(PANEL_SONRAKI_ADIMLAR.join("\n"));
      return CIKIS.TAMAM;
    }
    console.log(SONRAKI_ADIMLAR.join("\n"));
    return CIKIS.TAMAM;
  } catch (e) {
    if (e instanceof KullanimHatasi) {
      console.error(`kullanım: ${e.message}`);
      return CIKIS.KULLANIM;
    }
    if (e instanceof CapaHatasi) {
      console.error(`✖ ${e.tur}: ${e.message}`);
      return e.tur === "BICIM" ? CIKIS.BICIM : CIKIS.RED;
    }
    throw e;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
