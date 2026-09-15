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
// "İki taraflı" şu demek: katalogda olup yüzeyde olmayan KIRMIZI, yüzeyde olup
// katalogda olmayan da KIRMIZI. Tek yön ölçen bir kapı, eksik satırı görür ama
// FAZLA satırı göremez — ve fazlalık tam olarak "kimsenin kapatamadığı rapor"dur.
//
// DB GEREKTİRMEZ: metin + AST'siz desen; mandal olarak koşar.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPORT_CATALOG, GUNSUZ_TARIH_SOZLESMELERI, VARSAYILAN_GUN_MUAFLARI } from "../src/constants/report-catalog";
import type { ReportTarih } from "../src/constants/report-catalog";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";

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
  const importAd = new Map<string, string>();    // değişken → dosya adı
  for (const m of readFileSync(join(KOK, "src/routes/reports.routes.ts"), "utf8")
    .matchAll(/import (\w+) from "\.\/reports\/([\w.-]+)"/g)) importAd.set(m[1]!, m[2]!);
  const routeUclari = new Set<string>();
  for (const [degisken, onek] of monte) {
    const dosya = importAd.get(degisken);
    if (!dosya) continue;
    const kaynak = readFileSync(join(KOK, "src/routes/reports", `${dosya}.ts`), "utf8");
    for (const m of kaynak.matchAll(/router\.get\(\s*"(\/[^"]*)"/g)) routeUclari.add(`/api/reports${onek}${m[1]}`);
  }
  check("§1z körlük zemini: route taraması bir şey gördü", routeUclari.size > 20, `${routeUclari.size} uç`);
  const katalogUclari = new Set(REPORT_CATALOG.flatMap((r) => (r.uc === null ? [] : Array.isArray(r.uc) ? r.uc : [r.uc])));
  ikiTarafli("§1 backend route", katalogUclari, routeUclari);

  // ── §2 PANEL ROUTE ────────────────────────────────────────────────────────
  const icerik = readFileSync(join(ELECTRON, "src/routes/content-routes.tsx"), "utf8");
  const panelYollari = new Set([...icerik.matchAll(/path:\s*"(reports\/[^"]+)"/g)].map((m) => m[1]!));
  // Kategori hub'ları (`reports/<kategori>`) katalogda satır DEĞİL — yaprak değiller.
  const yapraklar = new Set([...panelYollari].filter((p) => p.split("/").length === 3));
  check("§2z körlük zemini: panel route taraması dolu", panelYollari.size > 20,
    `${panelYollari.size} yol · ${yapraklar.size} yaprak · ${panelYollari.size - yapraklar.size} kategori hub'ı`);
  const katalogPanel = new Set(REPORT_CATALOG.filter((r) => r.panelYolu !== "").map((r) => r.panelYolu));
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
  ikiTarafli("§3 karo `to`", katalogPanel, karoYollari);

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
  for (const r of REPORT_CATALOG) {
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
    || `${REPORT_CATALOG.filter((r) => r.varsayilanGun !== null && r.panelYolu !== "").length} yaprak ölçüldü`);

  // ── §6 BEYANLI YÜZEY TÜRLERİ görünür kalsın ───────────────────────────────
  const yabanci = REPORT_CATALOG.filter((r) => r.yuzey === "yaprak-yabanci-uc");
  check("§6 `yaprak-yabanci-uc` satırlarının `uc`u NULL (başkasının sözleşmesi)",
    yabanci.every((r) => r.uc === null), yabanci.map((r) => r.key).join(", "));
  const diyalog = REPORT_CATALOG.filter((r) => r.yuzey === "diyalog");
  check("§6b `diyalog` satırının panel yolu YOK (yaprak sayfa değil)",
    diyalog.every((r) => r.panelYolu === ""), diyalog.map((r) => r.key).join(", "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
