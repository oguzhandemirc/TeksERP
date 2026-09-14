// =============================================================================
// FASON SEVKİNDE İPLİK KALEMİ (G1) BEKÇİSİ — git · storno · dön · storno · türetilmiş bakiye
// =============================================================================
// Koşum: npx tsx scripts/test_subcontractor_dispatch_yarn.ts   (DB'li; TEST- fikstürü; iplik bayrağı fotoğrafa döner)
//
// Ölçer (1e hükmü 2026-09-15 H1–H5; migration 20260915020000–023000):
//   §0 statik — enum üç kalem (YARN · 4 fason türü · YARN_SUBCONTRACT_RETURN) ↔ CHECK ↔ işaret ↔ GATED iki yönlü;
//      tek yazıcı (`yarnMovement.create` yalnız yarn.service); allowlist `dispatchItemId`; dönüş/bakiye uçları
//      `requireIplikEnabled`; gövde kapısı iki controller'da; `totalQty` §19 `kind<>'YARN'`; beyan çiftleri
//   §1 fikstür — iplik kartı + lot + IN 100 kg
//   §2 ROLL yolu bayt bayt (iplik satırı yokken kalem/totalQty/yarnItems boş)
//   §3 iplik sevki — kalem kind=YARN (yarnItemId+warehouseId+lotId, dispatchedQty=kg, dispatchedWeight null);
//      SUBCONTRACT_OUT −kg (lot bakiyesi düşer); `totalQty` metre (kg GİRMEZ), `yarnTotalKg` ayrı; DTO `unit:"KG"`;
//      `yarnItems` `items`e girmez; lot bakiyesini aşan çıkış 409 (YARN_LOT_BALANCE_EXCEEDED); kalem başına tek OUT (23505)
//   §4 dönüş — kısmi, +kg; sebep kodu ZORUNLU (geçersiz 400 REASON_CODE_INVALID; DB 23514); Σ ≤ giden (400
//      YARN_RETURN_EXCEEDS); depo seçilebilir (H2); dönmüş kalemli sevk iptali 409 (LIFO, iki hat); dönüş stornosu
//      −kg; ikinci storno 409 YARN_RETURN_NOT_OPEN; bakiye türetimi (`yarnAtSubcontractor`) her adımda doğru
//   §5 sevk iptali — SUBCONTRACT_OUT_CANCEL +kg (aynı depo/lot), bakiye satırı düşer
//   §6 DB sedleri — kind_ref_ck üç kol (ROLL/WARP_BEAM kolları aynen) · fason_link_ck iki yönlü · dönüş sebep CHECK
//   §7 iplik KAPALI — YARN satırı 403 MODULE_DISABLED (modul iplik) + sevk satırı geri alındı; ROLL sevki bayt bayt;
//      dönüş ucu servis düzeyinde 403
//   §8 G1c SARILAN LEVENT — fasona sardırılan leventin WOUND olayı iplik kalemine bağlanır (`dispatchItemId`);
//      bakiyede `sarilanKg` ayrı kalem (nominal, kaynak beyanlı), kalem DTO'sunda `sarilan[]`; kapılar: IN_HOUSE 400
//      WARP_YARN_ITEM_ORIGIN · başka fasoncu 400 WARP_YARN_ITEM_MISMATCH · YARN olmayan kalem 400 · sarım stornosu
//      bakiyeden düşer; DB: WOUND bağlı OK, WOUND_CANCEL bağlı 23514, fason türü bağsız 23514 (kol korunur)
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-15):
//   · `yarn-sign.helper` SUBCONTRACT_OUT işareti −1 → +1 → §0e + §3c/§3d/§4 bakiye satırları ❌
//   · `dispatchYarnItemsTx`ten `applyYarnMovementTx` çağrısı düşürülünce §3c ❌ (kalem var defter yok)
//   · `returnYarn` Σ≤giden kapısı düşürülünce §4c ❌
//   · G1c (2026-09-15): `assertYarnDispatchItemTx` fasoncu eşleşmesi düşürülünce §8c ❌ · bakiyede `reversal: null`
//     süzgeci düşürülünce §8e ❌ (storno edilmiş sarım hâlâ düşülür)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. İplik bayrağı FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, RollStatus, StationType, SubcontractorDispatchItemKind, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { yarnMovementSign } from "../src/services/helpers/yarn-sign.helper";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { yarnLotBalanceTx } from "../src/services/helpers/yarn-lot.helper";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { warpTheoreticalKg } from "../src/constants/warp-beam";
import { cancelYarnReturn, returnYarn, yarnAtSubcontractor } from "../src/services/subcontractor-yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
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
async function pgHata(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "geçti"; } catch (e) {
    const m = /\b(23\d{3})\b/.exec(String((e as Error).message ?? e));
    return m?.[1] ?? "başka";
  }
}

