// =============================================================================
// DOKUMA REJİM KAPISI BEKÇİSİ — `dokuma.enabled` kapısı ZİNCİRİ ve KAPSAMI ölçüyor mu,
// ve bayrak KAPALIYKEN panelde "sıfır görünür fark" hâlâ doğru mu?
// =============================================================================
// Dokuma işi (`WeavingOrder`) · tezgah koşumu (`MachineRun`) · top indirme
// (`DoffEvent`) TEK kapının arkasındadır: `requireDokumaEnabled`. Bağımlılık iki
// halkadır — dokuma → production — ve tezgah izlemenin KARDEŞİDİR (çocuğu değil):
// fasona dokutan firmada dokuma işi var tezgah yok (DOKUMA-IS-EMRI §2.5).
//
// ⚠️ BU BEKÇİNİN ÜÇ SORUSU:
//   §2–§5  kapı ön koşulu ÖNCE okuyor, 403 EKSİK OLANI söylüyor, varsayılan KAPALI.
//   §6     kapıyı taşıması gereken üç router taşıyor — `verifyToken`DAN SONRA ve o
//          router'ın TÜM uçlarından ÖNCE (`test_production_regime_gate` §2 kalıbı);
//          kapıyı taşıyan her dosya listede ANILIYOR (§1e kalıbı — listenin dışında
//          kalan taşıyıcı görünmez); dokuma modeline dokunan her router kapılı.
//   §7  ⭐ "BAYRAK KAPALIYKEN HİÇBİR ŞEY DEĞİŞMEZ" — ekran dilimi inerken ÖLÇÜLDÜ
//          (2026-09-13): Electron + mobil kaynağında dokuma uçlarını çağıran dosya
//          sayısı 0'dı. Bugün TEK istemci dosyası var (dokuma ekranının service'i)
//          ve o ekran dokuma karosunun arkasındadır. Bu bölüm o cümleyi kilitler:
//          uçları çağıran her istemci dosyası allowlist'te, allowlist'teki ekranın
//          karosu `dokumaEnabled`e bağlı, route'u `weavingorder:read` istiyor,
//          manifestosu `dokumaEnabled` beyan ediyor. Ölçtüğü KADAR iddia: karo ve
//          palet gizli (menüden ulaşılmaz); route yalnız İZNE bakar, elle yazılan
//          URL boş kabuk + backend 403 görür (`ProtectedRoute` bayrak okumaz —
//          panel route kapısı ayrı dilim). "İstek atılmaz" demez: ölçmüyor.
//
// Salt-okunur: DB'ye dokunmaz (§5 satır-yok diyen sahte istemciyle ölçülür),
// HTTP atmaz. Koşum: npx tsx scripts/run-all-tests.ts dokuma_regime
//
// NEGATİF SONDALAR (2026-09-13, ekran dilimiyle koşuldu; dosyalar md5 ile geri alındı):
//   ① `requireDokumaEnabled` gövdesinden `readProductionEnabled` dalı silindi
//      → §2a + §2b + §3a kırmızı (3 ❌).
//   ② `weaving-order.routes.ts`te kapı satırı dosyanın SONUNA taşındı
//      → §6c kırmızı (1 ❌) — §6a/§6b yeşil kaldı, yani sıra kontrolü olmasa sızıntı
//        sessiz geçerdi.
//   ③ Electron'da başka bir dosyaya `"/api/weaving-orders"` çağrısı yazıldı
//      → §7b kırmızı (1 ❌).
//   ④ `isWeavingOrdersVisible` `return true;` yapıldı → §7d kırmızı (1 ❌).
//   ⑤ `MODULE_DEPENDENCIES.dokumaEnabled` silindi → §4a kırmızı (1 ❌).
//   ⑥ (2026-09-14) `src/routes/reports/` altına `prisma.weavingOrder` okuyan KAPISIZ
//      router kondu → §6g kırmızı (1 ❌) — özyineli tarama olmasa görünmezdi.
// GEREKLİ Mİ (reçete md. 20): kapı doğduğu gün ağaçta gerçek kusur bulmadı — ölçtüğü
// sınıf (kapı sızıntısı · listesiz taşıyıcı · kapısız istemci) bugün yok; gerekçesi
// üç kardeş bekçinin (production/iplik/devere) ölçülmüş tarihidir.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODULE_DEPENDENCIES,
  MODULE_FLAG_KEYS,
  MODULE_LABELS,
  MODULE_SETTING_KEYS,
} from "../src/constants/module-flags";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import { readDokumaEnabled } from "../src/services/system-setting.service";
import type prisma from "../src/lib/prisma";
import { routerKapiOlcumu, yorumlariSok } from "./lib/regime-gate-scan";

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

