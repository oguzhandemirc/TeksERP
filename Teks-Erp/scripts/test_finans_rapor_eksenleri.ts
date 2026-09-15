// =============================================================================
// FİNANS RAPOR EKSENLERİ — süzgeç SÖZLEŞMESİ (R5b-d)
// =============================================================================
// Beş finans raporuna ikinci eksenler eklendi. Bu bekçi eksenin VAR olduğunu
// değil, SÖZLEŞMESİNE UYDUĞUNU ölçer — dört kol:
//
//   §1 EKSEN UCA BAĞLI: Zod şemasında var ∧ servise GEÇİRİLİYOR. "Şemaya yazıp
//      servise geçirmemek" sessiz bir arızadır: uç 400 vermez, süzgeç de çalışmaz;
//      kullanıcı filtrelediğini sanar. (`kk1DuplicateGuardEnabled` dersinin ikizi.)
//   §2 SÜZGEÇSİZ GÖVDE BAYT BAYT ESKİ: `suzgec`/`meta` anahtarı süzgeç yokken
//      GÖVDEDE HİÇ BULUNMAZ (değeri `null` olarak bile). Panel varlığına bakarak
//      şerit çizer; boş nesne göndermek her raporu "süzgeçli" gösterirdi.
//   §3 DÜŞEN SATIR SAYILIR: süzgeç boş sonuç verdiğinde ekranda "veri yok" ile
//      "süzgeç kesti" AYRILMALI. Sayaç olmadan ikisi aynı boş ekrandır.
//   §4 BAKİYE SÜZGECE GÖRE DEĞİŞMEZ: yürüyen bakiye taşıyan iki raporda
//      (`cash-book` · `statement`) süzgeç SATIR DÖKÜMÜNE uygulanır, bakiye/toplam
//      bütün hareketlerden yürür. Ters sıra (önce süz, sonra yürüt) "doğru görünen
//      ama yanlış" bir bakiye üretir ve hiçbir yüzey onu yanlışlayamaz.
//
// ⚠️ NEDEN İKİ AYRI SÖZLEŞME: `vat-summary`/`fx-diff`te süzgeç WHERE'e iner ve
// özet ONUNLA BİRLİKTE daralır — çünkü o sayılar kümenin TOPLAMIdır. `cash-book`/
// `statement`te ise özet BAKİYEDİR ve bakiye kullanıcının ekranda neyi seçtiğine
// göre değişmez. İkisini tek kurala bağlamak, birinde yalan söylerdi.
//
// DB GEREKTİRMEZ: metin + tip düzeyi sözleşme taraması.
// Koşum: npx tsx scripts/test_finans_rapor_eksenleri.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..");
/** Bakiyeli raporda "özet süzgeçten etkilenmez" BEYANININ kanonik işareti. */
const OZET_DEGISMEZ_ISARETI = ["@suzgec", "ozet", "degismez"].join("-");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** Uç → (eksen adı, servise geçtiği çağrı metni), ve süzgeç kabının adı. */
const EKSENLER: Array<{
  uc: string;
  servis: string;
  eksen: string[];
  /** Süzgeç beyanının SERVİS dönüşündeki adı — rota onu cevabın KÖKÜNE kaldırır. */
  kap: "suzgec";
  /** Bakiye/yürüyen sütunu var mı — §4 yalnız bunlarda koşar. */
  bakiyeli: boolean;
  /** `dusenSatir` nasıl ölçülüyor: döngüde atlanarak mı, iki `count` farkıyla mı. */
  olcum: "dongu" | "sayim";
}> = [
  { uc: "/vat-summary", servis: "src/services/reports/finance-vat.report.ts", eksen: ["yon", "oran"], kap: "suzgec", bakiyeli: false, olcum: "sayim" },
  { uc: "/cash-book", servis: "src/services/reports/cash-book.report.ts", eksen: ["kategori", "yon"], kap: "suzgec", bakiyeli: true, olcum: "dongu" },
  { uc: "/fx-diff", servis: "src/services/reports/finance-fx-diff.report.ts", eksen: ["kind"], kap: "suzgec", bakiyeli: false, olcum: "sayim" },
  { uc: "/statement", servis: "src/services/cari.service.ts", eksen: ["belgeTipi"], kap: "suzgec", bakiyeli: true, olcum: "dongu" },
];

