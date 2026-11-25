// =============================================================================
// test_desen_tahar_mekanizma — Seyitoğlu K1 (tahar türü) + K10 (firma mekanizma ayarı), GERÇEK DB.
// K1: tür yalnız Eksantrik/Armür'de yazılır (Jakar 400), Jakar'a çevrilince saklı tür silinmez ama etkin
// görünüm null; kumaş görünümü sivri/atlamalı dizilimi çizer; basımda "TAHAR :" satırı (boşsa yok).
// K10: kapalı mekanizma YENİ seçimde 400; kayıtlı değeri taşıyan güncelleme serbest; üçü kapatılamaz.
// Fikstür `TEST-A1T-<ts>`; SystemSetting birebir geri yüklenir; temizlik `finally`de FK sırasıyla.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createWeaveDesign, updateWeaveDesign } from "../src/services/weave-design.service";
import { effectiveWeaveDesign } from "../src/services/helpers/effective-construction.helper";
import { computeDrawdown } from "../src/services/helpers/weave-drawdown.helper";
import { drawingInUnit } from "../src/constants/weave-drawing-in";
import { buildWeaveCardView } from "../src/services/weave-card.service";
import { renderWeaveDesignCardHtml } from "../src/services/document-render/weave-design-card.html";
import { systemSettingService } from "../src/services/system-setting.service";
import { MECHANISM_SETTING } from "../src/services/system-setting/weave-settings";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e.details?.code ?? `HTTP${e.statusCode}` : (e as Error).message.slice(0, 120); }
}

const TAG = `TEST-A1T-${Date.now()}`;
const ids = { design: [] as string[], items: [] as string[] };
const MECH_KEYS = Object.values(MECHANISM_SETTING).map((m) => m.key);
let savedSettings: Array<{ key: string; value: unknown; description: string | null }> = [];

const RAW_SELECT = {
  id: true, code: true, name: true, kind: true, shedMechanism: true, weaveStructure: true, hookCount: true, repeatWidthCm: true,
  familyLabel: true, frameCount: true, repeatCm: true, liftPlan: true, loomFileName: true, lenoSetup: true, lenoFrames: true,
  selvedgeFrames: true, drawingInNote: true, drawingInType: true, isActive: true,
} as const;

