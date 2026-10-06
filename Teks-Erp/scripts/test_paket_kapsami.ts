// =============================================================================
// BEKÇİ — BACKEND PAKETİNİN İMZALI KAPSAMI (Dağıtım v2 · D5, DB'siz)
// Çalıştır: npx tsx scripts/run-all-tests.ts paket_kapsami
// =============================================================================
// Paket (`deploy/paketle.ps1`) YÖNETİCİ/SYSTEM olarak koşacak dosyalar taşır: runtime\ altındaki iki
// Rust hizmet ikilisi (backend hizmet konağı + güncelleyici), hizmet\ (dizin/izin + hizmet kaydı) ve
// gecis\ (pm2 → hizmet geçişi) betikleri, kökteki kurulum betikleri. Bunlardan biri PAKET imzalı
// bütünlük listesinin (`butunluk.jws`) DIŞINDA kalırsa kurcalanmış bir betik SYSTEM'de koşar ve
// hiçbir doğrulama onu görmez. Ölçülen sözleşmeler:
//   §1 paketle.ps1 içerik listeleri okunur ($KOK_BETIKLERI · $ALT_BETIKLER · $HIZMET_IKILILERI) — yoksa ÖLÇÜLEMEDİ
//   §2 kök betikleri ⊆ INTEGRITY_SCOPE_FILES
//   §3 alt dizin betikleri + runtime\ ⊆ INTEGRITY_SCOPE_DIRS; D6'nın zorunlu dört betiği listede
//   §4 paketle.ps1'de $stage'e giden HER kopya bilinen bir girdiye iner (listeyi atlayan kopya yok);
//      çalıştırılabilir her girdi imzalı kapsamda — beyanlı istisnalar dışında
//   §5 hizmet ikilileri OLÇÜLEREK girer: yoksa DUR · MZ/PE · x64 · TEST çapası (test-anchor) RED · künye ·
//      güncelleyicinin çapa kipi = paketin (bayt kodu künyesi `guvenCapasi`, G3)
//   §6 PAKET.json `backendHizmetAdi` dağıtım kaydından (dagitim-kapisi TEKSERP_HIZMET_ADI) · `backendLisansSunucusu` +
//      `lisansSunucusuVarsayilan` (TEKSERP_LISANS_*; yoksa Fail) · `hizmetIkilileri`
//   §7 CI (korumali-paket.yml) win-x64 kolunda iki ikiliyi test çapasız ve TEK çapa kipinde derler (G3: bayt kodu
//      künyesi `uretim` değilse DUR, `hazirlik-capasi` özelliği yok, künye `capaKipi` ölçülür) ve yapıta koyar
//   §8 gerçek imza kapsamı işlevi (`packageScope` + `listScopedFiles`) sahte bir paket ağacında
//      hizmet\ · gecis\ · runtime\*.exe dosyalarını LİSTEYE alır
// NEGATİF SONDA (✓K, her koşumda): §2–§7 yüklemleri bellekte bozulmuş kopyalara koşar; her sonda
//   mutasyonun UYGULANDIĞINI ve hükmün beklenen bölümden geldiğini ölçer. ÜÇ SONUÇ: kaynak
//   okunamazsa ÖLÇÜLEMEDİ (kırmızı sayılır, yeşil DEĞİL).
// =============================================================================
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { INTEGRITY_SCOPE_DIRS, INTEGRITY_SCOPE_FILES, listScopedFiles, packageScope } from "../src/lib/license/integrity-scope";
import { psTara } from "./lib/ps-tarama";

const TEKS = join(__dirname, "..");
const KOK = join(TEKS, "..");
const PAKETLE = "deploy/paketle.ps1";
const KAPSAM = "Teks-Erp/src/lib/license/integrity-scope.ts";
const DAGITIM_LIB = "scripts/lib/dagitim.mjs";
const KORUMALI_CI = ".github/workflows/korumali-paket.yml";
const DOSYALAR = [PAKETLE, KAPSAM, DAGITIM_LIB, KORUMALI_CI];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** D6'nın paket için ZORUNLU tuttuğu alt dizin betikleri (yönetici kararı 2026-10-01). */
const D6_ZORUNLU = ["hizmet/backend-hizmeti.ps1", "hizmet/guncelleyici-hizmeti.ps1", "hizmet/kanal-adlari.ps1", "hizmet/sema-hizasi.ps1", "gecis/gecis.ps1", "gecis/gecis-yardimci.cjs"];
/** $stage'e kopyalanan ve listelerin DIŞINDA kalan bilinen girdiler (paketin kendi derlemesi). */
const BILINEN_GIRDILER = ["dist", "prisma", "runtime", "native", "public", "assets", "package.json", "package-lock.json", "ecosystem.config.js", "prisma.config.js"];
/**
 * İmzalı kapsamın BİLEREK dışında kalan girdiler — gerekçesiyle. Buraya eklemek bir KARARDIR.
 *   ecosystem.config.js: pm2 düzeninde kur.ps1 yükseltmede SUNUCUNUNKİNİ korur (test_lisans_butunluk §2d).
 *   public · assets: statik durum sayfası ve etiket fontları; sunucu onları çalıştırmaz, sunar.
 */
