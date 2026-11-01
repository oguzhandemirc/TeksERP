// =============================================================================
// test_import_dokuma_adaptor — SEYİTOĞLU SY-H2 içe aktarım adaptörleri (GERÇEK DB)
// =============================================================================
// Kabul (§16.1 SY-H2): dört yeni adaptör (çözgü kartı · atkı kartı · desen kartı · iplik maliyet
// fiyatı) + iş emri şablonu varyant genişlemesi her birinde ÖNİZLE → UYGULA → GERİ AL; sıra dışı
// referans (iplik yüklenmeden kart) SATIR HATASI (sessiz yaratma yok). Yarış: önizleme yeşilken
// iplik pasife alınırsa uygulama aynı doğrulamayı yeniden koşar ve hiçbir şey yazmaz.
// Modül kapısı: dokuma kapalıyken desen/atkı adaptörleri `/entities` listesinde yok.
// NEGATİF SONDA (ölçüldü, geri alındı): `weave-design`/`warp-spec` adaptöründe iplik çözümü modül
// düzeyi önbelleğe alınınca (uygula önizlemeye güvenir) §7a/§7b kırmızı — BEKCI-HARITASI satırı.
// SY-F3K §1a'': `resolveYarnCode` itemType vermeyince mesaj "kumaş bulunamadı" → ❌ (42/1); geri alındı.
// Fikstür `TEST-SYH2-<ts>`; temizlik `finally`de FK sırasıyla; modül bayrakları birebir geri yüklenir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { ImportService } from "../src/services/import/import.service";
import { ImportRevertService, REVERT_PLAN } from "../src/services/import/import-revert.service";
import { getImportAdapter, listAdapters } from "../src/services/import/import-registry";
import {
  systemSettingService,
  readDevereEnabledRaw,
  readDokumaEnabledRaw,
  readMaliyetEnabledRaw,
  readProductionEnabledRaw,
} from "../src/services/system-setting.service";
import { createWeftSpec } from "../src/services/weft-spec.service";
import { itemService } from "../src/routes/item.routes";
import type { ImportApplyResult, ImportRowInput } from "../src/services/import/import.types";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-SYH2-${Date.now()}`;
const ALL = ["*"];
const ids = { items: [] as string[], runs: [] as string[] };
const row = (rowNo: number, cells: Record<string, string>): ImportRowInput => ({ rowNo, cells });

async function apply(entity: string, rows: ImportRowInput[], permissions = ALL): Promise<ImportApplyResult> {
  const r = await ImportService.apply(entity, rows, {}, { userId: adminId, permissions });
  ids.runs.push(r.runId);
  return r;
}

async function revertAll(runId: string, rowNos: number[]): Promise<{ reverted: number; skipped: Array<{ rowNo: number; reason: string }> }> {
  return ImportRevertService.revert(runId, { reason: "SY-H2 bekçi geri sarma", selectedRowNos: rowNos, permissions: ALL, userId: adminId });
}

async function errCode(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e.details?.code : (e as Error).message; }
}

let adminId = "";
let flagsBefore: Record<string, boolean> | null = null;

/** Dört bayrak açılır; önceki ham değerler `finally`de BİREBİR geri yazılır (bağımlılık sırasıyla). */
async function openModules(): Promise<void> {
  flagsBefore = {
    productionEnabled: await readProductionEnabledRaw(),
    dokumaEnabled: await readDokumaEnabledRaw(),
    devereEnabled: await readDevereEnabledRaw(),
    maliyetEnabled: await readMaliyetEnabledRaw(),
  };
  await systemSettingService.setFeatureFlags({ productionEnabled: true }, adminId);
  await systemSettingService.setFeatureFlags({ dokumaEnabled: true, devereEnabled: true, maliyetEnabled: true }, adminId);
}

async function restoreModules(): Promise<void> {
  if (!flagsBefore) return;
  const { productionEnabled, ...rest } = flagsBefore;
  await systemSettingService.setFeatureFlags(rest, adminId);
  await systemSettingService.setFeatureFlags({ productionEnabled }, adminId);
}

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) throw new Error(block);
  adminId = (await ensureTestAdmin()).id;
  await openModules();
  const yarn = async (s: string, den: number | null = 150): Promise<string> => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} İPLİK ${s}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const y1 = await yarn("Y1");
  const y2 = await yarn("Y2");
  await yarn("Y3");
  const yRace = await yarn("YR");
  await yarn("YP");
  await yarn("YP2");
  const fabricNon = await prisma.item.create({ data: { code: `${TAG}-KMX`, name: `${TAG} KUMAŞ X`, itemType: "FABRIC" }, select: { id: true } });
  ids.items.push(fabricNon.id);
  const c = (s: string): string => `${TAG}-${s}`;

  console.log("§0 statik: kayıt defteri + ters yol");
  const gated = listAdapters().filter((a) => a.module).map((a) => `${a.entity}:${a.module}`).sort().join(",");
  check("§0a dört yeni adaptör modül kapılı", gated === "warpSpec:devere,weaveDesign:dokuma,weftSpec:dokuma,yarnCostPrice:maliyet", gated);
  check("§0b ters yollar: kartlar DEACTIVATE, fiyat REVOKE_VERSION",
    REVERT_PLAN.warpSpec?.mode === "DEACTIVATE" && REVERT_PLAN.weftSpec?.mode === "DEACTIVATE" && REVERT_PLAN.weaveDesign?.mode === "DEACTIVATE" && REVERT_PLAN.yarnCostPrice?.mode === "REVOKE_VERSION");

  console.log("§1 sıra dışı referans → satır hatası (sessiz yaratma yok)");
  const missWarp = await ImportService.preview("warpSpec", [row(2, { code: c("WX"), name: `${TAG} çözgü x`, yarnCode: c("YOK"), endsCount: "100" })], {}, { userId: adminId, permissions: ALL });
  check("§1a yüklenmemiş iplik → ERROR (yarnCode)", missWarp.rows[0]?.action === "ERROR" && missWarp.rows[0].errors.some((e) => e.column === "yarnCode"), JSON.stringify(missWarp.rows[0]?.errors));
  check("§1a' iplik için kumaş yaratma ipucu YOK", missWarp.rows[0]?.errors.every((e) => !e.fix) === true);
  // SY-F3K: `item` çözücüsünün etiketi beklenen türden gelir — iplik sütununda "kumaş bulunamadı" denmez.
  const missMsg = missWarp.rows[0]?.errors.find((e) => e.column === "yarnCode")?.message ?? "";
  check("§1a'' iplik bulunamadı mesajı 'iplik' der, 'kumaş' demez", /eşleşen iplik bulunamadı/.test(missMsg) && !/kumaş/.test(missMsg), missMsg);
  const nonYarn = await ImportService.preview("weftSpec", [row(2, { code: c("WFX"), name: `${TAG} atkı x`, yarnCode: c("KMX"), picksInRepeat: "4" })], {}, { userId: adminId, permissions: ALL });
  check("§1b kumaş kodu atkı ipliği olamaz → ERROR", nonYarn.rows[0]?.action === "ERROR" && nonYarn.rows[0].errors.some((e) => /İPLİK/.test(e.message)));
  const missApply = await errCode(() => ImportService.apply("warpSpec", [row(2, { code: c("WX"), name: `${TAG} çözgü x`, yarnCode: c("YOK"), endsCount: "100" })], {}, { userId: adminId, permissions: ALL }));
  check("§1c uygulama da reddeder, kart doğmaz", missApply === "IMPORT_VALIDATION_FAILED" && (await prisma.warpSpec.count({ where: { code: c("WX") } })) === 0, String(missApply));

  console.log("§2 çözgü kartı: önizle → uygula → güncelle → geri al");
  const wRows = [row(2, { code: c("WP1"), name: `${TAG} çözgü 1`, yarnCode: c("Y1"), endsCount: "5250", takeUpPct: "8" })];
  const wPrev = await ImportService.preview("warpSpec", wRows, {}, { userId: adminId, permissions: ALL });
  check("§2a önizleme CREATE, yazmaz", wPrev.rows[0]?.action === "CREATE" && (await prisma.warpSpec.count({ where: { code: c("WP1") } })) === 0);
  const wApp = await apply("warpSpec", wRows);
  const wp = await prisma.warpSpec.findUnique({ where: { code: c("WP1") } });
  check("§2b uygula: kart doğdu (iplik + tel + take-up)", wApp.created === 1 && wp?.yarnItemId === y1 && wp.endsCount === 5250 && Number(wp.takeUpPct) === 8);
  const wSame = await ImportService.preview("warpSpec", wRows, {}, { userId: adminId, permissions: ALL });
  check("§2c aynı dosya → SKIP", wSame.rows[0]?.action === "SKIP", JSON.stringify(wSame.rows[0]?.changes));
  const wUpd = await apply("warpSpec", [row(2, { code: c("WP1"), endsCount: "5300" })]);
  check("§2d güncelle UPDATE", wUpd.updated === 1 && (await prisma.warpSpec.findUnique({ where: { code: c("WP1") } }))?.endsCount === 5300);
  await revertAll(wUpd.runId, [2]);
  check("§2e güncelleme geri sarıldı (5250)", (await prisma.warpSpec.findUnique({ where: { code: c("WP1") } }))?.endsCount === 5250);
  await revertAll(wApp.runId, [2]);
  check("§2f yaratma geri sarıldı → PASİF (silinmedi)", (await prisma.warpSpec.findUnique({ where: { code: c("WP1") } }))?.isActive === false);

  console.log("§3 atkı kartı (gruplu): sıra kodundan adet + geri al");
  const fRows = [
    row(2, { code: c("WF1"), name: `${TAG} atkı 1`, picksPerCm: "12", sequenceCode: "a4 b1", yarnCode: c("Y1") }),
    row(3, { code: c("WF1"), yarnCode: c("Y2") }),
  ];
  const fApp = await apply("weftSpec", fRows);
  const wf = await prisma.weftSpec.findUnique({ where: { code: c("WF1") }, include: { yarns: { orderBy: { sortOrder: "asc" } } } });
  check("§3a iki satır TEK kart, adetler koddan (4·1)", fApp.created === 1 && wf?.yarns.map((y) => `${y.yarnItemId === y1 ? "Y1" : y.yarnItemId === y2 ? "Y2" : "?"}:${y.picksInRepeat}`).join() === "Y1:4,Y2:1", JSON.stringify(wf?.yarns));
  const fSame = await ImportService.preview("weftSpec", fRows, {}, { userId: adminId, permissions: ALL });
  check("§3b adet sütunu boş aynı dosya → SKIP (türetim diff'te)", fSame.rows[0]?.action === "SKIP", JSON.stringify(fSame.rows[0]?.changes));
  const fBad = await ImportService.preview("weftSpec", [row(2, { code: c("WF2"), name: `${TAG} atkı 2`, yarnCode: c("Y1") })], {}, { userId: adminId, permissions: ALL });
  check("§3c sıra kodu yokken adet zorunlu → ERROR", fBad.rows[0]?.action === "ERROR");
  const cardOf = async (): Promise<string> => {
    const w = await prisma.weftSpec.findUnique({ where: { code: c("WF1") }, include: { yarns: { orderBy: { sortOrder: "asc" } } } });
    return `${w?.sequenceCode} ${w?.yarns.map((y) => y.picksInRepeat).join()}`;
  };
  const before3e = await cardOf();
  const fUpd = await apply("weftSpec", [row(2, { code: c("WF1"), sequenceCode: "a3 b2", yarnCode: c("Y1") }), row(3, { code: c("WF1"), yarnCode: c("Y2") })]);
  const mid3e = await cardOf();
  const rv3e = await revertAll(fUpd.runId, [2]);
  check("§3e sıra kodu güncellemesi geri sarılınca kart TUTARLI önceki hâline döner", fUpd.updated === 1 && mid3e !== before3e && rv3e.reverted === 1 && (await cardOf()) === before3e, `${before3e} → ${mid3e} → ${await cardOf()} ${JSON.stringify(rv3e)}`);
  await revertAll(fApp.runId, [2]);
  check("§3d yaratma geri sarıldı → PASİF", (await prisma.weftSpec.findUnique({ where: { code: c("WF1") } }))?.isActive === false);

  console.log("§4 desen kartı: armür ızgarası + geri al");
  const dApp = await apply("weaveDesign", [row(2, { code: c("D1"), name: `${TAG} desen`, kind: "Döner", frameCount: "4", repeatCm: "1,5", liftPlan: "1010;0101" })]);
  const d1 = await prisma.weaveDesign.findUnique({ where: { code: c("D1") } });
  check("§4a desen doğdu, ızgara 2×4", dApp.created === 1 && d1?.kind === "LENO" && JSON.stringify(d1.liftPlan) === "[[1,0,1,0],[0,1,0,1]]", JSON.stringify(d1?.liftPlan));
  const dSame = await ImportService.preview("weaveDesign", [row(2, { code: c("D1"), liftPlan: "1 0 1 0; 0101" })], {}, { userId: adminId, permissions: ALL });
  check("§4b yazım biçimi farkı değişiklik değil → SKIP", dSame.rows[0]?.action === "SKIP", JSON.stringify(dSame.rows[0]?.changes));
  const dBad = await ImportService.preview("weaveDesign", [row(2, { code: c("D1"), liftPlan: "10;101" })], {}, { userId: adminId, permissions: ALL });
  check("§4c eşit olmayan satır → ERROR", dBad.rows[0]?.action === "ERROR");
  const dUpd = await apply("weaveDesign", [row(2, { code: c("D1"), liftPlan: "1100;0011", familyLabel: "DÖNER" })]);
  await revertAll(dUpd.runId, [2]);
  const d1b = await prisma.weaveDesign.findUnique({ where: { code: c("D1") } });
  check("§4d güncelleme geri sarıldı (ızgara + aile)", JSON.stringify(d1b?.liftPlan) === "[[1,0,1,0],[0,1,0,1]]" && d1b?.familyLabel === null, `${JSON.stringify(d1b?.liftPlan)} ${d1b?.familyLabel}`);
  await revertAll(dApp.runId, [2]);
  check("§4e yaratma geri sarıldı → PASİF", (await prisma.weaveDesign.findUnique({ where: { code: c("D1") } }))?.isActive === false);

  console.log("§5 iplik maliyet fiyatı: damgalı sürüm + geri al");
  const pApp = await apply("yarnCostPrice", [row(2, { yarnCode: c("YP"), currency: "USD", pricePerKg: "2,35" }), row(3, { yarnCode: c("YP2"), currency: "USD", pricePerKg: "3" })]);
  const active = async (code: string) => prisma.yarnCostPrice.findMany({ where: { yarnItem: { code }, revokedAt: null } });
  check("§5a iki fiyat yazıldı", pApp.created === 2 && Number((await active(c("YP")))[0]?.pricePerKg) === 2.35);
  const pSame = await ImportService.preview("yarnCostPrice", [row(2, { yarnCode: c("YP"), currency: "USD", pricePerKg: "2.35" })], {}, { userId: adminId, permissions: ALL });
  check("§5b aynı değer → SKIP", pSame.rows[0]?.action === "SKIP");
  const pUpd = await apply("yarnCostPrice", [row(2, { yarnCode: c("YP"), pricePerKg: "2,50" })]);
  const hist = await prisma.yarnCostPrice.count({ where: { yarnItem: { code: c("YP") } } });
  check("§5c farklı değer yeni sürüm, eskisi damgalı (2 satır, 1 aktif 2,50)", pUpd.updated === 1 && hist === 2 && Number((await active(c("YP")))[0]?.pricePerKg) === 2.5);
  const rUpd = await revertAll(pUpd.runId, [2]);
  const afterRev = await active(c("YP"));
  check("§5d güncelleme geri sarıldı: 2,35 YENİ sürüm, geçmiş silinmedi (3 satır)", rUpd.reverted === 1 && afterRev.length === 1 && Number(afterRev[0]?.pricePerKg) === 2.35 && (await prisma.yarnCostPrice.count({ where: { yarnItem: { code: c("YP") } } })) === 3);
  const rCre = await revertAll(pApp.runId, [2, 3]);
  check("§5e sonradan değişen sürüm ATLANIR, değişmeyen damgalanır", rCre.reverted === 1 && rCre.skipped.some((s) => s.rowNo === 2) && (await active(c("YP2"))).length === 0, JSON.stringify(rCre));

  console.log("§6 iş emri şablonu varyant genişlemesi");
  const wCard = await createWeftSpec({ code: c("WC"), name: `${TAG} kart`, yarns: [{ yarnItemId: y1, picksInRepeat: 4 }, { yarnItemId: y2, picksInRepeat: 1 }] }, adminId);
  const fab = await prisma.item.create({ data: { code: c("KM"), name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  ids.items.push(fab.id);
  await itemService.update(fab.id, { weftSpecId: wCard.id }, adminId);
  const recRow = row(2, { name: `${TAG} varyant`, itemCode: c("KM"), variantCode: "v01", weftChanges: `B=${c("Y3")}` });
  const noPerm = await ImportService.preview("productRecipe", [recRow], {}, { userId: adminId, permissions: ["data:import", "station:write"] });
  check("§6a warpspec:write yoksa atkı değişimi satır hatası", noPerm.rows[0]?.action === "ERROR" && noPerm.rows[0].errors.some((e) => e.column === "weftChanges"));
  const badLetter = await ImportService.preview("productRecipe", [row(2, { name: `${TAG} varyant z`, itemCode: c("KM"), weftChanges: `D=${c("Y3")}` })], {}, { userId: adminId, permissions: ALL });
  check("§6b kartta olmayan harf → ERROR", badLetter.rows[0]?.action === "ERROR");
  const badRate = await ImportService.preview("productRecipe", [row(2, { name: `${TAG} varyant r`, itemCode: c("KM"), finishingRateCode: `${TAG}-YOK`.slice(0, 32) })], {}, { userId: adminId, permissions: ALL });
  check("§6c yürürlükte olmayan tarife kodu → ERROR", badRate.rows[0]?.action === "ERROR");
  const rApp = await apply("productRecipe", [recRow]);
  const rec = await prisma.productRecipe.findFirst({ where: { itemId: fab.id }, include: { weftYarnOverrides: { include: { yarnItem: { select: { code: true } } } } } });
  check("§6d varyant + değişim yazıldı (V01, B=Y3)", rApp.created === 1 && rec?.variantCode === "V01" && rec.weftYarnOverrides.map((o) => `${o.weftSortOrder}:${o.yarnItem.code}`).join() === `1:${c("Y3")}`);
  const recKey = rec?.code ?? "";
  const rSame = await ImportService.preview("productRecipe", [row(2, { code: recKey, variantCode: "V01", weftChanges: `b=${c("Y3").toLowerCase()}` })], {}, { userId: adminId, permissions: ALL });
  check("§6e harf/kod yazımı farkı → SKIP", rSame.rows[0]?.action === "SKIP", JSON.stringify(rSame.rows[0]?.changes));
  const rClr = await apply("productRecipe", [row(2, { code: recKey, weftChanges: "NULL" })]);
  check("§6f NULL değişimi temizler", rClr.updated === 1 && (await prisma.productRecipeWeftYarn.count({ where: { recipeId: rec!.id } })) === 0);
  await revertAll(rClr.runId, [2]);
  check("§6g temizleme geri sarıldı (B=Y3 döndü)", (await prisma.productRecipeWeftYarn.count({ where: { recipeId: rec!.id, weftSortOrder: 1 } })) === 1);
  const legacy = await ImportService.preview("productRecipe", [row(2, { code: recKey, name: rec!.name })], {}, { userId: adminId, permissions: ALL });
  check("§6h varyant sütunsuz eski dosya → SKIP (bugünkü davranış)", legacy.rows[0]?.action === "SKIP");

  // Yarış: doğrulamadan SONRA atkı değişimi geçersizleşir (kartta olmayan sıra) → şablon yazıldı, değişim düştü.
  const recAdapter = getImportAdapter("productRecipe");
  const origValidate = recAdapter.validateRow!;
  recAdapter.validateRow = async (r, ctx) => {
    await origValidate(r, ctx);
    if (r.values.weftChanges__rows) r.values.weftChanges__rows = [{ weftSortOrder: 9, yarnItemId: y1 }];
  };
  let partial: ImportApplyResult;
  try {
    partial = await apply("productRecipe", [row(2, { name: `${TAG} varyant yarış`, itemCode: c("KM"), variantCode: "v02", weftChanges: `B=${c("Y3")}` })]);
  } finally {
    recAdapter.validateRow = origValidate;
  }
  const orphan = await prisma.productRecipe.findFirst({ where: { itemId: fab.id, variantCode: "V02" }, select: { id: true, isActive: true } });
  const orphanLine = orphan ? await prisma.importRunLine.count({ where: { importRunId: partial.runId, recordId: orphan.id, action: "CREATE" } }) : 0;
  check("§6i ikinci adım düştü → yazılan şablon defterde (PARTIAL, CREATE satırı)", partial.status === "PARTIAL" && orphanLine === 1, `${partial.status} line=${orphanLine}`);
  const rvPartial = await revertAll(partial.runId, [2]);
  check("§6j yarım şablon geri sarılabilir → PASİF", rvPartial.reverted === 1 && orphan !== null && (await prisma.productRecipe.findUnique({ where: { id: orphan.id } }))?.isActive === false, JSON.stringify(rvPartial));

  console.log("§7 yarış: uygula önizlemeye GÜVENMEZ");
  const raceRows = [row(2, { code: c("WR"), name: `${TAG} yarış`, yarnCode: c("YR"), endsCount: "100" })];
  const racePrev = await ImportService.preview("warpSpec", raceRows, {}, { userId: adminId, permissions: ALL });
  await prisma.item.update({ where: { id: yRace }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } });
  const raceApp = await errCode(() => ImportService.apply("warpSpec", raceRows, {}, { userId: adminId, permissions: ALL }));
  check("§7a önizleme yeşil, iplik araya pasife alındı → uygula 400 IMPORT_VALIDATION_FAILED", racePrev.rows[0]?.action === "CREATE" && raceApp === "IMPORT_VALIDATION_FAILED", String(raceApp));
  check("§7b kart YAZILMADI", (await prisma.warpSpec.count({ where: { code: c("WR") } })) === 0);

  console.log("§8 modül kapısı: kapalı modülün adaptörü listede yok");
  await systemSettingService.setFeatureFlags({ dokumaEnabled: false }, adminId);
  const off = (await ImportService.listEntities(ALL)).map((e) => e.entity);
  check("§8a dokuma kapalı → desen/atkı adaptörü YOK, modülsüzler VAR", !off.includes("weaveDesign") && !off.includes("weftSpec") && off.includes("productRecipe"), off.join(","));
  const offRevert = await errCode(() => revertAll(fApp.runId, [2]));
  check("§8c dokuma kapalı → atkı koşumunun geri sarması 403 MODULE_DISABLED", offRevert === "MODULE_DISABLED", String(offRevert));
  await systemSettingService.setFeatureFlags({ dokumaEnabled: true }, adminId);
  const on = (await ImportService.listEntities(ALL)).map((e) => e.entity);
  check("§8b dokuma açık → ikisi de listede", on.includes("weaveDesign") && on.includes("weftSpec"), on.join(","));
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.importRunLine.deleteMany({ where: { importRunId: { in: ids.runs } } }));
  await t(() => prisma.importRun.deleteMany({ where: { id: { in: ids.runs } } }));
  const recipes = (await prisma.productRecipe.findMany({ where: { itemId: { in: ids.items } }, select: { id: true } })).map((r) => r.id);
  await t(() => prisma.productRecipeWeftYarn.deleteMany({ where: { recipeId: { in: recipes } } }));
  await t(() => prisma.productRecipe.deleteMany({ where: { id: { in: recipes } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { warpSpecId: null, weftSpecId: null, weaveDesignId: null } }));
  await t(() => prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: { in: ids.items } } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpec: { code: { startsWith: TAG } } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { code: { startsWith: TAG } } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { code: { startsWith: TAG } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { code: { startsWith: TAG } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await restoreModules().catch((e) => { fail++; console.log(`  ✗ bayrak geri yükleme: ${(e as Error).message}`); });
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
