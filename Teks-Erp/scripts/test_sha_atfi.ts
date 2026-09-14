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
// ⚠️ ESKİ KÖR NOKTA — 2026-09-14'te İKİNCİ KOLLA KAPANDI (§3). Kapı önce yalnız
//   backtick içini sayıyordu; 5e aynı ağaçta 80 ÇIPLAK aday ölçtü, 65'i origin'de
//   çözülüyordu ve 10'u GERÇEK ÖLÜ atıftı ⇒ ***beyanlı bir kör nokta, sıfırlanmış bir
//   tabanı yalanlar: taban ağacın değil KAPININ GÖRDÜĞÜNÜN sayısıdır.*** Bu yüzden
//   §1'in cümlesi de daraldı — "ölü atıf yok" değil, "BACKTICK'Lİ atıflarda ölü yok".
//   Sözcük tetiği ("commit" geçen satır) hâlâ REDDEDİLMİŞTİR (bu depoda "commit"
//   çoğunlukla TX commit'i); ikinci kol tetik değil SINIFLANDIRMA kullanır (§3).
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

/**
 * ⚠️ CIRCIR TABANI — oturum DOKUNMAZ, entegratör trende ölçüp düşürür.
 * KAPSAM: yalnız BACKTICK'Lİ atıflar. "0" = *backtick'li atıflarda ölü yok*, ağaçta
 * ölü atıf yok DEĞİL — çıplak yazılmışların tabanı ayrı (`CIPLAK_OLU_TABAN`).
 */
const OLU_TABAN = 0;

/**
 * ⚠️ İKİNCİ KOL TABANI — ÇIPLAK (backtick'siz) ölü atıf. Oturum DOKUNMAZ.
 * Ölçüldü 2026-09-14 (ağaç `129c4a0f`): 80 çıplak aday · 65 çözülüyor (yazım ihlali,
 * ölü değil) · 15'i sınıflandı (10 SAGLAMA · 4 FİKSTÜR · 1 kanonik ad) ⇒ ölü 0.
 * 5e'nin ölçtüğü 10 gerçek ölü atıf, aynı günün treninde origin karşılığına çevrildi.
 */
const CIPLAK_OLU_TABAN = 0;

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

/**
 * ÇIPLAK (backtick'siz) sha adayları — İKİNCİ KOL. SAF.
 *
 * ⚠️ SINIR `-` DE İÇERİR: UUID parçası hex'tir (`3f2504e0-4f89-…`) ve tireyi sınır
 * saymayan bir kalıp fikstür UUID'lerinin her dilimini "ölü sha" sanar (ölçüldü
 * 2026-09-14: 100 aday → 80; 20 fark tamamen UUID dilimiydi). Aynı gerekçeyle `/`
 * (yol parçası) da sınır değildir.
 */
export function ciplakAdaylari(kaynak: string): Array<{ sha: string; satir: number; metin: string; sutun: number }> {
  const out: Array<{ sha: string; satir: number; metin: string; sutun: number }> = [];
  kaynak.split("\n").forEach((ham, i) => {
    // Backtick span'i MASKELENİR (uzunluk korunur): orası birinci kolun alanı.
    const maske = ham.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    for (const m of maske.matchAll(/(?<![0-9a-zA-Z_/-])([0-9a-f]{7,12})(?![0-9a-zA-Z_/-])/g)) {
      const sha = m[1]!;
      if (!/[a-f]/.test(sha)) continue;             // `20260914` tarihtir
      out.push({ sha, satir: i + 1, metin: ham, sutun: m.index! });
    }
  });
  return out;
}

