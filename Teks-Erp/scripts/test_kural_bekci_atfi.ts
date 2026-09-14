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
// ── CIRCIR: taban 10 → 5 → 0, YALNIZ DÜŞER ─────────────────────────────────
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
//
// ── KESİK ALAN CIRCIRI — sondalar (2026-09-13, worktree, index'ten) ─────────
//   K− 80 karakterlik alan, STAGE'li              → 72 → 73 ✓
//   K− dengesiz parantez, STAGE'li                → 72 → 73 ✓  (⚠️ ilk deneme
//      SUSTU: sondanın kendi satırında kapanış backtick'i yoktu ⇒ alan hiç
//      doğmadı — sonda kurguydu, kapı değil; düzeltilince ısırdı)
//   K+ var olan kesik alan tamamlandı (kalite.md:38) → 72 → 71 ✓
//   K  aynı 80'lik STAGE'siz                      → index 72 · ℹ️ ağaç 73 ✓
// =============================================================================
import { execFileSync } from "child_process";
import { basename } from "path";
import { type BekciAlani, bekciAlanlari, KOK, kuralDosyalari } from "./lib/kural-dosyalari";
import { curumeKolu } from "./lib/circir-kolu";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay?: string): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
// Çürüme kolu commit kapısında uyarıya düşünce defterde görünür (strict → kırmızı).
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

/**
 * Devralınan KESİK ad borcu — YALNIZ DÜŞER. **10 → 5 → 0 (2026-09-13).**
 *
 * 10 → 5: dördü tek adaya çözüldü, biri kapının SAHTE POZİTİFİYDİ
 * (`scripts/test_surum.mjs` — `.mjs` dosyasına `.ts` ekliyordu).
 *
 * 5 → 0: kalan beşi *"GERÇEKTEN belirsiz, tamamlamak KARAR VERMEK olurdu"* diye
 * bırakılmıştı. ⚠️ O cümle **yarısı doğruydu**: tamamlamak karar vermek olurdu —
 * ama *"hangi bekçinin o kuralı GERÇEKTEN ölçtüğü"* bir KARAR değil bir ÖLÇÜMDÜR.
 * Beşi de kuralın cümlesi ↔ adayların YÜKLEMİ okunarak çözüldü (`1705ffa1`):
 *   sevkiyat.md:28   → test_dispatch_report_gross   (⚠️ adı DAHA YAKIN olan
 *                      `test_dispatch_report`ta 0 eşleşme — ad yol göstermedi)
 *   superadmin.md:13 → test_db_invariants (§10)
 *   yetki-izin.md:20 → test_superadmin (§④ SUPAP)
 *   yetki-izin.md:23 → test_superadmin_visible (§4)
 *   is-emri.md:19    → ⛔ BEKÇİ YOK (2026-09-13) — bu da bir sonuçtur: tek `test_h*`
 *                      adayı `test_helpers`, kuralı ETKİSİZLEŞTİRİYOR: sahte
 *                      `workOrderStep.findUnique` her adayı `stepSequence: 1`
 *                      döndürüyor ⇒ "giriş noktası" dalı hiç ayrışmıyor.
 *                      Kural satırına BORÇ + kapanma koşulu yazıldı.
 *                      ⚠️ Çapa SATIR NUMARASI DEĞİL SEMBOL: ilk yazımda `:275-278`
 *                      yazılmıştı ve `test_olcum_iddiasi` onu çıplak sayı diye
 *                      yakaladı — haklı olarak, çünkü satır numarası nottan hızlı
 *                      bayatlar (aynı gün ölçüldü: `defter-beyan.ts`in beş
 *                      kaleminde beş çapa da kaymıştı).
 *                      Yeri: `grep -n 'workOrderStep' scripts/test_helpers.ts`
 * ⇒ ***Bir atfı doldurmak için OLMAYAN bir korumayı VAR göstermek, boş
 *   bırakmaktan kötüdür*** — bu yüzden beşincisi tahminle doldurulmadı, `YOK` yazıldı.
 *
 * ⚠️ TABAN 0 ARTIK SERT: yeni bir kesik ad İLK GÜNDEN kırmızı verir. Doğduğu gün
 * 10'la doğması *"erken sertlik olmasın"* diyeydi; sertlik artık erken değil,
 * KAZANILMIŞ. ⇒ *Bir cırcırın 0'a inmesi, kapının nihayet doğduğu andır.*
 */
