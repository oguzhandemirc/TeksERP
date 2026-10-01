// =============================================================================
// BEKÇİ — SIR DOSYASI GİT'E GİRMESİN (BULGU-T1-053)
// Çalıştır: npx tsx scripts/test_env_not_tracked.ts
// =============================================================================
// `Teks-Erp/.env` git ile İZLENİYORDU: `.gitignore` onu listeliyordu ama dosya
// kural eklenmeden ÖNCE eklendiği için kural hiç işlemiyordu — **gitignore,
// zaten izlenen bir dosyayı izlemekten ÇIKARMAZ**. Sonuç: `JWT_SECRET` ve
// `DATABASE_URL` depo geçmişinde kaldı ve depoya okuma erişimi olan herkes
// `git show <commit>:Teks-Erp/.env` ile okuyabildi.
//
// ⚠️ Bu bekçi TEKRAR EKLENMESİNİ engeller; GEÇMİŞİ temizlemez. Asıl adım
// sahadaki sırrın DÖNDÜRÜLMESİDİR (rotasyon tüm canlı oturumları düşürür →
// vardiya dışında; yeni değer depoya YAZILMAZ).
//
// ⚠️ Neden `.gitignore` kontrolü YETMEZ: bu kusurun tamamı "gitignore doğru ama
// dosya yine de izleniyor" hâliydi. Tek doğru ölçüm `git ls-files`tir —
// NİYETİ değil GERÇEĞİ okur.
//
// §4 (G22) KÖK .gitignore KAPSAMI: sır/döküm kalıpları alt proje .gitignore'larına bırakılmaz — kök dosya
// TEK BAŞINA (geçici depoda, yalnız o dosyayla) örnek sır yollarını yoksaymalı, izlenen şablonları
// yoksaymamalı; worktree'de ana ağaca SEMBOLİK BAĞ olan `mobil/keystore` da eşlenmeli (sondaki `/` bağı
// eşlemez). Kalıcı sondalar her koşumda: kalıp sökülür → kırmızı · şablon yoksayılır → kırmızı.
// =============================================================================
import { git } from "./lib/git";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** İzlenmesi YASAK olan sır dosyası desenleri (depo köküne göre). */
const YASAK = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\./, // her `.env.*` (şablonlar SERBEST'te)
  /\.(pem|key|p8|p12|pfx|jks|keystore|tkenc|pepper|dump)$/,
  /(^|\/)keystore\//, // mobil imza anahtarları (mobil/CLAUDE.md: git DIŞINDA)
  /(^|\/)_?anahtarlar\//,
  /(^|\/)dump\//,
  /(^|\/)scripts\/out\//,
  /(^|\/)patron-vapid\.json$/,
  /^deploy\/.*\.env$/,
];
/** `.env` ile başlayan ama ŞABLON oldukları için serbest olanlar. */
const SERBEST = [/\.env\.example$/, /\.env\..*\.example$/, /\.env\.docker\.example$/, /(^|\/)\.env\.ornek$/, /^deploy\/(.*\/)?ornek[^/]*\.env$/];

/**
 * BİLİNÇLİ olarak commit edilen env dosyaları — yol → gerekçe.
 *
 * ⚠️ İzin "güveniyorum" DEĞİL, DOĞRULANMIŞ olmalı: §1b her izinli dosyayı açıp
 * sır görünümlü anahtar arar. Aksi hâlde bu liste, kapattığımız deliği
 * "istisna" adı altında yeniden açardı.
 */
const IZINLI: Record<string, string> = {
  "Electron/.env.production":
    "yalnız APP_ENV — sır yok; varsayılan sunucu adresi kanal kaydına taşındı (deploy/kanallar.json panel.erpAdresi, derleme anında gömülür), dosya bilerek commit'li (kendi başlığı gerekçeli)",
};

/** Sır GÖRÜNÜMLÜ anahtar adları — izinli dosyalarda bulunmaları YASAK. */
const SIR_ANAHTARLARI = /^(.*_)?(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE_KEY|API_KEY|JWT)(_.*)?\s*=/i;