const IMZASIZ_ISTISNA: Record<string, string> = {
  "ecosystem.config.js": "pm2 düzeninde sunucunun kopyası korunur (test_lisans_butunluk §2d)",
  public: "statik durum sayfası — çalıştırılmaz",
  assets: "etiket fontları — çalıştırılmaz",
};
const CALISTIRILABILIR = /\.(ps1|psm1|cmd|bat|exe|dll|node|js|cjs|mjs)$/i;
const CALISTIRILABILIR_DIZIN = new Set(["dist", "runtime", "native", "node_modules", "hizmet", "gecis"]);

type Dosyalar = Record<string, string | undefined>;
interface Olcum {
  kirmizi: string[];
  olculemedi: string[];
}

function oku(rel: string): string | undefined {
  try {
    return readFileSync(join(KOK, rel), "utf8");
  } catch {
    return undefined;
  }
}

/** `$AD = @("a", "b")` ya da `[ordered]@{ "a" = "x"; ... }` — değerler (sözlükte ANAHTARLAR). */
function psListe(kaynak: string, ad: string): string[] | null {
  const dizi = new RegExp(`^\\$${ad}\\s*=\\s*@\\(([^)]*)\\)`, "m").exec(kaynak);
  if (dizi) return [...dizi[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const sozluk = new RegExp(`^\\$${ad}\\s*=\\s*\\[ordered\\]@\\{([^}]*)\\}`, "m").exec(kaynak);
  if (sozluk) return [...sozluk[1]!.matchAll(/"([^"]+)"\s*=/g)].map((m) => m[1]!);
  return null;
}

/** TS kaynağındaki `export const AD ... Object.freeze([ ... ])` dizisi (bellekte bozulabilsin diye metinden). */
function tsListe(kaynak: string, ad: string): string[] | null {
  const m = new RegExp(`export const ${ad}[^=]*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`).exec(kaynak);
  return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : null;
}

/** $stage'e kopyalanan hedefin paket kökündeki adı ("$stage\dist" → dist, "$stage\" → kaynağın adı). */
function stageHedefleri(kaynak: string): { satir: number; girdi: string | null; ham: string }[] {
  const out: { satir: number; girdi: string | null; ham: string }[] = [];
  const t = psTara(kaynak);
  for (const s of t.satirlar) {
    if (!/\bCopy-Item\b/.test(s.ciplak)) continue;
    const kod = s.kod;
    if (!/\$stage/.test(kod)) continue;
    // Hedef: son argüman. "$stage\x" / (Join-Path $stage "x") / (Join-Path (Join-Path $stage "runtime") $ikiliAd) / "$stage\" + kaynak adı.
    let girdi: string | null = null;
    let m: RegExpExecArray | null;
    if ((m = /"\$stage\\([A-Za-z0-9_.-]+)(?:\\[^"]*)?"\s*(?:-Recurse)?\s*$/.exec(kod.trim()))) girdi = m[1]!;
    else if ((m = /"\$stage\\"\s*$/.exec(kod.trim()))) {
      const k = /Copy-Item\s+"[^"]*[\\/]([A-Za-z0-9_.-]+)"/.exec(kod);
      girdi = k ? k[1]! : null;
    } else if ((m = /Join-Path\s+\(Join-Path\s+\$stage\s+"([A-Za-z0-9_.-]+)"\)/.exec(kod))) girdi = m[1]!;
    else if ((m = /Join-Path\s+\$stage\s+"([A-Za-z0-9_.-]+)(?:\\[^"]*)?"/.exec(kod))) girdi = m[1]!;
    else if (/Join-Path\s+\$stage\s+\$b\b/.test(kod)) girdi = "$KOK_BETIKLERI";
    else if (/Copy-Item\s+\$kaynak\s+\$altHedef\b/.test(kod)) girdi = "$ALT_BETIKLER";
    out.push({ satir: s.no, girdi, ham: kod.trim() });
  }
  return out;
}

function olc(d: Dosyalar): Olcum {
  const kirmizi: string[] = [];
  const olculemedi: string[] = [];
  const k = (bolum: string, x: string): void => void kirmizi.push(`${bolum} ${x}`);
  for (const rel of DOSYALAR) if (typeof d[rel] !== "string") olculemedi.push(`${rel} okunamadı`);
  if (olculemedi.length) return { kirmizi, olculemedi };
  const paketle = d[PAKETLE]!;
  const kapsam = d[KAPSAM]!;

  // §1
  const kokBetik = psListe(paketle, "KOK_BETIKLERI");
  const altBetik = psListe(paketle, "ALT_BETIKLER");
  const ikililer = psListe(paketle, "HIZMET_IKILILERI");
  const dizinler = tsListe(kapsam, "INTEGRITY_SCOPE_DIRS");
  const dosyalar = tsListe(kapsam, "INTEGRITY_SCOPE_FILES");
  for (const [ad, v] of [["$KOK_BETIKLERI", kokBetik], ["$ALT_BETIKLER", altBetik], ["$HIZMET_IKILILERI", ikililer], ["INTEGRITY_SCOPE_DIRS", dizinler], ["INTEGRITY_SCOPE_FILES", dosyalar]] as const) {
    if (!v || v.length === 0) olculemedi.push(`§1 ${ad} okunamadı (boş liste yeşil sayılmaz)`);
  }
  if (olculemedi.length) return { kirmizi, olculemedi };

  // §2
  for (const b of kokBetik!) if (!dosyalar!.includes(b)) k("§2", `kök betiği "${b}" imzalı kapsamda DEĞİL (INTEGRITY_SCOPE_FILES)`);

  // §3
  for (const b of altBetik!) {
    const ust = b.split("/")[0]!;
    if (!b.includes("/")) k("§3", `alt betik "${b}" bir dizin altında değil`);
    else if (!dizinler!.includes(ust)) k("§3", `"${b}" imzalı kapsamda DEĞİL — "${ust}" INTEGRITY_SCOPE_DIRS'te yok`);
  }
  if (!dizinler!.includes("runtime")) k("§3", "runtime\\ (Rust hizmet ikilileri + node.exe) imzalı kapsamda DEĞİL");
  for (const z of D6_ZORUNLU) if (!altBetik!.includes(z)) k("§3", `D6'nın zorunlu betiği pakette yok: ${z}`);
  for (const ikili of ["tekserp-hizmet.exe", "tekserp-guncelleyici.exe"]) if (!ikililer!.includes(ikili)) k("§3", `hizmet ikilisi listede yok: ${ikili}`);

  // §4
  const altDizinler = new Set(altBetik!.map((b) => b.split("/")[0]!));
  const bilinen = new Set([...BILINEN_GIRDILER, "$KOK_BETIKLERI", "$ALT_BETIKLER"]);
  const hedefler = stageHedefleri(paketle);
  if (hedefler.length < 8) olculemedi.push(`§4 paketle.ps1'de $stage kopyası ${hedefler.length} (taban 8) — tarayıcı kör olabilir`);
  for (const h of hedefler) {
    if (!h.girdi) k("§4", `satır ${h.satir}: $stage kopyasının hedefi çözülemedi (listeleri atlayan kopya?) — ${h.ham.slice(0, 120)}`);
    else if (!bilinen.has(h.girdi)) k("§4", `satır ${h.satir}: $stage'e listelerin DIŞINDA kopya "${h.girdi}" — $KOK_BETIKLERI/$ALT_BETIKLER'e ekle ya da imzalı kapsamını beyanla`);
  }
  const girdiler = new Set([...BILINEN_GIRDILER, ...kokBetik!, ...altDizinler]);
  for (const g of girdiler) {
    const calisir = CALISTIRILABILIR.test(g) || CALISTIRILABILIR_DIZIN.has(g);
    if (!calisir) continue;
    const kapsamda = dosyalar!.includes(g) || dizinler!.includes(g);
    if (!kapsamda && !IMZASIZ_ISTISNA[g]) k("§4", `çalıştırılabilir girdi "${g}" imzalı kapsamda DEĞİL ve beyanlı istisna değil`);
  }

  // §5
  const t = psTara(paketle);
  const fonk = t.fonksiyonlar.find((f) => f.ad === "HizmetIkilisiOlc");
  if (!fonk) k("§5", "HizmetIkilisiOlc işlevi yok — ikililer ölçülmeden pakete girer");
  else {
    const govde = paketle.split("\n").slice(fonk.bas - 1, fonk.son).join("\n");
    const iddialar: [string, RegExp][] = [
      ["ikili yoksa DUR", /if \(-not \(Test-Path -LiteralPath \$yol\)\) \{\s*\n?\s*Fail /],
      ["MZ imzası", /0x4D[\s\S]*0x5A/],
      ["x64 makine (0x8664)", /-ne 0x8664\) \{ Fail /],
      ["TEST çapası (test-anchor) RED", /Contains\("TEKSERP_TEST_CAPASI"\)\) \{\s*\n\s*Fail /],
      ["künye adı ölçülür", /& \$yol kunye/],
      ["künye testCapasi RED", /testCapasi -ne \$false\)\) \{\s*\n\s*Fail /],
      ["güncelleyici çapa kipi = paket kipi (G3)", /\$beklenenAd -eq "tekserp-guncelleyici" -and \$j\.capaKipi -cne \$capaKipi\) \{\s*\n\s*Fail /],
    ];
    for (const [ad, desen] of iddialar) if (!desen.test(govde)) k("§5", `HizmetIkilisiOlc: ${ad} ölçümü yok`);
  }
  if (!/HizmetIkilisiOlc \(Join-Path \$ikiliDizin \$ikiliAd\) \$HIZMET_IKILILERI\[\$ikiliAd\]/.test(paketle)) k("§5", "ikililer HizmetIkilisiOlc'tan geçmeden kopyalanıyor");
  if (!/HizmetIkilisiOlc \(Join-Path \$ikiliDizin \$ikiliAd\) \$HIZMET_IKILILERI\[\$ikiliAd\] \$paketCapaKipi/.test(paketle) || !/\$paketCapaKipi = \(Get-Content -Raw \(Join-Path \(Join-Path \$proj "dist"\) "server-kunye\.json"\) \| ConvertFrom-Json\)\.guvenCapasi/.test(paketle)) {
    k("§5", "HizmetIkilisiOlc paketin çapa kipini (dist/server-kunye.json guvenCapasi) almıyor (G3)");
  }
  if (!/if \(\$Korumali -and \$Hedef -eq "win-x64"\) \{/.test(paketle)) k("§5", "korumalı win-x64 paketi hizmet ikilisi koşulsuz taşımıyor");

  // §6
  if (!/^\s*backendHizmetAdi\s*=\s*\$backendHizmet\s*$/m.test(paketle)) k("§6", "PAKET.json backendHizmetAdi yazılmıyor");
  if (!/\$satir -cmatch '\^TEKSERP_HIZMET_ADI=\(\.\+\)\$'\) \{ \$backendHizmet = \$Matches\[1\] \}/.test(paketle)) k("§6", "backendHizmetAdi dağıtım kapısının TEKSERP_HIZMET_ADI çıktısından okunmuyor");
  if (!/^\s*hizmetIkilileri\s*=\s*\$hizmetIkilileri\s*$/m.test(paketle)) k("§6", "PAKET.json hizmetIkilileri yazılmıyor");
  // Lisans satıcısı dağıtım kaydından + derlemenin varsayılanı (geçiş kurulumun etkin LICENSE_SERVER_URL'sini bunlarla ölçer).
  if (!/^\s*backendLisansSunucusu\s*=\s*\$backendLisans\s*$/m.test(paketle) || !/^\s*lisansSunucusuVarsayilan\s*=\s*\$lisansVarsayilan\s*$/m.test(paketle)) k("§6", "PAKET.json lisans satıcısı (backendLisansSunucusu/lisansSunucusuVarsayilan) yazılmıyor");
  if (!/\$satir -cmatch '\^TEKSERP_LISANS_SUNUCUSU=\(\.\+\)\$'\) \{ \$backendLisans = \$Matches\[1\] \}/.test(paketle) || !/\$satir -cmatch '\^TEKSERP_LISANS_VARSAYILAN=\(\.\+\)\$'\) \{ \$lisansVarsayilan = \$Matches\[1\] \}/.test(paketle) ||
    !/if \(-not \$backendUrun -or -not \$backendHizmet -or -not \$backendLisans -or -not \$lisansVarsayilan\) \{ Fail /.test(paketle)) k("§6", "lisans satıcısı dağıtım kapısının TEKSERP_LISANS_* çıktısından okunmuyor ya da yoksa paketleme durmuyor");
  if (!/TEKSERP_HIZMET_ADI:\s*b\.hizmetAdi/.test(d[DAGITIM_LIB]!)) k("§6", "dagitim-kapisi backend-paketle TEKSERP_HIZMET_ADI vermiyor (scripts/lib/dagitim.mjs)");

  // §7
  const ci = d[KORUMALI_CI]!;
  if (!/cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet/.test(ci)) k("§7", "korumali-paket.yml hizmet ikililerini derlemiyor");
  if (!/if: matrix\.hedef == 'win-x64'/.test(ci)) k("§7", "ikili derlemesi win-x64 koluna bağlı değil");
  if (!/testCapasi/.test(ci)) k("§7", "CI güncelleyicinin künyesinde testCapasi=false ölçmüyor");
  if (!/koruma-cikti\/runtime\/tekserp-guncelleyici\.exe/.test(ci) || !/koruma-cikti\/runtime\/tekserp-hizmet\.exe/.test(ci)) k("§7", "iki ikili yapıtın runtime\\ dizinine konmuyor");
  if (/--features[^\n]*test-anchor/.test(ci)) k("§7", "korumalı paket iş akışı test-anchor özelliğiyle derliyor");
  if (!/\.guvenCapasi/.test(ci) || !/if \(\$kip -cne "uretim"\) \{ Write-Error [^\n]*; exit 1 \}/.test(ci) || !/\$k\.capaKipi -cne \$kip\)/.test(ci)) {
    k("§7", "CI bayt kodunun çapa kipini (tek kip uretim) denetleyip güncelleyici künyesinde capaKipi ölçmüyor (G3)");
  }
  if (/hazirlik-capasi/.test(ci)) k("§7", "korumalı paket iş akışında emekli `hazirlik-capasi` özelliği var (çapa tek kip)");
  return { kirmizi, olculemedi };
}

