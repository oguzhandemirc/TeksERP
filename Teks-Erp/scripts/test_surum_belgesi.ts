// =============================================================================
// BEKÇİ — BACKEND SÜRÜM BELGESİ (`docs/surumler/backend-<sürüm>.md`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts surum_belgesi
//
// ⭐ NEDEN VAR (2026-09-10): backend'in sürüm belgesi YOKTU. Paketi KURAN taraf
//    (bugün fabrikadaki Claude oturumu) dosya okur, paketi üretenin sohbetini
//    değil — ve bu bir kez zarar verdi: kurana "2.9.6 → 2.9.8" denildi, sahadaki
//    2.9.7'ydi; delta yanlış sayıldı. Aynı turda `dist-web`in yeniden derlendiği
//    de beyan edilmemişti.
//
// ⚠️ İŞ BÖLÜMÜ: `paketle.ps1` yalnız DOSYA VAR MI diye bakar (PowerShell'de
//    markdown ayrıştırmak yanlış yer). İÇERİĞİN DOLU olduğunu bu bekçi ölçer.
//    İkisi ayrı olmasaydı "boş bir dosya açıp paketi geçirmek" mümkün olurdu ve
//    kapı tam da kapatmak için var olduğu şeye izin verirdi.
//
// NE ÖLÇER:
//   §1 Yedi başlığın hepsi VAR (başlık soruyu SORMAYA zorlar; `dist-web` tam da
//      böyle bir başlık olmadığı için atlanmıştı).
//   §2 Doldurulmamış yer tutucu (`<...>`) KALMAMIŞ — şablondan kopyalanıp
//      unutulan alan, boş bir belgeden daha kötüdür: dolu görünür.
//   §3 Dosya adındaki sürüm ile başlıktaki sürüm TUTUYOR (yanlış dosyaya yazmak
//      sessizdir).
//   §4 Migration ve sözleşme başlıkları GERÇEKTEN cevaplanmış — "var mı" satırı
//      duruyor ama cevabı yoksa kuran hiçbir şey öğrenmez.
//   §5 `SABLON.md` kapsam DIŞI (kendisi yer tutucu doludur).
//
// ⚠️ GEÇMİŞ SÜRÜMLER ÖLÇÜLMEZ: kapı 2026-09-10'da kondu, 2.9.0–2.9.8 belgesiz.
//    Geçmişi uydurmak belgeyi güvenilmez yapardı; bekçi VAR OLAN dosyaları
//    ölçer, eksik olanı istemez. Eksik olanı `paketle.ps1` ister — yalnız
//    üretilmekte olan sürüm için.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-10): başlık silinince §1 KIRMIZI ·
//    `<doldur>` bırakılınca §2 KIRMIZI · dosya adı ile başlık ayrışınca §3
//    KIRMIZI · "Var mı:" satırının cevabı silinince §4 KIRMIZI.
// =============================================================================
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
const DIZIN = join(KOK, "docs", "surumler");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** Yedi başlık — sırası değil VARLIĞI ölçülür. */
const BASLIKLAR = [
  "## 1. Özet",
  "## 2. Ne değişti",
  "## 3. Sözleşme",
  "## 4. Migration",
  "## 5. Kurulum notu",
  "## 6. Geri alma",
  "## 7. Doğrulama",
];

const dosyalar = existsSync(DIZIN)
  ? readdirSync(DIZIN).filter((f) => /^backend-\d+\.\d+\.\d+\.md$/.test(f))
  : [];

console.log("\n§0 — körlük zemini");
check("`docs/surumler/` var", existsSync(DIZIN));
check("şablon duruyor", existsSync(join(DIZIN, "SABLON.md")));
check(
  "⭐ en az bir sürüm belgesi var (yoksa bu bekçi hiçbir şey ölçmez)",
  dosyalar.length > 0,
  `${dosyalar.length} dosya: ${dosyalar.join(", ")}`,
);

for (const dosya of dosyalar) {
  const metin = readFileSync(join(DIZIN, dosya), "utf8");
  const surum = dosya.replace(/^backend-|\.md$/g, "");
  console.log(`\n§1-4 — ${dosya}`);

  const eksik = BASLIKLAR.filter((b) => !metin.includes(b));
  check("⭐ yedi başlığın hepsi var", eksik.length === 0, eksik.join(" · ") || "tam");

  // ⚠️ Yer tutucu ŞABLONDAN kopyalanıp unutulan alandır ve dolu GÖRÜNÜR — boş
  //    bırakılmış bir başlıktan daha tehlikelidir. `<sürüm>` gibi köşeli
  //    parantezli her şey aranır; kod bloğu içindekiler de dahil (orada da
  //    doldurulmalı).
  // ⚠️ ÜÇ ALAN MAKİNE DOLDURUR (paket adı · SHA256 · commit): paketleme
  //    BİTMEDEN bilinemezler. `paketle.ps1` zip'i ürettikten sonra yazar.
  //    İnsanın SHA256 kopyalaması tam da hatanın çıkacağı yerdir — o yüzden
  //    `_(paketleme doldurur)_` işareti MEŞRU sayılır. Kalan her `<...>` yer
  //    tutucusu doldurulmamış demektir.
  const tutucular = [...metin.matchAll(/<[a-zçğıöşü][^<>\n]{2,60}>/gi)].map((m) => m[0]);
  check(
    "⭐ doldurulmamış yer tutucu YOK",
    tutucular.length === 0,
    tutucular.slice(0, 4).join(" · ") || "temiz",
  );

  const basligi = metin.match(/^#\s+Backend\s+`([^`]+)`/m)?.[1];
  check(
    "⭐ dosya adındaki sürüm ile başlıktaki sürüm tutuyor",
    basligi === surum,
    `dosya=${surum} başlık=${basligi ?? "YOK"}`,
  );

  // §4 — cevapsız bırakılmış zorunlu satırlar. "Var mı:" duruyor ama cevabı
  // yoksa kuran hiçbir şey öğrenmez; başlık VAR olduğu için §1 de yeşil kalır.
  // ⚠️ `[ \t]*` — `\s*` DEĞİL. İlk yazımda `\s*` vardı ve SATIR SONUNU GEÇİP bir
  //    SONRAKİ satırı cevap sayıyordu: "**Var mı:**" boş bırakılınca altındaki
  //    "**Toplam migration:** 238" satırını okuyup YEŞİL kalıyordu. Sonda
  //    yakaladı — tam da bu bekçinin kapatmak için var olduğu şey (dolu görünen
  //    boş alan) bekçinin kendisinde vardı.
  const cevapli = (etiket: string): boolean => {
    const m = metin.match(new RegExp(`\\*\\*${etiket}:?\\*\\*[ \\t]*([^\\n]*)`, "i"));
    return !!m && m[1]!.replace(/[*_\s]/g, "").length > 2;
  };
  check("⭐ 'Migration var mı' cevaplanmış", cevapli("Var mı"));
  check("⭐ 'Sözleşme kırıldı mı' cevaplanmış", cevapli("Kırıldı mı"));
  check("⭐ 'Önceki saha sürümü' yazılmış (tahmin edilmesin diye)", cevapli("Önceki saha sürümü"));
  check("'Beklenen kesinti' yazılmış", cevapli("Beklenen kesinti"));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
