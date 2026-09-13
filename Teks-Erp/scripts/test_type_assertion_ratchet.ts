// =============================================================================
// BEKÇİ — TİP ZORLAMASI MANDALI (iki küme, yalnız KÜÇÜLÜR)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts type_assertion_ratchet
// Tavanı güncelle (küme küçüldüyse): npx tsx scripts/test_type_assertion_ratchet.ts --yaz
//
// ⭐ NEDEN VAR (2026-09-13): `as unknown as` bir çağrı yerini TİP KAPISININ
//    MENZİLİNDEN ÇIKARIR — ve imza değişikliğinin en çok uyarı gerektirdiği
//    yerler tam onlardır.
//
// ⚠️ VE DERSİ ŞUDUR: "MEŞRU" ile "KÖR DEĞİL" AYRI EKSENLERDİR.
//    `as unknown as`ın en yoğun kullanıcısı bekçilerdir ve bu MEŞRU bir kalıptır
//    (özel metoda test erişimi, sahte `Request`). Bu yüzden "bekçi ⇒ sorun yok"
//    diye onaylandı. Sonra `buildRollWhere`a yeni bir `fireCodes` parametresi
//    eklendi; `test_inventory_shipment_scope` o metoda TAM BU YOLDAN erişiyordu,
//    derleyici SUSTU ve bekçi çalışma zamanında `TypeError` ile düştü.
//    ⚠️ Dosyanın kendi başlığı tuzağı ADIYLA yazıyordu — ve tuzak yine işledi:
//    yazılı bir uyarı bir kapı değildir.
//
// ⚠️ SAYI DEĞİL KÜME DONDURULUR. "14" bir sayı olarak dondurulsaydı, bir sitenin
//    yerine başkası geçtiğinde kapı YEŞİL kalırdı — bugünkü "sessiz kapı ölümü"
//    sınıfının birebir kendisi. Anahtar `dosya::hedef` (ya da `dosya::örnek`):
//    satır numarasından bağımsızdır, yani biçimlendirme kümeyi oynatmaz.
//
// ⚠️ SINIFLANDIRMA DESEN BAZLIDIR, her site tek tek OKUNMADI. Kümeyi dondurmak
//    bu sınırı zararsız kılar (yeni site ADIYLA çıkar), ama "14" bir ÖLÇÜMDÜR,
//    bir envanter değildir.
//
// İKİ KÜME, ÇÜNKÜ ÇÖZÜMLERİ FARKLI:
//   A) `src/` — NESNE LİTERALİ UYDURULUYOR: `{ … } as unknown as Roll`. Burada tip
//      hiçbir şey doğrulamaz; alan eklense/kalksa/değişse derleyici susar.
//      Çözüm: tipi gerçekten yaz ya da eksik alanı ver.
//      ⚠️ Kapsam dışı (KÖPRÜ, F değil): kaynağı bir DEĞİŞKEN olan zorlamalar
//      (`snapshot.doc as unknown as XDoc`) — orada tip ifade edilemiyor (JSON
//      sınırı), zorlama bir iddia değil bir köprüdür.
//   B) `scripts/` — ÖRNEĞİ NESNE TİPİNE GENİŞLETME: `(inv as unknown as { … })`,
//      yani özel üyeye erişim. Çözüm: üyeyi `internal` olarak dışa açmak ya da
//      çağrıyı GERÇEK İMZAYLA yazan tek bir yardımcı.
//      ⚠️ Sahte `Request` nesneleri (122 site) bu kümede DEĞİL: onlar test-double
//      kalıbıdır ve imza körlüğü üretmezler.
// =============================================================================
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = join(__dirname, "..");
const TAVAN_DOSYA = join(KOK, "type-assertion-baseline.json");
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

function tsDosyalari(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) tsDosyalari(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** A kümesi: `{ … } as unknown as X` — kaynak bir NESNE LİTERALİ. */
function kumeA(): Map<string, number> {
  const kume = new Map<string, number>();
  for (const f of tsDosyalari(join(KOK, "src"))) {
    for (const sat of readFileSync(f, "utf8").split("\n")) {
      const t = sat.trim();
      if (t.startsWith("//") || t.startsWith("*")) continue;
      let i = -1;
      while ((i = sat.indexOf("as unknown as", i + 1)) >= 0) {
        if (!sat.slice(0, i).trimEnd().endsWith("}")) continue;
        const hedef = sat
          .slice(i + "as unknown as".length)
          .trim()
          .replace(/[;,)\]]+$/, "")
          .replace(/\s+/g, " ")
          .slice(0, 60);
        const k = `${relative(KOK, f)}::${hedef}`;
        kume.set(k, (kume.get(k) ?? 0) + 1);
      }
    }
  }
  return kume;
}