const TABAN = 0;

/**
 * KESİK ALAN TABANI — YALNIZ DÜŞER. Ölçüldü 2026-09-13 (HEAD `da0d3ced`):
 * 598 alanın uzunluk dağılımında 79→3 · **80→66** · 81→1 · 82→0. Bu bir
 * yazım alışkanlığı değil, 2026-09-05 üretecinin 80 karakterde KESME İMZASI —
 * alanlar kelime ortasında bitiyor ("…kırmızı gös", "…READ", "…, te").
 * 66'nın 37'sinde parantez dengesiz; 80 dışı 6 alanda daha dengesiz parantez var.
 * ⇒ Kesik alan, kesilen adı ADAY OLARAK BİLE doğurmaz (`kalite.md:38`
 *    "…test_kursun_bypass, te" — `te` hiçbir desene uymadığı için üstteki
 *    cırcır 0'da kalıyordu). Popülasyon aranan şeyin DOĞRU biçiminden türeyince,
 *    YANLIŞ biçim popülasyonun dışında kalır — tam da ölçülmek istenen şey.
 *
 * Yüklem: uzunluk === 80 (imza) ∨ parantez dengesiz. Elle yazılmış bir alan
 * 80'e denk gelirse bir karakter oynat — imza, kanıt değil işarettir ve
 * yanlış pozitifin bedeli bir karakterdir.
 * Üreten komut (index'ten):
 *   for f in $(git ls-files docs/kurallar/*.md); do git show ":$f"; done \
 *     | grep -oE 'bekçi: `[^`]*`' | sed 's/^bekçi: `//; s/`$//' \
 *     | awk '{ a=gsub(/\(/,"("); b=gsub(/\)/,")"); if (length($0)==80 || a!=b) n++ } END { print n }'
 *   (awk'ta `length` BYTE sayabilir — kapı KARAKTER sayar; fark Türkçe harflerden.)
 */
const KESIK_TABAN = 0;  // 72 → 63 → 50 → 21 → 14 → 13 → 0 (2026-09-13/14, entegratör 1e): tren sonunda BİRLEŞİK index'te ölçüldü — ea ayrıştırıcı −2 · 5e 17 + 11 · 6e 8 · 01 13 · sabite trende TEK yazar. ⚠️ ARTIK SERT: yeni kesik alan ilk günden kırmızı