const KOK = path.resolve(__dirname, "../..");
const SRC = path.resolve(__dirname, "../src");
const MIDDLEWARE = path.join(SRC, "middlewares/module.middleware.ts");
const KAPI = "requireDokumaEnabled";
const ELECTRON_SRC = path.join(KOK, "Electron/src");
const MOBIL_SRC = path.join(KOK, "mobil/src");

/** Dokuma kapısını TAŞIMASI GEREKEN router'lar (mount adresiyle). */
const KAPILI: ReadonlyArray<{ dosya: string; mount: string }> = [
  { dosya: "routes/weaving-order.routes.ts", mount: "/api/weaving-orders" },
  { dosya: "routes/machine-run.routes.ts", mount: "/api/machine-runs" },
  { dosya: "routes/machine-doff.routes.ts", mount: "/api/machine-doffs" },
  { dosya: "routes/subcontractor-weaving.routes.ts", mount: "/api/subcontractor-weaving" }, // G2 fason dokuma
  // Faz 1b (6e, 2026-09-14): elle duruş girişi — koşumla aynı kapı (`requireDokumaEnabled`).
  { dosya: "routes/machine-stop.routes.ts", mount: "/api/machine-stops" },
  // Dokuma raporları Dilim 2 (01, 2026-09-14): vardiya karnesi okuma (M1) — aynı kapı.
  { dosya: "routes/machine-shift-stat.routes.ts", mount: "/api/machine-shift-stats" },
  // Dilim 4 (01, 2026-09-14): üç rapor ucu — `reports.routes` kökünden mount, kapı kendi dosyasında.
  { dosya: "routes/reports/dokuma.report.routes.ts", mount: "/api/reports/dokuma" },
  // B3 (01, 2026-09-14): künye + gölge mod — tasarımın `requireTezgahEnabled`i ekransız doğamaz (§10b), dokuma kapısında.
  { dosya: "routes/machine-spec.routes.ts", mount: "/api/machine-specs" },
];

/** Dokuma-ÖZEL Prisma model erişimcileri ve servisleri — bunlara dokunan router kapılıdır. */
const DOKUMA_MODELLERI = ["weavingOrder", "machineRun", "doffEvent", "machineStopEvent", "machineShiftStat", "machineSpec"];
const DOKUMA_SERVISLERI = ["weaving-order.service", "machine-run.service", "machine-doff.service", "machine-stop.service", "machine-shift-stat.service", "machine-shift-seal.service", "machine-spec.service"];

/** Dokuma uçlarının mount adresleri — istemci kaynağında aranan metinler. */
const DOKUMA_UC_METINLERI = ["/api/weaving-orders", "/api/machine-runs", "/api/machine-doffs", "/api/machine-stops", "/api/machine-shift-stats", "/api/reports/dokuma", "/api/machine-specs"];

/**
 * §7 — dokuma uçlarını çağırmasına İZİN VERİLEN istemci dosyaları (repo köküne göre).
 * Her satır bir EKRANIN service'idir ve o ekranın karosu dokuma bayrağına bağlı olmak
 * zorundadır (§7c–§7f). Tablet tezgah ekranı doğduğu gün buraya satır eklenir ve
 * aynı gün o ekranın `useVisibleScreens` kapısı ölçülür.
 */
/**
 * `karo`: karonun yaşadığı hub — `operations` (`pages/Operations/tile-config.ts`, saf `visibleWhen`
 * yüklemi) ya da `reports` (`pages/Reports/tile-config.ts`, `featureFlag: "dokumaEnabled"` —
 * Raporlar hub'ının bayrak biçimi; palet girişi `regimePredicate(featureFlag)` ile türer).
 * İki biçim de aynı soruyu sorar: karo YALNIZ `dokumaEnabled` ile çizilir.
 */