/**
 * ÇIPLAK ADAYIN SINIFI — kova, MUAF LİSTESİ DEĞİL. Üçü de YAPISAL ölçüttür; hiçbiri
 * elle tutulan bir sha listesine bakmaz (liste bakım borcudur, ölçüt değil).
 *
 *   SAGLAMA — hemen ardında `…`/`...`: sha256/md5 ÖRNEĞİ. Yazım kuralı bunları
 *             backtick'e ALMAZ (alınsaydı birinci kol onları ölü atıf sanardı).
 *   FIKSTUR — kod dosyasında TIRNAK İÇİNDE: sondanın girdisi (`"abc1234"`,
 *             `"dead123"`). Gerçek atıf koda yorumda ya da backtick'le yazılır.
 *   ATIF    — kalanı. Çözülüyorsa YAZIM İHLALİ (gerçek sha, çıplak yazılmış),
 *             çözülmüyorsa ÖLÜ.
 *
 * ⚠️ Dördüncü bir kova AÇILMADI: sha olmayan hex-benzeri teknik ad (`Ed25519`)
 * KANONİK BÜYÜK HARFİYLE yazılır ve kalıba hiç uymaz — kovaya değil YAZIM kuralına
 * bağlıdır. Kova açmak, tek üyeli bir muaf listesi açmaktır.
 */