const hukum = (o: Olcum): "yesil" | "kirmizi" | "olculemedi" => (o.olculemedi.length ? "olculemedi" : o.kirmizi.length ? "kirmizi" : "yesil");

/** §8 — gerçek imza kapsamı işlevi sahte paket ağacında. */
async function gercekKapsam(): Promise<void> {
  const kok = mkdtempSync(join(tmpdir(), "tekserp-paket-kapsami-"));
  try {
    const dosya = (rel: string): void => {
      const tam = join(kok, ...rel.split("/"));
      mkdirSync(path.dirname(tam), { recursive: true });
      writeFileSync(tam, `// ${rel}\n`);
    };
    const ornek = [
      "dist/server.js", "runtime/node.exe", "runtime/tekserp-hizmet.exe", "runtime/tekserp-guncelleyici.exe",
      "hizmet/backend-hizmeti.ps1", "hizmet/guncelleyici-hizmeti.ps1", "gecis/gecis.ps1", "gecis/gecis-yardimci.cjs",
      "kur.ps1", "yedekle.ps1", "bakim-rolu.ps1", "package.json", "PAKET.json", "ecosystem.config.js",
    ];
    for (const r of ornek) dosya(r);
    const scope = await packageScope(kok);
    const liste = await listScopedFiles(kok, scope);
    const gerekli = ["runtime/tekserp-hizmet.exe", "runtime/tekserp-guncelleyici.exe", "hizmet/backend-hizmeti.ps1", "hizmet/guncelleyici-hizmeti.ps1", "gecis/gecis.ps1", "gecis/gecis-yardimci.cjs", "kur.ps1", "yedekle.ps1", "bakim-rolu.ps1"];
    const eksik = gerekli.filter((g) => !liste.includes(g));
    check("§8 imza aracının kapsamı hizmet\\ · gecis\\ · runtime\\*.exe · kök betiklerini LİSTEYE alır", eksik.length === 0, eksik.join(", "));
    check("§8 kapsam dizinleri imzalı yüke yazılır (hizmet + gecis pakette olunca)", scope.dizinler.includes("hizmet") && scope.dizinler.includes("gecis"));
    check("§8 ecosystem.config.js imzalı listede YOK (beyanlı istisna, §2d)", !liste.includes("ecosystem.config.js"));
    check("§8 canlı sabitler ile metin okuması aynı küme (bekçi sabitin kendisini ölçüyor)",
      JSON.stringify(tsListe(readFileSync(join(KOK, KAPSAM), "utf8"), "INTEGRITY_SCOPE_DIRS")) === JSON.stringify([...INTEGRITY_SCOPE_DIRS]) &&
      JSON.stringify(tsListe(readFileSync(join(KOK, KAPSAM), "utf8"), "INTEGRITY_SCOPE_FILES")) === JSON.stringify([...INTEGRITY_SCOPE_FILES]));
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
}

function sondalar(taban: Dosyalar): void {
  const metin = (rel: string, eski: string | RegExp, yeni: string) => (d: Dosyalar): void => {
    d[rel] = d[rel]!.replace(eski, yeni);
  };
  const S: [string, "yesil" | "kirmizi" | "olculemedi", (d: Dosyalar) => void, string?][] = [
    ["P0 gerçek ağaç YEŞİL", "yesil", () => {}],
    ["P1 hizmet\\ altına yeni betik (dizin imzalı) YEŞİL", "yesil", metin(PAKETLE, '"gecis/gecis-yardimci.cjs")', '"gecis/gecis-yardimci.cjs", "hizmet/yeni.ps1")')],
    ["N1 kapsamdan 'hizmet' çıktı → KIRMIZI (§3)", "kirmizi", metin(KAPSAM, '"prisma/migrations", "hizmet", "gecis"', '"prisma/migrations", "gecis"'), "§3"],
    ["N2 kapsamdan 'gecis' çıktı → KIRMIZI (§3)", "kirmizi", metin(KAPSAM, '"prisma/migrations", "hizmet", "gecis"', '"prisma/migrations", "hizmet"'), "§3"],
    ["N3 kapsamdan 'runtime' çıktı → KIRMIZI (§3)", "kirmizi", metin(KAPSAM, '"native", "runtime", "node_modules"', '"native", "node_modules"'), "§3"],
    ["N4 listeyi atlayan $stage kopyası → KIRMIZI (§4)", "kirmizi", metin(PAKETLE, 'Copy-Item $prodCfg "$stage\\prisma.config.js"', 'Copy-Item $prodCfg "$stage\\prisma.config.js"\nCopy-Item "$repo\\deploy\\ek.ps1" "$stage\\"'), "§4"],
    ["N5 kök betiği imzasız (listeye eklendi, kapsama değil) → KIRMIZI (§2)", "kirmizi", metin(PAKETLE, '"bakim-rolu.ps1")', '"bakim-rolu.ps1", "gizli.ps1")'), "§2"],
    ["N6 alt betik imzasız dizinde → KIRMIZI (§3)", "kirmizi", metin(PAKETLE, '"gecis/gecis-yardimci.cjs")', '"gecis/gecis-yardimci.cjs", "araclar/x.ps1")'), "§3"],
    ["N7 D6 zorunlu betiği listeden çıktı → KIRMIZI (§3)", "kirmizi", metin(PAKETLE, '"hizmet/guncelleyici-hizmeti.ps1", ', ""), "§3"],
    ["N8 TEST çapası kapısı silindi → KIRMIZI (§5)", "kirmizi", metin(PAKETLE, 'Contains("TEKSERP_TEST_CAPASI")', 'Contains("YOK_BOYLE_BIR_SEY")'), "§5"],
    ["N9 ikili yoksa DUR kapısı gevşedi → KIRMIZI (§5)", "kirmizi", metin(PAKETLE, /if \(-not \(Test-Path -LiteralPath \$yol\)\) \{\s*\n(\s*)Fail /, "if (-not (Test-Path -LiteralPath $yol)) {\n$1Write-Host "), "§5"],
    ["N10 x64 ölçümü silindi → KIRMIZI (§5)", "kirmizi", metin(PAKETLE, "-ne 0x8664) { Fail ", "-ne 0x8664) { Write-Host "), "§5"],
    ["N11b PAKET.json backendLisansSunucusu silindi → KIRMIZI (§6)", "kirmizi", metin(PAKETLE, /^\s*backendLisansSunucusu\s*=\s*\$backendLisans\s*$/m, ""), "§6"],
    ["N11c dağıtım kapısı lisans satıcısını vermeyince paketleme sürüyor → KIRMIZI (§6)", "kirmizi", metin(PAKETLE, "if (-not $backendUrun -or -not $backendHizmet -or -not $backendLisans -or -not $lisansVarsayilan) { Fail ", "if ($false) { Fail "), "§6"],
    ["N11 PAKET.json backendHizmetAdi silindi → KIRMIZI (§6)", "kirmizi", metin(PAKETLE, /^\s*backendHizmetAdi\s*=\s*\$backendHizmet\s*$/m, ""), "§6"],
    ["N12 CI ikili derlemesi kalktı → KIRMIZI (§7)", "kirmizi", metin(KORUMALI_CI, "cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet", "echo atlandi"), "§7"],
    ["N13 CI test-anchor ile derliyor → KIRMIZI (§7)", "kirmizi", metin(KORUMALI_CI, "cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet", "cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet --features tekserp-guncelleyici/test-anchor"), "§7"],
    ["N14 güncelleyici çapa kipi denetimi gevşedi → KIRMIZI (§5, G3)", "kirmizi", metin(PAKETLE, /(\$j\.capaKipi -cne \$capaKipi\) \{\s*\n\s*)Fail /, "$1Write-Host "), "§5"],
    ["N15 ikililere paketin çapa kipi verilmiyor → KIRMIZI (§5, G3)", "kirmizi", metin(PAKETLE, "$HIZMET_IKILILERI[$ikiliAd] $paketCapaKipi", "$HIZMET_IKILILERI[$ikiliAd]"), "§5"],
    ["N16 CI güncelleyicinin capaKipi ölçümü kalktı → KIRMIZI (§7, G3)", "kirmizi", metin(KORUMALI_CI, "$k.capaKipi -cne $kip)", "$false)"), "§7"],
    ["N17 CI tek kip kapısı gevşedi (hazırlık kipi de kabul) → KIRMIZI (§7)", "kirmizi", metin(KORUMALI_CI, 'if ($kip -cne "uretim") {', 'if ($kip -cne "uretim" -and $kip -cne "hazirlik") {'), "§7"],
    ["N18 CI emekli hazirlik-capasi özelliğiyle derliyor → KIRMIZI (§7)", "kirmizi", metin(KORUMALI_CI, "cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet", "cargo build --release --locked -p tekserp-guncelleyici -p tekserp-hizmet --features tekserp-guncelleyici/hazirlik-capasi"), "§7"],
    ["O1 paketle.ps1 okunamadı → ÖLÇÜLEMEDİ", "olculemedi", (d) => { d[PAKETLE] = undefined; }],
    ["O2 $ALT_BETIKLER listesi kayboldu → ÖLÇÜLEMEDİ (§1)", "olculemedi", metin(PAKETLE, "$ALT_BETIKLER = @(", "$ALT_BETIKLER_ESKI = @("), "§1"],
  ];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    mutasyon(d);
    const uygulandi = ad.startsWith("P0") || DOSYALAR.some((r) => d[r] !== taban[r]);
    const o = olc(d);
    const h = hukum(o);
    const izOk = !iz || [...o.kirmizi, ...o.olculemedi].some((x) => x.includes(iz));
    check(`sonda: ${ad}`, uygulandi && h === beklenen && izOk,
      !uygulandi ? "MUTASYON UYGULANMADI" : h !== beklenen ? `hüküm ${h}: ${[...o.olculemedi, ...o.kirmizi][0] ?? "-"}` : izOk ? "" : `hüküm beklenen bölümden (${iz}) gelmedi`);
  }
}

async function main(): Promise<void> {
  console.log("test_paket_kapsami — backend paketinin imzalı kapsamı (Dağıtım v2)\n");
  const d: Dosyalar = {};
  for (const rel of DOSYALAR) d[rel] = oku(rel);
  const o = olc(d);
  for (const x of o.olculemedi) check(`ÖLÇÜLEMEDİ — ${x}`, false);
  for (const x of o.kirmizi) check(x, false);
  if (hukum(o) === "yesil") check("§1–§7 paket içeriği imzalı kapsamda, ikililer ölçülerek giriyor, CI test çapasız ve paketin çapa kipiyle derliyor", true);
  await gercekKapsam();
  sondalar(d);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(`⛔ BEKLENMEYEN: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
