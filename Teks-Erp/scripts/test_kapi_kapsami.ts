// =============================================================================
// BEKÇİ — TİP KAPISININ KAPSAMI SIFIR OLAMAZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts kapi_kapsami
//
// ⭐ NEDEN VAR (2026-09-13): bir oturum Electron'da `npx tsc --noEmit` koştu, **RC 0**
//    aldı ve ilerledi. Oysa bir export kaldırılmıştı ve ÜÇ SAYFA hâlâ onu import
//    ediyordu. Komut yalan söylemedi — **HİÇ BAKMADI**: kök `tsconfig.json`
//    `files: []` + `references` taşıyor ve `-b` olmadan referanslara girilmez.
//
//    ÖLÇÜLDÜ (kök dosya sayısı, `--showConfig`; aynı sayılar `--listFilesOnly`
//    ile de doğrulandı):
//      Electron  KÖK tsconfig.json (çıplak `tsc`) →      0 DOSYA
//      Electron  gerçek kapı: node 26 + web 1.407 →  1.433 dosya
//      Teks-Erp  tsconfig.json 486 · tsconfig.scripts.json 1.133
//      mobil     tsconfig.json 403
//
// ⚠️ ÖLÇÜMÜN İLK HÂLİ YANLIŞ SORUYU SORUYORDU: üç projede iki komutun ÇIKIŞ KODUNU
//    karşılaştırdım, üçü de RC 0 ve "ayrışmıyor" çıktı. O ölçüm hiçbir şey
//    söylemiyordu — **iki aracın aynı cevabı vermesi, aynı soruyu sorduklarını
//    göstermez.** Soru SONUÇTAN KAPSAMA taşınınca fark ortaya çıktı.
//
// ⚠️ EŞİK SIFIR, "makul bir taban" DEĞİL: *sıfır* yanlışlanabilir bir iddiadır,
//    *"en az 50"* bir tahmindir. Kapsamın daralmasını ölçen ayrı bir tavan
//    (`check-lint-baseline`in `EN_AZ_DOSYA`ı) zaten lint tarafında var; bu, onun
//    tsc tarafındaki eşi ve BİLEREK yalnız sıfırı kovalar.
//
// ⚠️ CONFIG LİSTESİ ELLE YAZILMAZ, `package.json`DAN TÜRETİLİR. Kök sebep zaten
//    "kapı komutunu kendin uydurma"ydı; burada ikinci bir liste tutmak aynı hatayı
//    bekçinin içine kopyalamak olurdu. Script değişirse bekçi onu İZLER.
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { atlamaDefteri } from "./lib/atlama";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
const PROJELER = ["Teks-Erp", "Electron", "mobil"] as const;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

