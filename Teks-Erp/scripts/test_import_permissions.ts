// =============================================================================
// BEKÇİ — İÇE AKTARIM İZNİ, VARLIĞIN GERÇEK CRUD İZNİYLE AYNI OLMALI
// =============================================================================
// SORUN (2026-08-19'da ölçüldü, iki adaptörde vardı): adaptörün beyan ettiği
// `writePermission`, o varlığa normal yoldan yazmak için gereken izinle
// ayrışabiliyordu:
//
//   color.adapter → "quality:write"   ama  POST /api/colors → "property:write"
//   productRecipe → "item:write"      ama  POST /api/product-recipes → "station:write"
//
// İki sonucu vardı, ikincisi ciddi:
//   1) Panelde "eksik kaydı buradan yarat" düğmesini adaptörün iznine göre
//      göstermek, tam da onu gören kullanıcıya 403 verirdi.
//   2) Daha önemlisi: İÇE AKTARIM UCU YANLIŞ İZİNLE YAZMA AÇIYORDU.
//      `data:import` + `quality:write` taşıyan biri panelden tek renk
//      açamazken TOPLU renk yükleyebiliyordu.
//
// ⚠️ ROTA DOSYASI TAHMİN EDİLMEZ, ADAPTÖRÜN KENDİ IMPORT'UNDAN ÇÖZÜLÜR.
// Adaptörlerin çoğu servisini `../../../routes/<x>.routes`ten alıyor; o dosya
// zaten "bu varlığın API'si" demektir. Elle bir eşleme tablosu tutmak, tam da
// bu bekçinin engellemeye çalıştığı sınıfta ikinci bir sapma kaynağı olurdu.
// Servisini bir `.service` dosyasından alan adaptörler için (BaseService
// kullanmayanlar) gerekçeli bir eşleme var ve o eşleme BAYATLIĞA KARŞI da
// denetleniyor.
//
// Koşum: npx tsx scripts/test_import_permissions.ts
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { listAdapters } from "../src/services/import/import-registry";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
const ADAPTER_DIR = path.join(KOK, "src/services/import/adapters");
const ROUTES_DIR = path.join(KOK, "src/routes");

/**
 * Servisini `.service` dosyasından alan adaptörler — hangi rota dosyasının
 * "bu varlığın API'si" olduğu import'tan çıkarılamaz. Gerekçeli ve bayatlığa
 * karşı denetlenir: adaptör artık import'undan çözülebiliyorsa bu satır ÖLÜ
 * MUAFtır ve test düşer.
 */
const ROUTE_FILE_FOR_SERVICE_ADAPTERS: Record<string, string> = {
  // `CustomerBranchService` BaseService kullanmıyor; şubeler müşterinin alt
  // kaynağıdır ve yazma izni müşterininkiyle aynıdır.
  customerBranch: "customer-branch.routes.ts",
  // `CustomerAliasService` upsert semantikli, kendi router'ı var.
  customerItemAlias: "customer-alias.routes.ts",
  customerColorAlias: "customer-alias.routes.ts",
  // Fason firma + kategori TEK router'da (subcontractorRouter / categoryRouter).
  subcontractor: "subcontractor-management.routes.ts",
  subcontractorCategory: "subcontractor-management.routes.ts",
};

/** Adaptör dosyasından servis kaynağını çöz: routes/<x>.routes veya <x>.service. */
function routeFileOf(entity: string, adapterSrc: string): { file: string | null; from: "import" | "map" | "none" } {
  const m = /from "\.\.\/\.\.\/\.\.\/routes\/([a-z-]+)\.routes"/.exec(adapterSrc);
  if (m?.[1]) return { file: `${m[1]}.routes.ts`, from: "import" };
  const mapped = ROUTE_FILE_FOR_SERVICE_ADAPTERS[entity];
  if (mapped) return { file: mapped, from: "map" };
  return { file: null, from: "none" };
}

/**
 * Bir rota dosyasında, verilen HTTP metodunun KÖK yolundaki (`"/"`) izinleri.
 * `requireAnyPermission(a, b, ...)` çoklu döner; `...SPREAD` sabitleri atlanır
 * (onlar mobil ekran izinleri — ana veri yazma izni değil).
 */
function anyWritePermissionsOf(routeSrc: string): string[] {
  // Alt kaynak router'ları (şube, alias) kök POST taşımaz: yazma yolları
  // `/:customerId/branches` gibi iç içe. Orada "kök yol" diye bir şey yok;
  // dosyadaki TÜM yazma guard'larını topluyoruz. Ölçülemeyen şeyi "uyumlu"
  // saymak, bu bekçinin varlık sebebine aykırı olurdu.
  const out = new Set<string>();
  const lines = routeSrc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/\.(post|put|patch)\(/.test(lines[i] ?? "")) continue;
    const window = lines.slice(i, i + 6).join(" ");
    const any = /requireAnyPermission\(([^)]*)\)/.exec(window);
    if (any?.[1]) for (const m of any[1].matchAll(/"([^"]+)"/g)) out.add(m[1] as string);
    const one = /requirePermission\("([^"]+)"\)/.exec(window);
    if (one?.[1]) out.add(one[1]);
  }
  return [...out];
}

