// =============================================================================
// Test: BAĞIMLILIK SÖZLEŞMESİ — pin · CommonJS invariantı · karar kaydı
// Çalıştır: npx tsx scripts/test_dependency_contract.ts
// =============================================================================
// NEDEN: `package.json`ı denetleyen tek bekçi bugüne kadar Electron tarafındaydı
// (`discovery-ipc-contract.test.ts`) ve yalnız `bonjour-service`e bakıyordu.
// Backend'in üç sessiz arıza sınıfı kapısız duruyordu: pin kayması, ESM-only
// paketin CommonJS gövdeye sızması, kaydı olmayan bağımlılık.
//
// Doğrulananlar (docs/standart/KUTUPHANELER.md):
//   (a) [KU-12] `bonjour-service` backend + Electron'da TAM SABİT ve aynı sürüm
//   (b) [KU-18] Backend'in her `dependencies` girdisi gerçek `require()` ile
//       çözülüyor; ESM-only paket kümesi BEYAN EDİLMİŞ listeyle birebir
//   (c) [KU-04/KU-08] Üç projenin `dependencies`i ile KUTUPHANELER-TABLO.md §2
//       tablosu arasındaki fark boş (devralınan kayıtsızlar donmuş listede)
//
// KAPSAM `dependencies`tir; `devDependencies` MUAF. Gerekçe: §2 tabloları araç
// zincirini düzyazıyla anıyor (`cva`, "Araç (dev)" hücresi, `@types/*`), yani
// devDep karşılaştırması kuralı değil yazım biçimini ölçerdi. Üründe
// `MODULE_NOT_FOUND` üreten sınıf zaten `dependencies`tir ([KU-15]).
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..", "..");
const PROJE = { backend: "Teks-Erp", electron: "Electron", mobil: "mobil" } as const;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type PaketJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
function paketJson(dizin: string): PaketJson {
  return JSON.parse(readFileSync(join(REPO, dizin, "package.json"), "utf8")) as PaketJson;
}

// KÖRLÜK ZEMİNİ: dosya adı/biçimi değişince ayrıştırıcı sessizce boş küme
// döndürür ve bekçi "fark yok" diye yeşil geçer — ölçtüğü şeyin değil kapsamın
// boşluğunu ölçmüş olur. Zeminler bugünkü sayının belirgin altında.
const EN_AZ_DEPS = { backend: 15, electron: 35, mobil: 30 };
const EN_AZ_TABLO_TOKEN = 15;

// =============================================================================
// (a) PIN KAYDI — [KU-12]
// =============================================================================
// Sabit sürümün gerekçesi kodda yazılı: bonjour-service'in constructor'ı bind
// hatasını `throw`la atıyor (Teks-Erp/src/jobs/mdns-advertiser.job.ts:12-17,
// Electron/electron/discovery/mdns-browser.ts:8). İki uç aynı protokolü
// konuşuyor → sürüm de birlikte yürür.
const PIN_KAYDI = [
  { paket: "bonjour-service", projeler: ["Teks-Erp", "Electron"] as const },
];
const TAM_SABIT = /^\d+\.\d+\.\d+$/;

function bolumA(): void {
  console.log("\n── (a) Sabit sürüm pinleri [KU-12] ──");
  for (const { paket, projeler } of PIN_KAYDI) {
    const surumler: string[] = [];
    for (const dizin of projeler) {
      const spec = paketJson(dizin).dependencies?.[paket];
      check(
        `${dizin}: ${paket} dependencies'te ve TAM SABİT`,
        typeof spec === "string" && TAM_SABIT.test(spec),
        spec ?? "girdi yok",
      );
      if (spec) surumler.push(spec);
    }
    check(
      `${paket} iki projede AYNI sürüm`,
      surumler.length === projeler.length && new Set(surumler).size === 1,
      surumler.join(" ↔ "),
    );
  }
}

// =============================================================================
// (b) BACKEND CommonJS INVARIANTI — [KU-18], [KU-19]
// =============================================================================
// `require.resolve` YETMEZ: ESM-only paket çözülür ama CommonJS gövdede
// yüklenemez. Ölçüm gerçek `require()` ile ve AYRI süreçte yapılır (bir paketin
// yan etkisi bekçiyi düşürmesin).
const REQUIRE_MUAF: Record<string, string> = {
  // CLI paketi: giriş noktası yayınlamıyor, `require("prisma")` MODULE_NOT_FOUND
  // verir. `dependencies`te durmak ZORUNDA — kur.ps1 `migrate deploy` koşuyor
  // ve `npm ci --omit=dev` devDep'i elerdi ([KU-15]).
  prisma: "CLI paketi, giriş noktası yayınlamıyor",
};

// ESM-only girdiler ADIYLA beyan edilir; listede olmayan yeni bir ESM-only
// paket sessizce giremesin ([KU-18]). uuid@13 bugün yalnız Node ≥ 22.12'nin
// require(esm) desteğiyle koşuyor — engines tabanı açık karar ([KU-19]).
const ESM_ONLY_BEYAN = new Set(["uuid"]);

