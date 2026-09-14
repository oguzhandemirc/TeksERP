// =============================================================================
// BEKÇİ — SHA ATIFLARI ÇÖZÜLÜYOR MU (ölü atıf = okuyucunun bulamayacağı kanıt)
// Çalıştır: npx tsx scripts/run-all-tests.ts sha_atfi
// =============================================================================
// NEDEN: bu repoda oturumlar izole dallarda commit atıyor ve entegratör CHERRY-PICK
// ediyor ⇒ oturumun gördüğü sha, origin'de BAŞKA bir sha olur. Ağaca yazılan atıf
// dalın sha'sıysa okuyucu onu HİÇBİR ZAMAN bulamaz — kanıt görünüşte var, gerçekte yok.
// Ölçüldü 2026-09-14: kendi iki atıfım (`test_defter_ters_yol` §10c3 · `lib/silme-bagi`
// başlığı) tam olarak buydu; tesadüfen fark edildi, kapısı yoktu.
//
// ⚠️ KAPSAM BEYANI — ölçülen şey ATIF BAĞLAMINDAKİ sha'dır:
//   · BACKTICK içinde, kelime sınırlı, 7–12 hane, en az bir a–f harfi taşıyan hex.
//     "en az bir harf" koşulu TARİH/SAYI'yı eler (`20260914` sekiz hanelik geçerli
//     hex'tir); 40 hanelik sağlama ve 36 karakterlik UUID sınır kuralıyla dışarıda.
//   · `docs/history/` KAPSAM DIŞI: arşiv donmuş belgedir, tarihî (bugün ölü) sha
//     taşıması KUSUR DEĞİLDİR (ölçüldü 2026-09-14: arşivde 66 çözülemeyen atıf).
// ⚠️ KÖR NOKTA, BİLEREK: backtick'siz yazılmış bir sha ÖLÇÜLMEZ. Bu, ölçtüğüm kendi
//   vakamın YARISIDIR (iki atıfımdan biri backtick'sizdi). Sözcük tetiği ("commit"
//   geçen satır) denendi ve REDDEDİLDİ: bu depoda "commit" çoğunlukla TX commit'idir
//   ve ölçüm bir fikstür barkodunu ölü sha sandı. Dar ve doğru, geniş ve yanlıştan
//   iyidir; kör nokta kapatılacaksa yazım kuralı (sha daima backtick içinde) ayrı
//   bir kolla ölçülür.
//
// ÜÇ SONUÇ: git yok → ⏭ · SIĞ KLON → ⏭ sayıyla (eski sha'lar orada YOK, sert kol
// yanlış kırmızı verirdi) · derin klon → SERT.
//
// DB GEREKTİRMEZ.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

/** ⚠️ CIRCIR TABANI — oturum DOKUNMAZ, entegratör trende ölçüp düşürür. */
const OLU_TABAN = 0;

/** Beyanlı muafiyet: gerçekten sha OLMAYAN ama kalıba uyan literaller. BOŞ DOĞAR. */
const MUAF: Record<string, string> = {};

/** Backtick içinde, atıf bağlamındaki sha adayları. SAF — girdi metin, çıktı aday. */
export function shaAdaylari(kaynak: string): Array<{ sha: string; satir: number }> {
  const out: Array<{ sha: string; satir: number }> = [];
  kaynak.split("\n").forEach((satir, i) => {
    for (const m of satir.matchAll(/`([0-9a-f]{7,12})`/g)) {
      const sha = m[1]!;
      // ⚠️ EN AZ BİR HARF: `20260914` gibi tarihler geçerli hex'tir ve atıf değildir.
      if (!/[a-f]/.test(sha)) continue;
      out.push({ sha, satir: i + 1 });
    }
  });
  return out;
}

function gitVar(): boolean {
  try { execFileSync("git", ["rev-parse", "--git-dir"], { cwd: KOK, stdio: "ignore" }); return true; }
  catch { return false; }
}
function sigKlon(): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: KOK, encoding: "utf8" }).trim() === "true";
  } catch { return true; }
}

