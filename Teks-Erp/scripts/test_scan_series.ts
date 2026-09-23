// =============================================================================
// OKUTMA SINIFLANDIRMASI SUNUCUDA — `/api/scan/series` + `/api/scan/resolve`
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts scan_series   (DB GEREKMEZ)
//
// ⭐ NEDEN VAR (Faz B, 2026-09-22): ön ek bugüne kadar istemcilerde REGEX olarak
//    sabitti. Ön ek değişse eski tablet 400/404 vermez, SESSİZCE yanlış dala
//    düşerdi — çuval kodunu top sanıp "Top bulunamadı" derdi. Tür artık
//    sunucunun TEK sınıflandırıcısından (`classifyScannedCode`) çözülür.
//
//   §1 Tablo yalnız OKUTULAN serileri taşır ve her satır biçimin tamamını verir
//   §2 Her okutulan serinin ÜRETTİĞİ kod kendi anahtarına çözülür (ikizleme yok)
//   §3 Emekli ön ekli eski kod (`RK` kartı) hâlâ çözülür
//   §4 Hane taşmış (5 haneli) kod çözülür — sabit hane dayatan eski yol reddediyordu
//   §5 Tanınmayan kod `UNKNOWN` + `key:null` döner; istemci TAHMİN YÜRÜTMEZ
//   §6 ⭐ `/resolve` KAYIT tablolarına inmez — izinsiz olmasının gerekçesi bu, ve ölçülür
//   §7 `search.service`te elle yazılmış tam-format ikizi KALMADI (boğaz ikiz)
//   §8 ⭐ `FSN…` (fason firma kodu) `FS…` (fason SEVK BELGESİ) serisine DÜŞMEZ
//
// ⭐ NEGATİF SONDA ✓B4 (2026-09-22, ölçüldü): `matchesSeries`te emekli ön ek döngüsü
//    `[fmt.prefix]`e kısılınca §3 ❌1 · `\d{digits,}`→`\d{digits}` §4 ❌2 ·
//    `resolveScannedCode`ta çözülmeyen koda `kind:"ROLL"` uydurulunca §5 ❌5 ·
//    `scan.service`e `prisma` import'u + bir top okuması eklenince §6 ❌2.
//    (Çağrı kalıbı burada YAZIYLA anlatılır: `test_keyfi_arama`nın tarayıcısı
//     `prisma.<model>.findFirst` desenini YORUM İÇİNDE de sayar ve bu satırı
//     "ortama yaslanan yeni çağrı" sanardı — dize ile çağrıyı ayırmıyor.)
//    · `classifyScannedCode` tam-format eşleşmesi yerine ÇIPLAK ön ek çapasına
//      (`startsWith`) düşürülünce §8 ❌ (`FSN2209260001 → subcontractorDispatch`) + §5 ❌1.
//    ⚠️ Dördüncü sonda ilk denemede GEÇERSİZDİ: yalnız çağrıyı ekleyince `prisma`
//    tanımsız kaldı, bekçi ÇÖKTÜ — çökme kırmızı DEĞİLDİR. Kaynak-metni ölçen bir
//    sondanın mutasyonu DERLENEBİLİR olmalı, yoksa ölçülen şey kapı değil kazadır.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import { classifyScannedCode, formatSeriesCode, resolveSeriesFormat, seriesClassifierTable, seriesPrefix } from "../src/services/number-series.service";
import { getSeriesClassifier, resolveScannedCode } from "../src/services/scan.service";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SRC = join(__dirname, "..", "src");
const AT = new Date("2026-09-22T09:00:00.000Z");
const OKUTULAN = NUMBER_SERIES_CATALOG.filter((e) => e.kind !== undefined);

// ── §1 Tablo ────────────────────────────────────────────────────────────────
const tablo = getSeriesClassifier();
check("§1 uç zarfı servisten geliyor", tablo.success === true && Array.isArray(tablo.data));
check("§1 tablo yalnız okutulan serileri taşır", tablo.data.length === OKUTULAN.length,
  `${tablo.data.length} satır / ${OKUTULAN.length} okutulan seri`);
check("§1 körlük zemini: tablo boş değil", tablo.data.length >= 9, `${tablo.data.length} satır`);
check("§1 her satır biçimin tamamını verir (ön ek · tarih segmenti · hane · ayraç)",
  tablo.data.every((r) => r.prefixes.length >= 1 && r.digits >= 1 && typeof r.dateSegment === "string" &&
    typeof r.separator === "string"));
