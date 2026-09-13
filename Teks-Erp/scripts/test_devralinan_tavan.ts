// =============================================================================
// BEKÇİ — `devralınan:` TAVANLARI SESSİZCE YÜKSELMEZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts devralinan_tavan
//
// ⭐ NEDEN VAR (5e'nin ölçümü, 2026-09-13): `docs/standart/*.md` kural satırları
//    `· devralınan: N` alanı taşır ve bu bir TAVANDIR — yalnız düşer. Bir tavan
//    SESSİZCE aşılmış: `[BE-29]` 18 → 30. (`[BE-30]` "53 → 78" de sanıldı;
//    78 kurala UYAN dosyaları da sayan bir grep'ti — gerçek 53, hiç yükselmedi.
//    Aynı grep bu bekçiye de girdi ve ilk kurbanı kurala uyan bir dosya oldu.)
//    Sebep tek cümle: **`lint-baseline.json`ın aksine bu alanı HİÇBİR KAPI
//    OKUMUYORDU.** Beyan edilmiş bir tavan, ölçülmediği sürece bir temennidir.
//
// ⚠️ VE ASIL TEHLİKE SAYININ KENDİSİ DEĞİL, GÜNCELLENMESİ: aşılmış bir tavanı
//    yeni değere çekmek onu ÖLÇMEK değil ONAYLAMAKTIR. O yüzden §1 tam olarak
//    bunu kovalar — belgedeki sayı YÜKSELİRSE kırmızı.
//
// ⚠️ BELGEDEN KOMUT ÇALIŞTIRILMAZ. 70 sayısal tavanın yalnız **2'si** satırında
//    çalıştırılabilir bir ölçüm komutu taşıyor (ölçüldü). "Satırdaki komutu koştur"
//    tasarımı hem 70'in 2'sini kapsardı hem de markdown'dan komut çalıştırmak
//    olurdu — bir belge dosyası, kabuk komutu kaynağı DEĞİLDİR. §2 o iki ölçümü
//    bekçinin İÇİNDE, elle yazılmış hâliyle yapar.
//
// ⭐ ÜÇ BOŞLUK 2026-09-14'te BİR DOSYA BÖLMESİYLE AÇIĞA ÇIKTI (5e; BACKEND.md →
//    BACKEND-HTTP.md). Üçü de "kapı yeşil ama korumuyor" sınıfındandı:
//    ① TAŞIMA ≠ YENİ — defterin anahtarı `dosya::kural` olduğu için taşınan 9
//       tavan "§1b YENİ tavan" diye raporlandı. Refleks (`--yaz`) aynı koşumda
//       gerçek bir yükseltmeyi de onaylardı.
//    ② `--yaz` KENDİ BAŞINA AÇIK BİR KAPIYDI: yükselen bir tavanı sessizce
//       yazıyordu. Artık REDDEDİYOR; bilinçli yükseltme `--yaz --yukselt` ister.
//       ⚠️ Ve yükseltme TAŞIMANIN ALTINA saklanabiliyordu (anahtar değiştiği için
//       düz karşılaştırma göremiyor) — reddin eşleşmesi §1'inkiyle AYNI yapıldı.
//    ③ §2'nin "tabanda yok" dalı YEŞİL basıyordu. Bölme sonrası GERCEK anahtarı
//       eski dosyayı gösterdi, karşılaştırma YAPILAMADI ve kapı ✅ dedi —
//       ölçülemeyen bir ölçüm geçmiş sayılmaz; artık KIRMIZI.
//
// SONDA MATRİSİ (ölçüldü 2026-09-14, `cp` + `sha256` ile geri alındı):
//   (a) kuralı dosyalar arası TAŞI, değer aynı → YEŞİL + "↔ TAŞINDI" satırı ·
//       `--yaz` anahtarı günceller, DEĞERİ korur (10 → 10)
//   (b) TAŞIRKEN değeri 1 artır          → §1a KIRMIZI ("TAŞINIRKEN … 10→11") ·
//       `--yaz` REDDEDER · `--yaz --yukselt` bilerek yazar (11)
//   (c) gerçekten YENİ kural              → §1b KIRMIZI (eski davranış korundu) ·
//       `--yaz` yazar (70 → 71 tavan)
//
// ⚠️ İKİ BÖLÜMÜN KAPSAMI FARKLI ve bu BEYAN EDİLİR:
//    §1 belgedeki SAYIYI dondurur  → 70/70 kapsar, GERÇEKLİĞİ ölçmez
//    §2 GERÇEKLİĞİ ölçer            →   2/70 kapsar
//    Yani §1 yeşilse "tavan aşılmadı" değil, **"tavan yükseltilmedi"** demektir.
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
const STANDART = join(KOK, "docs", "standart");
const TAVAN_DOSYA = join(KOK, "Teks-Erp", "devralinan-baseline.json");
const YAZ = process.argv.includes("--yaz");
/** `--yaz`ın tavan YÜKSELTMESİNE izin veren BİLİNÇLİ kapı — refleksle yazılamaz. */
const YUKSELT = process.argv.includes("--yukselt");

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