const IZINLI_ISTEMCI_DOSYALARI: ReadonlyArray<{ dosya: string; ekranKey: string; izinler: readonly string[]; karo: "operations" | "reports" }> = [
  { dosya: "Electron/src/pages/Operations/WeavingOrders/service.ts", ekranKey: "operations/weaving-orders", izinler: ["weavingorder:read"], karo: "operations" },
  // Tezgah Duruşları (2026-09-14): iki izinden BİRİ açar — route `requireAnyPermission`, manifesto `requires` ikisini de anar.
  { dosya: "Electron/src/pages/Operations/MachineStops/service.ts", ekranKey: "operations/machine-stops", izinler: ["loom:manual-entry", "loom:classify"], karo: "operations" },
  // Dokuma raporları (Dilim 5, 2026-09-14): Raporlar hub'ı karosu; okuma `report:production` (1e hükmü ③).
  { dosya: "Electron/src/pages/Reports/Dokuma/service.ts", ekranKey: "reports/dokuma", izinler: ["report:production"], karo: "reports" },
];

function kapiGovdesi(kod: string): string {
  const bas = kod.indexOf(`export async function ${KAPI}`);
  if (bas < 0) return "";
  const sonrasi = kod.slice(bas + 10);
  const son = sonrasi.indexOf("export async function");
  return son < 0 ? kod.slice(bas) : kod.slice(bas, bas + 10 + son);
}

/** Dizini özyineli tarar; `.ts`/`.tsx` dosyalarını (test/mocks hariç) döner. */
function kaynakDosyalari(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const yuru = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const tam = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__mocks__") continue;
        yuru(tam);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(tam);
      }
    }
  };
  yuru(dir);
  return out;
}

