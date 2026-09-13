// =============================================================================
// BORÇ NOTU BİÇİMİ — B kolu (cırcır) + C kolu (mandal)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts borc_notu_bicimi
//
// NEDEN VAR — ölçüldü 2026-09-13: beyan edilmiş 61 açık borç kaleminin **17'si**
// hiçbir KAPANMA KOŞULU taşımıyordu. Koşulsuz bir borcun kusuru kapanmamış olması
// değil, **kapanamaz olmasıdır**: ölçülecek bir cümle yoksa hiç kimse "bitti"
// diyemez ve kalem sonsuza kadar taşınır. Aynı turda bunun bedeli ölçüldü —
// KAPANMIŞ bir borç (`SETTINGS_PASSWORD_*` etiket kapısı) hâlâ "açık" yazdığı
// için yeniden iş olarak dağıtıldı.
//
// BİÇİM (mevcut alanın GENİŞLETİLMESİ — yeni bir biçim İCAT EDİLMEDİ):
//   · bekçi: `YOK` · Kapanır: `<ölçen cümle>` · Çapa: `<sembol>` · Öncül: ölçüldü|VARSAYILDI
// Ev bu `bekçi:` alanını yıllardır yazıyor (598 iddia — grep -rhoE "bekçi: `[^`]*`"
// docs/kurallar/*.md | wc -l, 2026-09-13) ⇒ ikinci bir
// biçim kurmak iki gerçek üretirdi.
//
// ── ⛔ BU KAPININ ÖLÇEMEDİKLERİ — çıktıda BASILIR, gizlenmez ────────────────
//   ① `Kapanır:` cümlesinin gerçekten YANLIŞLANABİLİR olduğunu ölçmez. Kapı
//      "alan dolu mu" sorar; "cümle iyi mi" bir YARGIDIR ve makineye verilemez.
//   ② `Öncül: ölçüldü` beyanının DOĞRU olduğunu ölçmez — beyanın kendisi
//      ölçülemez, yalnız varlığı ölçülür.
//   ③ İşaretçiyi HİÇ KULLANMAYAN düz metin borçları (arşivin 13 adayı) hiçbir
//      kola girmez. C kolu YALNIZ opt-in bloğu bağlar ⇒ "işaretçiyi hiç yazma"
//      kaçışı AÇIKTIR ve kapatılmadı: 8200 satırlık salt-ekleme bir dosyaya
//      geriye dönük biçim dayatmak çalışmaz.
// => Adlandırılmış bir kaçış bir borçtur; adlandırılmamış olan bir YANILSAMADIR.
//
// ── SONDALAR (beşi de koşuldu 2026-09-13; `cp` + `shasum -c`, BİREBİR ✓) ────
//   B− koşulsuz borç eklendi, `Kapanır:` YOK        → 37 → 38  KIRMIZI ✓
//   B+ aynı satıra `Kapanır:` eklendi               → 38 → 37  YEŞİL   ✓
//   C+ iyi biçimli `**BORÇ:**` bloğu                → 1 blok · 0 bozuk  ✓
//   C− `**Öncül:**` silindi                         → "eksik alan (1/3)" ✓
//   C− `**Çapa:** test_helpers.ts:275`              → "Çapa SATIR NUMARASI" ✓
//
// ⚠️ B+ (POZİTİF sonda) BİR KUSUR BULDU ve negatif sonda onu göremezdi:
// yüklem `Kapanır:`ı `bekçi:` backtick'lerinin İÇİNDE arıyordu, oysa `Kapanır:`
// bir KARDEŞ alandır ⇒ kurala kapanma koşulu eklemek sayıyı DÜŞÜRMÜYORDU.
// => Tabanı DÜŞÜREMEYEN bir cırcır, hiç kapı olmamasından KÖTÜDÜR: borç
//    kapatılamaz, sayı hiç inmez, ve kapı ilk sıkışmada susturulur.
//    ⇒ Her cırcıra İKİ sonda gerekir: ihlal ekleyince KIRMIZI (negatif) ve
//      ihlali düzeltince YEŞİL (pozitif). İkincisi olmadan kapı tek yönlüdür.
// =============================================================================
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

