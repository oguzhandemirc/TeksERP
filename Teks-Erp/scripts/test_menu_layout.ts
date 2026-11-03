// =============================================================================
// BEKÇİ — MENÜ DÜZENİ (K19): gizleme listesi + Gelişmiş grubu + hazır set
// =============================================================================
// Korunan: (§1) küme tutarlılığı — hazır set / gizlenemez / Gelişmiş ⊆ SCREEN_CATALOG, set ∩ gizlenemez = ∅,
// set ∩ firmanın asıl işi = ∅, Gelişmiş yalnız masaüstü; (§2) okuma süzgeci — eski/bilinmeyen anahtar ve
// gizlenemez anahtar sessizce düşer, kayıt yok = bugünkü menü; (§3) yazım — bilinmeyen 400 MENU_SCREEN_UNKNOWN,
// gizlenemez 400 MENU_SCREEN_LOCKED, geçerli yazım okunur + audit; (§4) uç zinciri — GET yalnız verifyToken,
// PUT admin:settings + ayar şifresi; ham ayar ucu anahtarları reddeder.
// ⚠️ DB'ye YAZAR (iki `ui.menu*` satırı) → `hedefDbEngeli()` ilk adım; satırlar `finally`de birebir geri konur.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import {
  MENU_ADVANCED_SCREENS,
  MENU_LAYOUT_SCREEN_KEY,
  MENU_PRESETS,
  MENU_PRESET_FORBIDDEN_KEYS,
  MENU_UNHIDEABLE_KEYS,
  sanitizeHiddenScreens,
} from "../src/constants/menu-layout";
import { isReservedSettingKey } from "../src/constants/reserved-settings";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { getMenuLayoutView, readMenuLayout, updateMenuLayout, validateHiddenScreens } from "../src/services/menu-layout.service";
import menuLayoutRouter from "../src/routes/menu-layout.routes";
import { AuthService } from "../src/services/auth.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const KEYS = [SETTING_KEYS.UI_MENU_HIDDEN_SCREENS, SETTING_KEYS.UI_MENU_ADVANCED_GROUP];

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<{ ok: boolean; got: string }> {
  try {
    await fn();
    return { ok: false, got: "hata yok" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    const got = `${err.statusCode ?? "?"} ${err.details?.code ?? "?"}`;
    return { ok: err.statusCode === 400 && err.details?.code === code, got };
  }
}


async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n=== Menü düzeni (K19) ===\n");

  // ── §1 küme tutarlılığı (saf) ─────────────────────────────────────────────
  const catalogKeys = new Set(SCREEN_CATALOG.map((s) => s.key));
  const appOf = new Map(SCREEN_CATALOG.map((s) => [s.key, s.app]));
  check("§1a Menü Düzeni ekranı katalogda", catalogKeys.has(MENU_LAYOUT_SCREEN_KEY));
  const unknownLocked = [...MENU_UNHIDEABLE_KEYS].filter((k) => !catalogKeys.has(k));
  check("§1b gizlenemez küme ⊆ katalog", unknownLocked.length === 0, unknownLocked.join(", "));
  check("§1c Menü Düzeni'nin kendisi gizlenemez", MENU_UNHIDEABLE_KEYS.has(MENU_LAYOUT_SCREEN_KEY));
  const badAdvanced = MENU_ADVANCED_SCREENS.filter((k) => appOf.get(k) !== "desktop");
  check("§1d Gelişmiş grubu ⊆ katalogun masaüstü ekranları", badAdvanced.length === 0, badAdvanced.join(", "));
  const advLocked = MENU_ADVANCED_SCREENS.filter((k) => MENU_UNHIDEABLE_KEYS.has(k));
  check("§1e Gelişmiş ∩ gizlenemez = ∅ (gizlenemez ekran yerinde kalır)", advLocked.length === 0, advLocked.join(", "));
  check("§1f en az bir hazır set var ve 'Fason hizmet firması' adını taşır", MENU_PRESETS.some((p) => p.label === "Fason hizmet firması"));
  for (const p of MENU_PRESETS) {
    const keys = p.screens.map((s) => s.key);
    const notInCatalog = keys.filter((k) => !catalogKeys.has(k));
    check(`§1g [${p.id}] set ⊆ katalog`, notInCatalog.length === 0, notInCatalog.join(", "));
    const locked = keys.filter((k) => MENU_UNHIDEABLE_KEYS.has(k));
    check(`§1h [${p.id}] set ∩ gizlenemez = ∅`, locked.length === 0, locked.join(", "));
    const forbidden = keys.filter((k) => MENU_PRESET_FORBIDDEN_KEYS.has(k));
    check(`§1i [${p.id}] ⭐ set firmanın asıl işine dokunmaz (kurşun/KK/tambur/iş emri/belge/sevk…)`, forbidden.length === 0, forbidden.join(", "));
    check(`§1j [${p.id}] set tekil ve her satır gerekçeli`, new Set(keys).size === keys.length && p.screens.every((s) => s.reason.trim().length > 5));
  }
  const forbiddenNotInCatalog = [...MENU_PRESET_FORBIDDEN_KEYS].filter((k) => !catalogKeys.has(k));
  check("§1k yasak küme bayat değil (her anahtar katalogda)", forbiddenNotInCatalog.length === 0, forbiddenNotInCatalog.join(", "));

  // ── §2 okuma süzgeci (saf) ────────────────────────────────────────────────
  check("§2a kayıt yok / bozuk değer → boş liste", sanitizeHiddenScreens(undefined).length === 0 && sanitizeHiddenScreens("x").length === 0);
  const san = sanitizeHiddenScreens(["operations/kartela", "eski/silinmis-ekran", "system/menu-layout", "KK1", "KK1", 7]);
  check("§2b ⭐ eski anahtar + gizlenemez + tekrar + tip dışı sessizce düşer", JSON.stringify(san) === JSON.stringify(["operations/kartela", "KK1"]), JSON.stringify(san));
  const v = validateHiddenScreens(["operations/kartela", "yok/boyle", "access/users"]);
  check("§2c yazım doğrulaması bilinmeyen ve kilitliyi ayrı sayar", v.unknown.join() === "yok/boyle" && v.locked.join() === "access/users");

  // ── §3 yazım/okuma (DB) ───────────────────────────────────────────────────
  const snapshot = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  // Bekçi kullanıcısı TEST- damgalı; sert silinmez, `finally`de pasife alınır.
  const user = await prisma.user.create({
    data: { username: `TEST-menu-${Date.now().toString(36)}`, passwordHash: await AuthService.hashPassword("test-parola-1"), fullName: "TEST Menü Düzeni" },
    select: { id: true },
  });
  {
    try {
      await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
      const empty = await readMenuLayout();
      check("§3a ⭐ kayıt yok = bugünkü menü (hiçbiri gizli değil, Gelişmiş kapalı)", empty.hiddenScreens.length === 0 && empty.advancedGroup === false);

      const r1 = await expectCode(() => updateMenuLayout({ hiddenScreens: ["operations/kartela", "yok/boyle-ekran"] }, user.id), "MENU_SCREEN_UNKNOWN");
      check("§3b bilinmeyen ekran 400 MENU_SCREEN_UNKNOWN", r1.ok, r1.got);
      const r2 = await expectCode(() => updateMenuLayout({ hiddenScreens: ["system/module-profile"] }, user.id), "MENU_SCREEN_LOCKED");
      check("§3c gizlenemez ekran 400 MENU_SCREEN_LOCKED", r2.ok, r2.got);
      const afterReject = await prisma.systemSetting.count({ where: { key: { in: KEYS } } });
      check("§3d reddedilen yazım satır doğurmaz", afterReject === 0, `satır=${afterReject}`);

      const t0 = new Date();
      const view = await updateMenuLayout({ hiddenScreens: ["operations/kartela", "KK1", "KK1"], advancedGroup: true }, user.id);
      check("§3e geçerli yazım okunur (tekilleşir) + Gelişmiş açık", JSON.stringify(view.hiddenScreens) === JSON.stringify(["operations/kartela", "KK1"]) && view.advancedGroup === true, JSON.stringify(view.hiddenScreens));
      const audits = await prisma.systemLog.count({ where: { tableName: "SYSTEM_SETTING", recordId: { in: KEYS }, createdAt: { gte: t0 } } });
      check("§3f yazım audit'e düşer (iki anahtar)", audits >= 2, `audit=${audits}`);

      // Eski istemci/elle yazılmış bayat anahtar: okuma süzer, çökmeden döner.
      await prisma.systemSetting.update({ where: { key: SETTING_KEYS.UI_MENU_HIDDEN_SCREENS }, data: { value: ["operations/kartela", "silinmis/ekran", "access/users"] } });
      const stale = await readMenuLayout();
      check("§3g ⭐ DB'deki eski/gizlenemez anahtar okumada sessizce düşer", JSON.stringify(stale.hiddenScreens) === JSON.stringify(["operations/kartela"]), JSON.stringify(stale.hiddenScreens));

      const cleared = await updateMenuLayout({ hiddenScreens: [], advancedGroup: false }, user.id);
      check("§3h 'Tümünü göster' (boş liste) + Gelişmiş kapalı yazılır", cleared.hiddenScreens.length === 0 && cleared.advancedGroup === false);

      const full = await getMenuLayoutView();
      const preset = full.presets.find((p) => p.id === "fason-hizmet");
      check("§3i görünüm hazır seti başlık + uygulama bilgisiyle döner (önizleme)", !!preset && preset.screens.every((s) => s.title.length > 0 && (s.app === "desktop" || s.app === "mobile")) && preset.screens.some((s) => s.app === "mobile"));
      check("§3j görünüm gizlenemez küme + Gelişmiş listesini taşır", full.unhideable.length === MENU_UNHIDEABLE_KEYS.size && full.advancedScreens.length === MENU_ADVANCED_SCREENS.length);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
      for (const row of snapshot) {
        await prisma.systemSetting.create({ data: { key: row.key, value: row.value ?? [], description: row.description, updatedById: row.updatedById, createdAt: row.createdAt, updatedAt: row.updatedAt } });
      }
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } }).catch(() => undefined);
    }
  }

  // ── §4 uç zinciri + ham uç ────────────────────────────────────────────────
  const stack = menuLayoutRouter.stack;
  const routeOf = (method: string) => stack.find((l) => l.route?.path === "/" && l.route.stack.some((s) => s.method === method))?.route?.stack ?? [];
  const names = (layers: readonly { name?: string; handle?: unknown }[]) => layers.map((l) => l.name ?? (typeof l.handle === "function" ? l.handle.name : ""));
  const useNames = stack.filter((l) => !l.route).map((l) => l.name ?? "");
  check("§4a router.use(verifyToken) her ucun önünde", useNames.includes("verifyToken"), useNames.join(","));
  const putChain = names(routeOf("put"));
  check("§4b ⭐ PUT zincirinde ayar şifresi kapısı", putChain.includes("requireSettingsPassword"), putChain.join(","));
  check("§4c PUT zincirinde izin kapısı (admin:settings) ilk sırada", putChain.length >= 3 && putChain.indexOf("requireSettingsPassword") > 0, putChain.join(","));
  check("§4d GET ucu tek işleyici (izin istemez — tablet + panel menüyü süzer)", routeOf("get").length === 1);
  check("§4e ham ayar ucu (PUT /admin/settings/:key) iki anahtarı da reddeder", KEYS.every((k) => isReservedSettingKey(k)));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
