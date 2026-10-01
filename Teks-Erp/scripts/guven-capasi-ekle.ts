// =============================================================================
// GÜVEN ÇAPASI — tören sonrası kök / PAKET AÇIK anahtarını çapaya ekler (deterministik)
// =============================================================================
// Tek komut, dört yer, kipin tek listesi: çapa İKİ kiptir ve anahtar kid'inin kipine gider — `kok-*`/`paket-<yıl>`
// ÜRETİM, `hazirlik-*`/`paket-hazirlik*` HAZIRLIK listesine (üretim derlemesi hazırlık anahtarına hiç güvenmez).
// Yerler: TS kök çapası (`PRODUCTION_`/`STAGING_ROOT_PUBLIC_KEYS`, + satıcı ve patron protokol aynası, bayt-eşit
// kopya) · TS PAKET çapası (`…_PACKAGE_PUBLIC_KEYS`) · native gömülü çapa (`anchor.rs`, rustfmt düzeni, kipin
// `cfg` kapılı bloğu). Yalnız AÇIK yarı okunur: parola istemez, özel yarıya dokunmaz, hiçbir sır basmaz.
//
//   npx tsx scripts/guven-capasi-ekle.ts kok --dosya=<kid>.kok.json [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts kok --kid=kok-2026-1 --x=<base64url> --siniflar=URETIM,DR,… [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts paket --kid=paket-2026 --x=<base64url> [--yaz]
//   npx tsx scripts/guven-capasi-ekle.ts paket --dosya=<kid>.paket.json [--yaz]
//   Ortak: [--kok=<depo kökü>] (varsayılan bu deponun kökü)
//
// Varsayılan KURU: planı basar, dosya yazmaz; `--yaz` yazar. Aynı kid + aynı anahtar zaten çapadaysa
// değişiklik yok (idempotent); aynı kid başka anahtar/sınıf ya da aynı anahtar başka kid → RED, iki kipin
// listesi birlikte aranır (rotasyon YENİ kid'dir, satır değiştirilmez). Yeni satır kipin listesinin SONUNA
// eklenir. Başlangıçta dört yer tutarsızsa (ayna farkı, anchor.rs ≠ TS, listede başka kipin kid'i, elle
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
  capaDurumuOku,
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

function planla(argv: readonly string[], d: CapaDurumu): { plan: EklemePlani; ozet: string } {
  const komut = argv[0];
  const dosya = arg(argv, "dosya");
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
  throw new KullanimHatasi("komut: kok | paket");
}

const SONRAKI_ADIMLAR = [
  "Sonraki adımlar (sabiti OKUYAN her bekçi — kök kural):",
  "  cd Teks-Erp && node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_protokol   (protokol §0' + ayna)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz          (gömülü çapa vektörleri kipin İLK kid'iyle)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_native_kahin              (§0e gömülü çapa · §2e/§2f kipler)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts lisans_butunluk                  (§2 PAKET çapası)",
  "  node ../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts guven_capasi_ekle",
  "  cd native && npm run denetle && npm test                                                          (rustfmt + clippy + cargo test, bütün çalışma alanı, iki kip)",
  "  satici/sunucu ve patron/sunucu: npx tsc --noEmit (ayna)",
  "Sonra: native .node VE güncelleyici ikilisi o kipte YENİDEN derlenir (gömülü çapa ikisinde de: tekserp-dogrulama; üretim özelliksiz · hazırlık `hazirlik-capasi`) → yeni backend paketi; satıcı/patron imajı yeni aynayla.",
  "Belgeler: docs/kurallar/lisans.md (güven çapası satırı) · docs/design/LISANS-PROTOKOLU.md §0 tablosu · docs/ops/SATICI-KURULUM.md anahtar tablosu.",
];

export function main(argv: readonly string[]): number {
  const kok = path.resolve(arg(argv, "kok") ?? path.join(__dirname, "..", ".."));
  const yaz = argv.includes("--yaz");
  try {
    const durum = capaDurumuOku(kok);
    const { plan, ozet } = planla(argv, durum);
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
