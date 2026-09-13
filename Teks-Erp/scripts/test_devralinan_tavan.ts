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
  "BACKEND.md::BE-30": () => {
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
          gercek,
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
  const yeni = Object.keys(bugun).filter((k) => !(k in taban.belge));
  check(
    "§1a ⭐ hiçbir `devralınan:` tavanı YÜKSELTİLMEMİŞ",
    yukselen.length === 0,
    yukselen.length ? yukselen.map(([k, v]) => `${k} ${taban.belge[k]}→${v}`).join(" · ") : "temiz",
  );
  check(
    "§1b YENİ tavan eklendiyse tabana da yazılmış",
    yeni.length === 0,
    yeni.length ? `${yeni.length} yeni: ${yeni.slice(0, 3).join(" · ")} → --yaz` : "yeni yok",
  );
  const dusen = Object.entries(bugun).filter(([k, v]) => k in taban.belge && v < taban.belge[k]!);
  if (dusen.length) console.log(`   ↓ ${dusen.length} tavan DÜŞMÜŞ — sıkıştırılabilir: --yaz`);

  console.log("\n§2 — GERÇEKLİK ölçümü (yalnız 2 kural; belgeden komut ÇALIŞTIRILMAZ)");
  for (const [k, fn] of Object.entries(GERCEK)) {
    const n = fn();
    const t = taban.gercek?.[k];
    check(
      `§2 ⭐ ${k} gerçek sayı ARTMADI`,
      t === undefined || n <= t,
      t === undefined ? "tabanda yok → --yaz" : `${n} ${n <= t ? "≤" : ">"} ${t}`,
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