/** Üretecin kesme imzası ya da dengesiz parantez — alan bütün değil. */
function kesikMi(a: BekciAlani): boolean {
  const ac = (a.icerik.match(/\(/g) ?? []).length;
  const kapa = (a.icerik.match(/\)/g) ?? []).length;
  return [...a.icerik].length === 80 || ac !== kapa;
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
// ⚠️ SONDAKİ NEGATİF BAKIŞ (`(?!\.[a-z])`) da ölçümle geldi: `surum-yayin.md`
// `scripts/test_surum.mjs` diyor — `.ts` DEĞİL. Bakış olmadan kural adı
// `test_surum` diye kopuyor, `.ts` ekleniyor ve var olmayan bir dosya
// "çözülmedi" diye raporlanıyordu. Yani kapı, kendi eklediği uzantıyı belgenin
// kusuru sanıyordu. (Üçüncü sahte pozitif sınıfı: `ts` dışı uzantılar.)
const CIPLAK_BEKCI_DESENI = /\btest_[a-z0-9_]+\b(?!\.[a-z])/g;

/**
 * `· Çapa: `…`` alanları — kuralın VAAT ettiği bekçinin adı.
 *
 * ⚠️ NEDEN AYRI BİR KOL: `bekçi:` alanı ölü ad veremez (üstteki cırcır tutar), ama
 * `Çapa:` verebiliyordu ve fark eden yoktu — alan yalnız `ALAN_SONU` ayracında geçiyor,
 * hiçbir kapı ADINI çözmüyordu. Korunmayan bir alan, korunan alanın yanında sessizce
 * bayatlar (ölçüldü 2026-09-13: 7 Çapa alanının 3'ü çözülmüyordu).
 */
function capaAlanlari(dosyalar: Map<string, string>): Array<{
  dosya: string;
  satir: number;
  icerik: string;
  kapanirVar: boolean;
}> {
  const out: Array<{ dosya: string; satir: number; icerik: string; kapanirVar: boolean }> = [];
  const CAPA = /·\s*Çapa:\s*`([^`]+)`/;
  for (const [dosya, metin] of dosyalar) {
    metin.split("\n").forEach((s, i) => {
      const m = CAPA.exec(s);
      if (m) out.push({ dosya, satir: i + 1, icerik: m[1], kapanirVar: /·\s*Kapanır:/.test(s) });
    });
  }
  return out;
}

/** Bir alan metninden bekçi adı adayları — `bekçi:` kolunun yüklemiyle AYNI. */
function adAdaylari(icerik: string): string[] {
  const uzantili = icerik.match(DOSYA_ADI_DESENI) ?? [];
  const ciplak = (icerik.replace(DOSYA_ADI_DESENI, " ").match(CIPLAK_BEKCI_DESENI) ?? []).map(
    (n) => `${n}.ts`,
  );
  return [...uzantili, ...ciplak];
}

function repoDosyaAdlari(): Set<string> {
  const ham = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: KOK, encoding: "utf8" });
  return new Set(ham.split("\n").filter(Boolean).map((p) => basename(p)));
}

function main(): void {
  console.log("=== Kural dosyalarındaki `bekçi:` atıfları çözülür mü ===\n");

  const dosyalar = kuralDosyalari();
  const alanlar = bekciAlanlari(dosyalar.index);
  const gercek = repoDosyaAdlari();
  check("`bekçi:` alanı bulundu", alanlar.length >= 400, `${alanlar.length} iddia · kaynak: ${dosyalar.kaynak}`);
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
  curumeKolu(check, ATLAMA.atla, "taban ÇÜRÜMEMİŞ (gerçek < taban ise tabanı düşür)", cozulmeyen.length, TABAN);
  for (const [ad, yer] of cozulmeyen) console.log(`     ${yer.dosya}:${yer.satir}  → ${ad}`);

  // ── KESİK ALAN — üretecin 80 karakter imzası ∨ dengesiz parantez ─────────
  const kesik = alanlar.filter(kesikMi);
  check(
    `⭐ KESİK \`bekçi:\` alanı ≤ taban (${KESIK_TABAN})`,
    kesik.length <= KESIK_TABAN,
    `${kesik.length} kesik (80 karakter: ${kesik.filter((a) => [...a.icerik].length === 80).length})`,
  );
  curumeKolu(check, ATLAMA.atla, "kesik tabanı ÇÜRÜMEMİŞ (gerçek < taban ise tabanı düşür)", kesik.length, KESIK_TABAN);
  for (const a of kesik.slice(0, 5)) console.log(`     ${a.dosya}:${a.satir}  …${a.icerik.slice(-36)}`);
  if (kesik.length > 5) console.log(`     … +${kesik.length - 5} alan`);
  const agactaKesik = bekciAlanlari(dosyalar.agac).filter(kesikMi).length;
  const agactaCozulmeyen = (() => {
    const adlar = new Set<string>();
    for (const a of bekciAlanlari(dosyalar.agac)) {
      for (const ad of a.icerik.match(DOSYA_ADI_DESENI) ?? []) adlar.add(ad);
      for (const n of a.icerik.replace(DOSYA_ADI_DESENI, " ").match(CIPLAK_BEKCI_DESENI) ?? []) adlar.add(`${n}.ts`);
    }
    return [...adlar].filter((ad) => !gercek.has(ad)).length;
  })();
  if (dosyalar.kaynak === "index" && (agactaKesik !== kesik.length || agactaCozulmeyen !== cozulmeyen.length)) {
    console.log(`     ℹ️ çalışma ağacında: çözülmeyen ${agactaCozulmeyen} · kesik ${agactaKesik} (commit'lenmemiş fark; tabana ESAS DEĞİL — önce stage'le)`);
  }

  // ── `Çapa:` ÖLÜ AD — vaat, ancak KAPANIR cümlesiyle meşrudur ──────────────
  //
  // YÜKLEM: `Çapa:` adı çözülmüyor **∧** aynı satırda `Kapanır:` YOK ⇒ kırmızı.
  // Cırcır DEĞİL, sert kural (taban 0, sabit yok). Gerekçe: çözülmeyen bir çapa bir
  // VAAT'tir; vaat `Kapanır:` cümlesiyle meşrudur, cümlesizse ölü addır. Cırcır
  // olsaydı DÜRÜST bir vaat doğduğu gün kırmızı verir ve tabanın yükseltilmesi
  // gerekirdi — yani kapı doğru davranışı PAHALILAŞTIRIRDI.
  const capalar = capaAlanlari(dosyalar.index);
  // KÖRLÜK ZEMİNİ: hiç `Çapa:` bulunamazsa "ölü ad yok" cümlesi VAKUMEN doğru olur.
  check("körlük zemini: `Çapa:` alanı bulundu", capalar.length > 0, `${capalar.length} alan`);
  const oluCapa = capalar.filter(
    (c) => !c.kapanirVar && adAdaylari(c.icerik).some((ad) => !gercek.has(ad)),
  );
  check(
    "⭐ çözülmeyen `Çapa:` YALNIZ `Kapanır:` cümlesi olan satırda",
    oluCapa.length === 0,
    oluCapa.length === 0
      ? `${capalar.length} çapanın ${capalar.filter((c) => c.kapanirVar).length}'i Kapanır cümleli`
      : oluCapa.map((c) => `${c.dosya}:${c.satir} → ${adAdaylari(c.icerik).filter((ad) => !gercek.has(ad)).join(", ")}`).join(" · "),
  );
  if (oluCapa.length > 0) {
    console.log(
      "   YAPILACAK: ya bekçiyi yaz (ad çözülsün), ya da aynı satıra `Kapanır:`\n" +
        "   cümlesi ekle — ne olunca biteceğini bir SAYI ya da KÜME ile söyleyen.",
    );
  }

  // ── KAPSAM BEYANI — yeşilin NE DEMEK OLMADIĞI ─────────────────────────────
  console.log(
    `\n   ⛔ BU KOLUN ÖLÇMEDİĞİ (yeşil "borç notları kapı altında" DEMEK DEĞİLDİR):\n` +
      `      · \`bekçi: YOK/BELİRSİZ\` diyen ${kosulsuzBorc} satırın KAPANMA KOŞULU\n` +
      `        olup olmadığı BU KOLDA ÖLÇÜLMEZ — B kolu inmedi.\n` +
      `      · Adı geçen bekçinin o kuralı gerçekten ölçtüğü ölçülmez (atıf ≠ koruma).\n` +
      `      · Dosya adı anmayan ${adAnmayan} düz-metin atıf kapsam DIŞI.\n` +
      `      · \`Çapa:\` kolu yalnız AD ÇÖZÜMÜNÜ ölçer — \`Kapanır:\` cümlesinin\n` +
      `        ÖLÇÜLEBİLİRLİĞİ (bir sayı/küme söylüyor mu) ÖLÇÜLMEZ; cümlenin VARLIĞI\n` +
      `        vaadi meşru kılar, DOĞRULUĞU değil.\n` +
      `      · KESİK alanın İÇİNDE hangi adın kaybolduğu — kesik alan sayılır,\n` +
      `        kaybolan ad bilinemez; "0 çözülmeyen" o adlar için bir şey söylemez.\n` +
      `   ⚠️ BELGE METNİ INDEX'TEN okunur (ne ağaç ne HEAD; gerekçe lib/kural-dosyalari.ts);\n` +
      `      dosya VARLIĞI ise git ls-files'tan — o da index. Ağaç farkı ℹ️ ile basılır.\n`,
  );

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
