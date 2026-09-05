// =============================================================================
// BEKÇİ — Depo ekranı topu STOKTAN KALDIRABİLİR (`mobile:depo` → top iptali)
// =============================================================================
// NE KORUYOR: 2026-08-06'da top iptali (+ önizleme + geri alma) `mobile:kk1`ın
// yanında `mobile:depo`ya da açıldı. Gerekçe saha: yanlış etiketle stoğa girmiş
// top çoğu zaman KK1'de değil DEPODA, kâğıt okutulurken fark edilir. Depo
// personelinin yetkisi yoksa tek çare "KK1'e git, birini bul"dur ve saha onu
// beklemez — 2026-08-05'te beklemedi, doğaçladı ve aynı fiziksel top için ikinci
// bir barkod doğdu (T050826H0033 öldü → T050826H0072 doğdu, topta iki etiket).
//
// ÜÇ SESSİZ BOZULMA YOLU VAR, ÜÇÜ DE BURADA KİLİTLİ:
//   1. GERİ ALMA — üç uç (`cancel-preview` / `DELETE` / `restore-cancel`) AYNI
//      kümeyi taşımalı. Ayrışırsa depo personeli topu kaldırır ama yanlışlıkla
//      kaldırdığını GERİ ALAMAZ; tek çaresi yeniden giriş olur ve bu, guard'ın
//      önlemek için var olduğu ikinci-barkod vakasını aynen üretir.
//   2. KAPSAM GENİŞLEMESİ — küme `/initial-entry`ye de sızarsa depo ekranı ham
//      giriş açabilir hâle gelir. Depo topu KALDIRIR, YARATMAZ.
//   3. YETKİ GENİŞLEMESİ — `mobile:depo` bir yerde `roll:write` yerine sayılırsa
//      iptal izni sessizce tüm envanter yazma yetkisi olur.
//
// ⚠️ Bu bekçi YALNIZ kapıyı ölçer. İçerideki guard'lar (statü beyaz listesi,
// `confirmActive`, ölü etiket onayı) `test_roll_cancel_undo.ts`in işidir ve
// depo ile KK1 için birebir aynı koşar — kapıyı açmak onları gevşetmez.
//
// Salt-okunur: fixture/yazma yok, DB'ye bağlanmaz.
// Koşum: npx tsx scripts/test_depo_roll_cancel_permission.ts
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { matchesPermission } from "../src/middlewares/rbac.middleware";
import inventoryRouter from "../src/routes/inventory.routes";

const DEPO = "mobile:depo";
const KK1 = "mobile:kk1";

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
const satir = PERMISSION_CATALOG.find((p) => p.code === DEPO);
check("Katalogda satır var", Boolean(satir), DEPO);
check("Kategori 'mobile'", satir?.category === "mobile", `category=${satir?.category}`);

// ── 2) Yetki genişlemesi yok ─────────────────────────────────────────────────
console.log("\n=== 2) Yetki genişlemesi yok ===");
const yalnizDepo = [DEPO];
check("'mobile:depo' → 'roll:write' YERİNE GEÇMEZ", !matchesPermission(yalnizDepo, "roll:write"));
check(
  "'mobile:depo' → 'roll:manual-adjust' YERİNE GEÇMEZ",
  !matchesPermission(yalnizDepo, "roll:manual-adjust"),
);
check("'mobile:depo' → 'admin:settings' YERİNE GEÇMEZ", !matchesPermission(yalnizDepo, "admin:settings"));

// ── 3) Gerçek route zinciri ──────────────────────────────────────────────────
console.log("\n=== 3) /api/rolls route zinciri ===");
type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      name: string;
      handle: (req: Request, res: Response, next: NextFunction) => void;
    }>;
  };
};
const layers = (inventoryRouter as unknown as { stack: RouteLayer[] }).stack;

/**
 * Route'un YETKİ middleware'lerini gerçek izin listesiyle koşturur.
 * Zincir konvansiyonu: [verifyToken, ...yetki middleware'leri, controller] —
 * ilk ve son halka atlanır. Konvansiyon bozulursa `null` döner ve test düşer:
 * sessizce "geçti" demek bu bekçiyi süse çevirirdi.
 */
function yetkiVerirMi(
  method: "get" | "post" | "delete",
  routePath: string,
  permissions: string[],
): boolean | null {
  const layer = layers.find((l) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer?.route) return null;
  const zincir = layer.route.stack;
  if (zincir.length < 3 || zincir[0]!.name !== "verifyToken") return null;

  const req = { user: { permissions }, params: {}, query: {}, body: {} } as unknown as Request;
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

/** İptal üçlüsü — üçü de AYNI kümeyi taşımalı (bkz. başlıktaki 1. madde). */
const IPTAL_UCLARI = [
  { method: "get" as const, path: "/:id/cancel-preview", ad: "GET cancel-preview" },
  { method: "delete" as const, path: "/:id", ad: "DELETE /:id (iptal)" },
  { method: "post" as const, path: "/:id/restore-cancel", ad: "POST restore-cancel" },
];

for (const uc of IPTAL_UCLARI) {
  const depo = yetkiVerirMi(uc.method, uc.path, yalnizDepo);
  check(`${uc.ad} — zincir okunabildi (konvansiyon korunuyor)`, depo !== null);
  check(`${uc.ad} — 'mobile:depo' ile GEÇER`, depo === true);
  check(
    `${uc.ad} — 'mobile:kk1' yolu BOZULMADI`,
    yetkiVerirMi(uc.method, uc.path, [KK1]) === true,
  );
  check(
    `${uc.ad} — 'roll:write' yolu BOZULMADI`,
    yetkiVerirMi(uc.method, uc.path, ["roll:write"]) === true,
  );
  check(
    `${uc.ad} — ilgisiz izin hâlâ REDDEDİLİR`,
    yetkiVerirMi(uc.method, uc.path, ["order:read"]) === false,
  );
}

// ── 4) Kapsam sınırı: depo topu KALDIRIR, YARATMAZ ───────────────────────────
console.log("\n=== 4) Kapsam sınırı ===");
const hamGiris = yetkiVerirMi("post", "/initial-entry", yalnizDepo);
check("POST /initial-entry — zincir okunabildi", hamGiris !== null);
check("POST /initial-entry — 'mobile:depo' ile REDDEDİLİR", hamGiris === false);
check(
  "POST /initial-entry — 'mobile:kk1' yolu BOZULMADI",
  yetkiVerirMi("post", "/initial-entry", [KK1]) === true,
);
// Kalıcı silme süpervizör işi — dar mobil izin buraya asla ulaşmamalı.
check(
  "DELETE /:id/permanent — 'mobile:depo' ile REDDEDİLİR (arşivleme süpervizör işi)",
  yetkiVerirMi("delete", "/:id/permanent", yalnizDepo) === false,
);
check(
  "DELETE /:id/permanent — 'mobile:kk1' ile de REDDEDİLİR (kapsam KK1'e de kapalı)",
  yetkiVerirMi("delete", "/:id/permanent", [KK1]) === false,
);

// Koşucu yalnız "başarısız"/"kaldı" kelimesini tanır ("düştü" tanınmıyordu ve
// dosya özet tablosunda "geçti (exit 0)" görünüyordu — 12 kontrol gizliydi).
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} geçti, ${fail} başarısız`);
process.exit(fail === 0 ? 0 : 1);