/**
 * B KOLU TABANI — devralınan koşulsuz borç. YALNIZ DÜŞER.
 *
 * ⚠️ SAYI 29 DEĞİL 37, ve fark KAPSAMDAN geliyor (2026-09-13):
 * ilk ölçümüm (2026-09-13) yalnız `^(yok|YOK)` sayıyordu ve yöneticiye "29" gitti.
 * Ama `bekçi: BELİRSİZ` de koşulsuz bir borç beyanıdır — adlandırılmış bir bekçi
 * yok, kapanma koşulu yok. Kapsamı düzeltince sayı 37 oldu.
 * => Bir tabanın DEĞERİ, yükleminin KAPSAMIYLA birlikte taşınır; kapsam
 *    değişince eski sayı yanlış değil KONUSUZ olur.
 * Üreten komut:
 *   grep -rhoE 'bekçi: `(YOK|yok|BELİRSİZ)[^`]*`' docs/kurallar/*.md | wc -l
 */
const B_TABAN = 37;

/** `· bekçi: `…`` alanları — dosya + satır + içerik. */
function bekciAlanlari(): Array<{ dosya: string; satir: number; icerik: string; tamSatir: string }> {
  const out: Array<{ dosya: string; satir: number; icerik: string; tamSatir: string }> = [];
  for (const ad of readdirSync(KURALLAR).filter((f) => f.endsWith(".md"))) {
    readFileSync(join(KURALLAR, ad), "utf8").split("\n").forEach((s, i) => {
      for (const m of s.matchAll(/bekçi: `([^`]*)`/g)) {
        out.push({ dosya: `docs/kurallar/${ad}`, satir: i + 1, icerik: m[1]!, tamSatir: s });
      }
    });
  }
  return out;
}

/** Koşulsuz borç beyanı: adlandırılmış bekçi YOK. */
const KOSULSUZ = /^(YOK|yok|BELİRSİZ)/;
/**
 * Kapanma koşulu alanı — TAM SATIRDA aranır, `bekçi:` alanının İÇİNDE değil.
 *
 * ⚠️ İlk yazımda `bekçi:` backtick'lerinin İÇİNDEKİ metinde aranıyordu ve bunu
 * POZİTİF SONDA yakaladı: kurala `· Kapanır: \`…\`` eklendi ve sayı DÜŞMEDİ —
 * çünkü `Kapanır:` bir KARDEŞ alandır, `bekçi:` alanının içeriği değil.
 * => Yüklem tabanı DÜŞÜREMEYEN bir cırcır, hiç kapı olmamasından KÖTÜDÜR:
 *    borç kapatılamaz, sayı hiç inmez ve kapı ilk sıkışmada susturulur.
 *    Negatif sonda bunu göremezdi — yalnız POZİTİF sonda gösterdi.
 */
const KAPANIR = /Kapanır:\s*`[^`]+`/;

/** C kolu: opt-in borç bloğu ve zorunlu alanları. */
const BORC_ISARETCISI = /\*\*BORÇ:\*\*/;
const C_ALANLARI = [/\*\*Kapanır:\*\*/, /\*\*Çapa:\*\*/, /\*\*Öncül:\*\*/];
/** Çapa satır numarası taşımamalı — `foo.ts:275` biçimi. */
const SATIR_NUMARASI_CAPASI = /\*\*Çapa:\*\*[^\n]*?\.[a-z]+:\d+/;

/** Borç bloğu taranan dosyalar: kural dosyaları + arşiv + bekçi başlıkları. */
function borcBloklari(): Array<{ dosya: string; satir: number; blok: string }> {
  const hedefler: Array<[string, string]> = [];
  for (const ad of readdirSync(KURALLAR).filter((f) => f.endsWith(".md"))) {
    hedefler.push([`docs/kurallar/${ad}`, join(KURALLAR, ad)]);
  }
  hedefler.push(["docs/history/CLAUDE-NOT-ARSIVI.md", join(KOK, "docs/history/CLAUDE-NOT-ARSIVI.md")]);
  const betikler = join(KOK, "Teks-Erp", "scripts");
  // ⚠️ KAPI KENDİNİ TARAMAZ — "araç gözlenenin içinde" sınıfı, ölçüldü: ilk
  // koşumda tek bulgu BU DOSYANIN KENDİ `check(...)` etiketiydi (`**BORÇ:**`
  // dizgesi orada geçiyor). `grep -v grep` ile aynı gerekçe: bir tarayıcı kendi
  // desenini içerdiği için kendini ihlal sayarsa, tavan hiçbir zaman 0 olamaz.
  const kendi = basename(__filename).replace(/\.[tj]s$/, "");
  for (const ad of readdirSync(betikler).filter((f) => /^test_.*\.ts$/.test(f))) {
    if (ad.replace(/\.ts$/, "") === kendi) continue;
    hedefler.push([`Teks-Erp/scripts/${ad}`, join(betikler, ad)]);
  }

  const out: Array<{ dosya: string; satir: number; blok: string }> = [];
  for (const [etiket, yol] of hedefler) {
    const satirlar = readFileSync(yol, "utf8").split("\n");
    satirlar.forEach((s, i) => {
      if (!BORC_ISARETCISI.test(s)) return;
      // Blok = işaretçiden sonraki 8 satır (alanlar bitişik yazılır).
      out.push({ dosya: etiket, satir: i + 1, blok: satirlar.slice(i, i + 8).join("\n") });
    });
  }
  return out;
}

function main(): void {
  console.log("=== Borç notu biçimi — B (cırcır) + C (mandal) ===\n");

  const alanlar = bekciAlanlari();
  check("`bekçi:` alanı okunabildi", alanlar.length >= 400, `${alanlar.length} iddia`);

  // ── B KOLU — koşulsuz borç, `Kapanır:` taşımayan ─────────────────────────
  const kosulsuz = alanlar.filter((a) => KOSULSUZ.test(a.icerik));
  const kapanirsiz = kosulsuz.filter((a) => !KAPANIR.test(a.tamSatir));
  check(
    `⭐ B — \`Kapanır:\` taşımayan koşulsuz borç ≤ taban (${B_TABAN})`,
    kapanirsiz.length <= B_TABAN,
    `${kosulsuz.length} koşulsuz · ${kapanirsiz.length} kapanma koşulu YOK`,
  );
  check(
    "B tabanı ÇÜRÜMEMİŞ (gerçek < taban ise tabanı düşür)",
    kapanirsiz.length >= B_TABAN,
    `gerçek ${kapanirsiz.length} · taban ${B_TABAN}`,
  );
  for (const a of kapanirsiz.slice(0, 8)) console.log(`     ${a.dosya}:${a.satir}  ${a.icerik.slice(0, 52)}`);
  if (kapanirsiz.length > 8) console.log(`     … +${kapanirsiz.length - 8} satır`);

  // ── C KOLU — opt-in borç bloğu iyi biçimli mi (tavan 0) ──────────────────
  const bloklar = borcBloklari();
  const bozuk: string[] = [];
  for (const b of bloklar) {
    const eksik = C_ALANLARI.filter((r) => !r.test(b.blok));
    if (eksik.length > 0) bozuk.push(`${b.dosya}:${b.satir} — eksik alan (${eksik.length}/3)`);
    else if (SATIR_NUMARASI_CAPASI.test(b.blok)) bozuk.push(`${b.dosya}:${b.satir} — Çapa SATIR NUMARASI taşıyor`);
  }
  check(
    "⭐ C — her `**BORÇ:**` bloğu iyi biçimli (Kapanır · Çapa · Öncül, çapa satır no DEĞİL)",
    bozuk.length === 0,
    `${bloklar.length} blok · ${bozuk.length} bozuk`,
  );
  for (const b of bozuk) console.log(`     ${b}`);

  // ── KAPSAM BEYANI ────────────────────────────────────────────────────────
  console.log(
    `\n   ⛔ BU KAPININ ÖLÇMEDİĞİ (yeşil "borçlar kapanabilir" DEMEK DEĞİLDİR):\n` +
      `      · \`Kapanır:\` cümlesinin YANLIŞLANABİLİR olduğu — "alan dolu mu" ölçülür,\n` +
      `        "cümle iyi mi" bir YARGIDIR ve bu kapı onu ölçmez.\n` +
      `      · \`Öncül: ölçüldü\` beyanının DOĞRU olduğu — varlığı ölçülür, doğruluğu değil.\n` +
      `      · İşaretçiyi HİÇ kullanmayan düz metin borçları (${bloklar.length} blok bulundu;\n` +
      `        arşivin düz metin kalemleri bu sayıya GİRMEZ). C kolu yalnız opt-in\n` +
      `        bloğu bağlar ⇒ "işaretçiyi hiç yazma" kaçışı AÇIK ve bilinçlidir.\n`,
  );

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
