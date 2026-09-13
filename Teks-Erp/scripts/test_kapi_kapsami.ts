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
import { spawnSync } from "node:child_process";
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

/**
 * ÖLÇÜM ÇEKİRDEĞE DELEGE EDİLİR — `scripts/kapi-kapsami.mjs`.
 *
 * ⚠️ Eskiden bu dosya kendi `kapiConfigleri`/`dosyaSayisi`ını taşıyordu ve
 * (b) düzeltmesiyle birlikte CI'ın Electron/mobil job'ları da aynı ölçümü
 * yapmak zorunda kaldı. İkinci bir kopya yazmak İKİ GERÇEK üretirdi — bu gece
 * `tr-kokler.ts` ile tam bunu reddettik.
 * ⇒ *Bir ölçüm iki yerde koşacaksa, iki kez YAZILMAZ; bir kez yazılıp iki kez
 *   ÇAĞRILIR.* Çekirdek zero-dep `.mjs`tir, çünkü Electron/mobil job'larında
 *   `tsx` ve Teks-Erp bağımlılıkları YOK.
 *
 * Çıkış kodu sözleşmesi: 0 = temiz · 1 = SIFIR dosya (kapsam bulgusu) ·
 * 2 = ölçülemedi (ARIZA / bağımlılık yok) — üçü AYRI, çünkü "ölçemedim" ile
 * "ihlal buldum" aynı kırmızıya çıkamaz.
 */
function cekirdek(proje: string): { kod: number; satirlar: string[] } {
  const r = spawnSync("node", [join(KOK, "scripts", "kapi-kapsami.mjs"), proje], {
    cwd: KOK,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const cikti = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { kod: r.status ?? 2, satirlar: cikti.split("\n").filter(Boolean) };
}

function main(): void {
  console.log("=== Tip kapısının kapsamı ===\n");
  const ATLAMA = atlamaDefteri(() => {
    fail++;
  });
  let olculen = 0;
  for (const proje of PROJELER) {
    // ⚠️ ÖLÇÜLEMEYEN KAPSAM, "SIFIR DOSYA" DEĞİLDİR — ve ikisini ayırmak bu
    // bekçinin varlık sebebi (2026-09-13, CI'da üç kez kırmızı verdi).
    // CI'ın Backend job'ı `npm ci`yi YALNIZ `Teks-Erp` dizininde koşuyor;
    // `Electron/` ve `mobil/`de `node_modules` YOK ⇒ oradaki `npx tsc` config'i
    // çözemiyor ve kapı `-1` alıyor. Kapı doğru davrandı (ARIZA dedi, "0 dosya"
    // demedi) ama YANLIŞ YERDEN ölçüyordu: üç projeyi TEK job'dan.
    //
    // ⚠️ BEYAN BİR BORÇ KAYDIYDI; ARTIK BİR ÇAPRAZ REFERANS. (b) indi ve ÖLÇÜLDÜ
    // (koşum 34742637890): Electron job'ı 26 + 1.410 dosya, mobil job'ı 406 dosya,
    // ikisi de "0 sorunlu". Kapsam gerçekten ölçülüyor — ama BAŞKA BİR JOB'DA.
    //
    // ⚠️ BEYAN KALDIRILMADI ve bu ÖLÇÜLMÜŞ bir karar. Kaldırsaydık bu koşum
    // "her şeyi ölçtüm" diye okunurdu — oysa Backend job'ı Electron/mobil'e
    // BAKMADI. Atlama bu koşum için GERÇEK; koşucunun "yeşil ≠ kapsandı"
    // satırına katılması DOĞRU.
    //   ⇒ *Başka bir yerde ölçülüyor olmak, BURADA ölçülmüş olmak değildir —
    //     beyan kalkarsa o ayrım kaybolur.*
    // Değişen tek şey METİN: artık "borç" değil, "nerede ölçülüyor" diyor.
    // Sebep ↔ borç ↔ çapraz referans üç ayrı cümledir ve okuyan hangisi
    // olduğunu görmelidir.
    const { kod, satirlar } = cekirdek(proje);
    for (const l of satirlar) console.log(`   ${l}`);
    // Çekirdeğin çıkış kodu ÜÇ DURUMLU ve "ölçemedim" ≠ "ihlal buldum":
    //   0 = temiz · 1 = SIFIR dosya (gerçek kapsam bulgusu) · 2 = ölçülemedi
    if (kod === 2) {
      ATLAMA.atla(
        `${proje} tip kapısı kapsamı`,
        `bu koşum ${proje} kapsamına BAKMADI (bağımlılık yok) — CI'da "${proje}" job'ının "Kapı kapsamı" adımı ölçüyor`,
      );
      continue;
    }
    olculen++;
    check(`⭐ ${proje}: hiçbir kapı hedefi SIFIR dosya derlemiyor`, kod === 0, satirlar.at(-1) ?? "");
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
  // ⚠️ İKİNCİ SONDA BUNU YAKALADI: delegasyondan sonra zemini
  // `check(..., olculenProje > 0)` diye bırakmıştım — ama o satır yalnız
  // `olculen > 0` dalında koşuyordu, yani YÜKLEM HER ZAMAN DOĞRUYDU.
  // **Totolojik bir kontrol, vakumen yeşilin ta kendisidir** — ve bu bekçi tam
  // olarak onu kovalamak için var. Kendi zeminini kaybetmiş bir körlük zemini.
  //
  // Doğru yüklem YANLIŞLANABİLİR olmalı: her proje ya ÖLÇÜLDÜ ya BEYAN EDİLDİ;
  // toplam eksikse bir `continue` dalı ya da yutulan bir istisna projeyi
  // sessizce düşürmüş demektir.
  check(
    "§0z körlük zemini: her proje ya ölçüldü ya BEYAN edildi",
    olculen + ATLAMA.sayi === PROJELER.length,
    `${olculen} ölçüldü + ${ATLAMA.sayi} beyan = ${olculen + ATLAMA.sayi} / ${PROJELER.length} proje`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
