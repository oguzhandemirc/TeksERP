// =============================================================================
// BEKÇİ — güven çapası ekleme betiği (`scripts/guven-capasi-ekle.ts` + `scripts/lib/guven-capasi.ts`)
// =============================================================================
// DB'siz. NEDEN: çapaya anahtar yılda birkaç kez (tören, rotasyon) girer; dosya biçimi o güne dek kayarsa
// betik tören günü durur ya da yanlış yazar. Bu bekçi her koşumda betiğin BUGÜNKÜ dört yeri ayrıştırıp
// bayt-eşit yeniden ürettiğini ölçer ve davranışını geçici bir KOPYADA sınar (gerçek ağaca yazmaz).
//   §0 gerçek ağaç: ayrıştırma + aynalar eşit + anchor.rs = TS; çapadaki her kid üretim/hazırlık biçiminde;
//      gömülü çapa vektörlerinin fikstür kid'leri (`kok-fikstur-1` · `paket-fikstur`) bu biçimin DIŞINDA —
//      tören günü çapaya giren gerçek anahtar vektör dosyasını kaydıramaz · fikstür köklerinin kid'leri (`kok-fikstur-1` ·
//      `hazirlik-fikstur-1`) gerçek çapada yok ve biçim dışı (§0g)
//   §1 kuru koşum dosyaya dokunmaz · §2 kök ekleme: sona eklenir, aynalar bayt-eşit, anchor.rs kâhin
//      deseniyle TS'e eşit, TS modülü derin donuk ve `prepareTrustAnchor` geçer · §3 aynı anahtar ikinci
//      kez → değişiklik yok · §4 PAKET ekleme · §5 RET dalları (dosyaya dokunmaz) · §6 elle bozulmuş
//      biçim / ayna farkı → BICIM, yazım yok · §7 üretilen anchor.rs düzeni `rustfmt --check` temiz (rustfmt yoksa ⏭)
// ⭐ KALICI SONDA ✓K: §5–§6 her koşumda ret ve biçim dallarını ısırtır; §0c fikstür kid'leri kuralda ret alır.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_guven_capasi_ekle.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atlamaDefteri } from "./lib/atlama";
import { fiksturKur } from "./lib/lisans-fikstur";
import { main as ekle } from "./guven-capasi-ekle";
import {
  CAPA_DOSYALARI,
  KOK_KID_BICIMI,
  RUSTFMT_GENISLIK,
  capaDurumuOku,
  paketKidGecerli,
  rsSabiti,
  type CapaDurumu,
} from "./lib/guven-capasi";
import { prepareTrustAnchor, type RootKey } from "../src/lib/license/protocol";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const DEPO = path.resolve(__dirname, "..", "..");
const TUM_DOSYALAR = [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari, CAPA_DOSYALARI.paketTs, CAPA_DOSYALARI.anchorRs];
const RS_KOK_OGE = /\("([^"]+)", "([^"]+)", &\[([^\]]*)\]\)/g; // kâhin §0e deseni

const taze = (): string => generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x as string;
const oku = (kok: string, yol: string): string => readFileSync(path.join(kok, yol), "utf8");
const anlik = (kok: string): string => TUM_DOSYALAR.map((y) => oku(kok, y)).join("\u0000");

/** Konsolu susturup betiği süreç içinde koşar (çıkış kodu döner). */
function kos(argv: string[]): number {
  const log = console.log;
  const err = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return ekle(argv);
  } finally {
    console.log = log;
    console.error = err;
  }
}

function kopya(): string {
  const kok = mkdtempSync(path.join(os.tmpdir(), "guven-capasi-"));
  for (const yol of TUM_DOSYALAR) {
    mkdirSync(path.dirname(path.join(kok, yol)), { recursive: true });
    copyFileSync(path.join(DEPO, yol), path.join(kok, yol));
  }
  return kok;
}