function rootPermissionsOf(routeSrc: string, method: "post" | "get"): string[] {
  const lines = routeSrc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // `router.post("/"` / `xRouter.post("/"` — kök yol, alt yollar değil.
    if (!new RegExp(`\\.${method}\\(\\s*"/"`).test(line)) continue;
    // Guard aynı satırda ya da hemen sonrasında olabilir (çok satırlı çağrı).
    const window = lines.slice(i, i + 6).join(" ");
    const any = /requireAnyPermission\(([^)]*)\)/.exec(window);
    if (any?.[1]) {
      return [...any[1].matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
    }
    const one = /requirePermission\("([^"]+)"\)/.exec(window);
    if (one?.[1]) return [one[1]];
  }
  return [];
}

function main(): void {
  console.log("=== İçe aktarım izni ↔ varlığın gerçek CRUD izni ===\n");

  const adapters = listAdapters();
  // Körlük zemini: registry boşalırsa aşağıdaki kontroller VAKUMEN yeşil kalırdı.
  check("körlük zemini: registry dolu", adapters.length >= 10, `${adapters.length} adaptör`);

  const catalog = new Set<string>(PERMISSION_CATALOG.map((p) => p.code as string));
  const usedMapKeys = new Set<string>();

  let writeOk = true;
  let readOk = true;
  let resolvedCount = 0;

  for (const a of adapters) {
    const adapterFile = fs
      .readdirSync(ADAPTER_DIR)
      .map((f) => path.join(ADAPTER_DIR, f))
      // ⚠️ Satır başında TAM İKİ boşluk: `entity: "station"` iç içe
      // `lookup: { entity: "station" }` içinde de geçiyor ve naif bir
      // `includes` yanlış dosyayı seçiyordu (ölçüldü: station → fabric-property).
      .find((f) => new RegExp(`^  entity: "${a.entity}",$`, "m").test(fs.readFileSync(f, "utf8")));
    if (!adapterFile) {
      writeOk = false;
      console.log(`   ↳ ${a.entity}: adaptör dosyası bulunamadı (tarayıcı boşa düştü)`);
      continue;
    }
    const adapterSrc = fs.readFileSync(adapterFile, "utf8");
    const { file, from } = routeFileOf(a.entity, adapterSrc);
    if (from === "map") usedMapKeys.add(a.entity);
    if (!file) {
      writeOk = false;
      console.log(
        `   ↳ ${a.entity}: rota dosyası çözülemedi — servisini routes/'tan almıyor ve eşleme tablosunda da yok`,
      );
      continue;
    }
    const routePath = path.join(ROUTES_DIR, file);
    if (!fs.existsSync(routePath)) {
      writeOk = false;
      console.log(`   ↳ ${a.entity}: ${file} YOK — eşleme bayat`);
      continue;
    }
    const routeSrc = fs.readFileSync(routePath, "utf8");

    const rootWrite = rootPermissionsOf(routeSrc, "post");
    const writePerms = rootWrite.length > 0 ? rootWrite : anyWritePermissionsOf(routeSrc);
    const readPerms = rootPermissionsOf(routeSrc, "get");
    if (writePerms.length === 0) {
      // Hiç yazma guard'ı yok — bu bir bulgu, sessiz geçilmez.
      writeOk = false;
      console.log(`   ↳ ${a.entity}: ${file} hiç yazma guard'ı taşımıyor`);
    } else {
      resolvedCount++;
      if (!writePerms.includes(a.writePermission)) {
        writeOk = false;
        console.log(
          `   ↳ ${a.entity}: writePermission="${a.writePermission}" ama ${file} POST "/" → ${writePerms.join(" | ")}`,
        );
      }
    }
    if (readPerms.length > 0 && !readPerms.includes(a.readPermission)) {
      readOk = false;
      console.log(
        `   ↳ ${a.entity}: readPermission="${a.readPermission}" ama ${file} GET "/" → ${readPerms.join(" | ")}`,
      );
    }
  }

  check("her adaptörün YAZMA izni, varlığın POST rotasındaki izinle aynı", writeOk);
  check("her adaptörün OKUMA izni, varlığın GET rotasındaki izinle uyumlu", readOk);
  check(
    "körlük zemini: en az 8 adaptörde karşılaştırma GERÇEKTEN koştu",
    resolvedCount >= 8,
    `koşan=${resolvedCount}`,
  );

  // Eşleme tablosu iki yönlü denetlenir: ölü muaf, gerçek bir sapmayı sessizce
  // kapsam dışında tutar (izin kataloğu bekçisinin aynı dersi).
  const stale = Object.keys(ROUTE_FILE_FOR_SERVICE_ADAPTERS).filter((k) => !usedMapKeys.has(k));
  check(
    "eşleme tablosunda ölü satır yok",
    stale.length === 0,
    stale.length > 0 ? `artık gerekmeyen: ${stale.join(", ")}` : undefined,
  );

  // Katalog kontrolü burada da tekrarlanır: yanlış izin, tanımsız izinden daha
  // sinsidir (ikincisi 403 verir, birincisi YANLIŞ KİŞİYE kapı açar).
  let inCatalog = true;
  for (const a of adapters) {
    if (!catalog.has(a.writePermission) || !catalog.has(a.readPermission)) {
      inCatalog = false;
      console.log(`   ↳ ${a.entity}: izinlerden biri katalogda yok`);
    }
  }
  check("tüm adaptör izinleri katalogda tanımlı", inCatalog);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