/** `package.json > scripts` içindeki tip kapılarından `-p <config>` hedeflerini çıkarır. */
function kapiConfigleri(proje: string): string[] {
  const pkg = JSON.parse(readFileSync(join(KOK, proje, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const konu = Object.entries(pkg.scripts ?? {}).filter(([ad]) => /^typecheck/.test(ad));
  const out = new Set<string>();
  for (const [, cmd] of konu) {
    const p = [...cmd.matchAll(/-p\s+(\S+)/g)].map((m) => m[1]);
    // `-p` yoksa varsayılan `tsconfig.json` kullanılır — o da bir kapı hedefidir.
    if (p.length === 0) out.add("tsconfig.json");
    else for (const x of p) out.add(x);
  }
  return [...out];
}

/**
 * O config'in KÖK DOSYA sayısı (`include`/`files` çözülmüş hâli).
 *
 * ⚠️ NEDEN `--showConfig`, `--listFilesOnly` DEĞİL: ikisi de aynı sayıyı veriyor
 * (ölçüldü: 486 · 1133 · 26 · 1407) ama `--showConfig` tip denetimi yapmadan
 * yalnız config'i çözüyor ⇒ **2,7 sn ↔ 16,3 sn, 6 kat ucuz.** Kapı her commit'te
 * koşuyor; bedeli düşürmek kadansı korumanın parçası.
 *
 * ⚠️ SEMANTİK FARK BEYAN EDİLİR: `--showConfig` KÖK dosyaları sayar (include/files),
 * `--listFilesOnly` import kapanışını da. Bu kapının sorusu "kapsam SIFIR mı" olduğu
 * için kök dosya sayısı DAHA DOĞRU sinyaldir: Electron'un kök config'i `files: []`
 * taşır ve kapanışta yalnız `lib.d.ts` görünürdü. (mobil'de 403 ↔ 394 farkı buradan.)
 */
function dosyaSayisi(proje: string, cfg: string): number {
  let ham = "";
  try {
    ham = execFileSync("npx", ["tsc", "--showConfig", "-p", cfg], {
      cwd: join(KOK, proje),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    ham = (err as { stdout?: string }).stdout ?? "";
  }
  try {
    return ((JSON.parse(ham) as { files?: string[] }).files ?? []).length;
  } catch {
    return -1; // config çözülemedi → ARIZA, aşağıda 0'dan ayrı raporlanır
  }
}

function main(): void {
  console.log("=== Tip kapısının kapsamı ===\n");
  const ATLAMA = atlamaDefteri(() => {
    fail++;
  });
  let toplamConfig = 0;
  for (const proje of PROJELER) {
    // ⚠️ ÖLÇÜLEMEYEN KAPSAM, "SIFIR DOSYA" DEĞİLDİR — ve ikisini ayırmak bu
    // bekçinin varlık sebebi (2026-09-13, CI'da üç kez kırmızı verdi).
    // CI'ın Backend job'ı `npm ci`yi YALNIZ `Teks-Erp` dizininde koşuyor;
    // `Electron/` ve `mobil/`de `node_modules` YOK ⇒ oradaki `npx tsc` config'i
    // çözemiyor ve kapı `-1` alıyor. Kapı doğru davrandı (ARIZA dedi, "0 dosya"
    // demedi) ama YANLIŞ YERDEN ölçüyordu: üç projeyi TEK job'dan.
    //
    // ⚠️ VE BU BEYAN BİR ÇÖZÜM DEĞİL, BİR BORÇ KAYDIDIR. `atla()` boşluğu
    // GÖRÜNÜR kılar, KAPATMAZ: beyan edildiği an Electron ve mobil'in kapı
    // kapsamı o job'da ÖLÇÜLMÜYOR demektir. Kalem ancak (b) ile kapanır —
    // kapsam, bağımlılıkları kurulu olan KENDİ job'ında ölçülünce.
    if (!existsSync(join(KOK, proje, "node_modules"))) {
      ATLAMA.atla(
        `${proje} tip kapısı kapsamı`,
        "bu kapsam BU JOB'DA ÖLÇÜLMÜYOR — bağımlılıkları kurulu değil (borç: kendi job'ına taşınacak)",
      );
      continue;
    }
    const configler = kapiConfigleri(proje);
    // KÖRLÜK ZEMİNİ: script adı değişirse liste boşalır ve aşağıdaki her kontrol
    // VAKUMEN yeşil olur.
    check(`§0 ${proje}: package.json'dan tip kapısı çözüldü`, configler.length > 0, configler.join(" · "));
    toplamConfig += configler.length;
    for (const cfg of configler) {
      const n = dosyaSayisi(proje, cfg);
      check(
        `⭐ ${proje}/${cfg} SIFIR dosya derlemiyor`,
        n > 0,
        n > 0
          ? `${n} dosya`
          : n === 0
            ? "0 DOSYA — bu kapı HİÇBİR ŞEY ölçmüyor, her zaman yeşil verir"
            : "config ÇÖZÜLEMEDİ — bu bir kapsam bulgusu değil ARIZA",
      );
    }
  }
  // ⚠️ KÖRLÜK ZEMİNİ ÖLÇÜLEN PROJE SAYISINA GÖRE KURULUR — sabit bir eşik
  // (eski hâli: 4) beyanla birlikte YANLIŞ kırmızı üretir.
  //
  // SONDA BUNU YAKALADI: üç projeyi birden atlattığımda eşik hâlâ 2 bekliyordu
  // ve `0 config` kırmızı verdi — yani BEYAN, kapatmayı amaçladığı kırmızıyı
  // başka bir kırmızıya çevirmişti. Zemin, "hiç ölçmedim"i "ihlal buldum" ile
  // karıştıramaz.
  //
  // Doğru yüklem: ölçülen HER projeden en az bir kapı hedefi çıkmalı. Script
  // adları değişip liste boşalırsa (asıl kovaladığımız vakumen-yeşil) toplam
  // ölçülen proje sayısının altına düşer ve zemin ISIRIR.
  const olculenProje = PROJELER.length - ATLAMA.sayi;
  if (olculenProje === 0) {
    // Hiçbir proje ölçülmediyse zeminin kendisi de ölçülmemiştir — onu da
    // BEYAN et, sessizce atlama. "Kontrol koşmadı" ile "kontrol geçti" ayrı.
    ATLAMA.atla("§0z körlük zemini", "ölçülen proje YOK — zemin değerlendirilemedi");
  } else {
    check(
      "§0z körlük zemini: ölçülen her projede kapı hedefi bulundu",
      toplamConfig >= olculenProje,
      `${toplamConfig} config / ${olculenProje} ölçülen proje` +
        (ATLAMA.sayi > 0 ? ` (${ATLAMA.sayi} proje atlandı)` : ""),
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
