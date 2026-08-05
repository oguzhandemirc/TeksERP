// =============================================================================
// BEKÇİ — `settings:workstation` (Bu Bilgisayar / yerel donanım ayarları)
// =============================================================================
// NE KORUYOR: 2026-08-05'te "Bu Bilgisayar" sekmesi (etiket yazıcısı, kantar,
// barkod tabancası, sunucu adresi) `admin:settings`ten AYRILDI. Bu ayarların
// hiçbiri sunucuya yazılmaz — yalnız o makinenin yerel deposunda yaşar — bu
// yüzden yazıcısını kendi kuran depo/sevkiyat personeline sistem geneli özellik
// anahtarlarını, oturum politikasını ve log arşivini açmadan verilebilir.
//
// ÜÇ SESSİZ BOZULMA YOLU VAR, ÜÇÜ DE BURADA KİLİTLİ:
//   1. İZİN GENİŞLEMESİ — kod `admin:` alanına taşınır ya da bir yerde
//      `admin:settings` ile eş sayılırsa, "dar izin" sessizce yönetici yetkisi
//      olur. Kimse fark etmez, çünkü ekran zaten açılıyordur.
//   2. EKRAN YARIM AÇILIR — "Bu Bilgisayar → Yazıcı" sekmesi yerel yazıcıyı bir
//      CİHAZ KAYDINA bağlar (dil/şablon oradan çözülür). `GET /api/peripherals`
//      bu izni kabul etmezse liste 403 döner, seçim yapılamaz ve diyalogsuz
//      baskı kurulamaz — yani izin verilmiş ama iş yapılamaz.
//   3. İKİ PROJE AYRIŞIR — Electron backend'i import EDEMEZ (mobil
//      `permissions.ts` ile aynı durum), izin kodunu kendi sabitinde taşır. Tek
//      harflik fark = ekran hiç açılmaz ve hata mesajı sebebi söylemez.
//
// Salt-okunur: fixture/yazma yok, ortamdaki veriye bağımlı değil (DB'de satırın
// varlığını `test_permission_catalog.ts` zaten doğruluyor — katalog ⊆ DB).
// Koşum: npx tsx scripts/test_workstation_permission.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { matchesPermission } from "../src/middlewares/rbac.middleware";
import { peripheralRouter } from "../src/routes/peripheral.routes";

const KOD = "settings:workstation";

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

// ── 1) Katalog satırı ────────────────────────────────────────────────────────
console.log("\n=== 1) İzin kataloğu ===");
const satir = PERMISSION_CATALOG.find((p) => p.code === KOD);
check("Katalogda satır var", Boolean(satir), KOD);
check(
  "Kategori 'web' (yönetim yetkisi DEĞİL)",
  satir?.category === "web",
  // Electron `hasAdminAccess` yalnız admin:users/admin:settings/admin:* koduna
  // bakar; kategori UI gruplamasıdır. Yine de kararın kaydı burada dursun:
  // bu izin "Masaüstü Yetkileri" altında listelenir, "Yönetim" altında değil.
  `category=${satir?.category}`,
);
check("Açıklama dolu (yetki ekranında ne olduğu yazıyor)", Boolean(satir?.description?.trim()));

// ── 2) İzin GENİŞLEMİYOR ─────────────────────────────────────────────────────
console.log("\n=== 2) Yetki genişlemesi yok ===");
const yalnizIstasyon = [KOD];
check(
  "Bu izin 'admin:settings' yerine GEÇMEZ",
  !matchesPermission(yalnizIstasyon, "admin:settings"),
);
check("Bu izin 'admin:users' yerine GEÇMEZ", !matchesPermission(yalnizIstasyon, "admin:users"));
check(
  "Bu izin 'station:write' yerine GEÇMEZ (cihaz kaydını düzenleyemez)",
  !matchesPermission(yalnizIstasyon, "station:write"),
);
check(
  "Kod 'admin:' alanında DEĞİL → 'admin:*' wildcard'ı bunu VERMEZ",
  !KOD.startsWith("admin:") && !matchesPermission(["admin:*"], KOD),
);
check(
  "Kendi alan wildcard'ı beklendiği gibi çalışır ('settings:*')",
  matchesPermission(["settings:*"], KOD),
);

