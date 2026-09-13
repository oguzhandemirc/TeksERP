// =============================================================================
// KURAL DOSYALARINDAKİ `bekçi:` ATIFLARI ÇÖZÜLÜR — A kolu (2026-09-13)
// =============================================================================
// NE ÖLÇER: `docs/kurallar/*.md` satırlarındaki `· bekçi: `X`` alanında ANILAN
// her dosya adının repoda GERÇEKTEN var olduğunu.
//
// ⚠️ NEDEN DEĞERLİ: ev bu alanı yıllardır yazıyor (598 iddia / 525 benzersiz,
// ölçüldü 2026-09-13) ve bugüne kadar hiç bayatlatmamış. Ama bir bekçi yeniden
// adlandırılırsa 500+ atıftan hangisinin öldüğünü kimse göremez — ve ölü bir
// atıf, okuyana VAR OLMAYAN bir korumaya güvendirir ("belgede adı geçen ama var
// olmayan araç" sınıfı; aynı gün üç biçimi görüldü: ad yanlış · araç yok ·
// başlık yalan).
//
// ── ⛔ BU KOLUN ÖLÇMEDİKLERİ — kapsam GİZLENMEZ, BASILIR ────────────────────
// Yeşili "borç notları kapı altında" DEMEK DEĞİLDİR:
//   ① `bekçi: YOK…` diyen satırların KAPANMA KOŞULU olup olmadığını ölçmez
//      (B kolu; henüz inmedi). Sayı çıktıda basılır ki yokluğu görünür olsun.
//   ② Adı geçen bekçinin o kuralı GERÇEKTEN ölçtüğünü ölçmez — yalnız dosyanın
//      var olduğunu. "Atıf çözülüyor" ≠ "kural korunuyor".
//   ③ Hiçbir dosya adı anmayan düz metin atıfları (`DB seddi: schema @unique`)
//      kapsam dışıdır; sayıları basılır.
// => Bir kapı, ölçmediğini ÇIKTISINDA söylemezse yeşili komşu boşluğu örter.
//
// ── CIRCIR: taban 10, YALNIZ DÜŞER ─────────────────────────────────────────
// ⚠️ Bu kol doğduğu gün YEŞİL DEĞİL: 10 gerçek ihlalle doğuyor (kural
// dosyalarında adlar KESİK yazılmış — `test_h`, `test_superad`, kelime
// ortasında kapanan backtick). Tabanı 0 yapmak erken sertlik olurdu; 10'a
// konur ki ONBİRİNCİ kesik ad eklenemesin.
//
// ── NEGATİF SONDA (koşuldu 2026-09-13) ─────────────────────────────────────
// `docs/kurallar/tambur.md`de `test_roll_operation_revoke` →
// `…_SONDAX` yapıldı ⇒ 10 → 11, ad ve yeri basıldı. `cp` + `shasum -c` (✓).
//
// ⚠️ İLK SONDA TUTMADI ve sebebi ÖLÇÜLDÜ — kapı kördü, sonda kurgu değildi:
// hedef aldığım ad uzantısız yazılıydı ve kapı yalnız `.ts`/`.tsx` ile biten
// belirteçleri arıyordu (bkz. `CIPLAK_BEKCI_DESENI`).
// => Tutmayan bir sonda İKİ şeyin işareti olabilir: sonda kurgu YA DA KAPI KÖR.
//    Hangisinin sustuğu ölçülmeden "temiz" hükmü kurulamaz.
// =============================================================================
import { execFileSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay?: string): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const KOK = join(__dirname, "..", "..");
const KURALLAR = join(KOK, "docs", "kurallar");

/** Devralınan KESİK ad borcu — YALNIZ DÜŞER (ölçüldü 2026-09-13: 10). */
const TABAN = 10;

