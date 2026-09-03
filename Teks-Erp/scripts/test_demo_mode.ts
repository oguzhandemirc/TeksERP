// =============================================================================
// BEKÇİ: DEMO MODU SÜRÜMDE KENDİLİĞİNDEN KAPALI MI? (2026-09-01)
// =============================================================================
// Demo yardımcıları "release'de elle kaldırılacak" bir borç OLMAMALI — bu depo
// "unutulabilir elle adım" sınıfını üç kez mekanikleştirdi. Güvence şu:
//   ① bayrak kayıt YOKKEN `false` (dokunulmamış fabrika kurulumu = demo DEĞİL)
//   ② `/api/demo/*` altındaki HER uç `requireDemoMode` kapısının ARKASINDA
//   ③ panel `defaultOn` ile backend okuyucusu BİREBİR
//   ④ senaryo listesi TEK KAYNAK (Electron ayna liste tutmuyor)
//
// ⚠️ ② KAYNAKTAN TARANIR, elle listelenmez: yeni bir demo ucu eklenip kapısız
// bırakılırsa bu bekçi kırmızı verir. Elle liste, tam da korkulan olayı
// (yeni uç) göremezdi.
//
// ⚠️ KÖRLÜK ZEMİNİ: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye
// bakmadım" AYNI yeşile çıkardı. Bulunan uç sayısının alt sınırı var.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import { readDemoModeEnabled } from "../src/services/system-setting.service";
import { DEMO_SCENARIOS, demoService } from "../src/services/demo.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROUTES = join(__dirname, "../src/routes/demo.routes.ts");
const PANEL = join(__dirname, "../../Electron/src/pages/GeneralSettings/settings-config.ts");
const HOOK = join(__dirname, "../../Electron/src/hooks/usePricingEnabled.ts");

