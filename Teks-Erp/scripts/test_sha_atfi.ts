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

/** Tek `cat-file --batch-check` çağrısı — N süreç değil BİR süreç. */
function cozulemeyenler(shalar: string[]): Set<string> {
  if (shalar.length === 0) return new Set();
  const cikti = execFileSync("git", ["cat-file", "--batch-check"], {
    cwd: KOK,
    encoding: "utf8",
    input: shalar.map((s) => `${s}^{commit}`).join("\n") + "\n",
    maxBuffer: 16 * 1024 * 1024,
  });
  const olu = new Set<string>();
  for (const satir of cikti.trim().split("\n")) {
    const m = /^([0-9a-f]{7,12})\^\{commit\} (missing|ambiguous)/.exec(satir);
    if (m) olu.add(m[1]!);
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

  if (sigKlon()) {
    // Sığ klonda eski commit'ler YOKTUR — "çözülemedi" ile "ölü" ayrılamaz.
    ATLAMA.atla("§1 ⭐ sha atıfları çözülüyor", `SIĞ KLON — ${yerler.size} atıf doğrulanamaz`, yerler.size);
  } else {
    const olu = cozulemeyenler([...yerler.keys()]);
    check(
      "§1 ⭐ ağaçtaki her sha atfı BU depoda çözülüyor (ölü atıf yok)",
      olu.size === 0,
      olu.size === 0
        ? `${yerler.size} atıf, hepsi çözüldü`
        : `ÖLÜ ATIF (${olu.size}) — dal sha'sı olabilir, origin karşılığını yaz:\n      ` +
            [...olu].map((s) => `${s} ← ${yerler.get(s)!.join(" · ")}`).join("\n      "),
    );
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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
