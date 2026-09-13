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
// KAPSAM DIŞI olan üç sınıf SAYIYLA BASILIR — yeşilin neyi kapsamadığı görünsün.
//
// NEGATİF SONDA (üçü de ölçüldü 2026-09-13, atılabilir `GIT_INDEX_FILE` üstünde):
//   ① numaralı ölü çapa eklendi → KIRMIZI, dosya:satır + hedef bastı
//   ② tırnaklı ölü çapa eklendi → KIRMIZI
//   ③ serbest metin/konu atfı bozuldu → YEŞİL (kapsam dışı olduğu basıldı)
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
/** Hedef: repodaki HER `.md` (kök `CLAUDE.md`, alt proje `CLAUDE.md`'leri dâhil). */
function mdDosyalari(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: KOK, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

type Baslik = { metin: string; numara: string | null };
function basliklar(rel: string): Baslik[] {
  const out: Baslik[] = [];
  for (const ln of readFileSync(join(KOK, rel), "utf8").split("\n")) {
    if (!/^#{1,6}\s/.test(ln)) continue;
    const metin = ln.replace(/^#{1,6}\s*/, "").trim();
    const n = /^(\d+[a-z]?)\b/.exec(metin.replace(/^§\s*/, ""));
    out.push({ metin, numara: n ? n[1] : null });
  }
  return out;
}

/** BİTİŞİK yazım: `X.md` (+ Türkçe ek) § <içerik>. Tahmin YOK. */
const CAPA = /`?([A-Za-z0-9._/-]+\.md)`?['’a-zçğıöşü]{0,4}\s{0,2}§\s*([^\n]{0,80})/g;

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
  const olu: string[] = [];

  for (const p of kaynak) {
    const dirn = dirname(p);
    readFileSync(join(KOK, p), "utf8").split("\n").forEach((ln, idx) => {
      for (const m of ln.matchAll(CAPA)) {
        const ad = m[1];
        const icerik = m[2].trim();
        const goreli = normalize(join(dirn, ad));
        const hedef = H.has(goreli) ? goreli : H.has(ad) ? ad : adIndeksi.get(basename(ad));
        if (!hedef || !H.has(hedef)) {
          hedefYok++;
          return;
        }
        const hs = H.get(hedef)!;
        const nm = /^(\d+[a-z]?)\b/.exec(icerik);
        const q = /^"([^"]{3,})"/.exec(icerik);
        if (nm) {
          // ①′ — hedefte HİÇ numaralı başlık yoksa bu `§N` bir bölüm atfı DEĞİLDİR
          // (arıza sınıfı ya da satır numarası olabilir) ⇒ kapsam dışı.
          if (!hs.some((h) => h.numara)) {
            numarasizHedef++;
            return;
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
    });
  }

  // KÖRLÜK ZEMİNİ: kapsam içi hiç çapa bulunamazsa "ölü çapa yok" VAKUMEN doğru olur.
  check("körlük zemini: kapsam içi çapa bulundu", numarali + tirnakli >= 50, `${numarali} numaralı + ${tirnakli} tırnaklı`);
  check(
    "⭐ kapsam içi `§` çapası hedefini buluyor",
    olu.length === 0,
    olu.length === 0 ? `${numarali + tirnakli} çapa çözüldü` : olu.join(" · "),
  );
  if (olu.length > 0) {
    console.log("   YAPILACAK: ya atfı yeni yere yönlendir, ya da hedefteki başlığı geri getir.");
  }

  console.log(
    `\n   ⛔ BU KAPININ ÖLÇMEDİĞİ (yeşil "tüm § atıfları sağlam" DEMEK DEĞİLDİR):\n` +
      `      · Serbest metin / konu atfı: ${serbest} — başlık değil KONU gösteriyor, eşlenemez.\n` +
      `      · Hedefinde numaralı başlık olmayan \`§N\`: ${numarasizHedef} — bu \`§\` bir bölüm\n` +
      `        değil arıza sınıfı ya da satır numarası olabilir; tahmin edilmez.\n` +
      `      · Dosya adı BİTİŞİK olmayan \`§\` atıfları: kapsam DIŞI — hangi belgeye ait\n` +
      `        oldukları satırdan mekanik olarak çıkarılamaz (ölçüldü: geniş yüklem ~40\n` +
      `        yanlış pozitif üretiyordu; tasarım belgeleri KENDİ bölümlerine atıf yapıyor).\n` +
      `      · Hedef dosyası bulunamayan atıf: ${hedefYok} (repo dışı ad).\n` +
      `      · Çapanın DOĞRU bölümü gösterdiği ölçülmez — yalnız bölümün VAR olduğu.\n`,
  );

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