/** B kümesi: `(<örnek> as unknown as { … })` — özel üyeye erişim için genişletme. */
function kumeB(): Map<string, number> {
  const kume = new Map<string, number>();
  for (const f of tsDosyalari(join(KOK, "scripts"))) {
    // ⚠️ YORUM SATIRLARI ELENİR ama METİN BÜTÜN KALIR. İlk yazımda yorum elenmiyordu
    // ve bekçi KENDİ başlığındaki örneği sayıyordu (B 24 → 26). İkinci yazımda
    // satır satır tarandı ve bu sefer ÇOK SATIRLI eşleşmeler düştü — `inv as
    // unknown as {` kalıbında açan parantez BİR ÖNCEKİ satırdaydı ve vakanın
    // kendisi kümeden çıktı. İki kusur da §0c sondası tarafından yakalandı.
    const src = readFileSync(f, "utf8")
      .split("\n")
      .map((sat) => (sat.trim().startsWith("//") || sat.trim().startsWith("*") ? "" : sat))
      .join("\n");
    for (const m of src.matchAll(/\(\s*([A-Za-z_$][\w$.]*)\s+as unknown as\s*\{/g)) {
      const k = `${relative(KOK, f)}::${m[1]}`;
      kume.set(k, (kume.get(k) ?? 0) + 1);
    }
  }
  return kume;
}

type Taban = { A: Record<string, number>; B: Record<string, number> };

function mandal(ad: string, bugun: Map<string, number>, taban: Record<string, number>): void {
  const yeniler = [...bugun.keys()].filter((k) => !(k in taban));
  const artanlar = [...bugun].filter(([k, v]) => k in taban && v > taban[k]!);
  const kalkanlar = Object.keys(taban).filter((k) => !bugun.has(k));

  const toplam = [...bugun.values()].reduce((a, b) => a + b, 0);
  const tabanToplam = Object.values(taban).reduce((a, b) => a + b, 0);
  console.log(`\n${ad}: bugün ${toplam} site / ${bugun.size} anahtar · devralınan ${tabanToplam} / ${Object.keys(taban).length}`);

  check(
    `${ad} ⭐ YENİ tip zorlaması YOK (küme yalnız küçülür)`,
    yeniler.length === 0,
    yeniler.length ? `${yeniler.length} YENİ: ${yeniler.slice(0, 4).join(" · ")}` : "temiz",
  );
  check(
    `${ad} ⭐ mevcut anahtarlarda site sayısı ARTMADI`,
    artanlar.length === 0,
    artanlar.length ? artanlar.map(([k, v]) => `${k} ${taban[k]}→${v}`).join(" · ") : "temiz",
  );
  if (kalkanlar.length) console.log(`   ↓ küme sıkışıyor: ${kalkanlar.length} anahtar kalktı (${kalkanlar.slice(0, 3).join(" · ")})`);
}

function main(): void {
  console.log("=== Tip zorlaması mandalı ===\n");
  const A = kumeA();
  const B = kumeB();

  // KÖRLÜK ZEMİNİ: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkar.
  check("§0a körlük zemini: src/ tarandı ve A kümesi boş değil", A.size > 0, `${A.size} anahtar`);
  check("§0b körlük zemini: scripts/ tarandı ve B kümesi boş değil", B.size > 0, `${B.size} anahtar`);
  check(
    "§0c ⭐ sonda: yüklem GERÇEKTEN ayırıyor (vakanın kendisi B'de)",
    [...B.keys()].some((k) => k.includes("test_inventory_shipment_scope")),
    "fireCodes vakası kümede",
  );

  if (YAZ) {
    writeFileSync(
      TAVAN_DOSYA,
      `${JSON.stringify(
        {
          _not: "Tip zorlaması MANDALI — küme yalnız KÜÇÜLÜR. Ölçüm: npx tsx scripts/test_type_assertion_ratchet.ts --yaz",
          _A: "src/ — nesne literali uyduruluyor ({…} as unknown as X)",
          _B: "scripts/ — örneği nesne tipine genişletme ((x as unknown as {…}))",
          A: Object.fromEntries([...A].sort()),
          B: Object.fromEntries([...B].sort()),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\n✍️  tavan yazıldı — A ${A.size} anahtar · B ${B.size} anahtar`);
    process.exit(0);
  }

  if (!existsSync(TAVAN_DOSYA)) {
    check("taban dosyası var", false, `${TAVAN_DOSYA} yok — önce --yaz ile üret`);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  const taban = JSON.parse(readFileSync(TAVAN_DOSYA, "utf8")) as Taban;
  mandal("§1 A (src/ nesne literali)", A, taban.A ?? {});
  mandal("§2 B (scripts/ örnek genişletme)", B, taban.B ?? {});

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