/**
 * PAYLAŞILAN TARİH — atıfın çözülmesi gereken yer.
 *
 * ⚠️ ÖLÇÜM REJİME BAĞLIYDI VE İLK YAZIMDA YANILDIM (2026-09-14): `git cat-file`
 * YEREL nesne veritabanına bakar. Bu makinede her oturumun dalı duruyor ⇒ 240
 * atıfın hepsi "çözüldü" göründü. CI'da yalnız origin tarihi var ⇒ aynı ağaç 29
 * ÖLÜ atıf verdi. Doğru soru "bu nesne BENDE var mı" değil, ***"OKUYUCUNUN
 * göreceği tarihte var mı"***dır ⇒ ölçüt `origin/main`den ERİŞİLEBİLİRLİK.
 * Böylece yerel ile CI aynı cevabı verir.
 */
function paylasilanTarih(): { ad: string; shalar: Map<string, string[]> } | null {
  for (const ref of ["origin/main", "main", "HEAD"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: KOK, stdio: "ignore" });
      const cikti = execFileSync("git", ["rev-list", ref], { cwd: KOK, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      // Kısa atıfı bulmak için ilk 7 haneye göre dizinle (240 × 30k karşılaştırma yerine).
      const dizin = new Map<string, string[]>();
      for (const tam of cikti.split("\n")) {
        if (tam.length < 40) continue;
        const anahtar = tam.slice(0, 7);
        const liste = dizin.get(anahtar);
        if (liste) liste.push(tam);
        else dizin.set(anahtar, [tam]);
      }
      return { ad: ref, shalar: dizin };
    } catch {
      /* sıradaki ref */
    }
  }
  return null;
}

/** Paylaşılan tarihte KARŞILIĞI OLMAYAN atıflar. SAF — girdi dizin + adaylar. */
export function cozulemeyenler(dizin: Map<string, string[]>, shalar: string[]): Set<string> {
  const olu = new Set<string>();
  for (const kisa of shalar) {
    const adaylar = dizin.get(kisa.slice(0, 7)) ?? [];
    if (!adaylar.some((tam) => tam.startsWith(kisa))) olu.add(kisa);
  }
  return olu;
}

