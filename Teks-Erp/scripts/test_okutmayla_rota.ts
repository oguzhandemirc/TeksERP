// =============================================================================
// Okutmayla (esnek) rota — K29 (Gülkesim 2026-11-03; ayar `production.routeMode`)
// =============================================================================
// Kilitlenen:
//   §0 Ayar: varsayılan SEQUENTIAL + SELECTED; bilinmeyen değer 400; SIRALI'da kart çözümü BAYT-AYNI (kapı null),
//      SCAN'de izinsiz istasyon (SELECTED + anahtar kapalı) da bayt-aynı
//   §a Var olan adım: topların durduğu istasyonda okutma bugünkü çözüm (OPEN_EXISTING)
//   §b Olmayan istasyon: by-card 400 SCAN_ROUTE_AVAILABLE (INSERT); uygula → adım eklenir (addedVia=SCAN, okutan),
//      top taşınır, S10 varsayılan hedefi eklenir
//   §c İleri istasyon: aradaki bekleyenler ATLANDI (satır yerinde, skipReason SCAN_SKIP), olay defterine SCAN_SKIP,
//      kaynak kuyruk hareketi geri alınır
//   §d Açık iş başka istasyonda: 409 SCAN_ROUTE_OPEN_ELSEWHERE (closable); "bitmiş say ve geç" → geçer
//   §d2 "Bitmiş say ve geç" adım kapatma yetkisi ister (quality:write | mobile:kk2-kursun), yoksa 403
//   §k ATLANDI ara adım: finish/reopen/reopenPreview aynı "sonraki adım" (nextLiveStep) → yeniden açma çalışır
//   §e Atlanamaz istasyon: 409 SCAN_ROUTE_MANDATORY_STEP, hiçbir şey yazılmaz
//   §f Aynı okutma tekrarı (aynı clientToken) ikinci adım eklemez; yeni tokenla tekrar NOOP
//   §g İki eşzamanlı okutma → TEK ekleme
//   §h Atlanan kurşun adımı faturaya/maliyete girmez (resolveServiceItemsForRolls boş)
//   §r Rotasız İE: SIRALI'da 400; SCAN'de adımsız açılır, top partide bekler, ilk okutma adımı ekler
//   §s S15b: HTTP quick-start gövdesi `scanRouted` (Zod allowlist) SCAN→rotasız, SIRALI→400; rota+rotasız 400;
//      açık iş listesi (Kurşun/KK + Tambur) rotasız İE'yi YALNIZ includeScanRouted ile döner (eski APK bayt-aynı),
//      izinsiz istasyonda yok, bu istasyonda adımı olan İE tekrar etmez; seçilen satır apply ile adım ekler;
//      önizleme canClose = guard ile aynı izin (quality:write | mobile:kk2-kursun)
//
// Koşum: npx tsx scripts/test_okutmayla_rota.ts
// =============================================================================
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { Prisma, RollForm, RollOperationType, RollStatus, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { WorkOrderController } from "../src/controllers/workorder.controller";
import { WorkOrderService } from "../src/services/workorder.service";
import { applyScanRoute, gateByCard, previewScanRoute } from "../src/services/workorder-scan-route.service";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { SETTING_KEYS, readProductionRouteMode, readProductionScanRouteStations, systemSettingService } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
interface Err { status: number; code: string | null; message: string; details: Record<string, unknown> | null }
async function errOf(fn: () => Promise<unknown>): Promise<Err> {
  try { await fn(); return { status: 200, code: null, message: "", details: null }; } catch (e) {
    const x = e as { statusCode?: number; message?: string; details?: Record<string, unknown> & { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null, message: x.message ?? "", details: x.details ?? null };
  }
}
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try { return JSON.stringify({ ok: await fn() }); } catch (e) {
    const x = e as { statusCode?: number; message?: string; details?: unknown };
    return JSON.stringify({ status: x.statusCode, message: x.message, details: x.details });
  }
}

const qc = new KursunQcService();
const wos = new WorkOrderService();
const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-OKR-${STAMP}`;
const KEYS = [SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.PRODUCTION_SCAN_ROUTE_STATIONS] as const;
const fx = {
  woIds: [] as string[], rollIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[],
  propIds: [] as string[], valueIds: [] as string[],
  settings: new Map<string, { value: unknown } | null>(),
};

async function setKey(key: string, v: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v, description: "TEST — okutmayla rota" }, update: { value: v } });
}

interface Ctx { itemId: string; actor: string }
interface Job { woId: string; card: string; steps: string[]; rollIds: string[] }

/** Rota: `stations` sırasıyla; ilk adım ACTIVE ve toplar orada (açık kuyruk hareketiyle), diğerleri PENDING. */
async function makeJob(ctx: Ctx, tag: string, stations: string[], rollCount = 2): Promise<Job> {
  const number = `${P}-${tag}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: ctx.itemId,
      steps: { create: stations.map((stationId, i) => ({ stationId, stepSequence: i + 1, status: i === 0 ? StepStatus.ACTIVE : StepStatus.PENDING })) },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  fx.woIds.push(wo.id);
  const first = wo.steps[0]!.id;
  await prisma.travelerCard.create({ data: { cardNumber: number, barcode: number, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
  const rollIds: string[] = [];
  for (let i = 0; i < rollCount; i++) {
    const roll = await prisma.roll.create({
      data: { barcode: null, itemId: ctx.itemId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: first, producedInStepId: first, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK },
      select: { id: true },
    });
    fx.rollIds.push(roll.id);
    rollIds.push(roll.id);
    await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: first, qtyIn: 100 } });
  }
  return { woId: wo.id, card: number, steps: wo.steps.map((s) => s.id), rollIds };
}

