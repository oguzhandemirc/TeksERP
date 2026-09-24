// =============================================================================
// BEKÇİ — EKRAN BAŞINA AYAR İZİNLERİ (settings-scopes)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts settings_scopes   (DB gerekmez)
//
// Ölçtüğü üç iddia:
//   §1 TABLO — her dar izin katalogda; bir anahtar TEK ekrana ait; tablo
//      süperadmin / belge anahtarlarına uzanmaz; her anahtar gerçekten
//      `updateSchema`da (ölü anahtar dar izni sessizce boşa düşürürdü).
//   §2 KAPI — `PATCH /api/feature-flags` anahtar-kapsamlı: dar izin yalnız KENDİ
//      anahtarını açar, karma gövdede HER anahtar ayrı ölçülür (düz OR değil),
//      tabloda olmayan anahtar yalnız `admin:settings`, şemsiye her şeyi açar.
//   §3 HAM AYAR + SİSTEM EKRANLARI — `PUT /api/admin/settings/:key` aynı
//      tabloyu okur; sistem karolarının uçları kendi dar iznini kabul eder;
//      süperadmin ekranları sistem hesabı VARKEN yalnız ona açılır.
//
// NEGATİF SONDA (2026-09-24): `flagWriteScope` düz `[SETTINGS_ADMIN_PERMISSION]`
// dönecek şekilde bozulunca §2b/§2e/§2j KIRMIZI (3); `system:clients` `/clients`
// zincirinden çıkarılınca §3c KIRMIZI (1).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import {
  FLAG_KEY_SCOPE,
  SETTINGS_SCOPES,
  SETTING_KEY_SCOPE,
} from "../src/constants/settings-scopes";
import { SUPERADMIN_ONLY_FLAG_KEYS } from "../src/constants/module-flags";
import { DOCUMENT_DESIGN_FLAG_KEYS } from "../src/constants/document-design";
import featureFlagRouter, { updateSchema } from "../src/routes/feature-flag.routes";
import adminRouter from "../src/routes/admin.routes";
import dbCopyRouter from "../src/routes/db-copy.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name: string; handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

/**
 * Route zincirini (verifyToken ve controller hariç) senkron koşturur; izin
 * kapıları geçerse `true`. Ayar şifresi niyet kapısıdır, burada ölçülmez.
 * Zincir bulunamazsa `null` — test "geçti" demez.
 */
function passes(
  router: unknown,
  method: "get" | "post" | "put" | "patch" | "delete",
  routePath: string,
  permissions: string[],
  opts: { body?: unknown; params?: Record<string, string>; isSystemAccount?: boolean } = {},
): boolean | null {
  const layer = (router as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === routePath && l.route.methods[method],
  );
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = {
    user: { userId: "t", permissions },
    body: opts.body ?? {},
    params: opts.params ?? {},
    isSystemAccount: opts.isSystemAccount ?? false,
  } as unknown as Request;
  for (const link of chain.slice(1, -1)) {
    if (link.handle.name === "requireSettingsPassword") continue;
    let called = false;
    let err: unknown;
    link.handle(req, {} as Response, ((e?: unknown) => {
      called = true;
      err = e;
    }) as NextFunction);
    if (!called || err) return false;
  }
  return true;
}

const ADMIN = ["admin:settings"];
const catalog = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
const schemaKeys = new Set(Object.keys(updateSchema.shape));

// ── §1 TABLO ─────────────────────────────────────────────────────────────────
console.log("\n§1 — kapsam tablosu");
check("§1a körlük zemini: tablo dolu", SETTINGS_SCOPES.length >= 15 && FLAG_KEY_SCOPE.size >= 90, `${SETTINGS_SCOPES.length} ekran · ${FLAG_KEY_SCOPE.size} anahtar`);
const missingCodes = SETTINGS_SCOPES.map((s) => s.permission).filter((c) => !catalog.has(c));
check("§1b ⭐ her dar izin PERMISSION_CATALOG'da", missingCodes.length === 0, missingCodes.join(", "));
const allKeys = SETTINGS_SCOPES.flatMap((s) => s.flagKeys);
const dupKeys = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
check("§1c ⭐ bir anahtar TEK ekrana ait", dupKeys.length === 0, dupKeys.join(", "));
const forbidden = allKeys.filter((k) => SUPERADMIN_ONLY_FLAG_KEYS.has(k) || DOCUMENT_DESIGN_FLAG_KEYS.has(k));
check("§1d ⭐ tablo süperadmin / belge anahtarlarına uzanmıyor", forbidden.length === 0, forbidden.join(", "));
const dead = allKeys.filter((k) => !schemaKeys.has(k));
check("§1e ⭐ her anahtar updateSchema'da (ölü anahtar yok)", dead.length === 0, dead.join(", "));
const unscoped = [...schemaKeys].filter(
  (k) => !FLAG_KEY_SCOPE.has(k) && !SUPERADMIN_ONLY_FLAG_KEYS.has(k) && !DOCUMENT_DESIGN_FLAG_KEYS.has(k),
);
console.log(`   ℹ️  yalnız admin:settings ile yazılan (tabloda olmayan) anahtar: ${unscoped.length} — ${unscoped.join(", ")}`);

