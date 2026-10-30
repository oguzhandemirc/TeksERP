// =============================================================================
// BEKÇİ — RAPOR KATALOĞU DÖRT YÜZEYLE BİREBİR (Raporlar fazı R0)
// Çalıştır: npx tsx scripts/run-all-tests.ts rapor_katalogu
// =============================================================================
// NEDEN: "rapor" kümesinin sınırı bugüne kadar YÜZEYDE çiziliydi — hangi yaprağın
// rapor sayıldığı karo dosyasından okunuyordu, backend'de rapor başına anahtar YOKTU.
// Dört yüzey (backend route · panel route · karo · SCREEN_CATALOG) kendi listesini
// tutunca listeler AYRIŞIR ve ayrışma SESSİZDİR: yeni bir rapor ucu doğar ama karosu
// yoktur, ya da karo vardır ama route yoktur. Ölçüldü (envanter §0): backend 8 kapı /
// panel 16 kapı, kümeler ayrışık.
//
// ⇒ Katalog TEK KİMLİKTİR ve bu bekçi onu DÖRT YÖNDE, HER YÖNÜ İKİ TARAFLI ölçer:
//   §1 katalog ⇄ `routes/reports/**` `router.get` yolları
//   §2 katalog ⇄ Electron `content-routes.tsx` `reports/*` yaprak yolları
//   §3 katalog ⇄ karo `to` (`Reports/<Kategori>/tile-config.ts`)
//   §4 katalog `modul` ⇄ SCREEN_CATALOG `reports/<kategori>` satırının `modul`u
//   §5 Electron aynası ⇄ backend sabiti (gövde KARAKTER KARAKTER)
//   §7 tarih sözleşmesi ⇄ `varsayilanGun`; yaprak SAYI yazmaz, hook'a KENDİ anahtarını verir (çift yazım imkânsız, R4)
//   §8 Raporlar v2: her v1 satırının `yeniHali` · v2 satırı ucu inene kadar `hazir:false` (iki yönlü)
//   §9 ölçü tanım sözlüğü (`semantik/tanimlar.ts`): zorunlu kimlikler · formülsüz açıklama · ölçülü kaynak
// §1–§3 ve §7d yalnız ÇİZİLEN satırları (`isReportSurfaced`) ölçer: ucu inmemiş v2 satırının route/karo/
// yaprağı YOKTUR; onları saymak her v2 satırını "yüzeyde yok" diye kırmızıya düşürürdü. Ters yön §8f'de.
// R0-RAPC (2026-10-25, ilk `hazir:true` v2 satırları): §1 öneksiz mount'u (`router.use(X)`) tanır · §2 v2 yaprağını
// `...reportV2Routes` üreticisinden · §3 v2'yi karodan değil Rapor Merkezi'nden · §7d v2 tarih çipini sayar.
// SONDALAR: `...reportV2Routes` yayılımı silindi → §2 ❌ · öneksiz mount silindi → §1 ❌ (md5 ile geri alındı, 33/0).
// "İki taraflı" şu demek: katalogda olup yüzeyde olmayan KIRMIZI, yüzeyde olup
// katalogda olmayan da KIRMIZI. Tek yön ölçen bir kapı, eksik satırı görür ama
// FAZLA satırı göremez — ve fazlalık tam olarak "kimsenin kapatamadığı rapor"dur.
//
// Negatif sondalar (2026-10-24, KQ-D6, md5 ile geri alındı): `yeniRapor` beyanı silindi → §8c ❌ (+§5 ayna);
// content-routes'tan `...reportV2Routes` çıkarıldı → §2v + §2 ❌.
// DB GEREKTİRMEZ: metin + AST'siz desen; mandal olarak koşar.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  REPORT_CATALOG, GUNSUZ_TARIH_SOZLESMELERI, VARSAYILAN_GUN_MUAFLARI, isReportSurfaced,
  RAPOR_KATEGORILERI_V2, RAPOR_PERSONALARI, RAPOR_VARYANT_BOYUTLARI,
} from "../src/constants/report-catalog";
import type { ReportTarih } from "../src/constants/report-catalog";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import { OLCU_TANIMLARI } from "../src/services/reports/semantik/tanimlar";

const KOK = join(__dirname, "..");
const REPO = join(KOK, "..");
const ELECTRON = join(REPO, "Electron");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
/** İki kümeyi İKİ TARAFLI karşılaştır: eksik (katalogda var, yüzeyde yok) + fazla (tersi). */
function ikiTarafli(ad: string, katalog: Set<string>, yuzey: Set<string>): void {
  const eksik = [...katalog].filter((x) => !yuzey.has(x)).sort();
  const fazla = [...yuzey].filter((x) => !katalog.has(x)).sort();
  check(`${ad} — katalog ⇄ yüzey BİREBİR`, eksik.length === 0 && fazla.length === 0,
    [eksik.length ? `YÜZEYDE YOK: ${eksik.join(", ")}` : "", fazla.length ? `KATALOGDA YOK: ${fazla.join(", ")}` : ""]
      .filter(Boolean).join(" · ") || `${katalog.size} anahtar`);
}