/** Belgelerdeki `[KURAL-KODU] … devralınan: N` çiftleri. Anahtar = kural kodu. */
function belgedekiTavanlar(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ad of readdirSync(STANDART).filter((f) => f.endsWith(".md"))) {
    for (const sat of readFileSync(join(STANDART, ad), "utf8").split("\n")) {
      const kod = sat.match(/^\s*-\s*\*\*\[([A-ZÇĞİÖŞÜ]+-\d+[a-z]?)\]\*\*/);
      const n = sat.match(/devralınan:\s*(\d+)/);
      if (kod && n) out[`${ad}::${kod[1]}`] = Number(n[1]);
    }
  }
  return out;
}

/**
 * §2'nin GERÇEKLİK ölçümleri — belgeden değil BURADAN.
 * Komutlar belgedeki satırların birebir karşılığı; değişirlerse ikisi BİRLİKTE
 * güncellenir (aynı "tek kaynak" borcu, ama en azından GÖRÜNÜR).
 */
const GERCEK: Record<string, () => number> = {
  // ⚠️ ÖZYİNELEMELİ — ve bu fark ÖLÇÜLEREK bulundu: ilk yazımda düz `readdirSync`
  // kullandım ve **18** çıktı, oysa belgedeki sayı **30**. Fark alt dizinler
  // (`helpers/codec`, `helpers/raster`). Düz sayımla taban 18'e donardı ve kapı
  // 12 yeni ihlali SESSİZCE geçirirdi. İki ölçüm ayrıştığında boru hattı
  // karşılaştırılır — sayı değil.
  "BACKEND.md::BE-29": () =>
    execFileSync("find", ["src/services/helpers", "-name", "*.ts"], {
      cwd: join(KOK, "Teks-Erp"),
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => l.trim() && !/\.helper\.ts$/.test(l))
      .length,
  // ⚠️ BE-30'un yasakladığı şey "handler başına verifyToken"dır; kuralın
  // ÖNERDİĞİ `router.use(verifyToken, requireXEnabled)` da aynı `verifyToken,`
  // literalini taşır. Düz grep ikisini birlikte saydı (78→79 "ihlali" kurala
  // UYAN bir dosyaydı). Ölçülen: toplu kapısı OLMAYAN ve handler'ında
  // `verifyToken,` geçen route dosyası.
  "BACKEND-HTTP.md::BE-30": () => {
    const ROUTES = join(KOK, "Teks-Erp", "src", "routes");
    const dosyalar = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d, { withFileTypes: true })) {
        if (n.isDirectory()) dosyalar(join(d, n.name), out);
        else if (n.name.endsWith(".ts")) out.push(join(d, n.name));
      }
      return out;
    };
    return dosyalar(ROUTES).filter((f) => {
      const satirlar = readFileSync(f, "utf8").split("\n");
      const topluKapi = satirlar.some((l) => /router\.use\(\s*verifyToken/.test(l));
      const handlerBasina = satirlar.some(
        (l) => /verifyToken,/.test(l) && !/router\.use\(/.test(l) && !/^\s*\/\//.test(l) && !/\bimport\b/.test(l),
      );
      return handlerBasina && !topluKapi;
    }).length;
  },
};

