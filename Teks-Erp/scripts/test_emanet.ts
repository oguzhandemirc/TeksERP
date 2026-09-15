// =============================================================================
// EMANET (KONSİNYE MÜLKİYET) BEKÇİSİ — G3: modül anahtarı · sahiplik doğum niteliği · kalıtım · sevk kapısı
// =============================================================================
// Koşum: npx tsx scripts/test_emanet.ts   (DB'li; TEST- fikstürü; emanet/devere/iplik bayrakları fotoğrafa döner)
//
// Ölçer (1e hükmü E1–E5 + E2b/E4c/E5b, 2026-09-15):
//   §0 statik — `WarpBeamOrigin.CONSIGNED` ↔ `origin_party_ck` dört kol (üç eski kol bayt bayt) · modül anahtarı on
//      yerde (module-flags · profiles · SETTING_KEYS · reader · setFeatureFlags · zod · grandfathering migration) ·
//      E4c: malın çıktığı iki yol (`performDispatchTx` · `executeDirectShip`) `assertOwnerMatchesTx` çağırır ·
//      E2b: PATCH şemaları owner'ı ÇIKARIR (warp-beam `omit`, lot update alanı yok, roll'da jenerik PATCH yok) ·
//      E4b: fatura taslağı emanet topu `warnings`e yazar · MERGE_MAP üç satır
//   §1 KAPALI = bayt bayt — owner'lı KK1 / CONSIGNED levent / owner'lı lot → 403 MODULE_DISABLED (modul emanet),
//      hiçbir satır doğmaz; ownersız doğum aynen
//   §2 AÇIK — lot owner A · CONSIGNED levent owner A (supplier ile 400) · IN_HOUSE sarım lot A'dan → levent owner A
//      KALITIR · A+B lotları karışık → 409 OWNER_MISMATCH (levent PLANNED kalır, iplik defterine yazılmaz) ·
//      KK1 owner A · fason dokuma sevkindeki leventten `resolveOwnerFromBeamsTx` → A
//   §3 SEVK KAPISI — [A'nın topu, ownersız top] müşteri B → 409 OWNER_MISMATCH yalnız A'nın barkodu listelenir;
//      müşteri A → geçer; hepsi ownersız → geçer (bugünkü davranış)
//   §4 DB sedleri — CONSIGNED ownersız 23514 · CONSIGNED + supplier 23514 · IN_HOUSE + owner OK (mülkiyet ≠ köken)
//   §5 E2b — `updateWarpBeam` gövdesine owner sızdırılsa bile owner DEĞİŞMEZ; lot update owner almaz
//   §6 G3t — `GET /rolls/tablet-context` (`roll:write` ∨ `mobile:kk1`, `/:id`den ÖNCE): emanet KAPALI ⇒
//      `customers: []`; AÇIK ⇒ aktif cariler yalnız `{id, name}` (vergi no / adres SIZMAZ), pasif cari yok
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-15):
//   · `assertOwnerMatchesTx` `NOT: { ownerCustomerId }` yüklemi düşürülünce §3a/§3b ❌
//   · `assertEmanetWritableTx` bayrak kontrolü düşürülünce §1a/§1b/§1c ❌
//   · `singleOwner` çoklu-owner 409'u düşürülünce §2d ❌
//   · `roll-tablet.service` `select`e `taxNumber` eklenip map'e geçirilince §6c ❌ · bayrak kontrolü düşürülünce §6b ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür; temizlik yalnız `temizle`de.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, RollStatus, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam, updateWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { YarnLotService } from "../src/services/yarn-lot.service";
import { InventoryService } from "../src/services/inventory.service";
import { assertOwnerMatchesTx, resolveOwnerFromBeamsTx } from "../src/services/helpers/emanet-owner.helper";
import { getRollTabletContext } from "../src/services/roll-tablet.service";
import { AppError } from "../src/utils/app-error";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    throw e;
  }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");
const modul = (e: AppError | null): string => String((e?.details as { modul?: string } | undefined)?.modul ?? "");
async function pgHata(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "geçti"; } catch (e) {
    const m = /\b(23\d{3})\b/.exec(String((e as Error).message ?? e));
    return m?.[1] ?? "başka";
  }
}