check("§1 ⭐ top satırı infix'i taşır (istemci tam-format regex'ini bundan kurar)",
  tablo.data.find((r) => r.key === "roll")?.infix === "[HF]");

// ── §2 Her seri kendi anahtarına çözülür ────────────────────────────────────
// Üretilen kod ÜRETECİN kendisinden alınır: bekçi "olması gereken"i değil OLANI ölçer.
const yanlisCozulen: string[] = [];
for (const e of OKUTULAN) {
  const fmt = resolveSeriesFormat(e.key);
  // Top barkodu faz harfi taşır; üreteci ayrı olduğu için kodu elle kuruyoruz.
  const kod = e.key === "roll"
    ? `${fmt.prefix}220926H${"1".padStart(fmt.digits, "0")}`
    : formatSeriesCode(fmt, 1, AT);
  const cozum = classifyScannedCode(kod);
  if (cozum?.key !== e.key) yanlisCozulen.push(`${e.key}:${kod}→${cozum?.key ?? "UNKNOWN"}`);
}
check("§2 ⭐ okutulan her serinin kodu KENDİ anahtarına çözülür", yanlisCozulen.length === 0,
  yanlisCozulen.join(" · ") || `${OKUTULAN.length} seri`);

// ── §3 Emekli ön ek ─────────────────────────────────────────────────────────
const rk = resolveScannedCode("RK2209260007");
check("§3 ⭐ emekli ön ekli eski kart kodu çözülür (sahadaki RK kartları)",
  rk.data.key === "workOrder" && rk.data.kind === "TRAVELER_CARD", `${rk.data.key} / ${rk.data.kind}`);
const ie = resolveScannedCode("IE2209260007");
check("§3 yürürlükteki ön ek de aynı seriye çözülür", ie.data.key === "workOrder");

// ── §4 Hane taşması ─────────────────────────────────────────────────────────
const besHane = resolveScannedCode("CV220926" + "10000");
check("§4 ⭐ 5 haneli çuval kodu çözülür (günde 9999 aşılınca üretilen kod)",
  besHane.data.key === "sack", `${besHane.data.key}`);
const besHaneTop = resolveScannedCode("T220926H10000");
check("§4 top serisinde de hane esnekliği infix'le birlikte çalışır", besHaneTop.data.key === "roll");

// ── §5 Tanınmayan kod ───────────────────────────────────────────────────────
for (const kod of ["ZZZ2209260001", "12345", "CV22092", "", "   "]) {
  const r = resolveScannedCode(kod);
  check(`§5 tanınmayan kod UNKNOWN + key null (${JSON.stringify(kod)})`,
    r.data.kind === "UNKNOWN" && r.data.key === null, `${r.data.kind} / ${r.data.key}`);
}
check("§5 normalize edilmiş kod geri döner (istemci aynısını kullanır)",
  resolveScannedCode("  cv2209260001 ").data.code === "CV2209260001");
check("§5 küçük harfle okutulan kod da çözülür", resolveScannedCode("cv2209260001").data.key === "sack");