function main(): void {
  console.log("=== `devralınan:` tavanları ===\n");
  const bugun = belgedekiTavanlar();
  // KÖRLÜK ZEMİNİ: ayrıştırıcı boşa düşerse "tavan yükselmedi" ile "hiç bakmadım"
  // aynı yeşile çıkar.
  check("§0 körlük zemini: belgelerden sayısal tavan çözüldü", Object.keys(bugun).length >= 50, `${Object.keys(bugun).length} kural`);

  if (YAZ) {
    // ⚠️ `--yaz` KENDİ BAŞINA BİR KAPIYDI ve AÇIKTI (ölçüldü 2026-09-14): bir tavanı
    // yükselten değişiklikte `--yaz` yeni sayıyı SESSİZCE yazıyordu — bu dosyanın
    // kendi başlığı bunu yasaklıyor ("aşılmış bir tavanı yeni değere çekmek onu
    // ÖLÇMEK değil ONAYLAMAKTIR"), ama hiçbir şey zorlamıyordu. Kırmızıyı gören
    // operatörün ilk refleksi zaten çıktıdaki `--yaz`dır. ⇒ Yükseltme artık
    // BİLİNÇLİ bir bayrak ister; taşıma ve düşüş serbest kalır.
    if (existsSync(TAVAN_DOSYA) && !YUKSELT) {
      const oncekiTaban = JSON.parse(readFileSync(TAVAN_DOSYA, "utf8")) as { belge: Record<string, number> };
      // ⚠️ Yükseltme TAŞIMANIN ALTINA saklanabilir: kural başka dosyaya geçtiğinde
      // anahtar da değiştiği için düz `k in taban` karşılaştırması onu GÖREMEZ.
      // (Ölçüldü 2026-09-14: ilk yazımda tam bu yüzden 10→11'i sessizce yazdı.)
      // ⇒ Eşleşme §1'deki ile AYNI: önce anahtar, yoksa kural KODU.
      const oncekiDeger = (k: string): number | undefined => {
        if (k in oncekiTaban.belge) return oncekiTaban.belge[k];
        const kod = k.split("::")[1];
        for (const [ek, ev] of Object.entries(oncekiTaban.belge)) {
          if (ek.split("::")[1] === kod && !(ek in bugun)) return ev;
        }
        return undefined;
      };
      const yukseltecek = Object.entries(bugun)
        .map(([k, v]) => [k, v, oncekiDeger(k)] as const)
        .filter((x): x is readonly [string, number, number] => x[2] !== undefined && x[1] > x[2])
        .map(([k, v, e]) => [k, v, e] as [string, number, number]);
      if (yukseltecek.length > 0) {
        console.error(`❌ --yaz REDDEDİLDİ: ${yukseltecek.length} tavan YÜKSELİYOR — bir tavanı yeni değere çekmek onu ölçmek değil ONAYLAMAKTIR.`);
        for (const [k, v, e] of yukseltecek) console.error(`    ${k}  ${e} → ${v}`);
        console.error("    → Ya ihlali düzelt, ya yükseltmeyi BİLEREK onayla: --yaz --yukselt (ve gerekçesini commit mesajına yaz).");
        process.exit(1);
      }
    }
    const gercek: Record<string, number> = {};
    for (const [k, fn] of Object.entries(GERCEK)) gercek[k] = fn();
    writeFileSync(
      TAVAN_DOSYA,
      `${JSON.stringify(
        {
          _not: "`devralınan:` TAVAN defteri — yalnız DÜŞER. Ölçüm: npx tsx scripts/test_devralinan_tavan.ts --yaz",
          _belge: "belgedeki SAYI (yükselirse kırmızı) — gerçekliği ölçmez",
          _gercek: "GERÇEKLİK ölçümü (yalnız 2 kural; bekçinin içinde, belgeden komut çalıştırılmaz)",
          belge: Object.fromEntries(Object.entries(bugun).sort()),
          gercek: Object.fromEntries(Object.entries(gercek).sort()),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\n✍️  taban yazıldı — ${Object.keys(bugun).length} belge tavanı · ${Object.keys(gercek).length} gerçeklik ölçümü`);
    process.exit(0);
  }

  if (!existsSync(TAVAN_DOSYA)) {
    check("taban dosyası var", false, "önce --yaz ile üret");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  const taban = JSON.parse(readFileSync(TAVAN_DOSYA, "utf8")) as {
    belge: Record<string, number>;
    gercek: Record<string, number>;
  };

  console.log("\n§1 — belgedeki sayı YÜKSELMEDİ (70/70 kapsar, gerçekliği ÖLÇMEZ)");
  const yukselen = Object.entries(bugun).filter(([k, v]) => k in taban.belge && v > taban.belge[k]!);
  // TAŞIMA ≠ YENİ (2026-09-14): defterin anahtarı `dosya::kural`, dolayısıyla bir
  // dosya BÖLÜNDÜĞÜNDE taşınan her tavan "yeni" görünür. Bedeli teorik değil:
  // operatör refleksle `--yaz` koşarsa aynı koşumda GERÇEKTEN yükseltilmiş bir
  // tavan da sessizce onaylanır — oysa bu bekçinin varlık sebebi tam olarak o.
  // ⇒ Aynı kural KODU tabandan kaybolup başka dosyada belirdiyse bu bir TAŞIMADIR.
  // ⚠️ Eşleşme kural KODUNA dayanır ve bu, kodun docs/standart genelinde TEKİL
  //    olmasına yaslanır — o tekilliği `scripts/check-docs.mjs` § kural KİMLİĞİ
  //    kapısı zorlar. O kapı kalkarsa buradaki eşleşme de güvenilmez olur.
  const kodOf = (k: string): string => k.split("::")[1] ?? k;
  const kayipAnahtar = new Map<string, string>();
  for (const k of Object.keys(taban.belge)) if (!(k in bugun)) kayipAnahtar.set(kodOf(k), k);
  const tasinan: string[] = [];
  const tasinirkenYukselen: string[] = [];
  const yeni: string[] = [];
  for (const k of Object.keys(bugun)) {
    if (k in taban.belge) continue;
    const eskiAnahtar = kayipAnahtar.get(kodOf(k));
    if (eskiAnahtar === undefined) {
      yeni.push(k);
      continue;
    }
    const eskiDeger = taban.belge[eskiAnahtar]!;
    const yeniDeger = bugun[k]!;
    if (yeniDeger > eskiDeger) tasinirkenYukselen.push(`${eskiAnahtar} → ${k} ${eskiDeger}→${yeniDeger}`);
    else tasinan.push(`${eskiAnahtar} → ${k}${yeniDeger < eskiDeger ? ` (${eskiDeger}→${yeniDeger} ↓)` : ""}`);
  }
  check(
    "§1a ⭐ hiçbir `devralınan:` tavanı YÜKSELTİLMEMİŞ (taşınırken de değil)",
    yukselen.length === 0 && tasinirkenYukselen.length === 0,
    [...yukselen.map(([k, v]) => `${k} ${taban.belge[k]}→${v}`), ...tasinirkenYukselen.map((t) => `TAŞINIRKEN ${t}`)].join(" · ") ||
      "temiz",
  );
  check(
    "§1b YENİ tavan eklendiyse tabana da yazılmış",
    yeni.length === 0,
    yeni.length ? `${yeni.length} yeni: ${yeni.slice(0, 3).join(" · ")} → --yaz` : "yeni yok",
  );
  if (tasinan.length) {
    console.log(`   ↔ ${tasinan.length} tavan TAŞINDI (değer korunarak; §1b'nin konusu değil): ${tasinan.join(" · ")}`);
    console.log(`     → defterdeki anahtarı güncellemek için: --yaz`);
  }
  const dusen = Object.entries(bugun).filter(([k, v]) => k in taban.belge && v < taban.belge[k]!);
  if (dusen.length) console.log(`   ↓ ${dusen.length} tavan DÜŞMÜŞ — sıkıştırılabilir: --yaz`);

  console.log("\n§2 — GERÇEKLİK ölçümü (yalnız 2 kural; belgeden komut ÇALIŞTIRILMAZ)");
  for (const [k, fn] of Object.entries(GERCEK)) {
    const n = fn();
    const t = taban.gercek?.[k];
    // ⚠️ "tabanda yok" ÜÇÜNCÜ SONUÇTUR ve YEŞİL DEĞİLDİR (ölçüldü 2026-09-14):
    // bu dal 2026-09-14'te BİR KEZ gerçekleşti — BE-30 başka dosyaya taşındı, defter
    // anahtarı güncellendi ama buradaki GERCEK anahtarı eski kaldı ⇒ karşılaştırma
    // yapılamadı ve kapı "✅ tabanda yok" bastı. Ölçülemeyen bir ölçüm geçmiş sayılmaz.
    check(
      `§2 ⭐ ${k} gerçek sayı ARTMADI`,
      t !== undefined && n <= t,
      t === undefined
        ? `ÖLÇÜLEMEDİ — defterde \`${k}\` yok (anahtar taşındı mı? GERCEK ile defter AYRI yerlerde yaşıyor) → --yaz`
        : `${n} ${n <= t ? "≤" : ">"} ${t}`,
    );
  }
  console.log(
    `   ⚠️ KAPSAM: §1 belgedeki SAYIYI dondurur (70/70) ama GERÇEKLİĞİ ölçmez;\n` +
      `      §2 gerçekliği ölçer ama yalnız 2 kuralda. §1 yeşilse "tavan aşılmadı" DEĞİL,\n` +
      `      "tavan YÜKSELTİLMEDİ" demektir.`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