async function drawingInChecks(adminId: string): Promise<void> {
  console.log("§1 tahar türü saf dizilim");
  check("§1a sivri 4 → 0,1,2,3,2,1", drawingInUnit(4, "POINTED").join() === "0,1,2,3,2,1");
  check("§1b atlamalı 8 → 0,2,4,6,1,3,5,7", drawingInUnit(8, "SKIP").join() === "0,2,4,6,1,3,5,7");
  check("§1c n<3 ve özel/boş → düz", drawingInUnit(2, "POINTED").join() === "0,1" && drawingInUnit(4, "CUSTOM").join() === "0,1,2,3" && drawingInUnit(4, null).join() === "0,1,2,3");
  const dd = computeDrawdown({ kind: "DOBBY", liftPlan: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], lenoFrames: [], selvedgeFrames: [], pickSequence: null, drawingInType: "POINTED" });
  check("§1d computeDrawdown sivri: 6 tel, tahar şeridi 1-2-3-4-3-2", dd?.cells[0]?.length === 6 && (dd?.threading ?? []).join() === "1,2,3,4,3,2", JSON.stringify(dd?.threading));

  console.log("§2 yazım kapısı");
  const plan = [[1, 0, 1, 0], [0, 1, 0, 1]];
  const a = await createWeaveDesign({ code: `${TAG}-A`, name: `${TAG} ARMUR`, shedMechanism: "DOBBY", weaveStructure: "PLAIN", frameCount: 4, liftPlan: plan, drawingInType: "POINTED", drawingInNote: "kenar 2'li" }, adminId);
  ids.design.push(a.id);
  check("§2a Armür'de tür yazılır", a.drawingInType === "POINTED");
  const e = await createWeaveDesign({ code: `${TAG}-E`, name: `${TAG} EKS`, shedMechanism: "CAM", weaveStructure: "TWILL", drawingInType: "SKIP" }, adminId);
  ids.design.push(e.id);
  check("§2b Eksantrik'te tür yazılır", e.drawingInType === "SKIP");
  check("§2c Jakar'da tür → 400 WEAVE_DESIGN_DRAWING_IN_FRAMES_ONLY",
    (await codeOf(() => createWeaveDesign({ code: `${TAG}-J`, name: `${TAG} JAKAR`, shedMechanism: "JACQUARD", drawingInType: "STRAIGHT" }, adminId))) === "WEAVE_DESIGN_DRAWING_IN_FRAMES_ONLY");
  check("§2d tanınmayan tür → 400 WEAVE_DESIGN_DRAWING_IN_INVALID", (await codeOf(() => updateWeaveDesign(a.id, { drawingInType: "ZIGZAG" }, adminId))) === "WEAVE_DESIGN_DRAWING_IN_INVALID");
  check("§2e eski istemci (alan yok) türe dokunmaz", (await updateWeaveDesign(a.id, { notes: "x" }, adminId)).drawingInType === "POINTED");

  console.log("§3 Jakar'a çevirme: saklı tür korunur, etkin görünüm null");
  await updateWeaveDesign(e.id, { shedMechanism: "JACQUARD" }, adminId);
  const raw = await prisma.weaveDesign.findUniqueOrThrow({ where: { id: e.id }, select: RAW_SELECT });
  check("§3a saklı tür silinmedi", raw.drawingInType === "SKIP");
  check("§3b effectiveWeaveDesign Jakar'da tür null", effectiveWeaveDesign(raw)?.drawingInType === null);
  check("§3c Eksantrik'e dönünce tür yeniden görünür", effectiveWeaveDesign(await prisma.weaveDesign.findUniqueOrThrow({ where: { id: (await updateWeaveDesign(e.id, { shedMechanism: "CAM" }, adminId)).id }, select: RAW_SELECT }))?.drawingInType === "SKIP");

  console.log("§4 basım TAHAR satırı");
  const fab = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} KUMAŞ`, itemType: "FABRIC", weaveDesignId: a.id }, select: { id: true } });
  ids.items.push(fab.id);
  const html = renderWeaveDesignCardHtml(await buildWeaveCardView(fab.id, new Date("2026-11-25T09:00:00Z")));
  check("§4a 'TAHAR : Sivri · not' basılır", html.includes("<b>TAHAR :</b> Sivri · kenar 2&#39;li") || html.includes("<b>TAHAR :</b> Sivri · kenar 2'li"), html.match(/TAHAR :<\/b>[^<]*/)?.[0] ?? "");
  await updateWeaveDesign(a.id, { drawingInType: null, drawingInNote: null }, adminId);
  const bare = renderWeaveDesignCardHtml(await buildWeaveCardView(fab.id, new Date("2026-11-25T09:00:00Z")));
  check("§4b tür ve not boşsa satır yok (bugünkü basım)", !bare.includes("TAHAR :"));
}

async function mechanismChecks(adminId: string): Promise<void> {
  console.log("§5 firma mekanizma ayarı");
  const d = await createWeaveDesign({ code: `${TAG}-M`, name: `${TAG} MEK`, shedMechanism: "JACQUARD" }, adminId);
  ids.design.push(d.id);
  await systemSettingService.setFeatureFlags({ dokumaMechanismCamEnabled: true, dokumaMechanismDobbyEnabled: true, dokumaMechanismJacquardEnabled: false }, adminId);
  check("§5a kapalı mekanizmayla YENİ kart → 400 WEAVE_DESIGN_MECHANISM_DISABLED",
    (await codeOf(() => createWeaveDesign({ code: `${TAG}-M2`, name: `${TAG} MEK2`, shedMechanism: "JACQUARD" }, adminId))) === "WEAVE_DESIGN_MECHANISM_DISABLED");
  check("§5b kayıtlı (kapalı) değeri aynen gönderen güncelleme serbest", (await codeOf(() => updateWeaveDesign(d.id, { shedMechanism: "JACQUARD", notes: "eski kart" }, adminId))) === null);
  check("§5c mekanizmayı alan göndermeyen güncelleme serbest", (await codeOf(() => updateWeaveDesign(d.id, { notes: "eski kart 2" }, adminId))) === null);
  await systemSettingService.setFeatureFlags({ dokumaMechanismCamEnabled: false }, adminId);
  check("§5d kapalı mekanizmaya DEĞİŞTİRME → 400", (await codeOf(() => updateWeaveDesign(d.id, { shedMechanism: "CAM" }, adminId))) === "WEAVE_DESIGN_MECHANISM_DISABLED");
  check("§5e açık mekanizmaya değiştirme serbest", (await codeOf(() => updateWeaveDesign(d.id, { shedMechanism: "DOBBY" }, adminId))) === null);
  check("§5f üçünü kapatmak → 400 WEAVE_MECHANISM_NONE_ENABLED",
    (await codeOf(() => systemSettingService.setFeatureFlags({ dokumaMechanismDobbyEnabled: false }, adminId))) === "WEAVE_MECHANISM_NONE_ENABLED");
  const flags = (await systemSettingService.getFeatureFlags()).data;
  check("§5g reddedilen yazım ayarı değiştirmedi (Armür açık)", flags.dokumaMechanismDobbyEnabled === true && flags.dokumaMechanismCamEnabled === false);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { fail++; console.log(`  ✗ ${engel}`); return; }
  savedSettings = await prisma.systemSetting.findMany({ where: { key: { in: MECH_KEYS } }, select: { key: true, value: true, description: true } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: MECH_KEYS } } });
  const flags0 = (await systemSettingService.getFeatureFlags()).data;
  check("§0 kayıt yokken üç mekanizma açık (bugünkü davranış)", flags0.dokumaMechanismCamEnabled && flags0.dokumaMechanismDobbyEnabled && flags0.dokumaMechanismJacquardEnabled);
  const admin = await ensureTestAdmin();
  await drawingInChecks(admin.id);
  await mechanismChecks(admin.id);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { id: { in: ids.design } } }));
  await t(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: MECH_KEYS } } });
    for (const s of savedSettings) await prisma.systemSetting.create({ data: { key: s.key, value: s.value as never, description: s.description } });
  });
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