async function main(): Promise<void> {
  console.log("=== DOKUMA REJİM KAPISI BEKÇİSİ (dokuma.enabled) ===\n");

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: middleware dosyası okunabildi", fs.existsSync(MIDDLEWARE), MIDDLEWARE);
  const kod = yorumlariSok(fs.readFileSync(MIDDLEWARE, "utf8"));
  const govde = kapiGovdesi(kod);
  check("§1b Körlük zemini: kapı gövdesi ayrıştırıldı", govde.length > 200, `${govde.length} karakter`);

  // ── §2 ⭐ ÖN KOŞUL ÖNCE ─────────────────────────────────────────────────
  const iProduction = govde.indexOf("readProductionEnabled");
  const iDokuma = govde.indexOf("readDokumaEnabled");
  check(
    "§2a ⭐ Kapı İKİ halkayı da okuyor (production · dokuma)",
    iProduction >= 0 && iDokuma >= 0,
    `production=${iProduction} dokuma=${iDokuma}`,
  );
  check(
    "§2b ⭐ Sıra ön koşuldan içe (production → dokuma)",
    iProduction >= 0 && iDokuma > iProduction,
    "ters sıra operatörü yanlış anahtara gönderir: eksik olan ÜRETİM iken 'dokuma kapalı' denirdi",
  );

  // ── §3 ⭐ MESAJ EKSİK OLANI SÖYLÜYOR ──────────────────────────────────────
  check(
    '§3a ⭐ Üretim dalı `modul:"production"` + `dependent:"dokuma"` döndürüyor',
    /modul:\s*"production"[\s\S]{0,60}dependent:\s*"dokuma"/.test(govde),
  );
  check(
    '§3b Kendi dalı ortak `modulKapali("dokuma", …)` kullanıyor (403 + MODULE_DISABLED)',
    /modulKapali\(\s*"dokuma"/.test(govde),
  );
  check(
    "§3c Kapı `requirePermission`ın YERİNE geçmiyor (gövdede izin kontrolü yok)",
    !/requirePermission|hasPermission/.test(govde),
    "bayrak ve izin iki AYRI sorudur",
  );

  // ── §4 ⭐ BAĞIMLILIK TABLOSU ve DÖRT TABLO HİZASI ─────────────────────────
  check(
    "§4a ⭐ `MODULE_DEPENDENCIES.dokumaEnabled === productionEnabled`",
    MODULE_DEPENDENCIES["dokumaEnabled"] === "productionEnabled",
    `bugün: ${MODULE_DEPENDENCIES["dokumaEnabled"] ?? "YOK"}`,
  );
  check(
    "§4b ⭐ Tezgahın KARDEŞİ: tezgah dokumaya bağlı DEĞİL, dokuma tezgaha bağlı DEĞİL",
    MODULE_DEPENDENCIES["tezgahEnabled"] !== "dokumaEnabled" &&
      MODULE_DEPENDENCIES["dokumaEnabled"] !== "tezgahEnabled",
    "fasona dokutan firmada dokuma var tezgah yok — biri diğerinin ön koşulu olamaz",
  );
  check("§4c Anahtar tablolarda var (alan)", MODULE_FLAG_KEYS.has("dokumaEnabled"));
  check("§4d Anahtar tablolarda var (DB)", MODULE_SETTING_KEYS.has("dokuma.enabled"));
  check("§4e Türkçe adı yazılı", (MODULE_LABELS["dokumaEnabled"] ?? "").length > 3, MODULE_LABELS["dokumaEnabled"] ?? "YOK");

  // ── §5 ⭐ VARSAYILAN KAPALI (satır yokken) ────────────────────────────────
  const bosIstemci = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  check(
    "§5 ⭐ Satır yokken dokuma KAPALI (dünkü davranış: fabrika dokumuyor)",
    (await readDokumaEnabled(bosIstemci)) === false,
    "üretim modülünün 'satır yoksa TRUE' sigortası buraya KOPYALANMAZ",
  );

  // ── §6 ⭐ KAPI VAR · KİMLİKTEN SONRA · TÜM UÇLARDAN ÖNCE · KAPSAM TAM ─────
  for (const k of KAPILI) {
    const o = routerKapiOlcumu(path.join(SRC, k.dosya), KAPI);
    check(
      `§6a ⭐ ${k.mount} → kapı router seviyesinde ve verifyToken'dan SONRA`,
      o.kapiVar,
      o.kapiVar ? `router=${o.routerAdi}` : `\`router.use(verifyToken, ${KAPI})\` satırı YOK`,
    );
    check(`§6b ${k.mount} → körlük zemini: uçlar sayıldı`, o.ucSayisi >= 1, `uç=${o.ucSayisi}`);
    check(
      `§6c ⭐ ${k.mount} → HER uç kapıdan SONRA tanımlı (Express kayıt sırası)`,
      o.hepsiKapidanSonra,
      o.hepsiKapidanSonra ? "" : "kapıdan ÖNCE tanımlı uç kapıyı HİÇ görmez — hata da log da üretmez",
    );
  }
  // ⚠️ ÖZYİNELİ: `src/routes/reports/` altında 8 router var; düz `readdirSync`
  // onları görmüyordu (1e ölçtü 2026-09-14) — oraya konan kapısız bir dokuma
  // router'ı §6g'yi vakumen yeşil bırakırdı. Sonda: reports/ altına
  // `prisma.weavingOrder` okuyan kapısız router → §6g ❌ (1).
  const tumRouteDosyalari = routeDosyalariOzyineli(path.join(SRC, "routes")).map((f) =>
    path.relative(SRC, f).split(path.sep).join("/"),
  );
  const kapiTasiyan = tumRouteDosyalari.filter((rel) =>
    yorumlariSok(fs.readFileSync(path.join(SRC, rel), "utf8")).includes(KAPI),
  );
  const anilan = new Set(KAPILI.map((x) => x.dosya));
  const listesiz = kapiTasiyan.filter((rel) => !anilan.has(rel));
  check(
    "§6d Körlük zemini: route dizini tarandı, kapı taşıyan dosya bulundu",
    tumRouteDosyalari.length >= 50 && kapiTasiyan.length >= 1,
    `${tumRouteDosyalari.length} route · ${kapiTasiyan.length} kapı taşıyor`,
  );
  check(
    `§6e ⭐ \`${KAPI}\` taşıyan her dosya KAPILI listesinde ANILIR`,
    listesiz.length === 0,
    listesiz.length ? `listesiz: ${listesiz.join(", ")}` : `${kapiTasiyan.length}/${kapiTasiyan.length}`,
  );
  const dokunanlar: string[] = [];
  const kapisizlar: string[] = [];
  for (const rel of tumRouteDosyalari) {
    const metin = yorumlariSok(fs.readFileSync(path.join(SRC, rel), "utf8"));
    const dokunuyor =
      DOKUMA_MODELLERI.some((m) => new RegExp(`\\b(prisma|tx)\\.${m}\\b`).test(metin)) ||
      DOKUMA_SERVISLERI.some((s) => metin.includes(s));
    if (!dokunuyor) continue;
    dokunanlar.push(rel);
    if (!metin.includes(KAPI)) kapisizlar.push(rel);
  }
  check(
    "§6f Körlük zemini: dokuma yüzeyi BULUNDU (yoksa §6g vakumen yeşil kalırdı)",
    dokunanlar.length >= 3,
    dokunanlar.join(", "),
  );
  check(
    "§6g ⭐ Dokuma modeline/servisine dokunan HER router kapıyı taşıyor",
    kapisizlar.length === 0,
    kapisizlar.length ? `KAPISIZ: ${kapisizlar.join(", ")}` : `${dokunanlar.length} router kapılı`,
  );
  check("§6h Kapı ölü değil: middleware dışa aktarılmış", new RegExp(`export async function ${KAPI}`).test(kod));

  // ── §7 ⭐ BAYRAK KAPALIYKEN SIFIR GÖRÜNÜR FARK ────────────────────────────
  const istemciDosyalari = [...kaynakDosyalari(ELECTRON_SRC), ...kaynakDosyalari(MOBIL_SRC)];
  check(
    "§7a Körlük zemini: istemci kaynağı tarandı (Electron + mobil)",
    istemciDosyalari.length >= 200,
    `${istemciDosyalari.length} dosya`,
  );
  const cagiranlar = istemciDosyalari
    .filter((f) => {
      const metin = yorumlariSok(fs.readFileSync(f, "utf8"));
      return DOKUMA_UC_METINLERI.some((u) => metin.includes(`"${u}`) || metin.includes(`\`${u}`));
    })
    .map((f) => path.relative(KOK, f).split(path.sep).join("/"));
  const izinli = new Set(IZINLI_ISTEMCI_DOSYALARI.map((x) => x.dosya));
  const izinsiz = cagiranlar.filter((f) => !izinli.has(f));
  const oluIzin = [...izinli].filter((f) => !cagiranlar.includes(f));
  check(
    "§7b ⭐ Dokuma uçlarını çağıran her istemci dosyası allowlist'te (çağıran dosya = dokuma karosunun arkasındaki service)",
    izinsiz.length === 0,
    izinsiz.length ? `izinsiz: ${izinsiz.join(", ")}` : `${cagiranlar.length} dosya çağırıyor`,
  );
  check(
    "§7b2 Allowlist bayat değil (her satır GERÇEKTEN çağırıyor — ölü muaf kırmızı)",
    oluIzin.length === 0,
    oluIzin.join(", "),
  );

  // Allowlist'teki ekranın ÜÇ kapısı: manifesto · karo · route.
  const tileConfigs = {
    operations: yorumlariSok(fs.readFileSync(path.join(ELECTRON_SRC, "pages/Operations/tile-config.ts"), "utf8")),
    reports: yorumlariSok(fs.readFileSync(path.join(ELECTRON_SRC, "pages/Reports/tile-config.ts"), "utf8")),
  };
  const contentRoutes = fs.readFileSync(path.join(ELECTRON_SRC, "routes/content-routes.tsx"), "utf8");
  for (const { ekranKey, izinler, karo } of IZINLI_ISTEMCI_DOSYALARI) {
    const tileConfig = tileConfigs[karo];
    const manifesto = SCREEN_CATALOG.find((s) => s.key === ekranKey);
    check(
      `§7c ⭐ ${ekranKey} manifestoda \`dokumaEnabled\` beyanlı ve [${izinler.join(", ")}] istiyor`,
      manifesto?.modul === "dokumaEnabled" && izinler.every((p) => (manifesto?.requires ?? []).includes(p)),
      manifesto ? `modul=${manifesto.modul} requires=${manifesto.requires.join(",")}` : "manifestoda YOK",
    );
    // Karo bloğu: `to: "/<ekranKey>"` geçen `{ … }` içinde — operations: `visibleWhen: <saf yüklem>`;
    // reports: `featureFlag: "dokumaEnabled"` (hub'ın bayrak biçimi; karo `ctx[featureFlag]` ile süzülür).
    const toIdx = tileConfig.indexOf(`to: "/${ekranKey}"`);
    const blok = toIdx >= 0 ? tileConfig.slice(tileConfig.lastIndexOf("{", toIdx), tileConfig.indexOf("}", toIdx)) : "";
    if (karo === "operations") {
      const yuklem = /visibleWhen:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?/.exec(blok)?.[1] ?? null;
      check(
        `§7d ⭐ ${ekranKey} karosu SAF yüklem taşıyor ve yüklem \`dokumaEnabled\`i okuyor`,
        yuklem !== null && yuklemDokumayaBagli(tileConfig, yuklem),
        yuklem ? `visibleWhen=${yuklem}` : "karo yok ya da yüklem satır içi/eksik",
      );
    } else {
      const bayrak = /featureFlag:\s*"([A-Za-z]+)"/.exec(blok)?.[1] ?? null;
      check(
        `§7d ⭐ ${ekranKey} karosu (Raporlar hub'ı) \`featureFlag: "dokumaEnabled"\` taşıyor`,
        bayrak === "dokumaEnabled" && izinler.every((p) => blok.includes(`"${p}"`)),
        bayrak ? `featureFlag=${bayrak}` : "karo yok ya da featureFlag eksik — referans fabrikada karo BELİRİR",
      );
    }
    const routeBlok = new RegExp(`path:\\s*"${ekranKey.replace("/", "\\/")}"([\\s\\S]{0,400})`).exec(contentRoutes)?.[1] ?? "";
    // Tek izin `requirePermission="x"`, çok izin `requireAnyPermission={["x", "y"]}` — ikisinde de her izin ADIYLA geçer.
    check(
      `§7e ⭐ ${ekranKey} route'u [${izinler.join(", ")}] ile sarılı (ProtectedRoute)`,
      /require(Any)?Permission/.test(routeBlok) && izinler.every((p) => routeBlok.includes(`"${p}"`)),
      routeBlok ? "" : "content-routes.tsx'te route YOK",
    );
  }

  // ── §8 ⭐ KAPALI MODÜLÜN YAZMA YOLU YOKTUR — tarihsel bağ dahil (E1, 2026-09-14) ──
  // `POST /rolls/initial-entry` `doffEventId` taşıyorsa dokuma bayrağı OKUNUR ve kapalıyken
  // 403 MODULE_DISABLED (modul "dokuma"); KK1 rotası `requireDokumaEnabled` taşımaz (bayrak
  // kapalı fabrikada KK1 bugünküyle birebir), kapı bu yüzden gövdededir.
  const ctrl = fs.readFileSync(path.resolve(__dirname, "../src/controllers/inventory.controller.ts"), "utf8");
  const e1Ok = (t: string): boolean => {
    const i = t.indexOf("async createInitialEntry(");
    const govde = i < 0 ? "" : t.slice(i, i + 3000);
    const kapi = /if \(doffEventId && !\(await readDokumaEnabled\(\)\)\)[\s\S]{0,400}?code: "MODULE_DISABLED",\s*modul: "dokuma"/.exec(govde);
    const cagri = govde.indexOf("createInitialEntry(", govde.indexOf("initialEntrySchema.parse"));
    return !!kapi && cagri > 0 && kapi.index < cagri;
  };
  check("§8a ⭐ initial-entry: `doffEventId` verildiyse dokuma bayrağı okunur, kapalı → 403 MODULE_DISABLED (modul dokuma), servis çağrısından ÖNCE", e1Ok(ctrl));
  check("§8b ⭐ sonda bellek içi: kapı düşürülünce §8a kırmızı", !e1Ok(ctrl.replace(/if \(doffEventId && !\(await readDokumaEnabled\(\)\)\)/, "if (false)")));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

/** `src/routes/**​/*.routes.ts` — alt dizinler dahil (reports/). */
function routeDosyalariOzyineli(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const tam = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeDosyalariOzyineli(tam));
    else if (e.name.endsWith(".routes.ts")) out.push(tam);
  }
  return out;
}

/** `visibleWhen: X` → X'in tanımlandığı dosyada `return <param>.dokumaEnabled;` var mı? */
function yuklemDokumayaBagli(tileConfigMetni: string, fnAdi: string): boolean {
  const imp = new RegExp(`import\\s*\\{[^}]*\\b${fnAdi}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(tileConfigMetni);
  if (!imp) return false;
  const hedef = path.join(ELECTRON_SRC, "pages/Operations", `${imp[1]!}.ts`);
  if (!fs.existsSync(hedef)) return false;
  const govde = yorumlariSok(fs.readFileSync(hedef, "utf8"));
  const fn = new RegExp(`export function ${fnAdi}\\s*\\(\\s*([A-Za-z0-9_]+)[^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(govde);
  if (!fn) return false;
  return new RegExp(`return\\s+${fn[1]!}\\.dokumaEnabled\\s*;`).test(fn[2]!);
}

main().catch((e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  process.exit(1);
});