// ── §6 `/resolve` DB'ye inmez ───────────────────────────────────────────────
// ⚠️ Bu kontrol bir SÖZÜN kapısıdır: iki ucun izinsiz (yalnız `verifyToken`)
// olmasının gerekçesi "yük iş verisi değil biçim meta verisi". Biri yarın
// "bulamadıysan rolls'a bak" eklerse gerekçe yalan olur ve hiçbir yerden
// görünmez — burada görünür.
//
// ⚠️ İDDİANIN BOYU ÖLÇÜLENLE AYNI: burada aranan DOĞRUDAN çağrıdır. Uç DOLAYLI
// olarak bir okuma tetikleyebilir — `resolveSeriesFormat` önbellek boş/bayatsa
// arka planda `prisma.numberSeries.findMany()` koşar. O bir YAPILANDIRMA
// satırıdır; güvenlik argümanı KAYIT tablolarına inmemeye dayanır, "hiç DB
// yok"a değil. "DB'ye hiç inmez" demek, ölçülmemiş bir iddia olurdu.
const DB_IZI = /\b(prisma|tx)\s*\.\s*[a-zA-Z$]/;
for (const dosya of ["services/scan.service.ts", "routes/scan.routes.ts"]) {
  const metin = readFileSync(join(SRC, dosya), "utf-8");
  const kodSatirlari = metin.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
  check(`§6 ⭐ ${dosya} KAYIT tablosuna inmiyor (izinsiz olmanın gerekçesi)`,
    !kodSatirlari.some((l) => DB_IZI.test(l)),
    kodSatirlari.filter((l) => DB_IZI.test(l)).join(" | ") || "0 DB çağrısı");
  check(`§6 ${dosya} prisma import etmiyor`, !/from "\.\.?\/.*lib\/prisma"/.test(metin));
}
// ⚠️ Zemin örneği BİLEREK `findFirst` İÇERMEZ: `test_keyfi_arama`nın tarayıcısı
// `prisma.<model>.findFirst` kalıbını dize İÇİNDE de sayar ve bu satırı "ortama
// yaslanan yeni çağrı" sanardı — sonda GİRDİSİ ile gerçek çağrı aynı metin.
check("§6 körlük zemini: sonda gerçekten DB izi görebiliyor",
  DB_IZI.test("const n = await prisma.roll.count({});") && DB_IZI.test("await tx.sack.update({});"));

// ── §7 Elle yazılmış ikiz kalmadı ───────────────────────────────────────────
const searchSrc = readFileSync(join(SRC, "services/search.service.ts"), "utf-8");
check("§7 ⭐ `search.service` tek sınıflandırıcıyı kullanıyor",
  searchSrc.includes("classifyScannedCode"));
check("§7 ⭐ elle yazılmış tam-format ikizi KALMADI (EXACT_FORMATS)",
  !/\bEXACT_FORMATS\b/.test(searchSrc));
check("§7 panelin ön eklerini literal tutan regex kalmadı",
  !/\/\^\(\?:IE\|RK\)/.test(searchSrc) && !/\/\^CV\\d/.test(searchSrc) && !/\/\^KRT\\d/.test(searchSrc));
check("§7 körlük zemini: dosya gerçekten okundu", searchSrc.length > 5000, `${searchSrc.length} bayt`);

// Tablo ile tek-kod çözümü AYNI kaynaktan gelmeli (iki yüzey ayrışmasın).
const tabloAnahtarlari = new Set(seriesClassifierTable().map((r) => r.key));
check("§7 sınıflandırma tablosu ile tek-kod çözümü aynı seri kümesini tanır",
  OKUTULAN.every((e) => tabloAnahtarlari.has(e.key)) && tabloAnahtarlari.size === OKUTULAN.length);

// ── §8 FSN ↔ FS: ön ek içinde ön ek ──────────────────────────────────────
// Fason firma kodu `FSN…`, okutulan fason sevk belgesi `FS…` ile BAŞLIYOR.
// İkisinin ayrılması ön ek çakışma kapısına DEĞİL, eşleştiricinin ön ekten
// sonra tarih RAKAMI istemesine dayanıyor (`FS` + `N` → rakam değil).
// ⚠️ Çakışma kapısı (`assertSeriesFormatAllowed ③`) burada KORUMAZ: o yalnız
// TARAMA uzayında küresel, `subcontractor` ise okutulan bir seri DEĞİL. Yani
// iki bağımsız karar birbirine yaslanıyor — bu yüzden ÖLÇÜLÜYOR.
const fsnKodu = `${seriesPrefix(resolveSeriesFormat("subcontractor"))}0001`;
check("§8 ⭐ fason FİRMA kodu sevk belgesi sanılmıyor", classifyScannedCode(fsnKodu) === null,
  `${fsnKodu} → ${classifyScannedCode(fsnKodu)?.key ?? "UNKNOWN"}`);
check("§8 gerçek fason SEVK belgesi hâlâ çözülüyor (kontrol grubu)",
  classifyScannedCode(`${seriesPrefix(resolveSeriesFormat("subcontractorDispatch"))}0001`)?.key === "subcontractorDispatch");
check("§8 fason firma/kategori serileri OKUTULAN küme DIŞINDA (scanned değil)",
  NUMBER_SERIES_CATALOG.find((e) => e.key === "subcontractor")?.kind === undefined &&
  NUMBER_SERIES_CATALOG.find((e) => e.key === "subcontractorCategory")?.kind === undefined);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