/** `· bekçi: `…`` alanının İÇERİĞİ (backtick'ler arası), dosya başına. */
function bekciAlanlari(): Array<{ dosya: string; satir: number; icerik: string }> {
  const out: Array<{ dosya: string; satir: number; icerik: string }> = [];
  for (const ad of readdirSync(KURALLAR).filter((f) => f.endsWith(".md"))) {
    const satirlar = readFileSync(join(KURALLAR, ad), "utf8").split("\n");
    satirlar.forEach((s, i) => {
      for (const m of s.matchAll(/bekçi: `([^`]*)`/g)) {
        out.push({ dosya: `docs/kurallar/${ad}`, satir: i + 1, icerik: m[1]! });
      }
    });
  }
  return out;
}

/**
 * ⚠️ ÇÖZÜMLEME TEMEL ADLA (basename), yolla DEĞİL — ve bu bilinçli:
 * alan serbest metindir ve ölçülen biçimleri KISMİ yol taşıyor
 * (`Electron Rolls/service.test.ts`, `Electron .../Foo.test.tsx:151-162`,
 * `packingGroupUi.test.ts §6`). Tam yol arayan bir yüklem bunların hepsini
 * "çözülmedi" sayardı — yani kapı kendi ayrıştırıcısının darlığını
 * "belge kusuru" diye raporlardı.
 */
const DOSYA_ADI_DESENI = /[A-Za-z0-9_.-]+\.tsx?/g;

/**
 * ⚠️ UZANTISIZ `test_…` ADLARI DA SAYILIR — ve bunu NEGATİF SONDA öğretti:
 * ilk yazımda yalnız `.ts`/`.tsx` ile biten belirteçler aranıyordu; sonda
 * tutmadı, çünkü hedef aldığım ad `kalite.md`de UZANTISIZ yazılıydı
 * (`bekçi: \`test_station_quality_capability §3\``). Ölçüldü: bu biçim
 * 155 benzersiz atıfla EN YAYGIN olanıydı ⇒ kapı en yaygın şekle KÖRDÜ ve
 * "0 çözülmeyen" yeşili o körlüğü örtüyordu.
 * => Tutmayan bir sonda iki şeyin işareti olabilir: sonda kurgu YA DA KAPI KÖR.
 *    Hangisi olduğu ölçülmeden bilinmez — burada ikincisiydi.
 */
const CIPLAK_BEKCI_DESENI = /\btest_[a-z0-9_]+\b/g;

function repoDosyaAdlari(): Set<string> {
  const ham = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: KOK, encoding: "utf8" });
  return new Set(ham.split("\n").filter(Boolean).map((p) => basename(p)));
}

function main(): void {
  console.log("=== Kural dosyalarındaki `bekçi:` atıfları çözülür mü ===\n");

  const alanlar = bekciAlanlari();
  const gercek = repoDosyaAdlari();
  check("`bekçi:` alanı bulundu", alanlar.length >= 400, `${alanlar.length} iddia`);
  check("repo dosya adları okunabildi", gercek.size >= 1000, `${gercek.size} benzersiz ad`);

  // Dosya adı ANMAYAN alanlar: `BELİRSİZ`, `YOK (yazılacak)`, düz metin sed.
  const adAnan = new Map<string, { dosya: string; satir: number }>();
  let adAnmayan = 0;
  let kosulsuzBorc = 0;
  for (const a of alanlar) {
    if (/^(BELİRSİZ|YOK|yok)/.test(a.icerik)) kosulsuzBorc++;
    const uzantili = a.icerik.match(DOSYA_ADI_DESENI) ?? [];
    // Uzantılı adlar önce çıkarılır ki `foo.test.ts` içindeki `test_…` parçası
    // ikinci kez, uzantısız sanılarak sayılmasın.
    const kalan = a.icerik.replace(DOSYA_ADI_DESENI, " ");
    const ciplak = (kalan.match(CIPLAK_BEKCI_DESENI) ?? []).map((n) => `${n}.ts`);
    const adlar = [...uzantili, ...ciplak];
    if (adlar.length === 0) { adAnmayan++; continue; }
    for (const ad of adlar) if (!adAnan.has(ad)) adAnan.set(ad, { dosya: a.dosya, satir: a.satir });
  }

  const cozulmeyen = [...adAnan.entries()].filter(([ad]) => !gercek.has(ad));
  check(
    `⭐ çözülmeyen atıf ≤ taban (${TABAN})`,
    cozulmeyen.length <= TABAN,
    `${adAnan.size} benzersiz ad · ${cozulmeyen.length} çözülmeyen`,
  );
  // ⚠️ Taban ÇÜRÜMESİN: gerçek sayı tabanın ALTINA inerse tabanı düşür. Yoksa
  // kapı sessizce genişler ve kazanılan temizlik geri verilebilir hâle gelir.
  check(
    "taban ÇÜRÜMEMİŞ (gerçek < taban ise tabanı düşür)",
    cozulmeyen.length >= TABAN,
    `gerçek ${cozulmeyen.length} · taban ${TABAN}`,
  );
  for (const [ad, yer] of cozulmeyen) console.log(`     ${yer.dosya}:${yer.satir}  → ${ad}`);

  // ── KAPSAM BEYANI — yeşilin NE DEMEK OLMADIĞI ─────────────────────────────
  console.log(
    `\n   ⛔ BU KOLUN ÖLÇMEDİĞİ (yeşil "borç notları kapı altında" DEMEK DEĞİLDİR):\n` +
      `      · \`bekçi: YOK/BELİRSİZ\` diyen ${kosulsuzBorc} satırın KAPANMA KOŞULU\n` +
      `        olup olmadığı BU KOLDA ÖLÇÜLMEZ — B kolu inmedi.\n` +
      `      · Adı geçen bekçinin o kuralı gerçekten ölçtüğü ölçülmez (atıf ≠ koruma).\n` +
      `      · Dosya adı anmayan ${adAnmayan} düz-metin atıf kapsam DIŞI.\n`,
  );

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