function bolum0(): CapaDurumu | null {
  console.log("\n§0 gerçek ağaç");
  let d: CapaDurumu | null = null;
  try {
    d = capaDurumuOku(DEPO);
  } catch (e) {
    check("§0a betik bugünkü dört yeri ayrıştırır (biçim · aynalar · anchor.rs = TS)", false, (e as Error).message);
    return null;
  }
  check("§0a betik bugünkü dört yeri ayrıştırır (biçim · aynalar · anchor.rs = TS)", d.kokler.length >= 1 && d.paketler.length >= 1, `${d.kokler.length} kök · ${d.paketler.length} PAKET`);
  const kotuKok = d.kokler.filter((r) => !KOK_KID_BICIMI.test(r.kid)).map((r) => r.kid);
  const kotuPaket = d.paketler.filter((k) => !paketKidGecerli(k.kid)).map((k) => k.kid);
  check("§0b çapadaki her kid üretim/hazırlık biçiminde (kök kok|hazirlik-<yıl>-<n> · PAKET paket-<yıl> | paket-hazirlik…)", kotuKok.length === 0 && kotuPaket.length === 0, [...kotuKok, ...kotuPaket].join(", ") || "temiz");
  check(
    "§0c ⭐ gömülü çapa vektörlerinin fikstür kid'leri biçim DIŞINDA (kok-fikstur-1 · paket-fikstur çapaya giremez; kural bir şeyi dışarıda bırakıyor)",
    !KOK_KID_BICIMI.test("kok-fikstur-1") && !paketKidGecerli("paket-fikstur") && KOK_KID_BICIMI.test("kok-2026-1") && paketKidGecerli("paket-2026") && paketKidGecerli("paket-hazirlik"),
  );
  const vektor = readFileSync(path.join(DEPO, "Teks-Erp/scripts/lib/lisans-cekirdek-vektor.ts"), "utf8") + readFileSync(path.join(DEPO, "Teks-Erp/scripts/lib/lisans-butunluk-vektor.ts"), "utf8");
  check("§0d körlük zemini: vektör üreticisi bu fikstür kid'lerini gerçekten kullanıyor", vektor.includes('"kok-fikstur-1"') && vektor.includes('"paket-fikstur"'));
  const kayitlar = (JSON.parse(readFileSync(path.join(DEPO, VEKTOR_DOSYASI), "utf8")) as { kayitlar: Array<{ vektor: Record<string, unknown> }> }).kayitlar;
  const gomulu = gomuluCapaImzacilari(kayitlar);
  const kayacak = kaymaAdaylari(gomulu, d);
  check("§0e ⭐ vektör dosyasında gömülü çapayla koşan her vektörün imzacısı ya çapada ya üretim biçimi DIŞINDA (tören günü sonuç kaymaz)", gomulu.length >= 4 && kayacak.length === 0, kayacak.join(" · ") || `${gomulu.length} vektör`);
  const yalnizHazirlik: CapaDurumu = { ...d, kokler: d.kokler.filter((r) => r.kid.startsWith("hazirlik-")), paketler: d.paketler.filter((k) => k.kid.startsWith("paket-hazirlik")) };
  const sahte = kaymaAdaylari([{ ad: "sahte", tur: "hak", kid: "kok-2099-1" }, { ad: "sahte-paket", tur: "butunluk", kid: "paket-2099" }, { ad: "hazirlik", tur: "hak", kid: "hazirlik-2026-1" }], yalnizHazirlik);
  check("§0f ✓K sınıflandırıcı üretim biçimli, çapada olmayan imzacıyı yakalar (kök + PAKET)", sahte.length === 2, sahte.join(" · "));
  const f = fiksturKur(0);
  const capaKidleri = new Set(d.kokler.map((r) => r.kid));
  const fiksturKokleri = [f.kok.kid, f.hazirlik.kid];
  check(
    "§0g ⭐ fikstür köklerinin kid'leri gerçek çapada YOK ve üretim biçimi DIŞINDA (gömülü çapayla koşan doğrulamada çarpışmaz, çapaya giremez)",
    fiksturKokleri.every((k) => !capaKidleri.has(k) && !KOK_KID_BICIMI.test(k)) && f.hazirlik.kid.startsWith("hazirlik-"),
    fiksturKokleri.join(", "),
  );
  return d;
}

const VEKTOR_DOSYASI = "Teks-Erp/native/lisans-cekirdek/test-vektorleri/protokol.json";

function jwsKid(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    const kid = (JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: unknown }).kid;
    return typeof kid === "string" ? kid : null;
  } catch {
    return null;
  }
}

function altSertifikaKid(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    return jwsKid((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { altSertifika?: unknown }).altSertifika);
  } catch {
    return null;
  }
}

interface Imzaci {
  readonly ad: string;
  readonly tur: string;
  readonly kid: string;
}

