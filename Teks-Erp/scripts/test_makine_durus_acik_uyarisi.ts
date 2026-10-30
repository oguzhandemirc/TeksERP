// =============================================================================
// BEKÇİ — Açık duruş dokunuş uyarısı ayarı (D4-A2b, DALGA4 §2.5/5 · K2 · §12.1)
// =============================================================================
// SORU: `uretim.makineDurusAcikUyarisi` DÖRT KAPIDAN geçiyor mu (tip + sanitize + controller Zod +
// kapsam), varsayılanı sahadaki davranış (KAPALI) mı, ve sunucuda KAPI DEĞİL mi (K2: yalnız tablet
// uyarısı — ayar backend'de ayar servisi/şema/kapsam dışında okunmaz)?
// Global durum yazar (SystemSetting): `hedefDbEngeli()` ilk adım; ayar satırı birebir geri yüklenir.
// NEGATİF SONDA: (S1) Zod satırı silindi → §2a kırmızı; (S2) sanitize bloğu silindi → §3 kırmızı;
//   (S3) okuyucu `return true` → §1 kırmızı.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { FLAG_KEY_SCOPE } from "../src/constants/settings-scopes";
import { HIZMET_AYAR_PAKETI } from "./hizmet-ayar-paketi";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const FIELD = "machineStopOpenWarningEnabled";
const KEY = SETTING_KEYS.MACHINE_STOP_OPEN_WARNING_ENABLED;
const SRC = join(__dirname, "..", "src");
let saved: { value: Prisma.JsonValue; description: string | null } | null = null;

async function readFlag(): Promise<unknown> {
  invalidateFeatureFlagsCache();
  const res = await systemSettingService.getFeatureFlags();
  return (res.data as unknown as Record<string, unknown>)[FIELD];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  check("§0 anahtar adı tasarımla aynı", KEY === "uretim.makineDurusAcikUyarisi", KEY);
  saved = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true, description: true } });
  const actor = await testActorId();

  // ── §1 varsayılan = sahadaki davranış (uyarı yok) ──
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  const def = await readFlag();
  check("§1 ⭐ kayıt yokken bayrak false (varsayılan KAPALI)", def === false, `değer=${String(def)}`);

  // ── §2 controller Zod (PATCH /api/feature-flags gövdesi, strictObject) ──
  const bad = updateSchema.safeParse({ [FIELD]: "EVET" });
  const badMsg = bad.success ? "" : bad.error.issues.map((i) => i.message).join(" | ");
  check("§2a ⭐ Zod: boolean olmayan değer reddedilir (400) + Türkçe mesaj", !bad.success && /açık\/kapalı/.test(badMsg), badMsg);
  check("§2b Zod: true/false kabul", updateSchema.safeParse({ [FIELD]: true }).success && updateSchema.safeParse({ [FIELD]: false }).success);

  // ── §3 servis sanitize (Zod'u atlayan çağıran da 400 alır) ──
  let status: number | null = null;
  try {
    await systemSettingService.setFeatureFlags({ [FIELD]: "EVET" } as never, actor);
  } catch (e) {
    status = (e as { statusCode?: number }).statusCode ?? -1;
  }
  check("§3 ⭐ servis: boolean olmayan değer 400", status === 400, `status=${String(status)}`);

  // ── §4 yaz-oku gidiş dönüş ──
  await systemSettingService.setFeatureFlags({ [FIELD]: true } as never, actor);
  const on = await readFlag();
  await systemSettingService.setFeatureFlags({ [FIELD]: false } as never, actor);
  const off = await readFlag();
  check("§4 yaz true → oku true; yaz false → oku false", on === true && off === false, `on=${String(on)} off=${String(off)}`);

  // ── §5 kapsam + ayar paketi ──
  check("§5a dar ayar kapsamında (üretim — saha)", FLAG_KEY_SCOPE.has(FIELD), String(FLAG_KEY_SCOPE.get(FIELD)));
  const row = HIZMET_AYAR_PAKETI.find((r) => r.alan === FIELD);
  check("§5b hizmet ayar paketi satırı: anahtar + hedef açık", row?.anahtar === KEY && row?.hedef === true, JSON.stringify(row ?? null));

  // ── §6 K2: sunucu kapısı YOK — alan/anahtar ayar katmanı dışında okunmaz ──
  const allowed = ["services/system-setting.service.ts", "routes/feature-flag.routes.ts", "constants/settings-scopes.ts"];
  const sites = walk(SRC)
    .filter((f) => { const t = readFileSync(f, "utf8"); return t.includes(FIELD) || t.includes("MACHINE_STOP_OPEN_WARNING_ENABLED") || t.includes("makineDurusAcikUyarisi"); })
    .map((f) => relative(SRC, f));
  check("§6 ⭐ ayar yalnız ayar servisi + Zod + kapsamda (sunucu kapısı yok, K2)", sites.every((s) => allowed.includes(s)) && sites.length === allowed.length, sites.join(" | "));
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    try {
      if (saved) await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: saved.value as never, description: saved.description }, update: { value: saved.value as never, description: saved.description } });
      else await prisma.systemSetting.deleteMany({ where: { key: KEY } });
      invalidateFeatureFlagsCache();
    } catch (e) {
      console.error("geri yükleme hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