const ROOT = path.join(__dirname, "..");
const TAG = `TEST-FY-${Date.now().toString(36)}`;
const svc = new SubcontractorService();
const FASON4 = ["SUBCONTRACT_OUT", "SUBCONTRACT_OUT_CANCEL", "SUBCONTRACT_RETURN", "SUBCONTRACT_RETURN_CANCEL"] as const;

function statik(): void {
  console.log("── §0 Statik ──");
  const mig = readFileSync(path.join(ROOT, "prisma/migrations/20260915023000_fason_yarn_items/migration.sql"), "utf8");
  const linkCk = /yarn_movements_fason_link_ck" CHECK \(\s*\("kind" IN \(([^)]*)\)\) = \("dispatchItemId" IS NOT NULL\)/.exec(mig);
  const ckList = (linkCk?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  check("§0a fason türleri ↔ fason_link_ck İKİ YÖNLÜ eşit (4 tür)", JSON.stringify(ckList) === JSON.stringify([...FASON4].sort()), ckList.join(","));
  check("§0b kind_ref_ck ÜÇ KOL — ROLL/WARP_BEAM kolları levent/iplik bağını dışlıyor, YARN kolu kalem+depo ister",
    /"kind" = 'ROLL'\s+AND "rollId" IS NOT NULL AND "warpBeamId" IS NULL AND "yarnItemId" IS NULL/.test(mig) && /"kind" = 'YARN'\s+AND "yarnItemId" IS NOT NULL AND "warehouseId" IS NOT NULL AND "rollId" IS NULL AND "warpBeamId" IS NULL/.test(mig));
  const migEnum = readFileSync(path.join(ROOT, "prisma/migrations/20260915021000_yarn_movement_kind_subcontract/migration.sql"), "utf8");
  const migEnumKod = migEnum.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  check("§0c dört tür ADD VALUE IF NOT EXISTS (55P04; yorum dışı başka ifade yok)", FASON4.every((k) => new RegExp(`ADD VALUE IF NOT EXISTS '${k}'`).test(migEnumKod)) && !/INSERT|UPDATE|CHECK|CREATE/.test(migEnumKod));
  const guard = readFileSync(path.join(ROOT, "src/services/helpers/yarn-balance-guard.helper.ts"), "utf8");
  const gated = /GATED_KINDS = new Set<YarnMovementKind>\(\[([\s\S]*?)\]\)/.exec(guard)?.[1] ?? "";
  check("§0d eksi bakiye kapısı: bakiyeyi DÜŞÜREN iki fason türü kapılı, artıran ikisi değil",
    /SUBCONTRACT_OUT\b/.test(gated) && /SUBCONTRACT_RETURN_CANCEL/.test(gated) && !/SUBCONTRACT_OUT_CANCEL/.test(gated) && !/YarnMovementKind\.SUBCONTRACT_RETURN,/.test(gated));
  check("§0e işaret tablosu: OUT −1 · OUT_CANCEL +1 · RETURN +1 · RETURN_CANCEL −1 (depo bakiyesi; fasondaki tersi)",
    yarnMovementSign(YarnMovementKind.SUBCONTRACT_OUT) === -1 && yarnMovementSign(YarnMovementKind.SUBCONTRACT_OUT_CANCEL) === 1 && yarnMovementSign(YarnMovementKind.SUBCONTRACT_RETURN) === 1 && yarnMovementSign(YarnMovementKind.SUBCONTRACT_RETURN_CANCEL) === -1);
  const ySvc = readFileSync(path.join(ROOT, "src/services/subcontractor-yarn.service.ts"), "utf8");
  const yarnSvc = readFileSync(path.join(ROOT, "src/services/yarn.service.ts"), "utf8");
  check("§0f tek yazıcı: fason iplik servisi `yarnMovement.create` çağırmaz, `applyYarnMovementTx` kullanır; allowlist `dispatchItemId` taşır",
    !/yarnMovement\.create\(/.test(ySvc) && /applyYarnMovementTx\(/.test(ySvc) && /dispatchItemId: input\.dispatchItemId \?\? null/.test(yarnSvc));
  const routes = readFileSync(path.join(ROOT, "src/routes/subcontractor.routes.ts"), "utf8");
  const ucKapili = (yol: string) => { const i = routes.indexOf(`"${yol}"`); if (i < 0) return false; const blok = routes.slice(i, routes.indexOf(");", i)); return blok.indexOf("requireIplikEnabled") > 0 && blok.indexOf("requireIplikEnabled") < blok.indexOf("controller."); };
  check("§0g iplik dönüş/storno/bakiye uçları `requireIplikEnabled` taşır (controller'dan önce)", ucKapili("/dispatches/:id/yarn-items/:itemId/return") && ucKapili("/dispatches/:id/yarn-items/:itemId/return-cancel") && ucKapili("/:subcontractorId/yarn-balance"));
  const ctl = readFileSync(path.join(ROOT, "src/controllers/subcontractor.controller.ts"), "utf8");
  const wRoutes = readFileSync(path.join(ROOT, "src/routes/subcontractor-weaving.routes.ts"), "utf8");
  check("§0h gövde kapısı iki sevk yolunda: `yarnLines` dolu ∧ iplik kapalı → 403 (iş emri + dokuma işi)",
    /yarnLines\?\.length \?\? 0\) > 0 && !\(await readIplikEnabled\(\)\)/.test(ctl) && /yarnLines\?\.length \?\? 0\) > 0 && !\(await readIplikEnabled\(\)\)/.test(wRoutes));
  const cons = readFileSync(path.join(ROOT, "scripts/consistency-check.sql"), "utf8");
  check("§0i consistency §19 `totalQty` = Σ kalem yüklemi YARN'ı dışlıyor (`kind<>'YARN'`)", /sdi\.kind <> 'YARN'/.test(cons));
  const beyan = readFileSync(path.join(ROOT, "scripts/lib/defter-beyan.ts"), "utf8");
  check("§0j defter-beyan KARSI_OLAY iki yeni çift", /\["SUBCONTRACT_OUT", "SUBCONTRACT_OUT_CANCEL"\]/.test(beyan) && /\["SUBCONTRACT_RETURN", "SUBCONTRACT_RETURN_CANCEL"\]/.test(beyan));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("=== FASON İPLİK KALEMİ (G1) BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, select: { value: true } });
  const devereFoto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, select: { value: true } });
  const patos = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!patos) throw new Error("Seed fixture eksik (PATOS)");
  const admin = await ensureTestAdmin();
  const whId = await fixtureWarehouseId();
  const ids = { st: "", sub: "", sub2: "", yarn: "", lot: "", wh2: "", spec: "", beamIds: [] as string[], woIds: [] as string[], rollIds: [] as string[], dispatchIds: [] as string[] };
  const sevkKaydet = (r: { data: unknown }): string => { const id = (r.data as { id: string }).id; if (!ids.dispatchIds.includes(id)) ids.dispatchIds.push(id); return id; };
  // Beklenmedik BAŞARI da temizliğe girer: sonda kapıyı düşürürse sevk doğar, kayıtsız kalırsa WO silinemez ve kalıntı büyür (ölçüldü 2026-09-15).
  const sevkHatasi = async (fn: () => Promise<{ data: unknown }>): Promise<AppError | null> => beklenenHata(async () => sevkKaydet(await fn()));
  const hareketler = (dispatchItemId: string) => prisma.yarnMovement.findMany({ where: { dispatchItemId }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, qtyKg: true, warehouseId: true, lotId: true, reasonCode: true } });
  const lotBakiye = () => prisma.$transaction((tx) => yarnLotBalanceTx(tx, ids.lot, whId)).then(Number);
  const depoBakiye = async () => Number((await prisma.yarnStock.findUnique({ where: { itemId_warehouseId: { itemId: ids.yarn, warehouseId: whId } } }))?.balanceKg ?? 0);
  async function yeniWo(n: string) {
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: patos!.id, steps: { create: [{ stationId: ids.st, stepSequence: 1, status: "PENDING" }] } }, include: { steps: true } });
    ids.woIds.push(wo.id);
    return { woId: wo.id, stepId: wo.steps[0].id };
  }
  async function yeniTop(n: string, qty: number): Promise<string> {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${n}`, itemId: patos!.id, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: whId, width: 250 }, select: { id: true } });
    ids.rollIds.push(r.id);
    return r.id;
  }

  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, create: { key: SETTING_KEYS.IPLIK_ENABLED, value: "true" }, update: { value: "true" } });
    await reconcileReasonPresets(); // YARN_SUBCONTRACT_RETURN kataloğu (KALAN_IPLIK · KALITE · IPTAL) boot uzlaştırmasıyla doğar
    console.log("\n── §1 Fikstür ──");
    const st = await prisma.station.create({ data: { name: `${TAG}-BOYA`, code: `${TAG}-BY`.slice(0, 32), type: StationType.EXTERNAL }, select: { id: true } });
    ids.st = st.id;
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
    ids.sub = sub.id;
    const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.yarn = yarn.id;
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L1` }, select: { id: true } });
    ids.lot = lot.id;
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 100, lotId: lot.id, reason: `${TAG} giriş` }));
    check("§1 iplik kartı + lot + IN 100 kg (lot bakiyesi 100)", (await lotBakiye()) === 100 && (await prisma.reasonPreset.count({ where: { kind: "YARN_SUBCONTRACT_RETURN", isActive: true } })) >= 3);
    const depo0 = await depoBakiye();

    console.log("\n── §2 ROLL yolu değişmedi ──");
    const w1 = await yeniWo("W1");
    const r1 = await yeniTop("1", 100);
    const d1 = sevkKaydet(await svc.dispatch({ workOrderId: w1.woId, stepId: w1.stepId, subcontractorId: sub.id, rollIds: [r1] }, admin.id));
    const d1Dto = (await svc.getDispatch(d1)).data as { items: Array<{ kind: string }>; yarnItems: unknown[]; yarnTotalKg: number; totalQty: unknown };
    check("§2a top-yalnız sevk: tek ROLL kalemi, `yarnItems` boş, `yarnTotalKg` 0, totalQty 100 m, iplik defteri dokunulmadı",
      d1Dto.items.length === 1 && d1Dto.items[0].kind === "ROLL" && d1Dto.yarnItems.length === 0 && d1Dto.yarnTotalKg === 0 && Number(d1Dto.totalQty) === 100 && (await lotBakiye()) === 100);

    console.log("\n── §3 İplik sevki ──");
    const w2 = await yeniWo("W2");
    const r2 = await yeniTop("2", 50);
    const asim = await sevkHatasi(() => svc.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: sub.id, rollIds: [], yarnLines: [{ itemId: yarn.id, warehouseId: whId, lotId: lot.id, qtyKg: 150 }] }, admin.id));
    check("§3a lot bakiyesini aşan çıkış 409 YARN_LOT_BALANCE_EXCEEDED — sevk satırı geri alındı", kod(asim) === "YARN_LOT_BALANCE_EXCEEDED" && (await prisma.subcontractorDispatch.count({ where: { workOrderId: w2.woId } })) === 0);
    const d2 = sevkKaydet(await svc.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: sub.id, rollIds: [r2], yarnLines: [{ itemId: yarn.id, warehouseId: whId, lotId: lot.id, qtyKg: 60 }] }, admin.id));
    const d2Items = await prisma.subcontractorDispatchItem.findMany({ where: { dispatchId: d2 }, orderBy: { createdAt: "asc" } });
    const yItem = d2Items.find((i) => i.kind === SubcontractorDispatchItemKind.YARN)!;
    check("§3b ⭐ kalem kind=YARN: yarnItemId+warehouseId+lotId, dispatchedQty 60 (kg), dispatchedWeight null, roll/beam null",
      !!yItem && yItem.yarnItemId === yarn.id && yItem.warehouseId === whId && yItem.lotId === lot.id && Number(yItem.dispatchedQty) === 60 && yItem.dispatchedWeight === null && yItem.rollId === null && yItem.warpBeamId === null);
    const h3 = await hareketler(yItem.id);
    check("§3c ⭐ SUBCONTRACT_OUT satırı kaleme bağlı; lot bakiyesi 100→40, depo −60", h3.length === 1 && h3[0].kind === "SUBCONTRACT_OUT" && Number(h3[0].qtyKg) === 60 && h3[0].lotId === lot.id && (await lotBakiye()) === 40 && (await depoBakiye()) === depo0 - 60);
    const d2Row = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2 }, select: { totalQty: true } });
    const d2Dto = (await svc.getDispatch(d2, { includeBeams: true })).data as { items: Array<{ kind: string }>; yarnItems: Array<{ unit: string; dispatchedKg: number; remainingKg: number; item: { code: string } }>; yarnTotalKg: number };
    check("§3d ⭐ H1: `totalQty` = 50 m (kg GİRMEZ), `yarnTotalKg` 60 ayrı; DTO `unit:\"KG\"`; iplik kalemi `items`e girmez (includeBeams=1 dahil)",
      Number(d2Row.totalQty) === 50 && d2Dto.yarnTotalKg === 60 && d2Dto.yarnItems.length === 1 && d2Dto.yarnItems[0].unit === "KG" && d2Dto.yarnItems[0].remainingKg === 60 && d2Dto.items.every((i) => i.kind !== "YARN"));
    check("§3e kalem başına TEK çıkış → 23505 (partial unique)", (await pgHata(() => prisma.$executeRaw`INSERT INTO yarn_movements (id, "itemId", "warehouseId", kind, "qtyKg", "dispatchItemId") VALUES (gen_random_uuid(), ${yarn.id}::uuid, ${whId}::uuid, 'SUBCONTRACT_OUT', 1, ${yItem.id}::uuid)`)) === "23505");
    const bak3 = (await yarnAtSubcontractor(sub.id)).data;
    check("§3f K1(b) türetilmiş bakiye: fasonda 60 kg (kalem × lot), satır yazılmadı (sanal depo yok)", bak3.length === 1 && bak3[0].remainingKg === 60 && bak3[0].lotId === lot.id && (await prisma.yarnStock.count({ where: { itemId: yarn.id } })) === 1);

    console.log("\n── §4 Dönüş ──");
    check("§4a geçersiz sebep kodu 400 REASON_CODE_INVALID", kod(await beklenenHata(() => returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 10, reasonCode: "YOK_BOYLE" }, admin.id))) === "REASON_CODE_INVALID");
    const ret1 = await returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 20, reasonCode: "KALAN_IPLIK" }, admin.id);
    check("§4b ⭐ kısmi dönüş 20 kg: SUBCONTRACT_RETURN +kg, lot 40→60, kalan 40", ret1.data.remainingKg === 40 && (await lotBakiye()) === 60 && (await hareketler(yItem.id)).at(-1)?.kind === "SUBCONTRACT_RETURN");
    check("§4c ⭐ Σdönüş > giden → 400 YARN_RETURN_EXCEEDS (20 + 41 > 60)", kod(await beklenenHata(() => returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 41, reasonCode: "KALITE" }, admin.id))) === "YARN_RETURN_EXCEEDS");
    check("§4d dönmüş kalemli sevk iptali 409 (LIFO, tx-dışı sinyal)", (await beklenenHata(() => svc.cancel(d2, `${TAG} iptal`, admin.id)))?.statusCode === 409);
    const bak4 = (await yarnAtSubcontractor(sub.id)).data;
    check("§4e bakiye türetimi: fasonda 40 (60 − 20)", bak4[0]?.remainingKg === 40 && bak4[0]?.returnedKg === 20);
    const rc = await cancelYarnReturn(d2, { dispatchItemId: yItem.id, movementId: ret1.data.movementId, reason: `${TAG} yanlış kg` }, admin.id);
    check("§4f dönüş stornosu: SUBCONTRACT_RETURN_CANCEL −kg, lot 60→40, kalan 60", rc.data.remainingKg === 60 && (await lotBakiye()) === 40 && (await hareketler(yItem.id)).at(-1)?.kind === "SUBCONTRACT_RETURN_CANCEL");
    check("§4g ikinci storno 409 YARN_RETURN_NOT_OPEN", kod(await beklenenHata(() => cancelYarnReturn(d2, { dispatchItemId: yItem.id, movementId: ret1.data.movementId, reason: "tekrar" }, admin.id))) === "YARN_RETURN_NOT_OPEN");
    const wh2 = await prisma.warehouse.create({ data: { code: `${TAG}-D2`.slice(0, 32), name: `${TAG} depo 2` }, select: { id: true } });
    const ret2 = await returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 15, reasonCode: "KALITE", warehouseId: wh2.id }, admin.id);
    const d2Bak = Number((await prisma.yarnStock.findUnique({ where: { itemId_warehouseId: { itemId: yarn.id, warehouseId: wh2.id } } }))?.balanceKg ?? 0);
    check("§4h H2: dönüş başka depoya (15 kg) — o depoda +15, lot bakiyesi orada", ret2.data.remainingKg === 45 && d2Bak === 15);
    await cancelYarnReturn(d2, { dispatchItemId: yItem.id, movementId: ret2.data.movementId, reason: `${TAG} geri` }, admin.id);
    ids.wh2 = wh2.id; // ikinci depo ve defter satırları `temizle`de (teardown), satır içi silme YOK (§10b2)

    console.log("\n── §5 Sevk iptali ──");
    await svc.cancel(d2, `${TAG} iptal`, admin.id);
    const h5 = await hareketler(yItem.id);
    check("§5a ⭐ iptal: SUBCONTRACT_OUT_CANCEL aynı depo/lot, 60 kg; lot 40→100; kalem SİLİNMEDİ", h5.at(-1)?.kind === "SUBCONTRACT_OUT_CANCEL" && Number(h5.at(-1)?.qtyKg) === 60 && h5.at(-1)?.lotId === lot.id && (await lotBakiye()) === 100 && (await prisma.subcontractorDispatchItem.count({ where: { id: yItem.id } })) === 1);
    check("§5b iptal edilmiş sevk türetilmiş bakiyeye GİRMEZ", (await yarnAtSubcontractor(sub.id)).data.length === 0);
    check("§5c iptal edilmiş sevke dönüş 409 DISPATCH_CANCELLED", kod(await beklenenHata(() => returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 1, reasonCode: "IPTAL" }, admin.id))) === "DISPATCH_CANCELLED");

    console.log("\n── §6 DB sedleri ──");
    check("§6a YARN kalemi depo/kalemsiz → 23514 · ROLL kalemi yarnItemId dolu → 23514",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatch_items (id, "dispatchId", kind, "dispatchedQty") VALUES (gen_random_uuid(), ${d2}::uuid, 'YARN', 1)`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatch_items (id, "dispatchId", kind, "rollId", "yarnItemId", "dispatchedQty") VALUES (gen_random_uuid(), ${d2}::uuid, 'ROLL', ${r2}::uuid, ${yarn.id}::uuid, 1)`)) === "23514");
    check("§6b fason türü kalem bağsız → 23514 · IN kalem bağlı → 23514 (iki yönlü)",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO yarn_movements (id, "itemId", "warehouseId", kind, "qtyKg") VALUES (gen_random_uuid(), ${yarn.id}::uuid, ${whId}::uuid, 'SUBCONTRACT_RETURN', 1)`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO yarn_movements (id, "itemId", "warehouseId", kind, "qtyKg", "dispatchItemId") VALUES (gen_random_uuid(), ${yarn.id}::uuid, ${whId}::uuid, 'IN', 1, ${yItem.id}::uuid)`)) === "23514");
    check("§6c dönüş sebep kodsuz → 23514", (await pgHata(() => prisma.$executeRaw`INSERT INTO yarn_movements (id, "itemId", "warehouseId", kind, "qtyKg", "dispatchItemId") VALUES (gen_random_uuid(), ${yarn.id}::uuid, ${whId}::uuid, 'SUBCONTRACT_RETURN', 1, ${yItem.id}::uuid)`)) === "23514");

    console.log("\n── §8 G1c sarılan levent ──");
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, create: { key: SETTING_KEYS.DEVERE_ENABLED, value: "true" }, update: { value: "true" } });
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
    ids.spec = spec.id;
    const sub2 = await prisma.subcontractor.create({ data: { code: `${TAG}-F2`, name: `${TAG} başka fasoncu` }, select: { id: true } });
    ids.sub2 = sub2.id;
    const w8 = await yeniWo("W8");
    const d8 = sevkKaydet(await svc.dispatch({ workOrderId: w8.woId, stepId: w8.stepId, subcontractorId: sub.id, rollIds: [], yarnLines: [{ itemId: yarn.id, warehouseId: whId, lotId: lot.id, qtyKg: 50 }] }, admin.id));
    const y8 = (await prisma.subcontractorDispatchItem.findFirstOrThrow({ where: { dispatchId: d8, kind: SubcontractorDispatchItemKind.YARN }, select: { id: true } })).id;
    const levent = async (fasoncu: string | null, origin: WarpBeamOrigin) => {
      const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: origin, subcontractorId: fasoncu });
      ids.beamIds.push(p.data.id);
      return p.data.id;
    };
    const b1 = await levent(sub.id, WarpBeamOrigin.SUBCONTRACT);
    const wound = await windWarpBeam(b1, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL, dispatchItemId: y8 }, admin.id);
    const nominal = Number(warpTheoreticalKg(3000, 300, 500)); // 3000 × 300 × 500 / 9e6 = 50 kg
    const ev8 = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b1, kind: "WOUND" }, select: { dispatchItemId: true, theoreticalKg: true } });
    check("§8a ⭐ WOUND olayı iplik kalemine bağlı, nominal kg 50 (3000 tel × 300 dn × 500 m / 9e6)", wound.data.status === "READY" && ev8.dispatchItemId === y8 && Number(ev8.theoreticalKg) === nominal && nominal === 50);
    const bak8 = (await yarnAtSubcontractor(sub.id)).data.find((r) => r.lotId === lot.id)!;
    check("§8b ⭐ bakiye: çıkış 50 · sarılan 50 (THEORETICAL beyanlı) · kalan 0 — sarılan AYRI kalem, tahmin değil", bak8.outKg === 50 && bak8.sarilanKg === 50 && bak8.sarilanKaynak === "THEORETICAL" && bak8.remainingKg === 0);
    const dto8 = (await svc.getDispatch(d8)).data as { yarnItems: Array<{ sarilanKg: number; sarilan: Array<{ beamNo: string; kaynak: string | null }>; remainingKg: number }> };
    check("§8b′ kalem DTO'su `sarilan[]` levent no + kaynak taşır, kalan 0", dto8.yarnItems[0]?.sarilanKg === 50 && dto8.yarnItems[0]?.sarilan.length === 1 && dto8.yarnItems[0]?.sarilan[0]?.kaynak === "THEORETICAL" && dto8.yarnItems[0]?.remainingKg === 0);
    const b2 = await levent(sub2.id, WarpBeamOrigin.SUBCONTRACT);
    check("§8c ⭐ başka fasoncunun leventi → 400 WARP_YARN_ITEM_MISMATCH (levent PLANNED kalır)", kod(await beklenenHata(() => windWarpBeam(b2, { lengthM: 10, kgSource: WarpKgSource.THEORETICAL, dispatchItemId: y8 }, admin.id))) === "WARP_YARN_ITEM_MISMATCH" && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: b2 }, select: { status: true } })).status === "PLANNED");
    const b3 = await levent(null, WarpBeamOrigin.IN_HOUSE);
    check("§8d IN_HOUSE levent bağ ister → 400 WARP_YARN_ITEM_ORIGIN · ROLL/yok kalem → 400 WARP_YARN_ITEM_NOT_FOUND",
      kod(await beklenenHata(() => windWarpBeam(b3, { lengthM: 10, kgSource: WarpKgSource.THEORETICAL, machineId: null, yarnIssues: [{ warehouseId: whId, qtyKg: 1 }], dispatchItemId: y8 }, admin.id))) === "WARP_YARN_ITEM_ORIGIN" &&
      kod(await beklenenHata(() => windWarpBeam(b2, { lengthM: 10, kgSource: WarpKgSource.THEORETICAL, dispatchItemId: r2 }, admin.id))) === "WARP_YARN_ITEM_NOT_FOUND");
    await cancelWound(b1, `${TAG} yanlış sarım`, admin.id);
    const bak8e = (await yarnAtSubcontractor(sub.id)).data.find((r) => r.lotId === lot.id)!;
    check("§8e ⭐ sarım stornosu (WOUND_CANCEL) → sarılan bakiyeden DÜŞER (kalan yeniden 50, kaynak null)", bak8e.sarilanKg === 0 && bak8e.remainingKg === 50 && bak8e.sarilanKaynak === null);
    check("§8f DB: WOUND_CANCEL kalem bağlı → 23514 (yalnız WOUND açıldı) · fason türü bağsız → 23514 (kol korunur)",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus", "dispatchItemId") VALUES (gen_random_uuid(), ${b1}::uuid, 'WOUND_CANCEL', 'READY', 'CANCELLED', ${y8}::uuid)`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus", "lengthM") VALUES (gen_random_uuid(), ${b1}::uuid, 'SHIP_OUT', 'READY', 'SHIPPED_OUT', 1)`)) === "23514");
    await svc.cancel(d8, `${TAG} iptal`, admin.id);

    console.log("\n── §7 İplik kapalı ──");
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, data: { value: "false" } });
    const w7 = await yeniWo("W7");
    const kapali = await sevkHatasi(() => svc.dispatch({ workOrderId: w7.woId, stepId: w7.stepId, subcontractorId: sub.id, rollIds: [], yarnLines: [{ itemId: yarn.id, warehouseId: whId, qtyKg: 5 }] }, admin.id));
    check("§7a ⭐ ikinci hat: servis düzeyinde 403 MODULE_DISABLED (modul iplik) — sevk satırı geri alındı, defter dokunulmadı",
      kod(kapali) === "MODULE_DISABLED" && (kapali?.details as { modul?: string })?.modul === "iplik" && (await prisma.subcontractorDispatch.count({ where: { workOrderId: w7.woId } })) === 0 && (await lotBakiye()) === 100);
    const r7 = await yeniTop("7", 30);
    const d7 = sevkKaydet(await svc.dispatch({ workOrderId: w7.woId, stepId: w7.stepId, subcontractorId: sub.id, rollIds: [r7] }, admin.id));
    check("§7b ⭐ iplik kapalıyken ROLL sevki bayt bayt (tek ROLL kalemi, yarnItems boş)", ((await svc.getDispatch(d7)).data as { yarnItems: unknown[]; items: unknown[] }).yarnItems.length === 0 && ((await svc.getDispatch(d7)).data as { items: unknown[] }).items.length === 1);
    check("§7c dönüş ucu servis düzeyinde de kapalı → 403", kod(await beklenenHata(() => returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 1, reasonCode: "IPTAL" }, admin.id))) === "MODULE_DISABLED" || kod(await beklenenHata(() => returnYarn(d2, { dispatchItemId: yItem.id, qtyKg: 1, reasonCode: "IPTAL" }, admin.id))) === "DISPATCH_CANCELLED");
  } finally {
    await temizle(ids, foto, devereFoto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(ids: { st: string; sub: string; sub2: string; yarn: string; lot: string; wh2: string; spec: string; beamIds: string[]; woIds: string[]; rollIds: string[]; dispatchIds: string[] }, foto: { value: Prisma.JsonValue } | null, devereFoto: { value: Prisma.JsonValue } | null): Promise<void> {
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: ids.dispatchIds } } });
  await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beamIds } } });
  if (ids.yarn) {
    await prisma.yarnMovement.deleteMany({ where: { itemId: ids.yarn } });
    await prisma.yarnStock.deleteMany({ where: { itemId: ids.yarn } });
  }
  if (ids.wh2) await prisma.warehouse.deleteMany({ where: { id: ids.wh2 } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: ids.dispatchIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatchIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rollIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.woIds } } });
  await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beamIds } } });
  if (ids.spec) await prisma.warpSpec.deleteMany({ where: { id: ids.spec } });
  if (ids.sub2) await prisma.subcontractor.deleteMany({ where: { id: ids.sub2 } });
  if (ids.lot) await prisma.yarnLot.deleteMany({ where: { id: ids.lot } });
  if (ids.yarn) await prisma.item.deleteMany({ where: { id: ids.yarn } });
  if (ids.sub) await prisma.subcontractor.deleteMany({ where: { id: ids.sub } });
  if (ids.st) await prisma.station.deleteMany({ where: { id: ids.st } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.dispatchIds, ...ids.woIds, ...ids.beamIds] } } });
  if (foto) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, data: { value: foto.value as Prisma.InputJsonValue } });
  else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.IPLIK_ENABLED } });
  if (devereFoto) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, data: { value: devereFoto.value as Prisma.InputJsonValue } });
  else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_ENABLED } });
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
