// =============================================================================
// BEKÇİ — ÖLÇÜM İDDİASI NİTELENDİRİLİR: sayı ya HESAPLANIR ya İZİNİ TAŞIR
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts olcum_iddiasi
//
// ⭐ NEDEN VAR (01'in bulgusu, 2026-09-13): `test_audit_labels`ın beyan
//    metinlerindeki SAYILAR bayatlamıştı — `PLANNED 3→4` · `COMPLETED 6→7` ·
//    `CANCELLED 14→15` — ve bekçi yalnız gerekçenin VARLIĞINI arıyordu, sayıyı
//    ölçmüyordu. 01 düzeltti, ama **bayat bırakabilirdi ve kimse görmezdi.**
//
// ⚠️ KURAL ZATEN YAZILI, EKSİK OLAN ZORLAMA: *"sayı ÜRETEN KOMUTUYLA yazılır"*
//    (`docs/standart/OLCUM-DISIPLINI.md`). Bu gece bu şeklin üçüncü vakası —
//    `devralınan:` tavanları ve `ILKELER.md:40` de aynıydı: **kural var, kapı yok.**
//    Ve kapının yokluğu ısırığın YERİNİ önceden söylüyor: 01'in bayat sayıları
//    tam da aşağıdaki "çıplak" kümenin içindeydi (`test_audit_labels:5`, `:221`).
//
// ⭐ YÜKLEM — ve neden "sayı yazılmasın" DEĞİL:
//    Ölçüldü: ölçüm iddiası taşıyan 250 yorum satırının **168'i (%67) zaten
//    tarihini taşıyor**. Ev bu kuralı çoktan uyguluyor. Sayıyı atmak BİLGİYİ
//    atmak olurdu; eksik olan NİTELENDİRME.
//      ⇒ *Bir sayı, ölçülemediği yerde YAZILMAZ değil — ölçülemediği yerde
//        NİTELENDİRİLMEDEN yazılmaz.* Tarih "ne zaman", komut "nasıl" der;
//        ikisi de yoksa sayı bir İDDİADIR ve yanlışlanamaz.
//
// ⚠️ KAPSAM DAR VE BU BİLİNÇLİ — sınırı aşağıda kapı kendi ağzından basar:
//    Kaba tarama 352 satır / 170 dosya buldu. İki daraltma:
//      · `${…}` ile HESAPLANAN 29 satır elendi — bayatlayamazlar.
//      · Kalan 258 sabit sayının ÇOĞU FİKSTÜR sayısıdır ("3 kayıt bekleniyor")
//        ve ağaç hakkında bir iddia taşımaz ⇒ bayatlamaz.
//    ⚠️ Fikstür sayısı ile AĞAÇ İDDİASI **sözdizimsel olarak ayırt edilemez**
//    (6e'nin `IS_ANAHTARI` sorunuyla aynı sınıf). ⇒ Hedef, ayırt EDİLEBİLEN alt
//    küme: yorum satırında *"ölçüldü/ölçüm"* + sayı.
//
// ⚠️ TANECİK KIPIRDAMAYLA SEÇİLDİ (30 commit, ölçüldü):
//      dosya        62 → 62   kıpırdama  2   ← seçilen
//      dosya:satır  83 → 81   kıpırdama 16   ← her yorum düzenlemesinde oynar
//    Satır taneciği körü körüne güncellenir ve kapı iki haftada ölür.
//    ⚠️ BEDELİ: aynı dosyaya İKİNCİ bir çıplak iddia eklemek mandalı UYANDIRMAZ.
//    Bu, `dosya::model` taneciğiyle aynı sınıf bedeldir ve burada beyan edilir.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS = __dirname;
const TABAN_DOSYA = join(SCRIPTS, "olcum-iddiasi-baseline.json");
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