function main(): void {
  console.log("=== SHA ATIFLARI ===\n");
  if (!gitVar()) {
    ATLAMA.atla("§1 sha çözümü", "git deposu yok — atıflar çözülemez", "?");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    process.exit(fail > 0 ? 1 : 0);
  }
  // ⚠️ `--cached --others --exclude-standard`: HENÜZ TAKİP EDİLMEYEN yeni belge de
  // taranır. Düz `ls-files` yalnız indeksi görür ve yeni yazılmış bir dosyadaki ölü
  // atıf, o dosya sahnelenene kadar GÖRÜNMEZ olurdu (sonda bunu bir kez yaşadı).
  const dosyalar = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "Teks-Erp/scripts", "Teks-Erp/docs", "docs"], {
    cwd: KOK, encoding: "utf8",
  })
    .trim().split("\n")
    .filter((f) => /\.(ts|md|mjs)$/.test(f) && !f.startsWith("docs/history/"));

  const yerler = new Map<string, string[]>();
  for (const f of dosyalar) {
    for (const a of shaAdaylari(readFileSync(join(KOK, f), "utf8"))) {
      if (a.sha in MUAF) continue;
      if (!yerler.has(a.sha)) yerler.set(a.sha, []);
      yerler.get(a.sha)!.push(`${f}:${a.satir}`);
    }
  }
  check("§0 körlük zemini: kapsam dolu", dosyalar.length > 100 && yerler.size > 20,
    `${dosyalar.length} dosya · ${yerler.size} benzersiz sha atfı`);

  const tarih = paylasilanTarih();
  if (sigKlon() || !tarih) {
    // Sığ klonda eski commit'ler YOKTUR — "çözülemedi" ile "ölü" ayrılamaz.
    ATLAMA.atla("§1 ⭐ sha atıfları çözülüyor", `SIĞ KLON / ref yok — ${yerler.size} atıf doğrulanamaz`, yerler.size);
  } else {
    const olu = cozulemeyenler(tarih.shalar, [...yerler.keys()]);
    // ⚠️ CIRCIR, taban 0 DEĞİL: ölçüldüğünde (2026-09-14) 29 ölü atıf vardı ve hepsi BAŞKA
    // oturumların dal sha'sı (cherry-pick sonrası origin'de başka sha). Borç
    // sahiplerine dağıtılıyor; kapı bugünden sonra ARTIŞI durdurur.
    check(
      `§1 ⭐ ölü sha atfı ARTMADI (paylaşılan tarih: ${tarih.ad})`,
      olu.size <= OLU_TABAN,
      olu.size <= OLU_TABAN
        ? `${olu.size} ≤ ${OLU_TABAN} · ${yerler.size} atıf tarandı`
        : `${olu.size} > ${OLU_TABAN} ⇒ YENİ ölü atıf:\n      ` +
            [...olu].map((s) => `${s} ← ${yerler.get(s)!.join(" · ")}`).join("\n      "),
    );
    curumeKolu(check, ATLAMA.atla, "§1c ⭐ ölü atıf tabanı ÇÜRÜMEDİ", olu.size, OLU_TABAN);
    if (olu.size > 0) {
      console.log(`   ⓘ duran borç (${olu.size}) — okuyucunun bulamayacağı atıflar:`);
      for (const x of olu) console.log(`      • ${x} ← ${yerler.get(x)!.join(" · ")}`);
    }
  }
  const oluMuaf = Object.keys(MUAF).filter((s) => !yerler.has(s));
  check("§1b muafiyet listesinde ölü satır yok", oluMuaf.length === 0, oluMuaf.join(", "));

  console.log("\n=== §2 SONDALAR (saf yüklem) ===");
  check("§2a ⭐ backtickli sha aday", shaAdaylari("bkz `cb4c8ac8` satırı").length === 1);
  check("§2b ⭐ backtick YOKSA aday DEĞİL (beyan edilmiş kör nokta)", shaAdaylari("bkz cb4c8ac8 satırı").length === 0);
  check("§2c ⭐ saf rakam aday DEĞİL (`20260914` tarihtir, hex değil)", shaAdaylari("`20260914`").length === 0);
  check("§2d ⭐ 40 hane aday DEĞİL (sağlama)", shaAdaylari("`" + "a".repeat(40) + "`").length === 0);
  check("§2e ⭐ 6 hane aday DEĞİL (CSS rengi sınırın altında)", shaAdaylari("`a3a3a3`").length === 0);
  check("§2f satır numarası doğru", shaAdaylari("x\ny `cb4c8ac8`").at(0)?.satir === 2);
  check("§2g aynı satırda iki atıf da sayılır", shaAdaylari("`cb4c8ac8` → `75df651b`").length === 2);
  // ⭐ ASIL AYRIM: "bende var" ile "paylaşılan tarihte var" AYNI ŞEY DEĞİLDİR.
  {
    const dizin = new Map<string, string[]>([["abc1234", ["abc1234" + "0".repeat(33)]]]);
    check("§2h ⭐ paylaşılan tarihte olan atıf ÖLÜ DEĞİL", cozulemeyenler(dizin, ["abc1234"]).size === 0);
    check("§2i ⭐ paylaşılan tarihte OLMAYAN atıf ÖLÜ (dal sha'sı sınıfı)", cozulemeyenler(dizin, ["dead123"]).size === 1);
    check("§2j kısa atıf uzun sha'nın ÖNEKİ olarak eşleşir", cozulemeyenler(dizin, ["abc12340"]).size === 0);
    check("§2k önek TUTMUYORSA ölü (7 hane aynı, sekizinci farklı)", cozulemeyenler(dizin, ["abc1234f"]).size === 1);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