function main(): void {
  const kok = join(__dirname, "../..");
  const cikti = git(["ls-files"], { cwd: kok });
  const izlenen = cikti.split("\n").filter(Boolean);

  // KÖRLÜK ZEMİNİ: `git ls-files` boş dönerse (yanlış cwd, git yok) aşağıdaki
  // kontrol "ihlal yok" der ve hiçbir şeye bakılmamış olur.
  check("§0: git dosya listesi okundu (körlük zemini)", izlenen.length > 500, `${izlenen.length} dosya`);

  const ihlal = izlenen.filter(
    (f) =>
      YASAK.some((r) => r.test(f)) &&
      !SERBEST.some((r) => r.test(f)) &&
      !(f in IZINLI),
  );
  check(
    "§1: izlenen SIR dosyası YOK (.env* / anahtar / döküm / keystore)",
    ihlal.length === 0,
    ihlal.join(", ") || `${izlenen.length} dosya tarandı, temiz`,
  );

  // ═══ §1b — İZİNLİ dosyalar gerçekten sırsız mı (izin ≠ güven) ═══
  const kirliIzin: string[] = [];
  const oluIzin: string[] = [];
  for (const [yol, gerekce] of Object.entries(IZINLI)) {
    if (!izlenen.includes(yol)) {
      oluIzin.push(yol); // artık izlenmiyor → izin bayat
      continue;
    }
    const src = require("fs").readFileSync(join(kok, yol), "utf8") as string;
    const supheli = src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && SIR_ANAHTARLARI.test(l));
    if (supheli.length > 0) kirliIzin.push(`${yol}: ${supheli.map((l) => l.split("=")[0]).join(",")}`);
    void gerekce;
  }
  check(
    "§1b: izinli env dosyalarında SIR görünümlü anahtar yok",
    kirliIzin.length === 0,
    kirliIzin.join(" | ") || `${Object.keys(IZINLI).length} izinli dosya doğrulandı`,
  );
  check("§1c: ölü izin yok (izinli dosya hâlâ izleniyor)", oluIzin.length === 0, oluIzin.join(", ") || "izin listesi güncel");

  bolum4(kok, izlenen);

  // ⚠️ Şablonun VARLIĞI de sözleşmenin parçası: `.env` izlenmiyorsa yeni bir
  // geliştirici hangi anahtarların gerektiğini başka nereden öğrenecek?
  const ornek = join(__dirname, "../.env.example");
  check("§2: `.env.example` şablonu var", existsSync(ornek), ornek);

  // Şablon SIR TAŞIMAMALI — örnek dosyaya gerçek değer yazmak, kapattığımız
  // deliği aynı yerden yeniden açar.
  if (existsSync(ornek)) {
    const src = require("fs").readFileSync(ornek, "utf8") as string;
    const supheli = src
      .split("\n")
      .filter((l) => /^(JWT_SECRET|DATABASE_URL)\s*=/.test(l.trim()))
      .filter((l) => !/BURAYA|KULLANICI|<|xxx|example|degistir/i.test(l));
    check(
      "§3: şablonda GERÇEK sır yok (yer tutucu kullanılmış)",
      supheli.length === 0,
      supheli.join(" | ") || "yalnız yer tutucu",
    );
  }
}

// ═══ §4 — KÖK .gitignore tek başına sır/döküm yollarını yoksayar, şablonları yoksaymaz (G22) ═══

/** Kök .gitignore'un TEK BAŞINA yoksayması gereken örnek yollar (dosya var olmak zorunda değil). */
const YOKSAYILMALI = [
  ".env", "Teks-Erp/.env", "deploy/.env", "deploy/satici/uretim.env", "deploy/patron/uretim.env", "satici/web/.env",
  "Electron/.env.production.local", "Teks-Erp/.env.bak-20260930", "Electron/sertifika.pfx", "satici/sunucu/anahtar/kok.pem",
  "satici/sunucu/baska-anahtarlar-dizini/modul-kasasi.key", "satici/sunucu/anahtarlar/x.json", "x/etkinlestirme-kodu.pepper",
  "patron/sunucu/patron-vapid.json", "mobil/credentials.json", "mobil/x.jks", "mobil/keystore/tekserp-release.keystore",
  "Teks-Erp/lisans/kurulum.json", "Teks-Erp/dump/tekserp_yeni_20260923.dump", "Teks-Erp/dump/a.sql", "Teks-Erp/scripts/out/cari.csv",
  "yedek/tekserp_20261001.dump.tkenc", "_anahtarlar/kok.key",
];
/** Sembolik bağ olarak kurulup ölçülen yol: worktree'de `mobil/keystore` ana ağaca bağdır. */
const SEMBOLIK_BAG = "mobil/keystore";

interface Kapsam { kacan: string[]; yanlis: string[]; olculemedi: string | null }

/** Ölçüm için her zaman yoksayılan yol: toplu `check-ignore` hiçbir yol eşleşmese de çıkış 1 vermesin (çıkış ≠ 0 = ÖLÇÜLEMEDİ). */
const NOBET = "__olcum_nobetcisi__";

/** Toplu `git check-ignore -v -n`: yol → yoksayılıyor mu (eşleşen son kalıp `!` ile başlıyorsa yoksayılmaz). */
function yoksayilanlar(d: string, yollar: readonly string[]): Map<string, boolean> {
  const cikti = git(["check-ignore", "--no-index", "-v", "-n", "--", ...yollar, NOBET], { cwd: d, stdio: "yut" });
  const m = new Map<string, boolean>();
  for (const satir of cikti.split("\n").filter(Boolean)) {
    const [kaynak, yol] = satir.split("\t");
    const kalip = kaynak.split(":").slice(2).join(":");
    m.set(yol, kalip !== "" && !kalip.startsWith("!"));
  }
  return m;
}

