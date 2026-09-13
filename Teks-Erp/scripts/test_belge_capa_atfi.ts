// =============================================================================
// BEKÇİ — BELGEDEKİ `§` ÇAPALARI HEDEFİNİ BULUYOR MU (2026-09-13)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts belge_capa_atfi
//
// ⭐ NEDEN VAR: `check-docs.mjs` yalnız markdown LİNKLERİNİ ölçer; `X.md § N`
//    biçimindeki DÜZ METİN çapayı görmez. Ölçüldü 2026-09-13: bugüne kadar dört
//    bayat çapa bu yolla birikmişti ve üçü aynı gün yapılan bölmelerden kalmaydı
//    (bölüm taşındı, atıf eski dosyayı göstermeye devam etti).
//    Sınıf: *korunmayan bir alan, korunan alanın YANINDA sessizce bayatlar.*
//
// ⚠️ KAPSAM DAR VE ÖLÇÜLEREK SEÇİLDİ — geniş yüklem DENENDİ ve ÇÜRÜDÜ:
//    · "satırdaki en yakın önceki dosya adı" ile atfetmek 42 aday üretti; elle
//      okununca ~40'ı YANLIŞ POZİTİFTİ: tasarım belgeleri KENDİ bölümlerine
//      `§1, §4` diye atıf yapıyor ve satırda başka bir dosya adı geçiyor.
//    · Dosya adı OLMAYAN `§N` atıfları (ölçüldü 2026-09-13: 1.347 adet) da kapsam
//      dışı: hangi belgeye ait oldukları satırdan mekanik olarak ÇIKARILAMAZ.
//    ⇒ Yalnız BİTİŞİK yazım kapı altındadır: `X.md § …` (arada en fazla Türkçe
//      ek + boşluk). Bu, atfı TAHMİN etmeyi bırakıp YAZILMIŞ olanı ölçer.
//
// ⚠️ İKİ SEMANTİK ÇAKIŞMA ÖLÇÜLDÜ ve kapsam onlara göre daraltıldı:
//    · `§N` her zaman "bölüm N" demek değil — bu repoda "arıza sınıfı N" de
//      demek (ölçüm disiplini kataloğu) ve "satır N" de (kural dosyaları).
//      ⇒ ①: hedef dosyada HİÇ numaralı başlık yoksa atıf KAPSAM DIŞI sayılır.
//    · Tırnaklı atıf başlığın TAMAMINI değil AYIRT EDİCİ PARÇASINI alıntılar
//      (`§ "Bende yok"` ↔ `### "Bende yok" bir ölçüm değildir`).
//      ⇒ ②: tırnak içi metin başlığın İÇİNDE geçmelidir (birebir eşitlik DEĞİL).
//
// ⭐ TERS SIRA — `§ <başlık> (`X.md`)` (yüklem genişletmesi 2026-09-13, 5e):
//    Ağaçta ikinci bir yazım biçimi var ve kapı onu GÖRMÜYORDU: dosya adı `§`den
//    ÖNCE değil SONRA, parantez içinde. Genişletme üç adımda ÖLÇÜLEREK daraltıldı
//    (gevşek yüklemin yanlış pozitif sayısı burada beyan edilir):
//      gevşek  `§ … ( … .md … )`                 83 aday → ~80 YANLIŞ POZİTİF
//              (kural satırlarının `<sub>(CLAUDE.md:286)</sub>` dipnotu, satırın
//               başındaki `§10` ile İLGİSİZ bir dosyayı gösteriyor)
//      sıkı    parantezde YALNIZ tek backtickli ad   2 aday → 1 yanlış pozitif
//      sıkı+①  numaralı içerikte ① kuralı da uygulanır  1 aday → 0 yanlış pozitif
//    Kalan tek yanlış pozitif (`§2'deki bir kerelik son elle tur … (`…KURULUM.md`)`)
//    ① ile eleniyor: hedefte hiç numaralı başlık yok ⇒ o `§2` bir bölüm atfı değil.
//    ⇒ Ters sıra, düz sırayla AYNI semantiği kullanır; değişen yalnız SIRA'dır.
//    ⚠️ Ters kolun NUMARALI dalı ÇOK İNCE bir zeminde koşuyor: 2026-09-13'te 0 örnek,
//       2026-09-14'te 1 (vaka dosyasının `§ 1 · Araç bozuk (`…-ARAC.md`)` kardeş atfı).
//       Körlük zeminini METİN dalı taşıyor; numaralı dal düz sıranın aynası olduğu
//       için duruyor, bugünkü kapsamı değil YARINKİ yazımı korumak üzere.
//
// ⭐ BAŞLIK DİZİNİ İKİ YÖNDEN ölçülür (2026-09-13, 5e):
//    `docs/standart/OLCUM-DISIPLINI-DIZIN.md` ölçüm disiplini dosyalarının her başlığını
//    tek tabloda taşır ve her satırı bir TERS SIRA çapasıdır. Tek yön yetmez:
//      (a) dizin → dosya: ölü başlık kırmızı  (yukarıdaki çapa kolu ölçer)
//      (b) dosya → dizin: dizinde OLMAYAN başlık kırmızı
//    (b) olmadan dizin sessizce eksik kalırdı ve "bu sınıf yazılı mı?" sorusuna
//    YANLIŞ HAYIR verirdi — bir dizinin arızası, yokluğu değil EKSİKLİĞİDİR.
//
// KAPSAM DIŞI olan üç sınıf SAYIYLA BASILIR — yeşilin neyi kapsamadığı görünsün.
//
// NEGATİF SONDA (beşi de ölçüldü 2026-09-13, atılabilir `GIT_INDEX_FILE` üstünde):
//   ① numaralı ölü çapa eklendi → KIRMIZI, dosya:satır + hedef bastı
//   ② tırnaklı ölü çapa eklendi → KIRMIZI
//   ③ serbest metin/konu atfı bozuldu → YEŞİL (kapsam dışı olduğu basıldı)
//   ④ TERS SIRA: dizindeki bir başlık bozuldu → KIRMIZI · düzeltilince YEŞİL
//      (ikinci sonda ŞART: yalnız birincisi, alakasızı da kırmızı veren gevşek
//       bir yüklemle de geçerdi.)
//   ⑤ dosyaya yeni başlık eklendi, dizine EKLENMEDİ → KIRMIZI (yön b) · geri
//      alınınca YEŞİL; dizinin beyan sayısı da aynı sondada 140→141 kaymasını bastı
//   ⑥ GERİLEME SONDASI: ters kol eklendikten SONRA düz kol yeniden sınandı
//      (`VERITABANI.md §99`) → KIRMIZI. Yeni bir kol eklemek eskisini sessizce
//      öldürebilir; refaktörden sonra ESKİ kol da yeniden sondalanır.
//   ⑦ dizinin dosya başına beyanı bozuldu (16→17) → KIRMIZI, sapmayı ADIYLA bastı
//   Geri alma `cp` + `sha256` ile doğrulandı (her sondadan sonra, birebir).
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Kaynak: yalnız CANLI docs — arşiv (`history`, `akademik`) donuk olmalıdır. */
const ARSIV = ["docs/history/", "docs/akademik/"];
/** Başlık dizini ve indekslediği dosya kümesi (yön b). */
const DIZIN = "docs/standart/OLCUM-DISIPLINI-DIZIN.md";
const OLCUM_DOSYA = /^docs\/standart\/OLCUM-DISIPLINI[A-Z-]*\.md$/;
/** Hedef: repodaki HER `.md` (kök `CLAUDE.md`, alt proje `CLAUDE.md`'leri dâhil). */
function mdDosyalari(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: KOK, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

type Baslik = { metin: string; numara: string | null; duzey: number };
function basliklar(rel: string): Baslik[] {
  const out: Baslik[] = [];
  for (const ln of readFileSync(join(KOK, rel), "utf8").split("\n")) {
    const d = /^(#{1,6})\s/.exec(ln);
    if (!d) continue;
    const metin = ln.replace(/^#{1,6}\s*/, "").trim();
    const n = /^(\d+[a-z]?)\b/.exec(metin.replace(/^§\s*/, ""));
    out.push({ metin, numara: n ? n[1] : null, duzey: d[1].length });
  }
  return out;
}

/** DÜZ sıra — BİTİŞİK yazım: `X.md` (+ Türkçe ek) § <içerik>. Tahmin YOK. */
const CAPA = /`?([A-Za-z0-9._/-]+\.md)`?['’a-zçğıöşü]{0,4}\s{0,2}§\s*([^\n]{0,80})/g;
/**
 * TERS sıra — `§ <içerik> (`X.md`)`. İçerik `|` taşıyamaz (tablo hücresini aşmasın);
 * araya EN FAZLA tek bir hücre ayracı girebilir. 120 karakterlik içerik sınırı
 * seçilmedi, ölçüldü 2026-09-13: en uzun indekslenen başlık 93 karakter.
 * Parantezin içinde TEK
 * backtickli dosya adından başka bir şey olamaz — gevşek biçim 83 aday / ~80
 * yanlış pozitif üretiyordu (ölçüldü 2026-09-13, yukarıdaki üç adımlı daraltma).
 */
const TERS = /§\s*([^|\n]{3,120}?)\s*\|?\s*\(`([A-Za-z0-9._/-]+\.md)`\)/g;

function main(): void {
  console.log("=== Belgedeki `§` çapaları hedefini buluyor mu ===\n");
  const tum = mdDosyalari();
  const H = new Map<string, Baslik[]>();
  for (const p of tum) H.set(p, basliklar(p));
  const adIndeksi = new Map<string, string>();
  for (const p of tum) if (!adIndeksi.has(basename(p))) adIndeksi.set(basename(p), p);

  const kaynak = tum.filter((p) => p.startsWith("docs/") && !ARSIV.some((a) => p.startsWith(a)));
  check("kaynak belge kümesi okunabildi", kaynak.length >= 40, `${kaynak.length} canlı .md · ${tum.length} hedef .md`);

  let numarali = 0;
  let tirnakli = 0;
  let serbest = 0;
  let numarasizHedef = 0;
  let hedefYok = 0;
  let tersNumarali = 0;
  let tersMetin = 0;
  let tersKapsamDisi = 0;
  const olu: string[] = [];
  /** Yön (b) için: dizinin kendi satırlarından çıkan (hedef dosya → alıntı) çiftleri. */
  const dizinCiftleri: { hedef: string; icerik: string }[] = [];

  /** Bir çapayı hedef dosyaya bağlar; bağlanamıyorsa null döner. */
  function hedefiCoz(p: string, ad: string): string | null {
    const goreli = normalize(join(dirname(p), ad));
    const h = H.has(goreli) ? goreli : H.has(ad) ? ad : adIndeksi.get(basename(ad));
    return h && H.has(h) ? h : null;
  }

  for (const p of kaynak) {
    readFileSync(join(KOK, p), "utf8").split("\n").forEach((ln, idx) => {
      // --- DÜZ sıra: `X.md § …`
      for (const m of ln.matchAll(CAPA)) {
        const icerik = m[2].trim();
        const hedef = hedefiCoz(p, m[1]);
        if (!hedef) {
          hedefYok++;
          continue;
        }
        const hs = H.get(hedef)!;
        const nm = /^(\d+[a-z]?)\b/.exec(icerik);
        const q = /^"([^"]{3,})"/.exec(icerik);
        if (nm) {
          // ①′ — hedefte HİÇ numaralı başlık yoksa bu `§N` bir bölüm atfı DEĞİLDİR
          // (arıza sınıfı ya da satır numarası olabilir) ⇒ kapsam dışı.
          if (!hs.some((h) => h.numara)) {
            numarasizHedef++;
            continue;
          }
          numarali++;
          if (!hs.some((h) => h.numara === nm[1])) olu.push(`${p}:${idx + 1} → ${hedef} §${nm[1]}`);
        } else if (q) {
          tirnakli++;
          if (!hs.some((h) => h.metin.includes(q[1].trim()))) olu.push(`${p}:${idx + 1} → ${hedef} § "${q[1]}"`);
        } else {
          serbest++;
        }
      }

      // --- TERS sıra: `§ … (`X.md`)` — aynı semantik, değişen yalnız SIRA.
      for (const m of ln.matchAll(TERS)) {
        const ham = m[1].trim();
        const hedef = hedefiCoz(p, m[2]);
        if (!hedef) {
          hedefYok++;
          continue;
        }
        const hs = H.get(hedef)!;
        const nm = /^(\d+[a-z]?)\b/.exec(ham);
        if (nm) {
          if (!hs.some((h) => h.numara)) {
            tersKapsamDisi++;
            continue;
          }
          tersNumarali++;
          if (!hs.some((h) => h.numara === nm[1])) olu.push(`${p}:${idx + 1} → ${hedef} §${nm[1]} (ters)`);
          continue;
        }
        tersMetin++;
        // Tırnaklı yazım da AYIRT EDİCİ PARÇA alıntılar (kural ②) — iki aday denenir.
        const q = /^"(.+)"$/.exec(ham);
        const adaylar = q ? [ham, q[1].trim()] : [ham];
        if (!hs.some((h) => adaylar.some((a) => h.metin.includes(a)))) {
          olu.push(`${p}:${idx + 1} → ${hedef} § "${ham}" (ters)`);
        }
        if (p === DIZIN) dizinCiftleri.push({ hedef, icerik: ham });
      }
    });
  }

  // KÖRLÜK ZEMİNİ: kapsam içi hiç çapa bulunamazsa "ölü çapa yok" VAKUMEN doğru olur.
  check(
    "körlük zemini: kapsam içi çapa bulundu",
    numarali + tirnakli >= 50 && tersNumarali + tersMetin >= 50,
    `düz: ${numarali} numaralı + ${tirnakli} tırnaklı · ters: ${tersNumarali} numaralı + ${tersMetin} metin`,
  );
  check(
    "⭐ kapsam içi `§` çapası hedefini buluyor",
    olu.length === 0,
    olu.length === 0 ? `${numarali + tirnakli + tersNumarali + tersMetin} çapa çözüldü` : olu.join(" · "),
  );
  if (olu.length > 0) {
    console.log("   YAPILACAK: ya atfı yeni yere yönlendir, ya da hedefteki başlığı geri getir.");
  }

  // --- YÖN (b): dosyadaki her başlık DİZİNDE mi (dizin eksik kalamaz) ---
  const indekslenen = tum.filter((p) => OLCUM_DOSYA.test(p) && p !== DIZIN).sort();
  check("başlık dizini ve indekslediği dosyalar duruyor", H.has(DIZIN) && indekslenen.length >= 9, `${indekslenen.length} ölçüm dosyası · dizin: ${H.has(DIZIN) ? "var" : "YOK"}`);
  if (H.has(DIZIN)) {
    const eksik: string[] = [];
    let toplamBaslik = 0;
    for (const p of indekslenen) {
      for (const h of H.get(p)!) {
        if (h.duzey === 1) continue; // H1 = dosyanın kendi başlığı, sınıf değil
        toplamBaslik++;
        const var_ = dizinCiftleri.some((d) => d.hedef === p && d.icerik.length >= 8 && h.metin.includes(d.icerik));
        if (!var_) eksik.push(`${p} § ${h.metin.slice(0, 60)}`);
      }
    }
    check(
      "⭐ ölçüm dosyalarının HER başlığı dizinde",
      eksik.length === 0,
      eksik.length === 0 ? `${toplamBaslik} başlık ↔ ${dizinCiftleri.length} dizin satırı` : eksik.join(" · "),
    );
    if (eksik.length > 0) {
      console.log(`   YAPILACAK: ${DIZIN} içine satır ekle — başlık açan commit dizin satırını da taşır.`);
    }
    // Dizinin BEYAN ettiği sayılar da ölçülür — bir dizin, kendi sayısını bayatlatan
    // ilk yer olmamalıdır: toplam ("**140 başlık / 9 dosya**") ve dosya başına "(N başlık)".
    const dizinMetni = readFileSync(join(KOK, DIZIN), "utf8");
    const beyan = /\*\*(\d+) başlık \/ (\d+) dosya\*\*/.exec(dizinMetni);
    check(
      "dizinin beyan ettiği TOPLAM sayı ölçümle uyuşuyor",
      !!beyan && Number(beyan[1]) === toplamBaslik && Number(beyan[2]) === indekslenen.length,
      beyan ? `beyan ${beyan[1]}/${beyan[2]} · ölçülen ${toplamBaslik}/${indekslenen.length}` : "beyan satırı BULUNAMADI",
    );
    const sapan: string[] = [];
    let beyanliDosya = 0;
    for (const p of indekslenen) {
      const ad = basename(p);
      const m = new RegExp(`\\[\`${ad.replace(/\./g, "\\.")}\`\\][^|]*\\|[^|]*\\((\\d+) başlık\\)`).exec(dizinMetni);
      if (!m) continue;
      beyanliDosya++;
      const gercek = H.get(p)!.filter((h) => h.duzey > 1).length;
      if (Number(m[1]) !== gercek) sapan.push(`${ad}: beyan ${m[1]} ≠ ölçülen ${gercek}`);
    }
    check(
      "dizinin DOSYA BAŞINA beyan ettiği sayılar ölçümle uyuşuyor",
      sapan.length === 0 && beyanliDosya === indekslenen.length,
      sapan.length ? sapan.join(" · ") : `${beyanliDosya}/${indekslenen.length} dosya beyanı ölçüldü`,
    );
  }

  console.log(
    `\n   ⛔ BU KAPININ ÖLÇMEDİĞİ (yeşil "tüm § atıfları sağlam" DEMEK DEĞİLDİR):\n` +
      `      · Serbest metin / konu atfı: ${serbest} — başlık değil KONU gösteriyor, eşlenemez.\n` +
      `      · Hedefinde numaralı başlık olmayan \`§N\`: ${numarasizHedef} düz + ${tersKapsamDisi} ters —\n` +
      `        bu \`§\` bir bölüm değil arıza sınıfı ya da satır numarası olabilir; tahmin edilmez.\n` +
      `      · Dosya adı BİTİŞİK olmayan (düz) ya da parantezde TEK backtickli ad taşımayan\n` +
      `        (ters) \`§\` atıfları: kapsam DIŞI — ölçüldü 2026-09-13: gevşek ters yüklem 83 aday\n` +
      `        üretiyor ve ~80'i YANLIŞ POZİTİF (kural satırlarının \`<sub>(CLAUDE.md:N)</sub>\`\n` +
      `        dipnotu satır başındaki \`§N\` ile ilgisiz).\n` +
      `      · Hedef dosyası bulunamayan atıf: ${hedefYok} (repo dışı ad).\n` +
      `      · Çapanın DOĞRU bölümü gösterdiği ölçülmez — yalnız bölümün VAR olduğu.\n` +
      `      · Dizinin satırı DOĞRU dosyayı gösteriyor mu ölçülür; başlığın doğru DOSYADA\n` +
      `        durup durmadığı (sınıflandırma kararı) ölçülmez.\n`,
  );

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