export type CiplakSinif = "SAGLAMA" | "FIKSTUR" | "ATIF";
export function ciplakSinif(aday: { sha: string; metin: string; sutun: number }, dosya: string): CiplakSinif {
  const kalan = aday.metin.slice(aday.sutun + aday.sha.length);
  if (/^(…|\.\.\.)/.test(kalan)) return "SAGLAMA";
  if (/\.(ts|mjs)$/.test(dosya)) {
    const onces = aday.metin.slice(0, aday.sutun);
    // Tırnak İÇİNDE mi: adaydan önce TEK sayıda tırnak açılmışsa evet.
    for (const t of ['"', "'"]) {
      if ((onces.split(t).length - 1) % 2 === 1) return "FIKSTUR";
    }
  }
  return "ATIF";
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

  // ── §3 İKİNCİ KOL — ÇIPLAK (backtick'siz) atıflar ──────────────────────────
  console.log("\n=== §3 ÇIPLAK ATIFLAR (eski kör nokta) ===");
  const ciplak = new Map<string, { sinif: CiplakSinif; yerler: string[] }>();
  for (const f of dosyalar) {
    for (const a of ciplakAdaylari(readFileSync(join(KOK, f), "utf8"))) {
      const sinif = ciplakSinif(a, f);
      // Aynı sha iki sınıfta görünürse ATIF KAZANIR: sınıflandırma SUSTURUR ve bir kez
      // susturulan sha başka yerde ölü olsa da görünmez kalırdı.
      const v = ciplak.get(a.sha);
      if (v) { if (sinif === "ATIF") v.sinif = "ATIF"; v.yerler.push(`${f}:${a.satir}`); }
      else ciplak.set(a.sha, { sinif, yerler: [`${f}:${a.satir}`] });
    }
  }
  const sayim = (k: CiplakSinif): number => [...ciplak.values()].filter((v) => v.sinif === k).length;
  check("§3a körlük zemini: çıplak kapsam dolu", ciplak.size > 20,
    `${ciplak.size} benzersiz çıplak aday · ATIF ${sayim("ATIF")} · SAGLAMA ${sayim("SAGLAMA")} · FİKSTÜR ${sayim("FIKSTUR")}`);

  const atiflar = [...ciplak.entries()].filter(([, v]) => v.sinif === "ATIF");
  if (sigKlon() || !tarih) {
    // ÜÇÜNCÜ SONUÇ: rejim ölçemiyor. "Ölü yok" ile "bakamadım" AYNI ÇIKTIYA İNMEZ.
    ATLAMA.atla("§3b ⭐ çıplak ölü atıf", `SIĞ KLON / ref yok — ${atiflar.length} çıplak atıf ÖLÇÜLEMEDİ`, atiflar.length);
  } else {
    const ciplakOlu = cozulemeyenler(tarih.shalar, atiflar.map(([sha]) => sha));
    check(
      `§3b ⭐ çıplak ölü atıf ARTMADI (paylaşılan tarih: ${tarih.ad})`,
      ciplakOlu.size <= CIPLAK_OLU_TABAN,
      ciplakOlu.size <= CIPLAK_OLU_TABAN
        ? `${ciplakOlu.size} ≤ ${CIPLAK_OLU_TABAN} · ${atiflar.length} çıplak atıf tarandı`
        : `${ciplakOlu.size} > ${CIPLAK_OLU_TABAN} ⇒ YENİ çıplak ölü atıf:\n      ` +
            [...ciplakOlu].map((x) => `${x} ← ${ciplak.get(x)!.yerler.join(" · ")}`).join("\n      "),
    );
    curumeKolu(check, ATLAMA.atla, "§3c ⭐ çıplak ölü atıf tabanı ÇÜRÜMEDİ", ciplakOlu.size, CIPLAK_OLU_TABAN);
    if (ciplakOlu.size > 0) {
      console.log(`   ⓘ duran borç (${ciplakOlu.size}) — çıplak ölü atıflar:`);
      for (const x of ciplakOlu) console.log(`      • ${x} ← ${ciplak.get(x)!.yerler.join(" · ")}`);
    }
    // YAZIM İHLALİ: gerçek sha, çıplak yazılmış. Ölü DEĞİL ⇒ kırmızı değil; sayısı
    // GÖRÜNÜR kalır — yazım kuralı bu sayıyı ileriye doğru 0'a taşır, geçmişi geri
    // yazmaz. (Cırcıra çevrilmesi 1e kalemi: taban sabitine oturum dokunmaz.)
    console.log(`   ⓘ yazım ihlali (${atiflar.length - ciplakOlu.size}) — origin'de ÇÖZÜLEN ama backtick'siz yazılmış sha (ölü değil, okunaksız)`);
  }

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

  console.log("\n=== §4 İKİNCİ KOL SONDALARI (saf yüklem) ===");
  const A = (metin: string) => ciplakAdaylari(metin);
  check("§4a ⭐ çıplak sha ADAYDIR (birinci kolun görmediği)", A("bkz 5527c345 satırı").length === 1);
  check("§4b ⭐ backtick içi çıplak kolda SAYILMAZ (maskeleme)", A("bkz `5527c345` satırı").length === 0);
  check("§4c ⭐ UUID dilimi aday DEĞİL (tire SINIRDIR)", A('id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301"').length === 0);
  check("§4d yol parçası aday DEĞİL (`/` sınırdır)", A("dump/3f2504e0/x").length === 0);
  check("§4e saf rakam aday DEĞİL", A("bkz 20260914 tarihi").length === 0);
  {
    const sag = A("// ham sha256: 7d6d87f1… ≠ 72228d6c…")[0]!;
    check("§4f ⭐ `…` ardılı SAGLAMA (sha256 örneği, backtick'e ALINMAZ)", ciplakSinif(sag, "x.ts") === "SAGLAMA");
    const fik = A('check("§2i ölü", cozulemeyenler(d, ["dead123"]).size === 1);')[0]!;
    check("§4g ⭐ kodda TIRNAK İÇİ FİKSTÜR (sondanın girdisi)", ciplakSinif(fik, "scripts/test_x.ts") === "FIKSTUR");
    check("§4h ⭐ aynı literal BELGEDE fikstür değil ATIF (tırnak ölçütü koda özgü)",
      ciplakSinif(fik, "docs/kurallar/defter.md") === "ATIF");
    const atf = A("// geri alma yolu 5527c345 ile indi")[0]!;
    check("§4i ⭐ yorumdaki çıplak sha ATIF (kova değil)", ciplakSinif(atf, "scripts/test_x.ts") === "ATIF");
    check("§4j kanonik ad kalıba UYMAZ (`Ed25519` büyük harf — kova değil yazım kuralı)",
      A("dosyada yalnız Ed25519 varken").length === 0);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