/** Gömülü çapayla koşan vektörler (`roots`/`keys` null) ve zinciri çapaya dayanan imzacının kid'i. */
function gomuluCapaImzacilari(kayitlar: ReadonlyArray<{ vektor: Record<string, unknown> }>): Imzaci[] {
  const out: Imzaci[] = [];
  for (const { vektor: v } of kayitlar) {
    const ad = String(v.ad);
    const tur = String(v.tur);
    let kid: string | null = null;
    if ((tur === "sertifika" || tur === "hak") && v.roots === null) kid = jwsKid(v.token);
    else if (tur === "kira" && v.roots === null) kid = altSertifikaKid(v.token);
    else if (tur === "butunluk" && v.keys === null) kid = jwsKid(v.manifest);
    else if (v.roots === null || v.keys === null) kid = "?";
    if (kid !== null) out.push({ ad, tur, kid });
  }
  return out;
}

/** Çapada OLMAYAN ama üretim biçimli imzacı: o kid çapaya girdiğinde vektörün beklenen sonucu kayar. */
function kaymaAdaylari(imzacilar: readonly Imzaci[], d: CapaDurumu): string[] {
  const kokler = new Set(d.kokler.map((r) => r.kid));
  const paketler = new Set(d.paketler.map((k) => k.kid));
  return imzacilar
    .filter((i) => (i.tur === "butunluk" ? !paketler.has(i.kid) && (paketKidGecerli(i.kid) || i.kid === "?") : !kokler.has(i.kid) && (KOK_KID_BICIMI.test(i.kid) || i.kid === "?")))
    .map((i) => `${i.tur}/${i.ad}: ${i.kid}`);
}

function bolum1ile4(): void {
  console.log("\n§1–§4 geçici kopyada ekleme");
  const kok = kopya();
  try {
    const once = anlik(kok);
    const x = taze();
    const kokArg = [`--kok=${kok}`];
    const r1 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", ...kokArg]);
    check("§1 kuru koşum: çıkış 0, dosyalara dokunulmadı", r1 === 0 && anlik(kok) === once);

    const d0 = capaDurumuOku(kok);
    const r2 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", "--yaz", ...kokArg]);
    const d = capaDurumuOku(kok);
    const son = d.kokler[d.kokler.length - 1];
    check(
      "§2a --yaz: çıkış 0, yeni kök listenin SONUNDA, eskiler aynı sırada",
      r2 === 0 && son?.kid === "kok-2099-1" && son.x === x && d.kokler.length === d0.kokler.length + 1 && JSON.stringify(d.kokler.slice(0, -1)) === JSON.stringify(d0.kokler),
    );
    const kaynak = oku(kok, CAPA_DOSYALARI.kokTs);
    check("§2b satıcı + patron aynası kaynakla BAYT-EŞİT", CAPA_DOSYALARI.kokAynalari.every((a) => oku(kok, a) === kaynak));
    const rs = [...oku(kok, CAPA_DOSYALARI.anchorRs).matchAll(RS_KOK_OGE)].map((m) => ({ kid: m[1], x: m[2], classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1]) }));
    check("§2c anchor.rs (kâhin §0e deseni) = TS kök listesi", JSON.stringify(rs) === JSON.stringify(d.kokler), `${rs.length} kök`);
    const modul = require(path.join(kok, CAPA_DOSYALARI.kokTs)) as { ROOT_PUBLIC_KEYS: readonly RootKey[] };
    const liste = modul.ROOT_PUBLIC_KEYS;
    check(
      "§2d yazılan TS modülü yüklenir: derin donuk + prepareTrustAnchor geçer + yeni kök tanınır",
      Object.isFrozen(liste) && liste.every((r) => Object.isFrozen(r) && Object.isFrozen(r.classes)) && prepareTrustAnchor(liste).ok && liste.some((r) => r.kid === "kok-2099-1" && r.x === x),
    );
    check("§2e paket dosyası (integrity.ts) kök eklemede DEĞİŞMEDİ", oku(kok, CAPA_DOSYALARI.paketTs) === oku(DEPO, CAPA_DOSYALARI.paketTs));

    const ara = anlik(kok);
    const r3 = kos(["kok", "--kid=kok-2099-1", `--x=${x}`, "--siniflar=URETIM,DR,BAYI,BARINDIRILAN,TEST,DEMO", "--yaz", ...kokArg]);
    check("§3 aynı kid + aynı anahtar ikinci kez: çıkış 0, değişiklik yok (idempotent)", r3 === 0 && anlik(kok) === ara);

    const px = taze();
    const r4 = kos(["paket", "--kid=paket-2099", `--x=${px}`, "--yaz", ...kokArg]);
    const d4 = capaDurumuOku(kok);
    const sonPaket = d4.paketler[d4.paketler.length - 1];
    check(
      "§4a PAKET ekleme: çıkış 0, integrity.ts ve anchor.rs'te sona eklendi, eşit",
      r4 === 0 && d4.paketler.length === d.paketler.length + 1 && sonPaket?.kid === "paket-2099" && sonPaket.x === px && JSON.stringify(d4.paketler.slice(0, -1)) === JSON.stringify(d.paketler),
    );
    check("§4b PAKET eklemede kök dosyaları DEĞİŞMEDİ", oku(kok, CAPA_DOSYALARI.kokTs) === kaynak);
  } catch (e) {
    // Yarım yazım (ör. ayna yazılmadı) ayrıştırıcıyı düşürür: çökme değil kırmızı.
    check("§1–§4 geçici kopya ekleme sonrası ayrıştırılabilir", false, (e as Error).message);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
}