const stepsOf = (woId: string) => prisma.workOrderStep.findMany({
  where: { workOrderId: woId }, orderBy: { stepSequence: "asc" },
  select: { id: true, stepSequence: true, stationId: true, status: true, skipReason: true, addedVia: true, addedById: true },
});
const rollsAt = (stepId: string) => prisma.roll.count({ where: { currentStepId: stepId, status: RollStatus.IN_PRODUCTION } });

async function main(): Promise<void> {
  console.log("=== Okutmayla (esnek) rota — K29 ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }
  const actor = await testActorId();
  for (const k of KEYS) fx.settings.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));

  const itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST OKR kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(itemId);
  const mkStation = async (n: string, kind: "PROCESS_QC" | "TAMBUR" | "OTHER", extra: { appliesProperty?: boolean; scanNotSkippable?: boolean } = {}) => {
    const st = await prisma.station.create({ data: { code: `${P}-${n}`.slice(0, 32), name: `TEST OKR ${n} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE", ...extra }, select: { id: true } });
    fx.stationIds.push(st.id);
    return st.id;
  };
  const K = await mkStation("KURSUN", "PROCESS_QC");
  const Q = await mkStation("DKK", "PROCESS_QC", { appliesProperty: true });
  const B = await mkStation("ARA", "OTHER");
  const T = await mkStation("TAMBUR", "TAMBUR");
  const M = await mkStation("ZORUNLU", "OTHER", { scanNotSkippable: true });
  // S10: Q istasyonunun ZORUNLU seçim özelliği, istasyon varsayılanı "40".
  const propId = (await prisma.fabricProperty.create({ data: { code: `${P}-GR`.slice(0, 32), name: `TEST OKR Gramaj ${STAMP}`, valueType: "CHOICE" }, select: { id: true } })).id;
  fx.propIds.push(propId);
  const v40 = (await prisma.fabricPropertyValue.create({ data: { propertyId: propId, code: `${P}40`.slice(0, 32), name: "40 gr", sortOrder: 1 }, select: { id: true } })).id;
  fx.valueIds.push(v40);
  await prisma.stationProperty.create({ data: { stationId: Q, propertyId: propId, mode: "REQUIRED", defaultValueId: v40 } });
  const ctx: Ctx = { itemId, actor };
  const apply = (card: string, stationId: string, token = randomUUID(), closeOpenStepId: string | null = null, permissions: readonly string[] = ["*"]) =>
    applyScanRoute(card, { clientToken: token, closeOpenStepId }, { userId: actor, stationId, deviceId: "TEST-TABLET", machineId: null, permissions });

  // ── §0 ──
  section("§0 ayar + SIRALI bayt-aynı");
  for (const k of KEYS) await prisma.systemSetting.deleteMany({ where: { key: k } });
  check("varsayılan SEQUENTIAL + SELECTED", (await readProductionRouteMode()) === "SEQUENTIAL" && (await readProductionScanRouteStations()) === "SELECTED");
  const flags = (await systemSettingService.getFeatureFlags()).data;
  check("bayrak yükünde iki alan, varsayılanlı", flags.productionRouteMode === "SEQUENTIAL" && flags.productionScanRouteStations === "SELECTED");
  const bad = await errOf(() => systemSettingService.setFeatureFlags({ productionRouteMode: "SERBEST" } as never, actor));
  check("bilinmeyen rota uygulaması 400 (fail-closed)", bad.status === 400, JSON.stringify(bad.status));
  const j0 = await makeJob(ctx, "K0", [K, T]);
  const seqQ = await outcome(() => qc.getByCardBarcode(j0.card, Q, null));
  const seqK = await outcome(() => qc.getByCardBarcode(j0.card, K, null));
  check("SIRALI: kapı null (gateByCard)", (await gateByCard(j0.woId, Q)) === null);
  check("SIRALI: önizleme kapalı", (await previewScanRoute(j0.card, Q)).enabled === false);
  await setKey(KEYS[0], "SCAN");
  await setKey(KEYS[1], "SELECTED");
  check("SCAN + SELECTED + anahtarsız istasyon: kart çözümü bayt-aynı", (await outcome(() => qc.getByCardBarcode(j0.card, Q, null))) === seqQ);
  check("SCAN: toplar buradaysa kart çözümü bayt-aynı", (await outcome(() => qc.getByCardBarcode(j0.card, K, null))) === seqK);
  const offApply = await errOf(() => apply(j0.card, Q));
  check("anahtarsız istasyonda uygula 409 SCAN_ROUTE_DISABLED", offApply.status === 409 && offApply.code === "SCAN_ROUTE_DISABLED", JSON.stringify(offApply));
  await prisma.station.update({ where: { id: Q }, data: { scanAddAllowed: true } });
  check("SELECTED + istasyonda anahtar → kapı etkin", (await previewScanRoute(j0.card, Q)).enabled === true);
  await prisma.station.update({ where: { id: Q }, data: { scanAddAllowed: false } });
  await setKey(KEYS[1], "ALL");

  // ── §a ──
  section("§a var olan adım");
  const ga = await gateByCard(j0.woId, K);
  check("topların durduğu istasyon → OPEN_EXISTING", ga?.stepId === j0.steps[0], JSON.stringify(ga));
  const sa = await qc.getByCardBarcode(j0.card, K, null);
  check("Kurşun by-card bugünkü adımı açar", sa.data.workOrderStepId === j0.steps[0]);

  // ── §b ──
  section("§b olmayan istasyon → adım eklenir");
  const jb = await makeJob(ctx, "B", [K, T]);
  const eb = await errOf(() => qc.getByCardBarcode(jb.card, Q, null));
  const vb = eb.details?.scanRoute as { kind?: string } | undefined;
  check("by-card 400 SCAN_ROUTE_AVAILABLE (INSERT önerisi)", eb.status === 400 && eb.code === "SCAN_ROUTE_AVAILABLE" && vb?.kind === "INSERT", `${eb.code} ${vb?.kind}`);
  const tokB = randomUUID();
  const rb = await apply(jb.card, Q, tokB);
  const sb = await stepsOf(jb.woId);
  const added = sb.find((s) => s.stationId === Q);
  check("adım eklendi (addedVia=SCAN, okutan)", rb.kind === "INSERT" && !!added && added.addedVia === "SCAN" && added.addedById === actor, JSON.stringify(rb));
  check("eklenen adım rotada tek, sıra tekil", sb.filter((s) => s.stationId === Q).length === 1 && new Set(sb.map((s) => s.stepSequence)).size === sb.length);
  check("ekleme yeri topların durduğu adımın arkası; o (başlamamış) adım ATLANDI, sonraki plan adımı bekler",
    sb.map((s) => s.stationId).join() === [K, Q, T].join() && sb[0]!.status === StepStatus.SKIPPED && sb[2]!.status === StepStatus.PENDING, JSON.stringify(sb.map((s) => s.status)));
  check("toplar eklenen adımda", added ? (await rollsAt(added.id)) === 2 : false);
  check("kaynak kuyruk hareketi geri alındı, hedefte açık hareket", (await prisma.rollMovement.count({ where: { rollId: { in: jb.rollIds }, workOrderStepId: jb.steps[0], revokedAt: null } })) === 0
    && (added ? (await prisma.rollMovement.count({ where: { rollId: { in: jb.rollIds }, workOrderStepId: added.id, revokedAt: null, exitedAt: null } })) === 2 : false));
  const tv = await prisma.workOrderTargetValue.findFirst({ where: { workOrderId: jb.woId, propertyId: propId, revokedAt: null }, select: { valueId: true } });
  check("S10 istasyon varsayılanı hedef olarak eklendi (40 gr)", tv?.valueId === v40, JSON.stringify(rb.targetsAdded));
  check("İE IN_PROGRESS", (await prisma.workOrder.findUnique({ where: { id: jb.woId }, select: { status: true } }))?.status === WorkOrderStatus.IN_PROGRESS);

  // ── §f ──
  section("§f idempotent");
  const rf = await apply(jb.card, Q, tokB);
  check("aynı token → aynı adım (replay)", rf.insertedStepId === added?.id, JSON.stringify(rf));
  const rf2 = await apply(jb.card, Q);
  check("yeni tokenla tekrar → NOOP", rf2.kind === "NOOP");
  check("ikinci adım eklenmedi", (await prisma.workOrderStep.count({ where: { workOrderId: jb.woId, stationId: Q } })) === 1);

  // ── §c ──
  section("§c ileri istasyon → ATLANDI");
  const jc = await makeJob(ctx, "C", [K, B, T]);
  const rc = await apply(jc.card, T);
  const sc = await stepsOf(jc.woId);
  check("MOVE: hedef var olan Tambur adımı", rc.kind === "MOVE" && rc.targetStepId === jc.steps[2], JSON.stringify(rc));
  check("aradaki iki adım SKIPPED (SCAN_SKIP), satırlar yerinde", sc.length === 3 && sc.slice(0, 2).every((s) => s.status === StepStatus.SKIPPED && s.skipReason === "SCAN_SKIP"), JSON.stringify(sc.map((s) => [s.status, s.skipReason])));
  check("toplar Tambur adımında", (await rollsAt(jc.steps[2]!)) === 2);
  const evc = await prisma.workOrderEvent.count({ where: { workOrderId: jc.woId, trigger: "SCAN_SKIP" } });
  check("olay defteri: atlanan adım başına SCAN_SKIP satırı", evc === 2, String(evc));
  check("kurşun kuyruk hareketi geri alındı (istasyondan geçmiş sayılmaz)", (await prisma.rollMovement.count({ where: { workOrderStepId: jc.steps[0], revokedAt: null } })) === 0);
  // Atlanan istasyon yeniden okutulur → yeni adım (yeniden işlem uyarısı).
  const rcK = await apply(jc.card, K);
  check("atlanan istasyon yeniden okutma → yeni adım + yeniden işlem uyarısı", rcK.kind === "INSERT" && rcK.warnings.length === 1, JSON.stringify(rcK));
  check("atlanan satır yerinde kaldı", (await prisma.workOrderStep.findUnique({ where: { id: jc.steps[0] }, select: { status: true } }))?.status === StepStatus.SKIPPED);

  // ── §h ──
  section("§h atlanan adım faturaya/maliyete girmez");
  const res = await resolveServiceItemsForRolls({ rollIds: jc.rollIds, customerId: null, currency: "TRY" });
  check("atlanan kurşun/ara adım: hizmet işi yok", res.works.length === 0 && res.lines.length === 0, JSON.stringify(res.works.map((w) => w.source)));

  // ── §d ──
  section("§d açık iş başka istasyonda");
  const jd = await makeJob(ctx, "D", [K, T], 1);
  await prisma.rollOperation.create({ data: { rollId: jd.rollIds[0]!, workOrderStepId: jd.steps[0]!, operationType: RollOperationType.QC2_COMPLETED, operatorId: actor } });
  const gd = await errOf(() => gateByCard(jd.woId, T));
  const vd = gd.details?.scanRoute as { kind?: string; block?: { code?: string; closable?: boolean } } | undefined;
  check("kapı 400: BLOCKED OPEN_ELSEWHERE, kapatılabilir", gd.code === "SCAN_ROUTE_AVAILABLE" && vd?.block?.code === "SCAN_ROUTE_OPEN_ELSEWHERE" && vd.block.closable === true, JSON.stringify(vd));
  const ad = await errOf(() => apply(jd.card, T));
  check("onaysız uygula 409 SCAN_ROUTE_OPEN_ELSEWHERE", ad.status === 409 && ad.code === "SCAN_ROUTE_OPEN_ELSEWHERE", JSON.stringify(ad));
  check("engelde hiçbir şey yazılmadı", (await rollsAt(jd.steps[0]!)) === 1 && (await stepsOf(jd.woId)).every((s) => s.status !== StepStatus.SKIPPED));
  const rd = await apply(jd.card, T, randomUUID(), jd.steps[0]!);
  const sd = await stepsOf(jd.woId);
  check("'bitmiş say ve geç' → Kurşun TAMAMLANDI, top Tambur'da", sd[0]?.status === StepStatus.COMPLETED && (await rollsAt(jd.steps[1]!)) === 1, `${rd.kind} ${sd.map((s) => s.status).join(",")}`);

  // ── §d2 ── s14 inceleme B1: "bitmiş say ve geç" kurşun/KK adım kapatma YETKİSİNİ (finish-step ucu) ister.
  section("§d2 bitmiş say ve geç: adım kapatma yetkisi");
  const jd2 = await makeJob(ctx, "D2", [K, T], 1);
  await prisma.rollOperation.create({ data: { rollId: jd2.rollIds[0]!, workOrderStepId: jd2.steps[0]!, operationType: RollOperationType.QC2_COMPLETED, operatorId: actor } });
  const ad2 = await errOf(() => apply(jd2.card, T, randomUUID(), jd2.steps[0]!, ["mobile:tambur"]));
  check("yalnız mobile:tambur → 403 SCAN_ROUTE_CLOSE_FORBIDDEN", ad2.status === 403 && ad2.code === "SCAN_ROUTE_CLOSE_FORBIDDEN", JSON.stringify(ad2));
  const sd2 = await stepsOf(jd2.woId);
  check("yetkisiz denemede Kurşun açık, top yerinde", sd2[0]?.status === StepStatus.ACTIVE && (await rollsAt(jd2.steps[0]!)) === 1, sd2.map((s) => s.status).join(","));
  const rd2 = await apply(jd2.card, T, randomUUID(), jd2.steps[0]!, ["mobile:tambur", "mobile:kk2-kursun"]);
  check("mobile:kk2-kursun ile geçer", (await stepsOf(jd2.woId))[0]?.status === StepStatus.COMPLETED && (await rollsAt(jd2.steps[1]!)) === 1, rd2.kind);

  // ── §k ── s14 inceleme B2: finish / reopen / reopenPreview AYNI "sonraki adım" (ATLANDI hariç).
  section("§k ATLANDI ara adımdan sonra kurşun yeniden açılır");
  const jk = await makeJob(ctx, "K", [K, Q, T], 1);
  await prisma.workOrderStep.update({ where: { id: jk.steps[1]! }, data: { status: StepStatus.SKIPPED, skipReason: "SCAN_SKIP" } });
  await prisma.rollOperation.create({ data: { rollId: jk.rollIds[0]!, workOrderStepId: jk.steps[0]!, operationType: RollOperationType.QC2_COMPLETED, operatorId: actor } });
  await qc.finishStep({ stepId: jk.steps[0]! }, actor, null);
  check("finish: top ATLANDI'yı geçip Tambur'da", (await rollsAt(jk.steps[2]!)) === 1);
  const pk = await qc.reopenPreview(jk.steps[0]!);
  check("reopenPreview canReopen=true", pk.data?.canReopen === true, JSON.stringify(pk.data?.blockReason));
  const rk = await outcome(() => qc.reopenStep({ stepId: jk.steps[0]! }, actor));
  check("reopenStep başarılı, top Kurşun'a döndü", (await rollsAt(jk.steps[0]!)) === 1 && (await rollsAt(jk.steps[2]!)) === 0, rk);
  check("ATLANDI satırı yerinde", (await stepsOf(jk.woId))[1]?.status === StepStatus.SKIPPED);
  const qcSrc = readFileSync("src/services/kursun-qc.service.ts", "utf8");
  check("kursun-qc.service: 'sonraki adım' yalnız nextLiveStep'ten (inline stepSequence > step.stepSequence yok)",
    !/stepSequence\s*>\s*step\.stepSequence/.test(qcSrc) && !/stepSequence:\s*\{\s*gt:\s*step\.stepSequence/.test(qcSrc) && (qcSrc.match(/nextLiveStep/g) ?? []).length >= 4);

  // ── §e ──
  section("§e Atlanamaz");
  const je = await makeJob(ctx, "E", [K, M, T]);
  const ae = await errOf(() => apply(je.card, T));
  check("atlanamaz adım → 409 SCAN_ROUTE_MANDATORY_STEP", ae.status === 409 && ae.code === "SCAN_ROUTE_MANDATORY_STEP", JSON.stringify(ae));
  check("engelde adım durumu değişmedi", (await stepsOf(je.woId)).every((s) => s.status !== StepStatus.SKIPPED) && (await rollsAt(je.steps[0]!)) === 2);

  // ── §g ──
  section("§g yarış: iki tablet aynı anda");
  const jg = await makeJob(ctx, "G", [K, T]);
  const both = await Promise.allSettled([apply(jg.card, Q), apply(jg.card, Q)]);
  const kinds = both.map((r) => (r.status === "fulfilled" ? r.value.kind : `ERR:${(r.reason as { details?: { code?: string } }).details?.code}`));
  check("tek ekleme (Q adımı 1)", (await prisma.workOrderStep.count({ where: { workOrderId: jg.woId, stationId: Q } })) === 1, kinds.join(","));
  check("biri INSERT, öteki NOOP ya da STALE", kinds.includes("INSERT") && kinds.filter((k) => k === "INSERT").length === 1, kinds.join(","));

  // ── §r ──
  section("§r rotasız iş emri");
  const mkStock = async (n: number) => {
    const bc: string[] = [];
    for (let i = 0; i < n; i++) {
      const barcode = `${P}-R${i}`.slice(0, 40);
      const r = await prisma.roll.create({ data: { barcode, itemId, initialQty: 50, currentQty: 50, status: RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK }, select: { id: true } });
      fx.rollIds.push(r.id);
      bc.push(barcode);
    }
    return bc;
  };
  const barcodes = await mkStock(2);
  await setKey(KEYS[0], "SEQUENTIAL");
  const rs = await errOf(() => wos.quickStart({ clientToken: randomUUID(), rollBarcodes: barcodes, scanRouted: true, type: "STOCK_PRODUCTION" }, actor));
  check("SIRALI'da rotasız İE 400 SCAN_ROUTE_DISABLED", rs.status === 400 && rs.code === "SCAN_ROUTE_DISABLED", JSON.stringify(rs));
  const plain = await errOf(() => wos.quickStart({ clientToken: randomUUID(), rollBarcodes: barcodes, type: "STOCK_PRODUCTION" }, actor));
  check("rotasız bayraksız istek bugünkü 400 (rota seçin)", plain.status === 400 && plain.message.includes("Rota şablonu seçin"), plain.message);
  await setKey(KEYS[0], "SCAN");
  const qs = await wos.quickStart({ clientToken: randomUUID(), rollBarcodes: barcodes, scanRouted: true, type: "STOCK_PRODUCTION" }, actor);
  const rwo = qs.data!.workOrder;
  fx.woIds.push(rwo.id);
  const rRow = await prisma.workOrder.findUnique({ where: { id: rwo.id }, select: { scanRouted: true, status: true, steps: { select: { id: true } } } });
  check("rotasız İE açıldı: adımsız, scanRouted", rRow?.scanRouted === true && rRow.steps.length === 0 && qs.data!.attached === 2, JSON.stringify(rRow));
  const rRolls = await prisma.roll.findMany({ where: { barcode: { in: barcodes } }, select: { status: true, currentStepId: true, batchId: true } });
  check("toplar partide üretimde, adımsız", rRolls.every((r) => r.status === RollStatus.IN_PRODUCTION && r.currentStepId === null && r.batchId !== null));
  const card = (await prisma.travelerCard.findFirst({ where: { workOrderId: rwo.id, status: TravelerCardStatus.ACTIVE }, select: { barcode: true } }))!.barcode;
  const er = await errOf(() => qc.getByCardBarcode(card, K, null));
  check("ilk okutma (Kurşun) → 400 SCAN_ROUTE_AVAILABLE INSERT", er.code === "SCAN_ROUTE_AVAILABLE" && (er.details?.scanRoute as { kind?: string })?.kind === "INSERT", er.message);
  const rr = await apply(card, K);
  const rSteps = await stepsOf(rwo.id);
  check("Kurşun adımı eklendi (sıra 1), toplar orada açık hareketle", rr.kind === "INSERT" && rSteps.length === 1 && rSteps[0]!.stationId === K && (await rollsAt(rSteps[0]!.id)) === 2
    && (await prisma.rollMovement.count({ where: { workOrderStepId: rSteps[0]!.id, revokedAt: null, exitedAt: null } })) === 2);
  check("producedInStepId ilk adım, İE IN_PROGRESS",
    (await prisma.roll.count({ where: { barcode: { in: barcodes }, producedInStepId: rSteps[0]!.id } })) === 2
    && (await prisma.workOrder.findUnique({ where: { id: rwo.id }, select: { status: true } }))?.status === WorkOrderStatus.IN_PROGRESS);
  const rr2 = await apply(card, T);
  const rSteps2 = await stepsOf(rwo.id);
  check("sonraki okutma (Tambur) Kurşun'un arkasına eklenir, Kurşun ATLANDI (başlamamış)", rr2.kind === "INSERT" && rSteps2.map((s) => s.stationId).join() === [K, T].join() && rSteps2[0]!.status === StepStatus.SKIPPED, JSON.stringify(rSteps2.map((s) => s.status)));

  await sectionS15b(ctx, { K, Q, T }, (c, sid) => apply(c, sid));
}

/** HTTP gövdesini controller'ın Zod şemasından geçirir (sunucusuz): 201 gövdesi ya da hata. */
async function quickStartHttp(body: Record<string, unknown>, userId: string): Promise<{ status: number; body: unknown; err: Err | null }> {
  const ctrl = new WorkOrderController();
  let status = 0;
  let out: unknown = null;
  let err: Err | null = null;
  const res = { status: (c: number) => { status = c; return res; }, json: (b: unknown) => { out = b; return res; } };
  await ctrl.quickStart({ body, user: { userId } } as never, res as never, (e?: unknown) => {
    const x = e as { statusCode?: number; issues?: unknown; message?: string; details?: Record<string, unknown> & { code?: string } };
    err = { status: x.statusCode ?? (x.issues ? 400 : 500), code: x.details?.code ?? null, message: x.message ?? "", details: x.details ?? null };
  });
  return { status, body: out, err };
}

async function sectionS15b(ctx: Ctx, st: { K: string; Q: string; T: string }, apply: (card: string, stationId: string) => Promise<{ kind: string }>): Promise<void> {
  section("§s S15b — Hızlı İE rotasız + açık listede rotasız satır + canClose");
  const { K, Q, T } = st;
  const mkStock = async (tag: string, n: number) => {
    const bc: string[] = [];
    for (let i = 0; i < n; i++) {
      const barcode = `${P}-${tag}${i}`.slice(0, 40);
      const r = await prisma.roll.create({ data: { barcode, itemId: ctx.itemId, initialQty: 30, currentQty: 30, status: RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK }, select: { id: true } });
      fx.rollIds.push(r.id);
      bc.push(barcode);
    }
    return bc;
  };
  // quick-start HTTP gövdesi: SIRALI → 400 SCAN_ROUTE_DISABLED (Zod scanRouted'ı SİLSEYDİ "rota seçin" olurdu).
  await setKey(KEYS[0], "SEQUENTIAL");
  const b1 = await mkStock("S", 2);
  const seq = await quickStartHttp({ clientToken: randomUUID(), rollBarcodes: b1, scanRouted: true, type: "STOCK_PRODUCTION" }, ctx.actor);
  check("HTTP quick-start scanRouted + SIRALI → 400 SCAN_ROUTE_DISABLED", seq.err?.status === 400 && seq.err.code === "SCAN_ROUTE_DISABLED", JSON.stringify(seq.err));
  const both = await quickStartHttp({ clientToken: randomUUID(), rollBarcodes: b1, scanRouted: true, steps: [{ stationId: K }] }, ctx.actor);
  check("HTTP quick-start rotasız + adım birlikte → 400 (doğrulama)", both.err?.status === 400 && both.status === 0, JSON.stringify(both.err));
  await setKey(KEYS[0], "SCAN");
  const ok = await quickStartHttp({ clientToken: randomUUID(), rollBarcodes: b1, scanRouted: true, type: "STOCK_PRODUCTION" }, ctx.actor);
  const woId = (ok.body as { data?: { workOrder?: { id?: string } } } | null)?.data?.workOrder?.id ?? "";
  if (woId) fx.woIds.push(woId);
  const row = woId ? await prisma.workOrder.findUnique({ where: { id: woId }, select: { scanRouted: true, steps: { select: { id: true } } } }) : null;
  check("HTTP quick-start scanRouted + SCAN → 201 rotasız (adımsız) İE", ok.status === 201 && row?.scanRouted === true && row.steps.length === 0, JSON.stringify(ok.err ?? row));
  const card = (await prisma.travelerCard.findFirst({ where: { workOrderId: woId, status: TravelerCardStatus.ACTIVE }, select: { barcode: true } }))?.barcode ?? "";

  // Açık iş listesi (Kurşun/KK — oturum istasyonu K; ayar ALL).
  type Row = { workOrderId: string; stepId: string | null; scanRouteAdd?: boolean; scanRouteLabel?: string; cardBarcode: string; openRollCount: number };
  const kurs = async (stationId: string | null, include: boolean) => ((await qc.listOpenCards(stationId, null, null, include)).data ?? []) as Row[];
  const mine = (rows: Row[]) => rows.filter((r) => r.workOrderId === woId);
  const legacy = mine(await kurs(K, false));
  check("parametresiz (eski APK): rotasız İE listede YOK", legacy.length === 0, JSON.stringify(legacy));
  const withP = mine(await kurs(K, true));
  check("includeScanRouted: rotasız İE 'Sahada belirlenecek' (stepId null, 2 top)",
    withP.length === 1 && withP[0]!.stepId === null && withP[0]!.scanRouteAdd === true && withP[0]!.scanRouteLabel === "Sahada belirlenecek" && withP[0]!.openRollCount === 2 && withP[0]!.cardBarcode === card,
    JSON.stringify(withP));
  const tam = mine(((await new TamburService().listOpenCards(null, null, { sessionStationId: T })).data ?? []) as Row[]);
  check("Tambur listesi (oturum T) de aynı satırı verir", tam.length === 1 && tam[0]!.stepId === null, JSON.stringify(tam));
  const tamWrongKind = mine(((await new TamburService().listOpenCards(null, null, { sessionStationId: K })).data ?? []) as Row[]);
  check("Tambur listesi Tambur olmayan oturum istasyonunda rotasız satır vermez", tamWrongKind.length === 0);
  check("oturumsuz istekte rotasız satır yok", mine(await kurs(null, true)).length === 0);
  await setKey(KEYS[1], "SELECTED");
  check("izinsiz istasyon (SELECTED + anahtar kapalı): rotasız satır yok", mine(await kurs(Q, true)).length === 0);
  await prisma.station.update({ where: { id: Q }, data: { scanAddAllowed: true } });
  check("SELECTED + istasyonda anahtar: rotasız satır var", mine(await kurs(Q, true)).length === 1);
  await prisma.station.update({ where: { id: Q }, data: { scanAddAllowed: false } });
  await setKey(KEYS[1], "ALL");
  await setKey(KEYS[0], "SEQUENTIAL");
  check("SIRALI'da includeScanRouted olsa da rotasız satır yok", mine(await kurs(K, true)).length === 0);
  await setKey(KEYS[0], "SCAN");

  // Seçim = bugünkü kart çözümü → apply (tek ekleme yolu); sonra İE bu istasyonda adımlı → bir kez görünür.
  const picked = await apply(card, K);
  check("seçilen satır apply → K adımı eklendi", picked.kind === "INSERT" && (await stepsOf(woId)).map((s) => s.stationId).join() === K, picked.kind);
  const afterK = mine(await kurs(K, true));
  check("bu istasyonda adımı olan İE iki kez görünmez (tek satır, adımlı)", afterK.length === 1 && afterK[0]!.stepId !== null && !afterK[0]!.scanRouteAdd, JSON.stringify(afterK));
  const atT = mine(((await new TamburService().listOpenCards(null, null, { sessionStationId: T })).data ?? []) as Row[]);
  check("Tambur'da hâlâ 'Sahada belirlenecek' (K adımında bekliyor)", atT.length === 1 && atT[0]!.scanRouteAdd === true, JSON.stringify(atT));

  // canClose: guard ile AYNI izin kümesi (ayna).
  const cc = async (perms: string[]) => (await previewScanRoute(card, T, perms)).canClose;
  check("canClose: mobile:tambur → false", (await cc(["mobile:tambur"])) === false);
  check("canClose: mobile:kk2-kursun → true", (await cc(["mobile:tambur", "mobile:kk2-kursun"])) === true);
  check("canClose: quality:write → true", (await cc(["quality:write"])) === true);
  check("canClose: önizleme varsayılan (izin verilmedi) → false", (await previewScanRoute(card, T)).canClose === false);
  const src = readFileSync("src/services/workorder-scan-route.service.ts", "utf8");
  const helperSrc = readFileSync("src/services/helpers/scan-route-close.helper.ts", "utf8");
  check("guard + önizleme tek kaynak canCloseOpenStep (inline izin dizgesi yok)",
    src.includes("assertCanCloseOpenStep(ctx.permissions)") && src.includes("canClose: canCloseOpenStep(permissions)")
      && helperSrc.includes("if (canCloseOpenStep(permissions)) return;") && !/quality:write|matchesPermission/.test(src));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  for (const k of KEYS) {
    const prev = fx.settings.get(k);
    if (prev === null || prev === undefined) await del("ayar", () => prisma.systemSetting.deleteMany({ where: { key: k } }));
    else await del("ayar", () => prisma.systemSetting.update({ where: { key: k }, data: { value: prev.value as Prisma.InputJsonValue } }));
  }
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((s) => s.id);
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...stepIds, ...fx.woIds, ...fx.rollIds] } } }));
  // work_order_events append-only: iş emri silinince kaskatla gider.
  await del("hedef", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: fx.rollIds } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: fx.rollIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("yetenek", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  check("temizlik: TEST-OKR iş emri kalıntısı yok", (await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