function esmOnlyMu(dizin: string, paket: string): boolean {
  const yol = join(REPO, dizin, "node_modules", paket, "package.json");
  if (!existsSync(yol)) return false;
  const d = JSON.parse(readFileSync(yol, "utf8")) as {
    type?: string; main?: string; exports?: unknown;
  };
  if (d.type !== "module") return false;
  if (d.main) return false;
  return !JSON.stringify(d.exports ?? null).includes('"require"');
}

function bolumB(): void {
  console.log("\n── (b) Backend CommonJS invariantı [KU-18] ──");
  const deps = Object.keys(paketJson("Teks-Erp").dependencies ?? {});
  check("körlük zemini: backend dependencies dolu", deps.length >= EN_AZ_DEPS.backend, `${deps.length} paket`);

  const kod = `
    const adlar = ${JSON.stringify(deps)};
    const sonuc = {};
    for (const ad of adlar) {
      try { require(ad); sonuc[ad] = null; }
      catch (e) { sonuc[ad] = (e && e.code) || String(e).slice(0, 120); }
    }
    process.stdout.write(JSON.stringify(sonuc));
  `;
  const res = spawnSync(process.execPath, ["-e", kod], {
    cwd: join(REPO, "Teks-Erp"), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  check("require sondası koştu", res.status === 0 && !!res.stdout, res.stderr?.slice(0, 200) ?? "");
  if (res.status !== 0 || !res.stdout) return;

  const sonuc = JSON.parse(res.stdout) as Record<string, string | null>;
  check("körlük zemini: her dependency denendi", Object.keys(sonuc).length === deps.length,
    `${Object.keys(sonuc).length}/${deps.length}`);

  const beklenmeyen = deps.filter((d) => sonuc[d] !== null && !(d in REQUIRE_MUAF));
  check("her dependency gerçek require() ile çözülüyor (muaflar hariç)", beklenmeyen.length === 0,
    beklenmeyen.map((d) => `${d}: ${sonuc[d]}`).join(" · "));

  // Muafiyet BAYATLAMASIN: paket çözülür hâle gelirse muafiyet kalkmalı.
  for (const [ad, neden] of Object.entries(REQUIRE_MUAF)) {
    check(`muaf '${ad}' hâlâ dependencies'te`, deps.includes(ad), neden);
    check(`muaf '${ad}' hâlâ çözülemiyor (muafiyet bayat değil)`, sonuc[ad] !== null,
      sonuc[ad] === null ? "artık require edilebiliyor → muafiyeti kaldır" : String(sonuc[ad]));
  }

  const olculen = new Set(deps.filter((d) => esmOnlyMu("Teks-Erp", d)));
  const yeni = [...olculen].filter((d) => !ESM_ONLY_BEYAN.has(d));
  const bayat = [...ESM_ONLY_BEYAN].filter((d) => !olculen.has(d));
  check("beyan edilmemiş ESM-only paket YOK", yeni.length === 0, yeni.join(", "));
  check("ESM-only beyanı bayat değil", bayat.length === 0, bayat.join(", "));
}

// =============================================================================
// (c) KARAR KAYDI FARKI — [KU-04], [KU-08]
// =============================================================================
// Tabloda kısaltılarak yazılan girdiler (`@tanstack/react-query` + `-virtual`
// gibi) gerçek paket adına burada çevrilir.
const KISALTMA: Record<string, string> = {
  "-virtual": "@tanstack/react-virtual",
  "-persist-client": "@tanstack/react-query-persist-client",
  "query-async-storage-persister": "@tanstack/query-async-storage-persister",
  "native-stack": "@react-navigation/native-stack",
  cva: "class-variance-authority",
};
// Paket sütununda geçen ama paket OLMAYAN düzyazı jetonları.
const DUZYAZI = new Set(["fetch"]);

/**
 * REPO İÇİ DOSYA YOLU mu? Tabloda backtick'li her jeton paket adı sayılır; ama
 * §2 satırları bazen "paket YOK, kendi kodumuz şurada" der ve o yolu backtick
 * içinde yazar (`src/lib/logger.ts`, 2026-09-07). Ölçüt DAR tutuldu — yalnız
 * `/` İÇEREN ve kod uzantısıyla biten jeton: `opentype.js` gerçek bir pakettir
 * ve `/` taşımadığı için buraya düşmez, `@prisma/client` ise `/` taşır ama kod
 * uzantısıyla bitmez.
 */
const dosyaYolu = (ad: string): boolean => ad.includes("/") && /\.(ts|js|mjs|cjs)$/.test(ad);

// DEVRALINAN KAYITSIZLAR — [KU-04] baseline'ı: bu paketler §2.3'te hiç
// anılmıyor. Liste YALNIZ KÜÇÜLÜR; yeni bir kayıtsız bağımlılık kırmızıdır.
const KAYIT_BEKLEYEN: Record<string, string[]> = {
  mobil: [
    "expo-asset", "expo-build-properties", "expo-constants",
    "expo-screen-orientation", "expo-status-bar",
    "react-native-gesture-handler", "react-native-safe-area-context",
    "react-native-screens",
  ],
};

type Tablo = { tum: Set<string>; iddia: Set<string> };
function tabloOku(): Record<string, Tablo> {
  // §2 tablosu 2026-09-13'te KUTUPHANELER-TABLO.md'ye bölündü (envanter ayrıldı, kural kaldı).
  // Bölüm numarası §2 olarak KORUNDU — aşağıdaki regex'e dokunulmadı.
  const md = readFileSync(join(REPO, "docs", "standart", "KUTUPHANELER-TABLO.md"), "utf8");
  const bolumler = new Map<string, string>();
  // Girdi-sonu şartı: SON alt bölüm (§2.3) kendisinden sonra başlık olmadığı için
  // eskiden BOŞ dönüyordu — körlük zemini kontrolü bunu yakaladı (2026-09-13).
  const re = /^### (2\.\d) [^\n]*\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm;
  for (let m = re.exec(md); m; m = re.exec(md)) bolumler.set(m[1], m[2]);

  const esle: Record<string, string> = { "2.1": "backend", "2.2": "electron", "2.3": "mobil" };
  const out: Record<string, Tablo> = {};
  for (const [no, proje] of Object.entries(esle)) {
    const govde = bolumler.get(no) ?? "";
    const tum = new Set<string>();
    const iddia = new Set<string>();
    for (const satir of govde.split("\n")) {
      if (!satir.startsWith("|")) continue;
      const cols = satir.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cols.length < 2 || cols[0].startsWith("---") || cols[0] === "İhtiyaç") continue;
      for (const t of satir.match(/`[^`]+`/g) ?? []) tum.add(KISALTMA[t.slice(1, -1)] ?? t.slice(1, -1));
      // "İddia" = tablonun "bu paket KURULU" dediği küme: **YOK** hücreleri ve
      // parantez içi açıklamalar (kullanım sayısı, reddedilen alternatif, sembol
      // adı) bu kümeye girmez.
      if (cols[1].includes("YOK")) continue;
      const sade = cols[1].replace(/\([^)]*\)/g, "");
      for (const t of sade.match(/`[^`]+`/g) ?? []) {
        const ad = KISALTMA[t.slice(1, -1)] ?? t.slice(1, -1);
        if (!DUZYAZI.has(ad) && !dosyaYolu(ad)) iddia.add(ad);
      }
    }
    out[proje] = { tum, iddia };
  }
  return out;
}

function bolumC(): void {
  console.log("\n── (c) KUTUPHANELER-TABLO.md §2 ↔ dependencies farkı [KU-04] ──");
  const tablolar = tabloOku();
  check("körlük zemini: üç alt bölüm de bulundu", Object.keys(tablolar).length === 3);

  for (const [proje, dizin] of Object.entries(PROJE)) {
    const t = tablolar[proje];
    const deps = Object.keys(paketJson(dizin).dependencies ?? {});
    const dev = Object.keys(paketJson(dizin).devDependencies ?? {});
    check(`körlük zemini: ${proje} tablo jetonu dolu`, (t?.tum.size ?? 0) >= EN_AZ_TABLO_TOKEN, `${t?.tum.size ?? 0} jeton`);
    check(`körlük zemini: ${proje} dependencies dolu`, deps.length >= EN_AZ_DEPS[proje as keyof typeof EN_AZ_DEPS], `${deps.length} paket`);

    const kapsanir = (d: string): boolean =>
      t.tum.has(d) || [...t.tum].some((w) => w.endsWith("/*") && d.startsWith(w.slice(0, -1)));
    const donmus = KAYIT_BEKLEYEN[proje] ?? [];
    const eksik = deps.filter((d) => !kapsanir(d) && !donmus.includes(d));
    check(`${proje}: kaydı olmayan YENİ bağımlılık yok`, eksik.length === 0, eksik.join(", "));

    // Donmuş liste bayatlamasın: kaydı yazılan ya da kaldırılan paket listeden düşer.
    const cozulmus = donmus.filter((d) => !deps.includes(d) || kapsanir(d));
    check(`${proje}: donmuş kayıtsız listesi bayat değil`, cozulmus.length === 0,
      cozulmus.length ? `artık kayıtlı/kaldırılmış, listeden çıkar: ${cozulmus.join(", ")}` : `${donmus.length} devralınan`);

    const bayat = [...t.iddia].filter((x) => !x.endsWith("/*") && !deps.includes(x) && !dev.includes(x));
    check(`${proje}: tabloda olup package.json'da olmayan yok`, bayat.length === 0, bayat.join(", "));
  }
}

function main(): void {
  bolumA();
  bolumB();
  bolumC();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exit(1);
}

main();