// ── §2 PATCH /api/feature-flags ─────────────────────────────────────────────
console.log("\n§2 — PATCH /api/feature-flags anahtar-kapsamlı");
const SHIPPING = ["settings:shipping"];
check("§2a zincir bulundu", passes(featureFlagRouter, "patch", "/", ADMIN, { body: { shipmentConfirmationEnabled: true } }) !== null);
check(
  "§2b ⭐ dar izin KENDİ anahtarını yazar",
  passes(featureFlagRouter, "patch", "/", SHIPPING, { body: { shipmentConfirmationEnabled: true, shippingSackSeqPrefix: "S" } }) === true,
);
check(
  "§2c ⭐ dar izin BAŞKA ekranın anahtarını yazamaz",
  passes(featureFlagRouter, "patch", "/", SHIPPING, { body: { financeDefaultVatRate: 20 } }) === false,
);
check(
  "§2d ⭐ karma gövde: bir anahtar izinsizse TÜMÜ reddedilir (düz OR değil)",
  passes(featureFlagRouter, "patch", "/", SHIPPING, { body: { shipmentConfirmationEnabled: true, sessionDurationMinutes: 60 } }) === false,
);
check(
  "§2e iki dar izin, iki ekranın karma gövdesini yazar",
  passes(featureFlagRouter, "patch", "/", ["settings:shipping", "settings:session"], {
    body: { shipmentConfirmationEnabled: true, sessionDurationMinutes: 60 },
  }) === true,
);
check(
  "§2f ⭐ tabloda olmayan anahtar dar izinle yazılamaz (fail-closed)",
  unscoped.length === 0 || passes(featureFlagRouter, "patch", "/", SETTINGS_SCOPES.map((s) => s.permission), { body: { [unscoped[0]!]: 1 } }) === false,
  unscoped[0] ?? "(tabloda olmayan anahtar yok)",
);
check("§2g şemsiye `admin:settings` her ekranın anahtarını yazar", passes(featureFlagRouter, "patch", "/", ADMIN, { body: { shipmentConfirmationEnabled: true, financeDefaultVatRate: 20, companyName: "X" } }) === true);
check("§2h boş gövde yalnız `admin:settings`", passes(featureFlagRouter, "patch", "/", SHIPPING, { body: {} }) === false);
check(
  "§2i ⭐ dar izin modül anahtarını yazamaz (süperadmin dalı önde)",
  passes(featureFlagRouter, "patch", "/", ["settings:production"], { body: { productionEnabled: false } }) === false,
);
check("§2j `system:backups` yedek saatini yazar", passes(featureFlagRouter, "patch", "/", ["system:backups"], { body: { backupHour: 3 } }) === true);
check("§2k logo: `settings:company` yazar, `settings:label` yazamaz",
  passes(featureFlagRouter, "put", "/documents-logo", ["settings:company"]) === true &&
    passes(featureFlagRouter, "put", "/documents-logo", ["settings:label"]) === false);

// ── §3 HAM AYAR + SİSTEM EKRANLARI ──────────────────────────────────────────
console.log("\n§3 — ham ayar ucu ve sistem ekranları");
const [rawKey, rawScope] = [...SETTING_KEY_SCOPE.entries()][0] ?? [];
check("§3a körlük zemini: ham anahtar tablosu dolu", SETTING_KEY_SCOPE.size >= 3, `${SETTING_KEY_SCOPE.size}`);
check(
  "§3b ⭐ PUT /settings/:key — dar izin kendi ham anahtarını yazar, başkasınınkini yazamaz",
  passes(adminRouter, "put", "/settings/:key", [rawScope!], { params: { key: rawKey! } }) === true &&
    passes(adminRouter, "put", "/settings/:key", ["settings:finance"], { params: { key: rawKey! } }) === false &&
    passes(adminRouter, "put", "/settings/:key", [rawScope!], { params: { key: "backup.hour" } }) === false,
  `${rawKey} → ${rawScope}`,
);
const tileRoutes: Array<[string, "get" | "post" | "patch", string]> = [
  ["system:clients", "get", "/clients"],
  ["system:activity", "get", "/system-logs"],
  ["system:activity", "get", "/system-logs/archive"],
  ["system:backups", "post", "/backup"],
  ["system:backups", "get", "/backups/offsite"],
];
const tileMiss = tileRoutes
  .filter(([perm, m, p]) => passes(adminRouter, m, p, [perm]) !== true)
  .map(([perm, m, p]) => `${m.toUpperCase()} ${p} ← ${perm}`);
check("§3c ⭐ sistem karolarının uçları kendi dar iznini kabul eder", tileMiss.length === 0, tileMiss.join(" · "));
check("§3d dar izin başka karonun ucunu açmaz", passes(adminRouter, "get", "/clients", ["system:activity"]) === false);
// Süperadmin ekranları: `systemAccountLockActive()` ölçülmemişken TRUE (fail-closed) → senkron kilitli dal.
check(
  "§3e ⭐ süperadmin ekranı (perf) sistem hesabı varken `admin:settings`e KAPALI",
  passes(adminRouter, "get", "/perf", ADMIN) === false && passes(adminRouter, "get", "/perf", ["*"], { isSystemAccount: true }) === true,
);
check(
  "§3f ⭐ log arşivleme + DB geri yükleme de süperadmin",
  passes(adminRouter, "post", "/system-logs/archive", ADMIN) === false &&
    passes(dbCopyRouter, "get", "/", [...ADMIN, "admin:users"]) === false &&
    passes(dbCopyRouter, "get", "/", ["*"], { isSystemAccount: true }) === true,
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
