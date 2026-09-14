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
// =============================================================================
import { execFileSync } from "child_process";
import { git } from "./lib/git";
import { existsSync } from "fs";
import { join } from "path";

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
  /(^|\/)\.env\.local$/,
  /(^|\/)\.env\.production$/,
  /(^|\/)\.env\.bak/,
  /(^|\/)\.env\.backup/,
  /\.pem$/,
  /(^|\/)keystore\//, // mobil imza anahtarları (mobil/CLAUDE.md: git DIŞINDA)
];
/** `.env` ile başlayan ama ŞABLON oldukları için serbest olanlar. */
const SERBEST = [/\.env\.example$/, /\.env\..*\.example$/, /\.env\.docker\.example$/];

/**
 * BİLİNÇLİ olarak commit edilen env dosyaları — yol → gerekçe.
 *
 * ⚠️ İzin "güveniyorum" DEĞİL, DOĞRULANMIŞ olmalı: §1b her izinli dosyayı açıp
 * sır görünümlü anahtar arar. Aksi hâlde bu liste, kapattığımız deliği
 * "istisna" adı altında yeniden açardı.
 */
const IZINLI: Record<string, string> = {
  "Electron/.env.production":
    "yalnız VITE_API_BASE_URL (LAN adresi) + APP_ENV — sır yok; derlemeyi kim yaparsa yapsın fabrika adresi aynı gitsin diye bilerek commit'li (dosyanın kendi başlığı gerekçeli)",
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
    "§1: izlenen SIR dosyası YOK (.env / .pem / keystore)",
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

try {
  main();
} catch (e) {
  console.error("Beklenmeyen hata:", e);
  fail++;
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