function bolum5ile6(d: CapaDurumu): void {
  console.log("\n§5 ret dalları (dosyaya dokunmaz) — ✓K");
  const hazirlik = d.kokler.find((r) => r.kid.startsWith("hazirlik-"));
  // Her ret kendi kopyasında: bir dalın yanlışlıkla yazması sonrakileri kirletmesin.
  const ret = (ad: string, argv: string[], beklenen: number): void => {
    const kok = kopya();
    try {
      const once = anlik(kok);
      const r = kos([...argv, `--kok=${kok}`, "--yaz"]);
      check(`§5 ${ad} → çıkış ${beklenen}, dosyalar aynı`, r === beklenen && anlik(kok) === once, `çıkış ${r}`);
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  };
  {
    ret("aynı kid BAŞKA anahtar (rotasyon yeni kid'dir)", ["kok", `--kid=${hazirlik?.kid ?? "hazirlik-2026-1"}`, `--x=${taze()}`, "--siniflar=TEST,DEMO"], 1);
    ret("aynı anahtar BAŞKA kid", ["kok", "--kid=kok-2099-2", `--x=${hazirlik?.x ?? ""}`, "--siniflar=URETIM"], 1);
    ret("hazırlık kökü ÜRETİM sınıfıyla", ["kok", "--kid=hazirlik-2099-1", `--x=${taze()}`, "--siniflar=TEST,URETIM"], 1);
    ret("biçimsiz kök kid'i (fikstür biçimi)", ["kok", "--kid=kok-fikstur-1", `--x=${taze()}`, "--siniflar=URETIM"], 1);
    ret("geçersiz açık anahtar (31 bayt)", ["kok", "--kid=kok-2099-3", `--x=${Buffer.alloc(31, 7).toString("base64url")}`, "--siniflar=URETIM"], 1);
    ret("tanınmayan sınıf", ["kok", "--kid=kok-2099-4", `--x=${taze()}`, "--siniflar=URETIM,YOK"], 1);
    ret("fikstür PAKET kid'i", ["paket", "--kid=paket-fikstur", `--x=${taze()}`], 1);
    ret("eksik argüman", ["kok", "--kid=kok-2099-5"], 64);
  }

  console.log("\n§6 bozuk başlangıç → BICIM, yazım yok — ✓K");
  const bozuk = (ad: string, yol: string, degis: (s: string) => string): void => {
    const kk = kopya();
    try {
      writeFileSync(path.join(kk, yol), degis(oku(kk, yol)));
      const once = anlik(kk);
      const r = kos(["kok", "--kid=kok-2099-6", `--x=${taze()}`, "--siniflar=URETIM", `--kok=${kk}`, "--yaz"]);
      check(`§6 ${ad} → çıkış 2, dosyalar aynı`, r === 2 && anlik(kk) === once, `çıkış ${r}`);
    } finally {
      rmSync(kk, { recursive: true, force: true });
    }
  };
  bozuk("TS kök bloğu elle yeniden biçimlenmiş", CAPA_DOSYALARI.kokTs, (s) => s.replace(/classes: Object\.freeze<LicenseClass\[\]>\(\[/, "classes:  Object.freeze<LicenseClass[]>(["));
  bozuk("satıcı aynası kaynaktan farklı", CAPA_DOSYALARI.kokAynalari[0]!, (s) => `${s}\n// fark\n`);
  bozuk("anchor.rs rustfmt dışı düzen (aynı öğeler)", CAPA_DOSYALARI.anchorRs, rustfmtDisiDuzen);
  bozuk("anchor.rs TS'ten farklı kök", CAPA_DOSYALARI.anchorRs, (s) => s.replace(/"(hazirlik-2026-1)", "[A-Za-z0-9_-]{43}"/, `"$1", "${taze()}"`));
}

/** Kök bloğunu AYNI öğelerle rustfmt'in seçmeyeceği düzene çevirir (dikeyse tek satır, değilse dikey). */
function rustfmtDisiDuzen(metin: string): string {
  return metin.replace(/^pub const BUILTIN_ROOTS: &\[\(&str, &str, &\[&str\]\)\] =[\s\S]*?\];$/m, (blok) => {
    const ogeler = [...blok.matchAll(RS_KOK_OGE)].map((m) => m[0]);
    const bas = "pub const BUILTIN_ROOTS: &[(&str, &str, &[&str])] =";
    return blok.includes("\n    (") ? `${bas} &[${ogeler.join(", ")}];` : `${bas} &[\n${ogeler.map((o) => `    ${o},`).join("\n")}\n];`;
  });
}

function rustfmtBul(): string | null {
  const ad = process.platform === "win32" ? "rustfmt.exe" : "rustfmt";
  const yollar = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".cargo", "bin")];
  const dizin = yollar.find((p) => p && existsSync(path.join(p, ad)));
  return dizin ? path.join(dizin, ad) : null;
}