async function main(): Promise<void> {
  console.log("=== Demo modu bekçisi ===\n");

  // ── §1 VARSAYILAN KAPALI ───────────────────────────────────────────────
  // Ayarı GEÇİCİ olarak silip okumak YANLIŞ olurdu (canlı veriye dokunmak);
  // bunun yerine BOŞ istemciyle okunur: kayıt bulunamaz → varsayılana düşer.
  const bosIstemci = {
    systemSetting: { findUnique: async () => null },
  } as unknown as Parameters<typeof readDemoModeEnabled>[0];
  const varsayilan = await readDemoModeEnabled(bosIstemci);
  check(
    "§1 ⭐ kayıt YOKken demo modu KAPALI (sürüme sızan yardımcı etkisizdir)",
    varsayilan === false,
    `okunan=${varsayilan}`,
  );

  // ── §2 HER UÇ KAPININ ARKASINDA ────────────────────────────────────────
  const src = readFileSync(ROUTES, "utf8");
  // Yorumlar ayıklanır — "kodu değil yorumu eşlemek" bu depoda iki kez ısırdı.
  // ⚠️ SIRA LOAD-BEARING: ÖNCE satır yorumu, SONRA blok yorumu. Ters sırada,
  // bir SATIR yorumunun içinde geçen `/api/demo/*` metni blok yorumu BAŞLATIR
  // ve bir sonraki `*/`'a (swagger JSDoc'unun sonu) kadar her şeyi yutar —
  // `router.use(...)` satırları dahil. Ölçüldü: bekçi ilk yazımda tam bu yüzden
  // "kapı yok" diyordu, oysa kapı yerindeydi. (Refakat kartındaki "CSS yorumları
  // ÖNCE silinir" dersinin birebir ikizi.)
  const kod = src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const uclar = [...kod.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)].map(
    (m) => `${m[1]!.toUpperCase()} ${m[2]}`,
  );
  check("§2 zemin: demo uçları tarandı", uclar.length >= 2, `${uclar.length} uç: ${uclar.join(" · ")}`);

  // Kapı ROUTER SEVİYESİNDE olmalı (`router.use`) — uç başına tekrar etmek
  // "yeni uç eklerken unutuldu" hatasına açık bir tasarımdır.
  const routerKapisi = /router\.use\(\s*requireDemoMode\s*\)/.test(kod);
  check(
    "§2a ⭐ `requireDemoMode` ROUTER seviyesinde (yeni uç otomatik korunur)",
    routerKapisi,
    routerKapisi ? "router.use(requireDemoMode)" : "uç başına kapı = unutulabilir adım",
  );
  const authKapisi = /router\.use\(\s*verifyToken\s*\)/.test(kod);
  check("§2b kimlik kapısı da router seviyesinde", authKapisi);

  // Kapının SIRASI: rejim ÖNCE, kimlik... aslında kimlik önce (401 vs 403).
  const idxAuth = kod.indexOf("router.use(verifyToken)");
  const idxDemo = kod.indexOf("router.use(requireDemoMode)");
  check(
    "§2c kimlik kapısı rejim kapısından ÖNCE (anonim istek 401 alır, 403 değil)",
    idxAuth >= 0 && idxDemo >= 0 && idxAuth < idxDemo,
  );

  // ── §3 MIDDLEWARE SÖZLEŞMESİ ───────────────────────────────────────────
  const mw = readFileSync(join(__dirname, "../src/middlewares/demo.middleware.ts"), "utf8");
  check(
    "§3 ⭐ kapı 403 döner (404 DEĞİL — kaynak var, kurulum demo değil)",
    mw.includes("forbidden("),
  );
  check(
    "§3a okuma CACHE'SİZ (acil kapatma anahtarı — etki bir sonraki istekte)",
    mw.includes("readDemoModeEnabled()") && !mw.includes("cache"),
  );

  // ── §4 PANEL ↔ BACKEND VARSAYILANI BİREBİR ─────────────────────────────
  const panel = readFileSync(PANEL, "utf8");
  const blok = panel.slice(panel.indexOf('key: "demoModeEnabled"'));
  const defaultOn = /defaultOn:\s*(true|false)/.exec(blok.slice(0, 900))?.[1];
  check(
    "§4 ⭐ panel `defaultOn` ile backend varsayılanı BİREBİR",
    defaultOn === String(varsayilan),
    `panel=${defaultOn} backend=${varsayilan}`,
  );
  check(
    "§4a panelde ayrı `demo` bölümünde (rejim anahtarlarının evi `modules`e karışmıyor)",
    /section:\s*"demo"/.test(panel),
  );

  // ── §5 UI KANCASI FAIL-CLOSED ──────────────────────────────────────────
  const hook = readFileSync(HOOK, "utf8");
  const kancaBlok = hook.slice(hook.indexOf("useDemoModeEnabled"));
  check(
    "§5 ⭐ `useDemoModeEnabled` fail-closed (`?? false`) — sunucuya ulaşılamazsa yardımcı ÇİZİLMEZ",
    /demoModeEnabled\s*\?\?\s*false/.test(kancaBlok.slice(0, 400)),
  );

  // ── §6 SENARYO KATALOĞU ────────────────────────────────────────────────
  check("§6 zemin: senaryo kataloğu dolu", DEMO_SCENARIOS.length >= 1, `${DEMO_SCENARIOS.length} senaryo`);
  const kodlar = DEMO_SCENARIOS.map((s) => s.code);
  check("§6a senaryo kodları benzersiz", new Set(kodlar).size === kodlar.length);
  const izinsiz = DEMO_SCENARIOS.filter((s) => s.permissions.length === 0);
  check(
    "§6b ⭐ her senaryo simüle ettiği İŞİN iznini beyan eder (bayrak yetki yükseltme yüzeyi olmasın)",
    izinsiz.length === 0,
    izinsiz.map((s) => s.code).join(", ") || "hepsi izinli",
  );
  const yetkisiz = demoService.listScenarios([]);
  check(
    "§6c izinsiz kullanıcıda hiçbir senaryo `allowed` değil",
    yetkisiz.every((s) => !s.allowed),
  );
  const tamYetki = demoService.listScenarios(["admin:*"]);
  check("§6d `admin:*` hepsini açar", tamYetki.every((s) => s.allowed));
  // §6e SATICI HESABI: `["*"]` de hepsini açmalı. `listScenarios` düz `includes`
  // kullandığı sürece süperadmin her senaryoyu `allowed:false` görürdü — kapı
  // route'ta doğru, EKRAN yanlış (2026-09-03 `*` körlüğü düzeltmesi).
  // ⚠️ `"*"` katalogda YOKTUR (bilinçli — hiçbir panelden atanamaz), yani
  // `PermissionCode` union'ına da girmez; cast burada o gerçeğin ifadesidir.
  const superadmin = demoService.listScenarios(["*"] as unknown as Parameters<
    typeof demoService.listScenarios
  >[0]);
  check("§6e ⭐ `[\"*\"]` (satıcı hesabı) hepsini açar", superadmin.every((s) => s.allowed));
  // §6f DEVİR: `test_permission_catalog` demo.service'i dinamik kaynak sayıp
  // BU dosyaya devrediyor (senaryo dizisindeki string'ler yalnız izin değil,
  // etiket/kod da taşıyor → orada AST ayıramıyor). Kapsam BURADA mekanik kurulur.
  const katalogKodlari = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const eksikIzin = [
    ...new Set(DEMO_SCENARIOS.flatMap((sc) => sc.permissions)),
  ].filter((c) => !katalogKodlari.has(c));
  check(
    "§6f ⭐ her senaryo izni permission-catalog'da TANIMLI (devir: test_permission_catalog)",
    eksikIzin.length === 0,
    eksikIzin.length ? `KATALOGDA YOK: ${eksikIzin.join(", ")}` : `${katalogKodlari.size} kod`,
  );

  // ── §8 UI BİLEŞENLERİ KAPISIZ OLAMAZ ───────────────────────────────────
  // `components/demo/` altındaki HER bileşen `useDemoModeEnabled()` çağırmalı.
  // Elle liste tutulsaydı, tam da korkulan olayı (yeni bileşen) göremezdi.
  const demoDir = join(__dirname, "../../Electron/src/components/demo");
  const bilesenler = readdirSync(demoDir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
  check("§8 zemin: demo bileşenleri tarandı", bilesenler.length >= 2, bilesenler.join(", "));
  const kapisiz = bilesenler.filter(
    (f) => !readFileSync(join(demoDir, f), "utf8").includes("useDemoModeEnabled()"),
  );
  check(
    "§8a ⭐ her demo bileşeni `useDemoModeEnabled()` kapısını taşıyor",
    kapisiz.length === 0,
    kapisiz.join(", ") || "hepsi kapılı",
  );

  // ── §7 AYAR ANAHTARI ───────────────────────────────────────────────────
  check(
    "§7 SETTING_KEYS satırı var",
    SETTING_KEYS.DEMO_MODE_ENABLED === "demo.modeEnabled",
    SETTING_KEYS.DEMO_MODE_ENABLED,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