const IDDIA = /(ölçüldü|ölçüm|olculdu|olcum|measured)/i;
const SAYI = /\b\d{2,6}\b/;
const TARIH = /20\d\d-\d\d-\d\d/;
/** İzini taşıyan komut: ölçümü ÜRETEN çağrı. */
const KOMUT = /`[^`]*(grep|find|git |npx|node |SELECT|psql|wc )[^`]*`/;

/**
 * Tabanın ÖLÇÜLDÜĞÜ ağacın damgası.
 *
 * ⚠️ 6e'nin uyarısı (2026-09-13) ve bu kapıya da AYNEN uyuyor: taban
 * `scripts/test_*.ts`ten TÜRETİLİYOR ve o ağaç her commit'te oynuyor. Benim
 * kendi `848f84f3` dilimim ~20 bekçiye dokundu ve 6e'nin tabanını 174→173
 * kaydırdı; aynı dilim BU kapının tabanını da 62→63 yaptı.
 *   ⇒ *İki değişiklik hiçbir DOSYADA kesişmeden aynı ÖLÇÜMDE kesişebilir.*
 * Damga olmadan bir sonraki okuyan iki sayı arasındaki farkı "yeni ihlal"
 * sanar; damgayla "başka bir ağaçta ölçülmüş" olduğunu görür.
 */
function agacDamgasi(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: SCRIPTS, encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
}

interface Bulgu {
  dosya: string;
  satir: number;
  metin: string;
}

/** Yorum satırında ölçüm iddiası + sayı taşıyan, ama izi OLMAYAN satırlar. */
function ciplakIddialar(): Bulgu[] {
  const out: Bulgu[] = [];
  for (const ad of readdirSync(SCRIPTS).filter((f) => /^test_.*\.ts$/.test(f))) {
    const satirlar = readFileSync(join(SCRIPTS, ad), "utf8").split("\n");
    satirlar.forEach((l, i) => {
      const t = l.trim();
      if (!t.startsWith("//") && !t.startsWith("*")) return;
      if (!IDDIA.test(t) || !SAYI.test(t)) return;
      if (TARIH.test(t) || KOMUT.test(t)) return; // izi VAR → meşru
      out.push({ dosya: ad, satir: i + 1, metin: t.slice(0, 100) });
    });
  }
  return out;
}

/**
 * GÖMÜLÜ SONDA — kapı ÖNCE kendini sınar (fail-closed).
 *
 * ⚠️ Sınıflandırıcı bozulursa *"0 çıplak iddia"* ile *"hiç bakılmadı"* aynı
 * görünür. Bu gece bu sınıfın altı vakası çıktı; kapının kendi körlüğünü
 * ölçmenin tek yolu, sondayı ARACIN İÇİNE koymaktır — dışarıda kalırsa ilk
 * düzenlemede kaybolur.
 */
function kendiniSina(): { gecti: boolean; satirlar: string[] } {
  const vakalar: [string, boolean][] = [
    ["// Ölçüldü: 239 enum değeri paylaşımlı", true], // çıplak → YAKALANMALI
    ["// Ölçüm (2026-09-13): 239 enum değeri", false], // tarihli → elenmeli
    ["// Ölçüldü: 239 değer (`grep -c foo src`)", false], // komutlu → elenmeli
    ["// Ölçüldü: üç değer paylaşımlı", false], // sayı YOK → elenmeli
    ["const x = 239; // 239 kayıt", false], // iddia YOK → elenmeli
  ];
  const satirlar: string[] = [];
  let gecti = true;
  for (const [metin, beklenen] of vakalar) {
    const t = metin.trim();
    const yorum = t.startsWith("//") || t.startsWith("*");
    const bulundu = yorum && IDDIA.test(t) && SAYI.test(t) && !TARIH.test(t) && !KOMUT.test(t);
    const ok = bulundu === beklenen;
    gecti &&= ok;
    satirlar.push(`${ok ? "✓" : "✗"} ${beklenen ? "yakalanmalı" : "elenmeli"}: ${metin.slice(0, 58)}`);
  }
  return { gecti, satirlar };
}

function main(): void {
  console.log("=== Ölçüm iddiası nitelendirilir ===\n");

  // ⚠️ FAIL-CLOSED: sınıflandırıcı bozuksa taban ANLAMSIZDIR ve mandal neyin
  // dondurulduğunu söyleyemez. Arıza ARACIN KENDİSİNDE ve aracı düzeltmek tek
  // kişinin işi — yabancı bir WIP'e bağlı değil ⇒ KIRMIZI, beyan değil.
  const sonda = kendiniSina();
  for (const s of sonda.satirlar) console.log(`   ${s}`);
  check("§0 ⭐ gömülü sonda: sınıflandırıcı çalışıyor", sonda.gecti, `${sonda.satirlar.length} vaka`);
  if (!sonda.gecti) {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }

  const bulgular = ciplakIddialar();
  const dosyalar = [...new Set(bulgular.map((b) => b.dosya))].sort();

  console.log(
    `\n   ⚠️ KAPSAM: yalnız YORUM satırındaki "ölçüldü/ölçüm" + sayı kalıbı.\n` +
      `      FİKSTÜR sayıları ("3 kayıt bekleniyor") ve \`\${…}\` ile hesaplananlar KAPSAM DIŞI —\n` +
      `      ayrım ANLAMSALDIR ve sözdizimsel olarak yapılamaz.\n` +
      `      Tanecik DOSYA: aynı dosyaya İKİNCİ bir çıplak iddia eklemek mandalı UYANDIRMAZ\n` +
      `      (satır taneciği 30 commit'te 16 kıpırdıyor, dosya taneciği 2).\n` +
      `      ⇒ Yeşil "her sayı nitelendirilmiş" DEĞİL, "çıplak iddia taşıyan DOSYA kümesi büyümedi" demektir.`,
  );

  // KÖRLÜK ZEMİNİ: desen boşa düşerse "0 çıplak" ile "hiç taranmadı" aynı yeşile çıkar.
  const taranan = readdirSync(SCRIPTS).filter((f) => /^test_.*\.ts$/.test(f)).length;
  check("§0z körlük zemini: bekçi dosyaları tarandı", taranan >= 100, `${taranan} dosya`);

  if (YAZ) {
    writeFileSync(TABAN_DOSYA, `${JSON.stringify({ _not: "ÇIPLAK ölçüm iddiası taşıyan DOSYA kümesi — yalnız KÜÇÜLÜR. Ölçüm: --yaz", _agac: agacDamgasi(), dosyalar }, null, 2)}\n`);
    console.log(`\n✍️  taban yazıldı — ${dosyalar.length} dosya (${bulgular.length} çıplak iddia)`);
    process.exit(0);
  }
  if (!existsSync(TABAN_DOSYA)) {
    check("taban dosyası var", false, "önce --yaz");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  const taban = new Set((JSON.parse(readFileSync(TABAN_DOSYA, "utf8")) as { dosyalar: string[] }).dosyalar);
  const yeni = dosyalar.filter((d) => !taban.has(d));
  const kalkan = [...taban].filter((d) => !dosyalar.includes(d));

  console.log(`\n§1 — mandal: çıplak iddia taşıyan DOSYA kümesi yalnız küçülür`);
  console.log(`   bugün ${dosyalar.length} dosya · devralınan ${taban.size} · ${bulgular.length} çıplak iddia`);
  check(
    "⭐ ÇIPLAK ölçüm iddiası taşıyan YENİ dosya YOK",
    yeni.length === 0,
    yeni.length
      ? `${yeni.length} YENİ: ` +
        yeni
          .slice(0, 3)
          .map((d) => {
            const b = bulgular.find((x) => x.dosya === d)!;
            return `${d}:${b.satir}`;
          })
          .join(" · ") +
        "  → sayıya TARİH ya da ÜRETEN KOMUT ekle"
      : "temiz",
  );
  if (kalkan.length && yeni.length === 0) {
    console.log(`   ↓ küme sıkışıyor: ${taban.size} → ${dosyalar.length} (${kalkan.length} dosya nitelendirildi) — --yaz`);
    writeFileSync(TABAN_DOSYA, `${JSON.stringify({ _not: "ÇIPLAK ölçüm iddiası taşıyan DOSYA kümesi — yalnız KÜÇÜLÜR. Ölçüm: --yaz", _agac: agacDamgasi(), dosyalar }, null, 2)}\n`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