const ROOT = path.join(__dirname, "..");
const TAG = `TEST-EM-${Date.now().toString(36)}`;
const FLAGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED] as const;
const lots = new YarnLotService();
const inventory = new InventoryService();

function statik(): void {
  console.log("── §0 Statik ──");
  const mig = readFileSync(path.join(ROOT, "prisma/migrations/20260915052000_emanet_owner_customer/migration.sql"), "utf8");
  check("§0a origin_party_ck DÖRT KOL — üç eski kol bayt bayt + CONSIGNED ⇒ owner NOT NULL ∧ taraflar NULL",
    /\("originKind" = 'IN_HOUSE'\s+AND "subcontractorId" IS NULL\s+AND "supplierId" IS NULL\)/.test(mig) &&
    /\("originKind" = 'PURCHASED'\s+AND \(\("subcontractorId" IS NULL\) <> \("supplierId" IS NULL\)\)\)/.test(mig) &&
    /\("originKind" = 'CONSIGNED'\s+AND "ownerCustomerId" IS NOT NULL AND "subcontractorId" IS NULL AND "supplierId" IS NULL\)/.test(mig));
  const enumMig = readFileSync(path.join(ROOT, "prisma/migrations/20260915050000_warp_beam_origin_consigned/migration.sql"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  check("§0b CONSIGNED kendi ADD VALUE dosyasında (55P04), başka ifade yok", /ADD VALUE IF NOT EXISTS 'CONSIGNED'/.test(enumMig) && !/CREATE|INSERT|CHECK/.test(enumMig));
  const gf = readFileSync(path.join(ROOT, "prisma/migrations/20260915051000_emanet_modul_anahtari/migration.sql"), "utf8");
  check("§0c grandfathering damgası: `emanet.enabled` sabit false, koşullu INSERT, ON CONFLICT", /'emanet\.enabled', 'false'::jsonb/.test(gf) && /WHERE EXISTS \(SELECT 1 FROM "rolls"/.test(gf) && /ON CONFLICT \("key"\) DO NOTHING/.test(gf));
  const flags = readFileSync(path.join(ROOT, "src/constants/module-flags.ts"), "utf8");
  const profiles = readFileSync(path.join(ROOT, "src/constants/module-profiles.ts"), "utf8");
  const svc = readFileSync(path.join(ROOT, "src/services/system-setting.service.ts"), "utf8");
  const route = readFileSync(path.join(ROOT, "src/routes/feature-flag.routes.ts"), "utf8");
  check("§0d modül anahtarı: MODULE_FLAG_KEYS/SETTING_KEYS/LABELS · profil haritası+açıklama · SETTING_KEYS.EMANET_ENABLED · reader · setFeatureFlags dalı · zod",
    /"emanetEnabled",/.test(flags) && /"emanet\.enabled",/.test(flags) && /emanetEnabled: "Emanet/.test(flags) &&
    /"emanet\.enabled": "emanetEnabled"/.test(profiles) && /"emanet\.enabled": "Emanet/.test(profiles) &&
    /EMANET_ENABLED: "emanet\.enabled"/.test(svc) && /export async function readEmanetEnabled\(/.test(svc) && /hasOwnProperty\.call\(input, "emanetEnabled"\)/.test(svc) &&
    /emanetEnabled: z\.boolean\(\)\.optional\(\)/.test(route));
  const ship = readFileSync(path.join(ROOT, "src/services/shipping.service.ts"), "utf8");
  const sub = readFileSync(path.join(ROOT, "src/services/subcontractor.service.ts"), "utf8");
  const dispatchGovde = ship.slice(ship.indexOf("private async performDispatchTx("), ship.indexOf("private async performDispatchTx(") + 6000);
  const directGovde = sub.slice(sub.indexOf("async executeDirectShip("), sub.indexOf("async executeDirectShip(") + 20000);
  check("§0e ⭐ E4c: malın çıktığı İKİ yol `assertOwnerMatchesTx` çağırır — `performDispatchTx` (üç sevk yolunun boğazı) ve `executeDirectShip`",
    /await assertOwnerMatchesTx\(tx, \{ rollIds: shipmentRollIds/.test(dispatchGovde) && /await assertOwnerMatchesTx\(tx, \{ rollIds: effectiveShipRollIds/.test(directGovde));
  const wbRoute = readFileSync(path.join(ROOT, "src/routes/warp-beam.routes.ts"), "utf8");
  const yarnRoute = readFileSync(path.join(ROOT, "src/routes/yarn.routes.ts"), "utf8");
  const invCtl = readFileSync(path.join(ROOT, "src/controllers/inventory.controller.ts"), "utf8");
  const lotUpdate = yarnRoute.slice(yarnRoute.indexOf('router.patch("/lots/:id"'), yarnRoute.indexOf('router.patch("/lots/:id"') + 800);
  check("§0f ⭐ E2b: owner DOĞUM yolundan — warp-beam PATCH şeması `ownerCustomerId`'yi ÇIKARIR, lot PATCH almaz, roll'da yalnız `initialEntrySchema`",
    /createSchema\.omit\(\{ clientToken: true, ownerCustomerId: true \}\)/.test(wbRoute) && !/ownerCustomerId/.test(lotUpdate) && (invCtl.match(/ownerCustomerId/g) ?? []).length >= 2 && !/PATCH.*ownerCustomerId/.test(invCtl));
  const draft = readFileSync(path.join(ROOT, "src/services/helpers/shipment-auto-draft.helper.ts"), "utf8");
  check("§0g E4b: fatura taslağı emanet topu `warnings`e yazar (409 değil)", /ownerCustomerId !== null/.test(draft) && /warnings\.push\(`\$\{emanet\.length\} top müşterinin EMANET/.test(draft));
  const merge = readFileSync(path.join(ROOT, "src/constants/merge-map.customer.ts"), "utf8");
  check("§0h MERGE_MAP: üç modelde `ownerCustomerId` MOVE satırı", (merge.match(/column: "ownerCustomerId"/g) ?? []).length === 3);
  const invRoute = readFileSync(path.join(ROOT, "src/routes/inventory.routes.ts"), "utf8");
  const ctxAt = invRoute.indexOf('router.get("/tablet-context"');
  check("§6a G3t: `/rolls/tablet-context` `roll:write` ∨ `mobile:kk1` guard'ıyla ve `/:id`den ÖNCE kayıtlı (yoksa 'tablet-context' bir id sanılır)",
    ctxAt > 0 && ctxAt < invRoute.indexOf('router.get("/:id"') && /router\.get\("\/tablet-context", verifyToken, requireAnyPermission\("roll:write", \.\.\.MOBILE_ROLL_WRITE_KK1\)/.test(invRoute));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("=== EMANET (G3) BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...FLAGS] } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin();
  const patos = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!patos) throw new Error("Seed fixture eksik (PATOS)");
  const whId = await fixtureWarehouseId();
  const ids = { st: "", mk: "", custA: "", custB: "", custP: "", yarn: "", spec: "", lots: [] as string[], beams: [] as string[], rolls: [] as string[], wo: "", sub: "", dispatch: "" };
  const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

  try {
    console.log("\n── fikstür ──");
    const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
    ids.st = st.id;
    const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
    ids.mk = mk.id;
    const custA = await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Müşteri A` }, select: { id: true } });
    // B BİLEREK zengin (vergi no + adres): §6 tablet bağlamına SIZMAMALI. P pasif: listede olmamalı.
    const custB = await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Müşteri B`, taxNumber: "9990001113", address: `${TAG} gizli adres` }, select: { id: true } });
    const custP = await prisma.customer.create({ data: { code: `${TAG}-P`, name: `${TAG} Pasif`, isActive: false }, select: { id: true } });
    ids.custA = custA.id; ids.custB = custB.id; ids.custP = custP.id;
    const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.yarn = yarn.id;
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
    ids.spec = spec.id;
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, true);

    console.log("\n── §1 Emanet KAPALI = bayt bayt ──");
    await setFlag(SETTING_KEYS.EMANET_ENABLED, false);
    const e1a = await beklenenHata(() => inventory.createInitialEntry({ itemId: patos!.id, initialQty: 10, width: 150 }, admin.id, null, false, { ownerCustomerId: custA.id, gradeRequired: false }));
    check("§1a ⭐ KK1 owner'lı giriş → 403 MODULE_DISABLED (modul emanet), top doğmadı", kod(e1a) === "MODULE_DISABLED" && modul(e1a) === "emanet" && (await prisma.roll.count({ where: { ownerCustomerId: custA.id } })) === 0);
    const e1b = await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: custA.id }));
    check("§1b CONSIGNED levent → 403 MODULE_DISABLED", kod(e1b) === "MODULE_DISABLED" && modul(e1b) === "emanet");
    const e1c = await beklenenHata(() => lots.create({ itemId: yarn.id, lotNo: `${TAG}-L0`, ownerCustomerId: custA.id }, admin.id));
    check("§1c owner'lı lot → 403 MODULE_DISABLED, lot doğmadı", kod(e1c) === "MODULE_DISABLED" && (await prisma.yarnLot.count({ where: { itemId: yarn.id } })) === 0);
    const r0 = await inventory.createInitialEntry({ itemId: patos!.id, initialQty: 10, width: 150 }, admin.id, null, false, { gradeRequired: false });
    ids.rolls.push(r0.data.id);
    check("§1d ownersız doğum aynen (bugünkü davranış): ownerCustomerId null", (await prisma.roll.findUniqueOrThrow({ where: { id: r0.data.id }, select: { ownerCustomerId: true } })).ownerCustomerId === null);

    console.log("\n── §2 Emanet AÇIK — doğum + kalıtım ──");
    await setFlag(SETTING_KEYS.EMANET_ENABLED, true);
    const lotA = await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LA`, ownerCustomerId: custA.id }, admin.id);
    const lotB = await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LB`, ownerCustomerId: custB.id }, admin.id);
    const lotN = await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LN` }, admin.id);
    ids.lots.push(lotA.data.id, lotB.data.id, lotN.data.id);
    check("§2a lot owner A / B / yok (üçü de doğdu)", lotA.data.ownerCustomerId === custA.id && lotB.data.ownerCustomerId === custB.id && lotN.data.ownerCustomerId === null);
    // Lotlara giriş (kalıtım sarımı için bakiye) — fikstür, defter değil.
    for (const l of [lotA.data.id, lotB.data.id, lotN.data.id]) await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 300, lotId: l } });
    await prisma.yarnStock.upsert({ where: { itemId_warehouseId: { itemId: yarn.id, warehouseId: whId } }, create: { itemId: yarn.id, warehouseId: whId, balanceKg: 900 }, update: { balanceKg: { increment: 900 } } });
    const bC = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: custA.id });
    ids.beams.push(bC.data.id);
    check("§2b ⭐ CONSIGNED levent doğdu: owner A, taraflar boş", bC.data.ownerCustomerId === custA.id && bC.data.subcontractorId === null && bC.data.supplierId === null);
    check("§2c CONSIGNED + tedarikçi → 400 WARP_BEAM_ORIGIN_PARTY · CONSIGNED ownersız → 400", kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 1, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: custA.id, supplierId: custB.id }))) === "WARP_BEAM_ORIGIN_PARTY" && kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 1, originKind: WarpBeamOrigin.CONSIGNED }))) === "WARP_BEAM_ORIGIN_PARTY");
    const bIn = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
    ids.beams.push(bIn.data.id);
    const e2d = await beklenenHata(() => windWarpBeam(bIn.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: whId, qtyKg: 5, lotId: lotA.data.id }, { warehouseId: whId, qtyKg: 5, lotId: lotB.data.id }] }, admin.id));
    const bInAfter = await prisma.warpBeam.findUniqueOrThrow({ where: { id: bIn.data.id }, select: { status: true, ownerCustomerId: true } });
    check("§2d ⭐ A + B lotları karışık sarım → 409 OWNER_MISMATCH; levent PLANNED kaldı, iplik çıkışı yazılmadı (tx geri)", kod(e2d) === "OWNER_MISMATCH" && bInAfter.status === "PLANNED" && bInAfter.ownerCustomerId === null && (await prisma.yarnMovement.count({ where: { warpBeamId: bIn.data.id } })) === 0);
    await windWarpBeam(bIn.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: whId, qtyKg: 5, lotId: lotA.data.id }, { warehouseId: whId, qtyKg: 5, lotId: lotN.data.id }] }, admin.id);
    const bInWound = await prisma.warpBeam.findUniqueOrThrow({ where: { id: bIn.data.id }, select: { status: true, ownerCustomerId: true, originKind: true } });
    check("§2e ⭐ A lotu + ownersız lot sarım → levent owner A KALITTI (köken IN_HOUSE kaldı: mülkiyet ≠ köken)", bInWound.status === "READY" && bInWound.ownerCustomerId === custA.id && bInWound.originKind === "IN_HOUSE");
    const rA = await inventory.createInitialEntry({ itemId: patos!.id, initialQty: 20, width: 150 }, admin.id, null, false, { ownerCustomerId: custA.id, gradeRequired: false });
    ids.rolls.push(rA.data.id);
    check("§2f KK1 owner'lı giriş → top owner A", (await prisma.roll.findUniqueOrThrow({ where: { id: rA.data.id }, select: { ownerCustomerId: true } })).ownerCustomerId === custA.id);
    // Fason dokuma sevki fikstürü (helper'ı ölçmek için): dokuma işi + sevk + CONSIGNED leventin WARP_BEAM kalemi.
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
    ids.sub = sub.id;
    const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-DI`, itemId: patos!.id, executionKind: "SUBCONTRACTED", subcontractorId: sub.id }, select: { id: true } });
    ids.wo = wo.id;
    const d = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-FS`.slice(0, 32), weavingOrderId: wo.id, subcontractorId: sub.id, totalQty: 0, items: { create: [{ kind: "WARP_BEAM", warpBeamId: bC.data.id, dispatchedQty: 500 }] } }, select: { id: true } });
    ids.dispatch = d.id;
    check("§2g fason dokuma makbuzu kalıtımı: sevkteki CONSIGNED leventten owner A", (await prisma.$transaction((tx) => resolveOwnerFromBeamsTx(tx, wo.id))) === custA.id);

    console.log("\n── §3 Sevk sahiplik kapısı ──");
    const e3a = await beklenenHata(() => prisma.$transaction((tx) => assertOwnerMatchesTx(tx, { rollIds: [rA.data.id, r0.data.id], customerId: custB.id, belge: "sevkiyat TEST" })));
    const clash = (e3a?.details as { rolls?: Array<{ barcode: string }> } | undefined)?.rolls ?? [];
    check("§3a ⭐ [A'nın topu + ownersız top] → müşteri B: 409 OWNER_MISMATCH, YALNIZ A'nın barkodu listelenir", kod(e3a) === "OWNER_MISMATCH" && clash.length === 1 && clash[0]?.barcode === rA.data.barcode, JSON.stringify(clash));
    check("§3b müşteri A → geçer · hepsi ownersız → geçer", (await beklenenHata(() => prisma.$transaction((tx) => assertOwnerMatchesTx(tx, { rollIds: [rA.data.id, r0.data.id], customerId: custA.id, belge: "x" })))) === null && (await beklenenHata(() => prisma.$transaction((tx) => assertOwnerMatchesTx(tx, { rollIds: [r0.data.id], customerId: custB.id, belge: "x" })))) === null);

    console.log("\n── §4 DB sedleri ──");
    check("§4a CONSIGNED ownersız → 23514 · CONSIGNED + supplier → 23514",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beams (id, "beamNo", "warpSpecId", status, "plannedLengthM", "originKind", "createdAt", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X1`}, ${spec.id}::uuid, 'PLANNED', 1, 'CONSIGNED', now(), now())`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beams (id, "beamNo", "warpSpecId", status, "plannedLengthM", "originKind", "ownerCustomerId", "supplierId", "createdAt", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X2`}, ${spec.id}::uuid, 'PLANNED', 1, 'CONSIGNED', ${custA.id}::uuid, ${custB.id}::uuid, now(), now())`)) === "23514");
    check("§4b IN_HOUSE + owner → OK (mülkiyet ekseni köken ekseninden bağımsız)", bInWound.ownerCustomerId === custA.id && bInWound.originKind === "IN_HOUSE");

    console.log("\n── §5 E2b — PATCH'ten yazılamaz ──");
    const bP = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 50, originKind: WarpBeamOrigin.IN_HOUSE });
    ids.beams.push(bP.data.id);
    await updateWarpBeam(bP.data.id, { notes: "sonda", ...({ ownerCustomerId: custB.id } as object) }, admin.id);
    check("§5a `updateWarpBeam` gövdesine sızdırılan owner YAZILMAZ (doğum niteliği)", (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bP.data.id }, select: { ownerCustomerId: true } })).ownerCustomerId === null);
    await lots.update(lotN.data.id, { notes: "sonda", ...({ ownerCustomerId: custB.id } as object) }, admin.id);
    check("§5b lot `update` owner almaz — null kaldı", (await prisma.yarnLot.findUniqueOrThrow({ where: { id: lotN.data.id }, select: { ownerCustomerId: true } })).ownerCustomerId === null);

    console.log("\n── §6 G3t — KK1 tablet bağlamı (opt-in allowlist) ──");
    await setFlag(SETTING_KEYS.EMANET_ENABLED, false);
    check("§6b ⭐ emanet KAPALI → `customers: []` (kapalı kurulumda cari adı bu uçtan sızmaz)", (await getRollTabletContext()).data.customers.length === 0);
    await setFlag(SETTING_KEYS.EMANET_ENABLED, true);
    const ctx = (await getRollTabletContext()).data;
    const rowB = ctx.customers.find((c) => c.id === custB.id) as Record<string, unknown> | undefined;
    check("§6c ⭐ AÇIK: aktif cari listede, satır anahtar kümesi TAM OLARAK {id, name}; vergi no / adres cevapta YOK",
      !!rowB && Object.keys(rowB).sort().join(",") === "id,name" && ctx.customers.every((c) => Object.keys(c).sort().join(",") === "id,name") && !JSON.stringify(ctx).includes("9990001113") && !JSON.stringify(ctx).includes("gizli adres"), rowB ? Object.keys(rowB).join(",") : "satır yok");
    check("§6d pasif cari listede DEĞİL · ad sırası", !ctx.customers.some((c) => c.id === custP.id) && ctx.customers.findIndex((c) => c.id === custA.id) < ctx.customers.findIndex((c) => c.id === custB.id));
  } finally {
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(ids: { st: string; mk: string; custA: string; custB: string; custP: string; yarn: string; spec: string; lots: string[]; beams: string[]; rolls: string[]; wo: string; sub: string; dispatch: string }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  if (ids.dispatch) { await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: ids.dispatch } }); await prisma.subcontractorDispatch.deleteMany({ where: { id: ids.dispatch } }); }
  if (ids.wo) await prisma.weavingOrder.deleteMany({ where: { id: ids.wo } });
  if (ids.sub) await prisma.subcontractor.deleteMany({ where: { id: ids.sub } });
  await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beams } } });
  if (ids.yarn) { await prisma.yarnMovement.deleteMany({ where: { itemId: ids.yarn } }); await prisma.yarnStock.deleteMany({ where: { itemId: ids.yarn } }); }
  await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beams } } });
  await prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } });
  if (ids.spec) await prisma.warpSpec.deleteMany({ where: { id: ids.spec } });
  if (ids.yarn) await prisma.item.deleteMany({ where: { id: ids.yarn } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rolls } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  if (ids.mk) await prisma.machine.deleteMany({ where: { id: ids.mk } });
  if (ids.st) await prisma.station.deleteMany({ where: { id: ids.st } });
  await prisma.customer.deleteMany({ where: { id: { in: [ids.custA, ids.custB, ids.custP].filter(Boolean) } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.beams, ...ids.rolls, ...ids.lots] } } });
  for (const key of FLAGS) {
    const f = foto.find((x) => x.key === key);
    if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