const UCLAR = ["/aging", "/cash-book", "/statement", "/vat-summary", "/fx-diff"];

/** Bir `router.get("<uc>", …)` çağrısının, bir sonraki `router.get`e kadarki gövdesi. */
function ucGovdesi(rota: string, uc: string): string {
  const i = rota.indexOf(`router.get("${uc}"`);
  if (i < 0) return "";
  const j = rota.indexOf('router.get("', i + 10);
  return rota.slice(i, j < 0 ? rota.length : j);
}

function main(): void {
  console.log("=== FİNANS RAPOR EKSENLERİ ===\n");
  const rota = readFileSync(join(KOK, "src/routes/reports/finance.report.routes.ts"), "utf8");
  check("§0 körlük zemini: rota dosyası okundu ve beş uç duruyor",
    rota.length > 5000 && UCLAR.every((u) => rota.includes(`router.get("${u}"`)),
    `${rota.length} karakter`);

  // ── §1 EKSEN UCA BAĞLI (şemada VAR ∧ servise GEÇİYOR) ────────────────────
  const kopuk: string[] = [];
  for (const e of EKSENLER) {
    const govde = ucGovdesi(rota, e.uc);
    if (govde === "") { kopuk.push(`${e.uc}: ÖLÇÜLEMEDİ — uç bulunamadı`); continue; }
    for (const eksen of e.eksen) {
      if (!new RegExp(`\\b${eksen}: z\\.`).test(govde)) { kopuk.push(`${e.uc} §şema: \`${eksen}\` Zod şemasında YOK`); continue; }
      if (!new RegExp(`\\b${eksen}: q\\.${eksen}\\b`).test(govde)) kopuk.push(`${e.uc} §geçiş: \`${eksen}\` şemada var ama SERVİSE GEÇİRİLMİYOR (sessiz arıza)`);
    }
  }
  check("§1 ⭐ her eksen hem Zod şemasında hem servis çağrısında",
    kopuk.length === 0, kopuk.join(" · ") || `${EKSENLER.flatMap((e) => e.eksen).length} eksen`);

  // ── §1b ŞEMA STRICT (tanınmayan eksen 400 — fail-closed) ─────────────────
  // ⚠️ SAYI EŞİĞİ DEĞİL, UÇ BAŞINA (sonda ⑦ bunu ölçtü): `>= 5` yazılmıştı ve
  // beş uçtan birinin `.strict()`i düşünce sayı 6→5 olup eşiği HÂLÂ geçti — yani
  // gerçek bir ihlalin yeşil geçtiği bir eşik. Toplam sayıya bakan kapı, kaybı
  // yalnız o sayı eşiğin ALTINA inerse görür.
  const stricsiz = UCLAR.filter((u) => !ucGovdesi(rota, u).includes(".strict()"));
  check("§1b HER uç şeması `.strict()` (tanınmayan eksen 400, sessizce yok sayılmaz)",
    stricsiz.length === 0, stricsiz.join(", ") || `${UCLAR.length} uç`);

  // ── §2 SÜZGEÇSİZ GÖVDE BAYT BAYT ESKİ + BEYAN TEK ADRESTE ────────────────
  const sapan2: string[] = [];
  for (const e of EKSENLER) {
    const src = readFileSync(join(KOK, e.servis), "utf8");
    // Koşullu yayma şart: `...(x ? { suzgec: … } : {})`. Koşulsuz bir `suzgec:`
    // alanı, süzgeçsiz gövdeye yeni bir anahtar sokar ve "eski gövde" sözü düşer.
    if (!/\.\.\.\([\s\S]{0,120}?\?\s*\{\s*suzgec:/.test(src)) {
      sapan2.push(`${e.uc}: \`suzgec\` KOŞULSUZ yayılıyor (süzgeçsiz gövde değişir)`);
    }
    // Tip `SuzgecEcho` OLMALI: rapor başına özel bir şekil, dokuma/satış ile
    // AYRIŞIR ve panel tek bileşen yazamaz (R5b-c2 "tek adres" hükmü).
    if (!/\n\s*suzgec\?: SuzgecEcho;/.test(src)) {
      sapan2.push(`${e.uc}: \`suzgec\` tipi \`SuzgecEcho\` DEĞİL (ya opsiyonel değil ya rapora özel şekil)`);
    }
  }
  check("§2 ⭐ süzgeç kabı yalnız süzgeçliyken ve ORTAK tiple (`SuzgecEcho`)",
    sapan2.length === 0, sapan2.join(" · ") || `${EKSENLER.length} rapor`);

  // §2b ⭐ BEYAN CEVABIN KÖKÜNDE — `data`nın içinde DEĞİL. İki adres, panelin
  // süzgeç şeridini rapor başına yazdırırdı; 1e hükmü R5b-c2 tek adres.
  const kokSapan: string[] = [];
  for (const e of EKSENLER) {
    const govde = ucGovdesi(rota, e.uc);
    if (!/const \{ suzgec, \.\.\.\w+ \} =/.test(govde)) { kokSapan.push(`${e.uc}: servis dönüşünden \`suzgec\` AYRILMIYOR`); continue; }
    // Zarfın dördüncü parametresi `EnvelopeEk` NESNESİDİR (`{ suzgec, secenekler? }`) — R5b-c3'ten beri. Çıplak `suzgec`
    // geçmek tsc'de kırmızı vermez ama beyanı SESSİZCE düşürür (ek.suzgec boş kalır); o biçim burada ihlaldir.
    if (/reportEnvelope\(\w+, range, null, suzgec\)/.test(govde)) kokSapan.push(`${e.uc}: \`suzgec\` zarfa ÇIPLAK geçiyor — \`{ suzgec }\` nesnesi olmalı (beyan sessizce düşer)`);
    else if (!/reportEnvelope\(\w+, range, null, \{ suzgec(?:, secenekler)? \}\)/.test(govde)) kokSapan.push(`${e.uc}: \`suzgec\` zarfa VERİLMİYOR (cevabın kökünde değil)`);
  }
  check("§2b ⭐ süzgeç beyanı cevabın KÖKÜNDE (tek adres — dokuma/satış ile aynı yer)",
    kokSapan.length === 0, kokSapan.join(" · ") || `${EKSENLER.length} uç`);

  // ── §3 DÜŞEN SATIR SAYILIYOR ─────────────────────────────────────────────
  const sapan3: string[] = [];
  for (const e of EKSENLER) {
    const src = readFileSync(join(KOK, e.servis), "utf8");
    // ⚠️ API ALANI TR (`dusenSatir` — 6e'nin R5b-b zarfıyla ORTAK söz dağarcığı),
    // YEREL DEĞİŞKEN İngilizce (`droppedRows` — üretim kodu tanımlayıcı kuralı).
    // İkisi ayrı ve ikisi de aranır; birini ötekinin yerine koymak ya zarfı
    // ayrıştırır ya tanımlayıcı cırcırını yükseltir.
    if (!/dusenSatir:/.test(src)) { sapan3.push(`${e.uc}: \`dusenSatir\` ALANI yok`); continue; }
    // ⚠️ SAYACIN VARLIĞI DEĞİL, ARTIŞI ARANIR (sonda ④ bunu ölçtü): önceki yazım
    // `dusenSatir =` kalıbını da kabul ediyordu ve `let dusenSatir = 0;`
    // bildiriminin kendisi o kalıba uyuyordu — yani sayaç HİÇ artmasa da yeşildi.
    // Sınıf ayrı ayrı aranır çünkü ölçüm biçimi farklı:
    //   • döngüde süzen rapor  → `dusenSatir++`
    //   • WHERE'e inen süzgeç  → iki `count` farkı (elenen zaten sorguya girmez)
    const artiyor = e.olcum === "dongu"
      ? /droppedRows\+\+/.test(src)
      : /\.count\(\{[\s\S]{0,400}?\}\)\)\s*-\s*\(await/.test(src);
    if (!artiyor) sapan3.push(`${e.uc}: \`dusenSatir\` hiç ARTMIYOR/ÖLÇÜLMÜYOR (alan var, sayı yok)`);
  }
  check("§3 ⭐ elenen satır SAYILIYOR (\"veri yok\" ile \"süzgeç kesti\" ayrılsın)",
    sapan3.length === 0, sapan3.join(" · ") || `${EKSENLER.length} rapor`);

  // ── §4 BAKİYE SÜZGECE GÖRE DEĞİŞMEZ ──────────────────────────────────────
  // Ölçüm YAPISAL: yürüyen bakiyeyi yürüten ifade, süzgeç atlamasından ÖNCE
  // gelmeli. Sırayı tersine çeviren bir düzenleme burada kırmızı verir.
  const sapan4: string[] = [];
  for (const e of EKSENLER.filter((x) => x.bakiyeli)) {
    const src = readFileSync(join(KOK, e.servis), "utf8");
    const iYurut = Math.max(src.indexOf("running = running.plus"), 0);
    const iAtla = src.indexOf("droppedRows++");
    if (iYurut === 0 || iAtla < 0) { sapan4.push(`${e.uc}: ÖLÇÜLEMEDİ — yürütme ya da atlama ifadesi bulunamadı`); continue; }
    if (!(iYurut < iAtla)) sapan4.push(`${e.uc}: süzgeç atlaması bakiye yürütmesinden ÖNCE (bakiye süzgece göre değişir)`);
  }
  check("§4 ⭐ yürüyen bakiye BÜTÜN hareketlerden yürür, süzgeç SONRA uygulanır",
    sapan4.length === 0, sapan4.join(" · ") || "cash-book · statement");

  // ── §4b BAKİYELİ RAPORLARIN ÖZETİ SÜZGEÇSİZ KALIR ────────────────────────
  const sapan4b: string[] = [];
  for (const e of EKSENLER.filter((x) => x.bakiyeli)) {
    const src = readFileSync(join(KOK, e.servis), "utf8");
    // ⚠️ KANONİK İŞARET, serbest metin DEĞİL: TR büyük/küçük harf katlaması JS'te
    // `i` bayrağıyla bile güvenilmez ("SÜZGEÇSİZ" ↛ "süzgeçsiz"; `İ` noktalı `i`ye
    // düşer). Beyanı metne bağlamak, doğru yazılmış bir beyanı da kaçırırdı.
    if (!src.includes(OZET_DEGISMEZ_ISARETI)) {
      sapan4b.push(`${e.uc}: \`${OZET_DEGISMEZ_ISARETI}\` işareti YOK — özetin süzgeçsiz kaldığı beyan edilmemiş`);
    }
  }
  check("§4b bakiyeli raporlarda \"özet dönem gerçeğidir\" BEYANI yazılı (kullanıcı boş ekrana bakmasın)",
    sapan4b.length === 0, sapan4b.join(" · ") || "cash-book · statement");

  // ── §5 AGING'E EKSEN EKLENMEDİ ve bu BİLİNÇLİ ────────────────────────────
  // Simetri için eksen uydurmak ölçüme değil biçime uymaktır; kol o kararı
  // yazılı tutar — `aging` bir gün eksen alırsa bu satır da güncellenmeli.
  const agingGovde = ucGovdesi(rota, "/aging");
  check("§5 `aging` altı ekseniyle zaten zengin — R5b-d ona eksen EKLEMEDİ (beyanlı)",
    ["asOf", "cariId", "kind", "currency", "onlyOverdue", "detail"].every((k) => agingGovde.includes(`${k}:`))
      && !/\bkategori:|\bbelgeTipi:|\boran:|\byon:/.test(agingGovde),
    "altı eksen duruyor, yeni eksen yok");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