function main(): void {
  console.log("=== RAPOR KATALOĞU ===\n");
  const CIZILEN = REPORT_CATALOG.filter(isReportSurfaced);
  // Hazır v2 yaprağının yüzeyi ELLE yazılmaz: route `_v2/routes.tsx` katalogdan üretir, karo yerine
  // Rapor Merkezi kategorisi çizer (KQ-D6, ilk `hazir:true`). §2v/§3v/§7dv o üretimi ölçer.
  const CIZILEN_V1 = CIZILEN.filter((r) => r.nesil === "v1");
  const CIZILEN_V2 = CIZILEN.filter((r) => r.nesil === "v2");

  // ── §0 körlük zemini ──────────────────────────────────────────────────────
  check("§0 katalog dolu ve anahtarlar TEKİL", REPORT_CATALOG.length >= 25
    && new Set(REPORT_CATALOG.map((r) => r.key)).size === REPORT_CATALOG.length,
    `${REPORT_CATALOG.length} satır · basit ${REPORT_CATALOG.filter((r) => r.sinif === "basit").length} · gelişmiş ${REPORT_CATALOG.filter((r) => r.sinif === "gelismis").length}`);
  check("§0b her satır anahtarı `<kategori>/<rapor>` kalıbında (adres kalıbıyla aynı)",
    REPORT_CATALOG.every((r) => /^[a-z]+\/[a-z0-9-]+$/.test(r.key)),
    REPORT_CATALOG.filter((r) => !/^[a-z]+\/[a-z0-9-]+$/.test(r.key)).map((r) => r.key).join(", ") || "hepsi");

  // ── §1 BACKEND ROUTE ──────────────────────────────────────────────────────
  const monte = new Map<string, string>();       // dosya → mount öneki
  for (const m of readFileSync(join(KOK, "src/routes/reports.routes.ts"), "utf8")
    .matchAll(/router\.use\("(\/[a-z]+)",\s*(\w+)\)/g)) monte.set(m[2]!, m[1]!);
  // Öneksiz mount (rapor v2 temel uçları, yollar dosyada tam): yalnız ÇİZİLEN satırın ucu sayılır — çizilmeyen
  // (`hazir:false`) inmiş ucu §8f, kapsamayı `test_rapor_kapisi` ölçer (R0-RAPC, ilk `hazir:true` satırlar).
  const oneksiz = new Set<string>();
  for (const m of readFileSync(join(KOK, "src/routes/reports.routes.ts"), "utf8").matchAll(/router\.use\((\w+)\);/g)) { monte.set(m[1]!, ""); oneksiz.add(m[1]!); }
  const cizilenUc = new Set(CIZILEN.flatMap((r) => (r.uc === null ? [] : Array.isArray(r.uc) ? r.uc : [r.uc])));
  const importAd = new Map<string, string>();    // değişken → dosya adı
  for (const m of readFileSync(join(KOK, "src/routes/reports.routes.ts"), "utf8")
    .matchAll(/import (\w+) from "\.\/reports\/([\w.-]+)"/g)) importAd.set(m[1]!, m[2]!);
  const routeUclari = new Set<string>();
  for (const [degisken, onek] of monte) {
    const dosya = importAd.get(degisken);
    if (!dosya) continue;
    const kaynak = readFileSync(join(KOK, "src/routes/reports", `${dosya}.ts`), "utf8");
    for (const m of kaynak.matchAll(/router\.get\(\s*"(\/[^"]*)"/g)) {
      const uc = `/api/reports${onek}${m[1]}`;
      if (!oneksiz.has(degisken) || cizilenUc.has(uc)) routeUclari.add(uc);
    }
  }
  check("§1z körlük zemini: route taraması bir şey gördü", routeUclari.size > 20, `${routeUclari.size} uç`);
  const katalogUclari = new Set(CIZILEN.flatMap((r) => (r.uc === null ? [] : Array.isArray(r.uc) ? r.uc : [r.uc])));
  ikiTarafli("§1 backend route", katalogUclari, routeUclari);

  // ── §2 PANEL ROUTE ────────────────────────────────────────────────────────
  const icerik = readFileSync(join(ELECTRON, "src/routes/content-routes.tsx"), "utf8");
  const panelYollari = new Set([...icerik.matchAll(/path:\s*"(reports\/[^"]+)"/g)].map((m) => m[1]!));
  // Kategori hub'ları (`reports/<kategori>`) katalogda satır DEĞİL — yaprak değiller.
  const yapraklar = new Set([...panelYollari].filter((p) => p.split("/").length === 3));
  // Rapor v2 yaprakları KATALOGDAN üretilir (`_v2/routes.tsx`: `nesil === "v2"` → `path: e.panelYolu`); yayılım
  // `content-routes`ta ve üretici kalıp yerindeyse ÇİZİLEN v2 satırının yolu yüzeydedir (elle eşleme yok).
  const v2Uretici = readFileSync(join(ELECTRON, "src/pages/Reports/_v2/routes.tsx"), "utf8");
  const v2Yayildi = /\.\.\.reportV2Routes\b/.test(icerik) && /filter\(\(e\) => e\.nesil === "v2"\)/.test(v2Uretici) && /path:\s*e\.panelYolu/.test(v2Uretici);
  if (v2Yayildi) for (const r of CIZILEN) if (r.nesil === "v2") yapraklar.add(r.panelYolu);   // çizilmeyenin route'u kapıda boş döner
  check("§2z körlük zemini: panel route taraması dolu", panelYollari.size > 20,
    `${panelYollari.size} yol · ${yapraklar.size} yaprak · ${panelYollari.size - yapraklar.size} kategori hub'ı`);
  const katalogPanel = new Set(CIZILEN.filter((r) => r.panelYolu !== "").map((r) => r.panelYolu));
  const v2RouteKaynak = readFileSync(join(ELECTRON, "src/pages/Reports/_v2/routes.tsx"), "utf8");
  const v2Uretiliyor = icerik.includes("...reportV2Routes")
    && /REPORT_CATALOG\.filter\(\(e\) => e\.nesil === "v2"\)/.test(v2RouteKaynak) && /path:\s*e\.panelYolu/.test(v2RouteKaynak)
    && v2RouteKaynak.includes("<ReportV2Route reportKey={e.key} />");
  check("§2v ⭐ v2 yaprak route'ları katalogdan üretilir (`_v2/routes.tsx`) ve içerik route'larına yayılır", v2Uretiliyor,
    v2Uretiliyor ? `${CIZILEN_V2.length} hazır v2 yaprağı` : "üretim zinciri kopuk — hazır v2 satırının adresi yok");
  if (v2Uretiliyor) for (const r of CIZILEN_V2) yapraklar.add(r.panelYolu);
  ikiTarafli("§2 panel route", katalogPanel, yapraklar);

  // ── §3 KARO ───────────────────────────────────────────────────────────────
  const karoKok = join(ELECTRON, "src/pages/Reports");
  const karoYollari = new Set<string>();
  for (const e of readdirSync(karoKok, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;                        // hub karosu kategoriye gider, yaprağa değil
    const yol = join(karoKok, e.name, "tile-config.ts");
    let kaynak: string;
    try { kaynak = readFileSync(yol, "utf8"); } catch { continue; }
    for (const m of kaynak.matchAll(/to:\s*"\/(reports\/[^"]+)"/g)) karoYollari.add(m[1]!);
  }
  check("§3z körlük zemini: karo taraması dolu", karoYollari.size > 20, `${karoYollari.size} karo`);
  // Karo yalnız v1 hub'ındadır; v2 yaprağına giden karo bayrak kapalıyken /forbidden'a düşerdi (fazla = kırmızı).
  // SONDA (D4-H1): kümede olmayan v2 yaprağına (`reports/sales/siparis-talep`) karo → §3 ❌ KATALOGDA YOK; küme boşaltıldı → §3k ❌.
  // DAR istisna (D4-H1, 1e kararı): `V2_KEYS_WITH_OWN_PAGE` satırının sayfası bayraktan BAĞIMSIZ çizilir; v2 kapalıyken
  // Rapor Merkezi yoktur, bulunabilirlik için karo ZORUNLUDUR (iki taraflı). Kümede olmayan v2 satırına karo yine fazla.
  const kendiSayfali = new Set([...(readFileSync(join(ELECTRON, "src/pages/Reports/_v2/routes.tsx"), "utf8")
    .match(/V2_KEYS_WITH_OWN_PAGE[^=]*=\s*new Set\(\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/"([a-z]+\/[a-z0-9-]+)"/g)].map((m) => m[1]!));
  const kendiSayfaliV2 = CIZILEN_V2.filter((r) => kendiSayfali.has(r.key) && r.panelYolu !== "");
  check("§3k kendi sayfalı v2 kümesi okundu ve her anahtarı çizilen bir v2 satırı",
    kendiSayfali.size > 0 && kendiSayfaliV2.length === kendiSayfali.size,
    `${[...kendiSayfali].join(", ") || "BOŞ (küme okunamadı)"}`);
  ikiTarafli("§3 karo `to`", new Set([...CIZILEN_V1, ...kendiSayfaliV2].filter((r) => r.panelYolu !== "").map((r) => r.panelYolu)), karoYollari);
  const merkez = readFileSync(join(ELECTRON, "src/pages/Reports/_v2/center-model.ts"), "utf8");
  const merkezKategori = new Set([...(merkez.match(/CENTER_CATEGORIES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "")
    .matchAll(/key:\s*"([a-z-]+)"/g)].map((m) => m[1]!));
  const merkezSapan = CIZILEN_V2.filter((r) => r.kategoriV2 === null || !merkezKategori.has(r.kategoriV2)).map((r) => r.key);
  check("§3v ⭐ hazır v2 satırı Rapor Merkezi'nde bir kategoride çizilir (karosu merkezdir)",
    merkezKategori.size > 0 && /e\.kategoriV2 === c\.key/.test(merkez) && merkezSapan.length === 0,
    merkezSapan.length ? `KATEGORİSİZ: ${merkezSapan.join(", ")}` : `${CIZILEN_V2.length} satır · ${merkezKategori.size} kategori`);

  // ── §4 MODÜL SÖZ DAĞARCIĞI ────────────────────────────────────────────────
  const ekranModul = new Map(SCREEN_CATALOG.filter((s) => s.key.startsWith("reports/") && s.key.split("/").length === 2)
    .map((s) => [s.key, s.modul as string]));
  check("§4z körlük zemini: SCREEN_CATALOG kategori satırları bulundu", ekranModul.size >= 8, `${ekranModul.size} kategori`);
  const sapan: string[] = [];
  for (const r of REPORT_CATALOG) {
    const kategori = `reports/${r.key.split("/")[0]}`;
    const beklenen = ekranModul.get(kategori);
    if (beklenen === undefined) { sapan.push(`${r.key} → SCREEN_CATALOG'da ${kategori} YOK`); continue; }
    if (beklenen !== r.modul) sapan.push(`${r.key}: katalog "${r.modul}" ≠ ekran "${beklenen}"`);
  }
  check("§4 katalog `modul` ⇄ SCREEN_CATALOG kategori satırı", sapan.length === 0, sapan.join(" · ") || `${REPORT_CATALOG.length} satır hizalı`);

  // ── §5 ELECTRON AYNASI ────────────────────────────────────────────────────
  const govde = (metin: string): string => {
    const b = metin.indexOf("export type ReportSinif");
    return b < 0 ? "" : metin.slice(b).trim();
  };
  const arka = govde(readFileSync(join(KOK, "src/constants/report-catalog.ts"), "utf8"));
  const ayna = govde(readFileSync(join(ELECTRON, "src/lib/report-catalog.ts"), "utf8"));
  check("§5z körlük zemini: iki gövde de okundu", arka.length > 2000 && ayna.length > 2000, `${arka.length} / ${ayna.length} karakter`);
  check("§5 ⭐ Electron aynası backend sabitiyle KARAKTER KARAKTER aynı", arka === ayna,
    arka === ayna ? "birebir" : `ilk fark: ${[...arka].findIndex((c, i) => c !== ayna[i])}. karakter`);

  // ── §7 TARİH SÖZLEŞMESİ ve VARSAYILAN GÜN ─────────────────────────────────
  // NEDEN: aynı sayı bugün İKİ yerde yazılı — panel yaprağında `defaultDays={N}` ve
  // (R0'dan sonra) katalogda `varsayilanGun`. Çift yazımın maliyeti sessizdir: biri
  // değişir, öbürü kalır ve hiçbir kapı ötmez. R2 yaprak kopyasını kaldıracak; o güne
  // kadar İKİSİNİN EŞİT olduğunu bu kol ölçer, kaldırıldığında da kol ölçmeye devam
  // eder (yaprakta prop yoksa düzenin FALLBACK'i okunur, sabit "30" yazılmaz).
  const TARIH_DEGERLERI: ReportTarih[] = ["aralik-iso", "aralik-gun", "tek-gun", "kesit", "ileri-pencere", "yok"];
  const dagilim = new Map(TARIH_DEGERLERI.map((t) => [t, REPORT_CATALOG.filter((r) => r.tarih === t).length]));
  check("§7z körlük zemini: her tarih sözleşmesinin EN AZ bir satırı var (ölü sözleşme yok)",
    TARIH_DEGERLERI.every((t) => (dagilim.get(t) ?? 0) > 0),
    TARIH_DEGERLERI.map((t) => `${t} ${dagilim.get(t)}`).join(" · "));

  // §7a: günsüz sözleşmelerde `null` ZORUNLU · pencere sözleşmelerinde `null` YASAK
  // (muaf satırlar hariç, ve muafiyetin kendisi §7b'de ÖLÇÜLÜR).
  const muafAnahtar = new Set(VARSAYILAN_GUN_MUAFLARI.map((m) => m.key));
  const gunsuzIhlal = REPORT_CATALOG.filter((r) => GUNSUZ_TARIH_SOZLESMELERI.includes(r.tarih) && r.varsayilanGun !== null);
  const pencereIhlal = REPORT_CATALOG.filter((r) => !GUNSUZ_TARIH_SOZLESMELERI.includes(r.tarih)
    && r.varsayilanGun === null && !muafAnahtar.has(r.key));
  const oluMuaf = VARSAYILAN_GUN_MUAFLARI.filter((m) => {
    const satir = REPORT_CATALOG.find((r) => r.key === m.key);
    return !satir || satir.varsayilanGun !== null || GUNSUZ_TARIH_SOZLESMELERI.includes(satir.tarih);
  });
  check("§7a `varsayilanGun` ⇄ tarih sözleşmesi İKİ TARAFLI (günsüzde null zorunlu · penceresinde yasak · ölü muaf yok)",
    gunsuzIhlal.length === 0 && pencereIhlal.length === 0 && oluMuaf.length === 0,
    [gunsuzIhlal.length ? `GÜNSÜZ ama sayı var: ${gunsuzIhlal.map((r) => r.key).join(", ")}` : "",
     pencereIhlal.length ? `PENCERE ama sayı yok: ${pencereIhlal.map((r) => r.key).join(", ")}` : "",
     oluMuaf.length ? `ÖLÜ MUAF: ${oluMuaf.map((m) => m.key).join(", ")}` : ""].filter(Boolean).join(" · ")
    || `${REPORT_CATALOG.length} satır · ${muafAnahtar.size} ölçülü muaf`);

  // §7b: muafiyet LİSTE değil ÖLÇÜM — kanıt dosyası okunamazsa ÖLÇÜLEMEDİ ⇒ KIRMIZI.
  const muafSapan: string[] = [];
  for (const m of VARSAYILAN_GUN_MUAFLARI) {
    let kaynak: string;
    try { kaynak = readFileSync(join(REPO, m.kanit), "utf8"); }
    catch { muafSapan.push(`${m.key}: ÖLÇÜLEMEDİ — kanıt dosyası okunamadı (${m.kanit})`); continue; }
    if (!kaynak.includes(m.desen)) muafSapan.push(`${m.key}: kanıt DÜŞTÜ — "${m.desen}" artık ${m.kanit} içinde yok`);
  }
  check("§7b `varsayilanGun` muafiyetleri kanıtlarıyla AYAKTA (liste değil ölçüm)",
    muafSapan.length === 0, muafSapan.join(" · ") || VARSAYILAN_GUN_MUAFLARI.map((m) => `${m.key} ✓ ${m.desen}`).join(" · "));

  // §7c: gün sayıları KAPALI küme — "bir rapora özel 45" sessizce doğmasın.
  const GUN_KUMESI = [7, 30, 90, 180];
  const kacak = REPORT_CATALOG.filter((r) => r.varsayilanGun !== null && !GUN_KUMESI.includes(r.varsayilanGun));
  check("§7c `varsayilanGun` değerleri kapalı kümeden (7/30/90/180)", kacak.length === 0,
    kacak.map((r) => `${r.key}=${r.varsayilanGun}`).join(", ")
    || GUN_KUMESI.map((g) => `${g}g ${REPORT_CATALOG.filter((r) => r.varsayilanGun === g).length}`).join(" · "));

  // §7d ⭐ ÇİFT YAZIM İMKÂNSIZ (R4 sonrası): yaprak sayı YAZMAZ — tarih hook'u kataloğun
  // ANAHTARINI alır (`useReportDateRange("<key>")`), varsayılan gün `varsayilanGun`dan okunur,
  // düzen fallback taşımaz. Kol üç şeyi ölçer: (a) yaprakta `defaultDays=` prop'u ve sayı
  // argümanlı tarih hook'u YOK, (b) yaprak KENDİ anahtarını hook'a veriyor (yaprak→bileşen→
  // dosya zinciri route'tan çözülür, elle eşleme yok), (c) düzende `defaultDays` yok.
  // Pencereli yaprağın anahtarı doğruysa sayı katalogdan gelir — ayrışacak ikinci yazım yok.
  const bilesenYolu = new Map<string, string>();
  for (const m of icerik.matchAll(/import\s+\{?\s*(\w+)\s*\}?\s+from\s+"(@\/pages\/Reports\/[^"]+)"/g)) bilesenYolu.set(m[1]!, m[2]!);
  for (const m of icerik.matchAll(/const (\w+) = lazy\(\(\) => import\("(@\/pages\/Reports\/[^"]+)"\)/g)) bilesenYolu.set(m[1]!, m[2]!);
  const yolBilesen = new Map<string, string>();
  for (const m of icerik.matchAll(/path:\s*"(reports\/[^"]+)",\s*element:\s*\(([\s\S]{0,400}?)\n {4}\)/g)) {
    const ic = m[2]!.match(/<(\w+)\s*\/>/);
    if (ic) yolBilesen.set(m[1]!, ic[1]!);
  }
  const duzen = readFileSync(join(ELECTRON, "src/pages/Reports/_components/ReportPageLayout.tsx"), "utf8");
  check("§7dz körlük zemini: yaprak→bileşen→dosya zinciri çözüldü ve düzen katalog dışı gün taşımıyor",
    yolBilesen.size > 20 && bilesenYolu.size > 20 && !/defaultDays/.test(duzen) && duzen.includes("<ReportDateFilter"),
    `${yolBilesen.size} yaprak · ${bilesenYolu.size} bileşen · düzen: ${/defaultDays/.test(duzen) ? "defaultDays VAR" : "fallback yok"}`);
  const ciftSapan: string[] = [];
  const ARALIK_HOOKLARI = /\b(useReportDateRange|useFactoryRange)\(([^)]*)\)/g;
  for (const r of CIZILEN_V1) {
    if (r.varsayilanGun === null || r.panelYolu === "") continue;   // diyalog ve günsüzler §7a/§7b'de
    const bilesen = yolBilesen.get(r.panelYolu);
    if (!bilesen) { ciftSapan.push(`${r.key}: ÖLÇÜLEMEDİ — route'ta bileşen bulunamadı`); continue; }
    const yol = bilesenYolu.get(bilesen);
    if (!yol) { ciftSapan.push(`${r.key}: ÖLÇÜLEMEDİ — ${bilesen} import'u bulunamadı`); continue; }
    let kaynak: string;
    try { kaynak = readFileSync(join(ELECTRON, "src", `${yol.slice(2)}.tsx`), "utf8"); }
    catch { ciftSapan.push(`${r.key}: ÖLÇÜLEMEDİ — yaprak dosyası okunamadı (${yol})`); continue; }
    if (/defaultDays=\{/.test(kaynak)) { ciftSapan.push(`${r.key}: yaprakta \`defaultDays=\` prop'u var (ikinci yazım)`); continue; }
    const cagrilar = [...kaynak.matchAll(ARALIK_HOOKLARI)];
    if (cagrilar.length === 0) { ciftSapan.push(`${r.key}: pencereli sözleşme ama yaprak aralık hook'u çağırmıyor`); continue; }
    for (const c of cagrilar) {
      const arg = c[2]!.trim();
      if (arg !== `"${r.key}"`) ciftSapan.push(`${r.key}: ${c[1]}(${arg}) — anahtar kendi anahtarı değil`);
    }
  }
  check("§7d ⭐ pencereli yaprak SAYI yazmaz, KENDİ anahtarını hook'a verir (çift yazım imkânsız; sayı yalnız katalogda)",
    ciftSapan.length === 0, ciftSapan.join(" · ")
    || `${CIZILEN_V1.filter((r) => r.varsayilanGun !== null && r.panelYolu !== "").length} yaprak ölçüldü`);
  // v2 genel yaprağı tarihi `ReportDateFilter`a satırın KENDİ anahtarıyla verir (sayı katalogdan).
  const cipler = readFileSync(join(ELECTRON, "src/pages/Reports/_v2/ParamChips.tsx"), "utf8");
  check("§7dv ⭐ v2 genel yaprağı tarih hook'una KENDİ anahtarını verir (gün sayısı yazmaz)",
    /<ReportDateFilter reportKey=\{entry\.key as ReportKey\}/.test(cipler) && !/defaultDays/.test(cipler),
    `${CIZILEN_V2.filter((r) => r.varsayilanGun !== null).length} pencereli hazır v2`);

  // ── §6 BEYANLI YÜZEY TÜRLERİ görünür kalsın ───────────────────────────────
  const yabanci = REPORT_CATALOG.filter((r) => r.yuzey === "yaprak-yabanci-uc");
  check("§6 `yaprak-yabanci-uc` satırlarının `uc`u NULL (başkasının sözleşmesi)",
    yabanci.every((r) => r.uc === null), yabanci.map((r) => r.key).join(", "));
  const diyalog = REPORT_CATALOG.filter((r) => r.yuzey === "diyalog");
  check("§6b `diyalog` satırının panel yolu YOK (yaprak sayfa değil)",
    diyalog.every((r) => r.panelYolu === ""), diyalog.map((r) => r.key).join(", "));

  // ── §8 RAPORLAR v2 — YENİ HÂL EŞLEMESİ ve HAZIRLIK (R0-TANIM) ─────────────
  // NEDEN: 36 eski rapor 14 temel rapora iner (plan §5). Eski adres geçişte açık kalır ve
  // "bu raporun yeni hâli" bandı `yeniHali`den çizilir — eşlemesi olmayan bir v1 satırı bantsız
  // kalır, hiçbir v1'in göstermediği bir v2 satırı da "neyin yerine geldiği" belirsiz bir rapordur.
  // Negatif sondalar (2026-10-24, yalnız backend sabiti bozuldu, md5 ile geri alındı; §5 ayna ❌'si
  // beklenen eş kırmızıdır): `sales/order-intake`ın `yeniHali` silindi → §8a ❌ (+§5);
  // `dokuma/levent-sonucu` `birlesti → dokuma/tezgah-randimani` yapıldı → §8c ❌ (+§5);
  // §8f K-KAPI (R0-RAPB, 2026-10-24): `temel-uretim.routes.ts` `quality/kayip` ucundan `...reportGate(...)` silindi
  // → §8f ❌ (1); `/inventory/depo` yolu `/inventory/depo-x` yapıldı (kapı yolsuz kaldı) → §8f ❌ (1).
  const v1 = REPORT_CATALOG.filter((r) => r.nesil === "v1");
  const v2 = REPORT_CATALOG.filter((r) => r.nesil === "v2");
  check("§8z körlük zemini: iki nesil de dolu", v1.length > 0 && v2.length > 0, `v1 ${v1.length} · v2 ${v2.length}`);

  // Tip `yeniHali`yi zorunlu kılar ama `tsx` tip denetlemez — eksik alan çalışma anında da ölçülür.
  const halOf = (r: (typeof v1)[number]): (typeof v1)[number]["yeniHali"] | undefined =>
    (r as { yeniHali?: (typeof v1)[number]["yeniHali"] }).yeniHali;
  const v2Anahtar = new Set(v2.map((r) => r.key));
  const eksikHal: string[] = [];
  const yanlisHedef: string[] = [];
  const gosterilen = new Map<string, string[]>();
  for (const r of v1) {
    const hal = halOf(r);
    if (!hal) { eksikHal.push(r.key); continue; }
    if (hal.tur !== "birlesti") continue;
    if (!v2Anahtar.has(hal.anahtar)) { yanlisHedef.push(`${r.key} → ${hal.anahtar}`); continue; }
    gosterilen.set(hal.anahtar, [...(gosterilen.get(hal.anahtar) ?? []), r.key]);
  }
  check("§8a ⭐ her v1 satırı `yeniHali` taşır (birleşti · uzman · taşındı)", eksikHal.length === 0,
    eksikHal.length ? `YENİ HÂLİ YOK: ${eksikHal.join(", ")}` : `${v1.length}/${v1.length}`
      + ` · birleşti ${v1.filter((r) => halOf(r)?.tur === "birlesti").length}`
      + ` · uzman ${v1.filter((r) => halOf(r)?.tur === "uzman").length}`
      + ` · taşındı ${v1.filter((r) => halOf(r)?.tur === "tasindi").length}`);
  check("§8b `birlesti` hedefi katalogda `nesil:\"v2\"` satırıdır", yanlisHedef.length === 0, yanlisHedef.join(" · ") || "hepsi");
  // `yeniRapor:true` = hiçbir v1'in yerine gelmeyen BEYANLI yeni rapor; beyansız yetim kırmızı kalır.
  const yeniBeyan = (r: (typeof v2)[number]): boolean => (r as { yeniRapor?: true }).yeniRapor === true;
  const yetim = v2.filter((r) => !gosterilen.has(r.key) && !yeniBeyan(r)).map((r) => r.key);
  const yeniSapan = v2.filter((r) => yeniBeyan(r) && (gosterilen.has(r.key) || !r.hazir)).map((r) => r.key);
  check("§8c2 `yeniRapor` beyanı yalnız hiçbir v1'in göstermediği HAZIR satırda", yeniSapan.length === 0,
    yeniSapan.join(", ") || `${v2.filter(yeniBeyan).length} yeni rapor`);
  check("§8c ⭐ her v2 satırı EN AZ bir v1 satırının yeni hâlidir (yetim v2 yok)", yetim.length === 0,
    yetim.length ? `HİÇBİR v1 GÖSTERMİYOR: ${yetim.join(", ")}` : `${v2.length} v2 · ${[...gosterilen.values()].flat().length} v1 bağı`);

  // §8d taşınan rapor gerçekten VAR olan bir ekrana gider (adres ölçülür, uydurulmaz).
  const tumPanelYollari = new Set([...icerik.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!));
  const tasinan = v1.flatMap((r) => { const h = halOf(r); return h?.tur === "tasindi" ? [{ key: r.key, hal: h }] : []; });
  const tasinanSapan = tasinan.filter((t) => !tumPanelYollari.has(t.hal.panelYolu) || t.hal.aciklama.trim() === "")
    .map((t) => `${t.key} → ${t.hal.panelYolu}`);
  check("§8d `tasindi` hedef yolu panel route'larında var ve açıklaması dolu", tasinan.length > 0 && tasinanSapan.length === 0,
    tasinanSapan.join(" · ") || `${tasinan.length} satır`);

  // §8e uzman araçlar `muhasebe-araclari` kategorisinde; menüden çıkan v1 satırı kategorisiz.
  const kategoriSapan = v1.filter((r) => (halOf(r)?.tur === "uzman") !== (r.kategoriV2 === "muhasebe-araclari")
    || (halOf(r)?.tur !== "uzman" && r.kategoriV2 !== null)).map((r) => r.key);
  check("§8e v1 `kategoriV2`: uzman ⇔ `muhasebe-araclari`, diğerleri `null`", kategoriSapan.length === 0,
    kategoriSapan.join(", ") || `${v1.filter((r) => r.kategoriV2 !== null).length} uzman`);

  // §8f ⭐ AŞAMALI İNİŞ (K-KAPI 2026-10-24): `hazir:false` satırın ucu backend'de önce inebilir; o zaman uç
  // KAPILI olmalı — kapı iki kalıpta tanınır: literal `requireReportOpen("<key>")` ya da `...reportGate("<key>")`
  // fabrikası (aynı sıkılık). Ucu olmayan satırın taşıyıcısında kapı da OLMAZ (yolsuz kapı = beyan/uç ayrışması).
  // `hazir:true` satır §1–§3 ve `test_rapor_kapisi` ölçümüne zaten girer.
  const hazirSapan: string[] = [];
  let inmisUc = 0;
  const kapiVar = (metin: string, key: string): boolean =>
    metin.includes(`requireReportOpen("${key}")`) || metin.includes(`reportGate("${key}")`);
  for (const r of v2) {
    if (r.hazir) continue;
    for (const t of r.kapiTasiyici ?? []) {
      let kaynak: string;
      try { kaynak = readFileSync(join(KOK, t.dosya), "utf8"); } catch { continue; } // dosya henüz yok = beklenen
      const bas = kaynak.indexOf(`router.get("${t.yol}"`);
      if (bas < 0) {
        if (kapiVar(kaynak, r.key)) hazirSapan.push(`${r.key}: uç yok ama kapı var (${t.dosya})`);
        continue;
      }
      inmisUc++;
      // Zincir: yol dizgisinden işleyicinin başına (`async (`) kadar.
      const son = kaynak.indexOf("async (", bas);
      const zincir = kaynak.slice(bas, son < 0 ? undefined : son);
      if (!kapiVar(zincir, r.key)) hazirSapan.push(`${r.key}: uç inmiş ama RAPOR KAPISI yok (${t.dosya}${t.yol})`);
    }
  }
  check("§8f ⭐ `hazir:false` satırın inmiş ucu KAPILI, ucu olmayanda kapı yok (aşamalı iniş, K-KAPI)", hazirSapan.length === 0,
    hazirSapan.join(" · ") || `${v2.filter((r) => !r.hazir).length} hazır değil (${inmisUc} uç inmiş) · ${v2.filter((r) => r.hazir).length} hazır`);

  // §8g v2 satırının biçimi: adres anahtardan türer, kategori/persona/varyant kapalı kümeden.
  const KATEGORI = new Set<string>(RAPOR_KATEGORILERI_V2);
  const PERSONA = new Set<string>(RAPOR_PERSONALARI);
  const VARYANT = new Set<string>(RAPOR_VARYANT_BOYUTLARI);
  const bicimSapan = v2.filter((r) => r.panelYolu !== `reports/${r.key}` || r.uc !== `/api/reports/${r.key}`
    || r.kategoriV2 === null || r.kategoriV2 === "muhasebe-araclari" || !KATEGORI.has(r.kategoriV2)
    || r.persona.length === 0 || !r.persona.every((p) => PERSONA.has(p))
    || r.varyantBoyutlari.length === 0 || !r.varyantBoyutlari.every((b) => VARYANT.has(b))
    || !r.kapiTasiyici || r.kapiTasiyici.length === 0 || r.sinif !== "basit").map((r) => r.key);
  check("§8g v2 satırı: `reports/<key>` · `/api/reports/<key>` · kategori/persona/varyant kapalı kümeden · taşıyıcı beyanlı",
    bicimSapan.length === 0, bicimSapan.join(", ") || `${v2.length} satır`);

  // ── §9 ÖLÇÜ TANIM SÖZLÜĞÜ ─────────────────────────────────────────────────
  // NEDEN: "fire", "iptal oranı", "zamanında teslim" TEK tanımlıdır; adı ve günlük dil açıklaması
  // yalnız sözlükte yazılır. Kaynak alanı beyan değil ÖLÇÜMdür: dosya okunur, alan yolunun her
  // parçası dosyada aranır — servis alanı yeniden adlandırılınca sözlük sessizce bayatlamaz.
  // Negatif sondalar (2026-10-24, md5 ile geri alındı): `iade.oran` kaynağı `returnRatePct` yapıldı → §9c ❌ (1);
  // `sevk.brutMetre` açıklamasına "Σ" yazıldı → §9b ❌ (1).
  const ZORUNLU_OLCU = [
    "siparis.metre", "siparis.tutar", "sevk.brutMetre", "sevk.tutar", "termin.zamanindaYuzde", "termin.yariSureGun",
    "termin.dokuzdaDokuzGun", "siparis.iptalOrani", "iade.oran", "fire.metre", "fire.hurdaMetre", "fire.fasonMetre",
    "fire.leventMetre", "kalite.birinciYuzde", "kalite.binMetredeHata", "uretim.bekleyenTop", "uretim.gecenMetre",
    "stok.oluMetre", "stok.yasiBilinmeyenMetre", "fason.zamanindaDonusYuzde", "dokuma.randimanYuzde", "dokuma.durusSure",
    "dokuma.mudahaleDakika", "levent.dengeYuzde", "alacak.vadesiGecmis", "cek.yaklasanVade",
  ];
  const olcuKimlik = OLCU_TANIMLARI.map((o) => o.kimlik);
  const eksikOlcu = ZORUNLU_OLCU.filter((k) => !olcuKimlik.includes(k));
  check("§9a sözlük zorunlu ölçüleri taşır ve kimlikler TEKİL", eksikOlcu.length === 0 && new Set(olcuKimlik).size === olcuKimlik.length,
    eksikOlcu.length ? `EKSİK: ${eksikOlcu.join(", ")}` : `${olcuKimlik.length} ölçü`);
  // Formül dili kalkar (K3): okuyan patron/şef. Sözcük sınırıyla aranır ("ABC" bir müşteri adında geçebilir diye değil, açıklamada yeri yok).
  const FORMUL = [/Σ|∑|×|÷|=/, /\bP\d{2}\b/, /medyan/i, /\bOEE\b/, /\bABC\b/, /\bRFM\b/, /\s\/\s/];
  const formullu = OLCU_TANIMLARI.filter((o) => o.aciklama.trim() === "" || o.ad.trim() === ""
    || FORMUL.some((re) => re.test(o.aciklama) || re.test(o.ad))).map((o) => o.kimlik);
  check("§9b ⭐ ad ve açıklama dolu, formül dili YOK (Σ · P90 · medyan · OEE · ABC · RFM · işlem işaretleri)",
    formullu.length === 0, formullu.join(", ") || `${OLCU_TANIMLARI.length} açıklama temiz`);
  const kaynakSapan: string[] = [];
  for (const o of OLCU_TANIMLARI) {
    if (o.kaynak === null) continue;
    let kaynak: string;
    try { kaynak = readFileSync(join(KOK, o.kaynak.dosya), "utf8"); }
    catch { kaynakSapan.push(`${o.kimlik}: ÖLÇÜLEMEDİ — ${o.kaynak.dosya} okunamadı`); continue; }
    const yok = o.kaynak.alan.split(".").filter((parca) => !new RegExp(`\\b${parca}\\b`).test(kaynak));
    if (yok.length) kaynakSapan.push(`${o.kimlik}: ${o.kaynak.dosya} içinde yok → ${yok.join(", ")}`);
  }
  const kaynaksiz = OLCU_TANIMLARI.filter((o) => o.kaynak === null).map((o) => o.kimlik);
  check("§9c ⭐ beyanlı kaynak alanı servis dosyasında GERÇEKTEN var (her parça)", kaynakSapan.length === 0,
    kaynakSapan.join(" · ") || `${OLCU_TANIMLARI.length - kaynaksiz.length} ölçülü · ${kaynaksiz.length} kaynaksız (R0-RAP tamamlar): ${kaynaksiz.join(", ")}`);
  // Sevk metresi TEK kaynaktan (BRÜT `_shipped.ts`) okunur — çekirdek kural.
  const sevk = OLCU_TANIMLARI.find((o) => o.kimlik === "sevk.brutMetre");
  check("§9d `sevk.brutMetre` kaynağı `reports/_shipped.ts` (brüt sevk tek kaynak)", sevk?.kaynak?.dosya === "src/services/reports/_shipped.ts",
    sevk?.kaynak?.dosya ?? "kaynak yok");

  // ── §10 `reports.v2Enabled` VARSAYILANI KAPALI (bugünkü davranış) ──────────
  // Panel rozeti ↔ backend okuyucusu birebirliğini `test_feature_flag_contract` ölçer (sonda: okuyucu
  // `true` döndü → ❌ 1); bu kol İKİSİNİN BİRLİKTE `true`ya kaymasını yakalar (o bekçi eşitliğe bakar).
  const ayar = readFileSync(join(ELECTRON, "src/pages/GeneralSettings/settings-config.ts"), "utf8");
  const satir = ayar.slice(ayar.indexOf('key: "reportsV2Enabled"'), ayar.indexOf('key: "reportsV2Enabled"') + 600);
  check("§10 `reportsV2Enabled` panel satırı var ve varsayılanı KAPALI", ayar.includes('key: "reportsV2Enabled"') && /defaultOn: false/.test(satir),
    ayar.includes('key: "reportsV2Enabled"') ? (/defaultOn: false/.test(satir) ? "defaultOn: false" : "defaultOn KAPALI DEĞİL") : "satır yok");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