/** Geçici depoda YALNIZ verilen kök .gitignore ile: hangi sır yolu kaçıyor, hangi şablon yanlışlıkla yoksayılıyor. */
function kokKapsami(gitignore: string, sablonlar: readonly string[]): Kapsam {
  const d = mkdtempSync(join(tmpdir(), "kok-gitignore-"));
  try {
    git(["init", "-q"], { cwd: d, stdio: "yut" });
    writeFileSync(join(d, ".gitignore"), `${gitignore}\n/${NOBET}\n`);
    for (const y of sablonlar) {
      mkdirSync(dirname(join(d, y)), { recursive: true });
      writeFileSync(join(d, y), "");
    }
    const ilk = yoksayilanlar(d, [...YOKSAYILMALI, ...sablonlar]);
    // Sembolik bağ ayrı ölçülür (bağın ötesindeki yol git'te sorgulanamaz): bağ dizin DEĞİLDİR, sondaki `/` onu eşlemez.
    mkdirSync(join(d, "mobil"), { recursive: true });
    mkdirSync(join(d, "hedef-keystore"), { recursive: true });
    symlinkSync("../hedef-keystore", join(d, SEMBOLIK_BAG));
    const bag = yoksayilanlar(d, [SEMBOLIK_BAG]);
    const hepsi = new Map([...ilk, ...bag]);
    const eksik = [...YOKSAYILMALI, ...sablonlar, SEMBOLIK_BAG].filter((y) => !hepsi.has(y));
    if (eksik.length || hepsi.get(NOBET) !== true) return { kacan: [], yanlis: [], olculemedi: `check-ignore çıktısı eksik: ${eksik.join(", ") || NOBET}` };
    return {
      kacan: [...YOKSAYILMALI, SEMBOLIK_BAG].filter((y) => !hepsi.get(y)),
      yanlis: sablonlar.filter((y) => hepsi.get(y)),
      olculemedi: null,
    };
  } catch (e) {
    return { kacan: [], yanlis: [], olculemedi: (e as Error).message };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

function bolum4(kok: string, izlenen: string[]): void {
  const gitignore = readFileSync(join(kok, ".gitignore"), "utf8");
  // İzlenen her env/şablon dosyası ve izinli dosya: kök .gitignore onları YOKSAYMAMALI (yoksa yeni şablon commit'lenmez).
  const sablonlar = izlenen.filter((f) => /(^|\/)\.env|(^|\/)ornek[^/]*\.env$/.test(f));
  check("§4 körlük zemini: izlenen şablon/izinli env dosyaları bulundu", sablonlar.length >= 5, sablonlar.join(", "));
  const k = kokKapsami(gitignore, sablonlar);
  check("§4a ⭐ kök .gitignore TEK BAŞINA her sır/döküm yolunu yoksayar (sembolik bağ mobil/keystore dahil)",
    k.olculemedi === null && k.kacan.length === 0, k.olculemedi ?? (k.kacan.join(", ") || `${YOKSAYILMALI.length + 1} yol`));
  check("§4b kök .gitignore izlenen şablonları YOKSAYMAZ (iki yönlü)", k.olculemedi === null && k.yanlis.length === 0,
    k.olculemedi ?? (k.yanlis.join(", ") || `${sablonlar.length} şablon`));
  // Gerçek depoda izlenip AYNI ZAMANDA yoksayılan dosya yok (kalıp izleneni gölgelemez).
  const golge = git(["ls-files", "-ci", "--exclude-standard"], { cwd: kok }).split("\n").filter(Boolean);
  check("§4c izlenen hiçbir dosya .gitignore kalıbına takılmıyor", golge.length === 0, golge.join(", ") || "temiz");

  // KALICI SONDALAR — bellekteki kopyaya karşı; mutasyonun UYGULANDIĞI da ölçülür.
  const sondalar: Array<[string, string, (x: Kapsam) => boolean]> = [
    ["*.pfx kalıbı söküldü → sertifika kaçar", gitignore.replace(/^\*\.pfx$/m, ""), (x) => x.kacan.includes("Electron/sertifika.pfx")],
    ["/mobil/keystore sonuna eğik çizgi → sembolik bağ kaçar", gitignore.replace(/^\/mobil\/keystore$/m, "/mobil/keystore/"), (x) => x.kacan.includes(SEMBOLIK_BAG)],
    ["deploy/**/*.env söküldü → üretim env kaçar", gitignore.replace(/^deploy\/\*\*\/\*\.env$/m, ""), (x) => x.kacan.includes("deploy/satici/uretim.env")],
    ["!**/.env.ornek söküldü → şablon yanlışlıkla yoksayılır", gitignore.replace(/^!\*\*\/\.env\.ornek$/m, ""), (x) => x.yanlis.some((y) => y.endsWith(".env.ornek"))],
  ];
  for (const [ad, metin, kirmiziMi] of sondalar) {
    const uygulandi = metin !== gitignore;
    const x = uygulandi ? kokKapsami(metin, sablonlar) : { kacan: [], yanlis: [], olculemedi: null };
    check(`§4d sonda: ${ad} → kırmızı`, uygulandi && x.olculemedi === null && kirmiziMi(x), uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

try {
  main();
} catch (e) {
  console.error("Beklenmeyen hata:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