function bolum7(): void {
  console.log("\n§7 anchor.rs düzeni = rustfmt");
  const rustfmt = rustfmtBul();
  const DUZENLER = 4;
  if (!rustfmt) {
    ATLAMA.atla("§7 rustfmt kıyası", "rustfmt yok (PATH · ~/.cargo/bin) — native commit kapısı `cargo fmt --check` ölçer", DUZENLER);
    return;
  }
  const kok = (kid: string): string => `(${JSON.stringify(kid)}, "${taze()}", &["URETIM", "DR", "BAYI", "BARINDIRILAN", "TEST", "DEMO"])`;
  const paket = (kid: string): string => `(${JSON.stringify(kid)}, "${taze()}")`;
  const duzenler: Array<[string, string, string[]]> = [
    ["tek satır", "pub const BUILTIN_PACKAGE_KEYS: &[(&str, &str)] =", [paket("paket-hazirlik")]],
    ["`=` sonrası tek satır", "pub const BUILTIN_PACKAGE_KEYS: &[(&str, &str)] =", [paket("paket-hazirlik"), paket("paket-2026")]],
    ["dikey", "pub const BUILTIN_ROOTS: &[(&str, &str, &[&str])] =", [kok("hazirlik-2026-1"), kok("kok-2026-1"), kok("kok-2027-1")]],
    // Tek satır 141 karakter: rustfmt `=` sonrasına iner (bugünkü anchor.rs) — genişlik eşiği tam sınırda ölçülür.
    ["sınır (tek satır 141 karakter)", "pub const BUILTIN_ROOTS: &[(&str, &str, &[&str])] =", ['("hazirlik-2026-1", "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo", &["TEST", "DEMO"])']],
  ];
  const ayar = path.join(DEPO, "Teks-Erp/native/lisans-cekirdek/rustfmt.toml");
  const gecici = mkdtempSync(path.join(os.tmpdir(), "guven-capasi-rs-"));
  try {
    for (const [ad, bas, ogeler] of duzenler) {
      const dosya = path.join(gecici, "anchor.rs");
      const metin = `${rsSabiti(bas, ogeler)}\n`;
      writeFileSync(dosya, metin);
      const r = spawnSync(rustfmt, ["--edition", "2021", "--check", "--config-path", ayar, dosya], { encoding: "utf8" });
      check(`§7 ${ad} düzeni rustfmt --check temiz (max_width ${RUSTFMT_GENISLIK})`, r.status === 0, r.status === 0 ? "" : (r.stdout || r.stderr).split("\n").slice(0, 4).join(" | "));
    }
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
}

function main(): void {
  const d = bolum0();
  if (d) {
    bolum1ile4();
    bolum5ile6(d);
  }
  bolum7();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