// ── 3) Gerçek route dizisi — GET /api/peripherals kabul, yazma uçları RED ────
console.log("\n=== 3) /api/peripherals route zinciri ===");
type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name: string; handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};
const layers = (peripheralRouter as unknown as { stack: RouteLayer[] }).stack;

/**
 * Route'un YETKİ middleware'lerini gerçek izin listesiyle koşturur.
 * Zincir konvansiyonu: [verifyToken, ...yetki middleware'leri, controller] —
 * ilk ve son halka atlanır. Konvansiyon bozulursa `null` döner ve test düşer
 * (sessizce "geçti" demek, bu bekçiyi süse çevirirdi).
 */
function yetkiVerirMi(method: "get" | "post", routePath: string, permissions: string[]): boolean | null {
  const layer = layers.find((l) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer?.route) return null;
  const zincir = layer.route.stack;
  if (zincir.length < 3 || zincir[0]!.name !== "verifyToken") return null;

  const req = { user: { permissions } } as unknown as Request;
  const res = {} as Response;
  for (const halka of zincir.slice(1, -1)) {
    let hata: unknown;
    let cagrildi = false;
    halka.handle(req, res, ((e?: unknown) => {
      cagrildi = true;
      hata = e;
    }) as NextFunction);
    if (!cagrildi || hata) return false;
  }
  return true;
}

const getIzin = yetkiVerirMi("get", "/", yalnizIstasyon);
check("GET /api/peripherals — zincir okunabildi (konvansiyon korunuyor)", getIzin !== null);
check("GET /api/peripherals — bu izinle GEÇER (yazıcı seçimi çalışır)", getIzin === true);

const postIzin = yetkiVerirMi("post", "/", yalnizIstasyon);
check("POST /api/peripherals — zincir okunabildi", postIzin !== null);
check("POST /api/peripherals — bu izinle REDDEDİLİR (station:write ister)", postIzin === false);

check(
  "GET /api/peripherals — mevcut 'station:read' yolu BOZULMADI",
  yetkiVerirMi("get", "/", ["station:read"]) === true,
);
check(
  "GET /api/peripherals — izinsiz kullanıcı hâlâ REDDEDİLİR",
  yetkiVerirMi("get", "/", ["order:read"]) === false,
);

// ── 4) Electron aynası — kod BİREBİR aynı mı ────────────────────────────────
console.log("\n=== 4) Electron sabiti (ayrı proje, import edemez) ===");
const ELECTRON_CONFIG = path.resolve(
  __dirname,
  "../../Electron/src/pages/GeneralSettings/settings-config.ts",
);
if (!fs.existsSync(ELECTRON_CONFIG)) {
  // Backend tek başına dağıtılabilir; dosya yoksa bu bölüm atlanır ama SESSİZ
  // değil — kapsam boşluğu ekranda görünür.
  console.log(`⚠️  Electron kaynağı bulunamadı, ayna kontrolü atlandı: ${ELECTRON_CONFIG}`);
} else {
  const kaynak = fs.readFileSync(ELECTRON_CONFIG, "utf8");
  const m = /WORKSTATION_PERMISSION\s*=\s*"([^"]+)"/.exec(kaynak);
  check("Electron'da WORKSTATION_PERMISSION sabiti var", Boolean(m));
  check("Electron sabiti backend koduyla BİREBİR aynı", m?.[1] === KOD, `electron=${m?.[1]}`);
  check(
    "'Bu Bilgisayar' kategorisi bu izinle de açılıyor (permissionAny)",
    /permissionAny:\s*\[SETTINGS_ADMIN_PERMISSION,\s*WORKSTATION_PERMISSION\]/.test(kaynak),
  );
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
