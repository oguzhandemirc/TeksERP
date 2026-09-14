// =============================================================================
// POLİMORFİK FASON SEVK KALEMİ — F1 LEVENT: git · storno · dön · storno (kapalı çevrim)
// =============================================================================
// NEDEN: `SubcontractorDispatchItem` top-yalnızdı (`rollId NOT NULL`); F1 kalemi polimorfik yapar
// (ROLL | WARP_BEAM) ve leventin fiziksel çıkışını sevk belgesine, defterini `WarpBeamEvent`e
// (SHIP_OUT · SHIP_OUT_CANCEL · RETURNED_IN · RETURNED_IN_CANCEL, her satır KALEME bağlı) yazar.
// Bu bekçi tasarımı GERÇEK DB'de ölçer: ROLL yolu bayt bayt aynı · levent kalemi + SHIP_OUT aynı tx ·
// READY dışı 409 · levent-yalnız sevk (parti boş doğar) · OUTSTANDING kümesi levent kalemini DIŞLAR ·
// DTO opt-in (`includeBeams`) · belge levent satırı · dönüş (≤ giden, replay, çift dönüş) · LIFO (dönmüş
// kalemin sevki iptal edilemez; yeniden sevk edilmiş leventin dönüşü storno edilemez) · sevk iptali
// SHIP_OUT_CANCEL'ı DOĞRU kaleme bağlar · gövde seddi SHIPPED_OUT'u da kapsar · DB sedleri · devere kapısı.
//
// Bölümler: §0 statik · §1 fikstür · §2 ROLL yolu · §3 levent sevki · §4 dönüş + storno + LIFO ·
//   §5 sevk iptali · §6 DB sedleri · §7 devere kapalı.
//
// NEGATİF SONDALAR (2026-09-14, cp+sha256 ile geri):
//   · `subcontractor-beam.service.ts` `dispatchWarpBeamItemsTx` READY kapısı `!== READY` → `=== "X"` (kapı
//     düştü) → §3f kırmızı (SHIPPED_OUT levent ikinci sevke girdi: kod WARP_BEAM_NOT_READY değil WARP_BEAM_STATE)
//   · `subcontractor-beam.service.ts` `cancelWarpBeamItemsTx` `if (openReturnOf(it))` → `if (false)` → §4f′ kırmızı
//     (tx-içi hat düştü; §4f uçtan uca YEŞİL kalır çünkü tx-dışı sinyal hâlâ engeller ⇒ iki hat AYRI ölçülür)
//   · `subcontractor.service.ts` cancel() `returnedBeamCount,` → `returnedBeamCount: 0,` → §4g′ kırmızı (tx-dışı sinyal
//     düştü; §4f yine yeşil — tx-içi hat yakalar)
//   · `subcontractor.controller.ts` gövde kapısı `if (... && !(await readDevereEnabled()))` → `if (false)` → §0b kırmızı
//   · `constants/warp-beam.ts` SHIP_OUT işareti −1 → +1 → 7 kırmızı (§0e · §3d · §4b · §4h · §4j · §5a · §5c: kalan
//     metre fasondayken 0 değil, dönüşte/iptalde yanlış)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Devere bayrağı FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, RollStatus, StationType, SubcontractorDispatchItemKind, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, PrintedDocType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { WARP_BEAM_EVENT_KINDS, WARP_BEAM_FASON_KINDS, warpBeamLengthSign } from "../src/constants/warp-beam";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { cancelWarpBeamItemsTx, cancelWarpBeamReturn, returnWarpBeam } from "../src/services/subcontractor-beam.service";
import { resolveDispatchCancelBlockReason } from "../src/services/helpers/subcontractor-cancel.helper";
import { OUTSTANDING_ITEM } from "../src/services/helpers/fason-open-dispatch.helper";
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
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
async function pgHata(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const m = /\b(23\d{3})\b/.exec(String((e as Error).message ?? e));
    return m?.[1] ?? "başka";
  }
}

const TAG = `TEST-FSB-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const svc = new SubcontractorService();

function statik(): void {
  console.log("── §0 Statik ──");
  const mig = readFileSync(path.join(ROOT, "prisma/migrations/20260914171000_sd_item_polymorphic/migration.sql"), "utf8");
  const m = /"warp_beam_events_fason_item_ck" CHECK \(\s*\("kind" IN \(([^)]*)\)\)/.exec(mig);
  const ckList = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort();
  check("§0a WARP_BEAM_FASON_KINDS ↔ fason_item_ck İKİ YÖNLÜ eşit ve hepsi WARP_BEAM_EVENT_KINDS'ta",
    JSON.stringify(ckList) === JSON.stringify([...WARP_BEAM_FASON_KINDS].sort()) && WARP_BEAM_FASON_KINDS.every((k) => (WARP_BEAM_EVENT_KINDS as readonly string[]).includes(k)),
    `${ckList.join(",")} ↔ ${WARP_BEAM_FASON_KINDS.join(",")}`);

  const ctrl = readFileSync(path.join(ROOT, "src/controllers/subcontractor.controller.ts"), "utf8");
  const gateOk = (t: string): boolean => {
    const i = t.indexOf("async dispatch(");
    const govde = i < 0 ? "" : t.slice(i, i + 2000);
    const kapi = /if \(\(body\.warpBeamIds\?\.length \?\? 0\) > 0 && !\(await readDevereEnabled\(\)\)\)[\s\S]{0,400}?code: "MODULE_DISABLED",\s*modul: "devere"/.exec(govde);
    const cagri = govde.indexOf("this.service.dispatch(", govde.indexOf("dispatchSchema.parse"));
    return !!kapi && cagri > 0 && kapi.index < cagri;
  };
  check("§0b ⭐ dispatch: `warpBeamIds` verildiyse devere bayrağı okunur, kapalı → 403 MODULE_DISABLED (modul devere), servis çağrısından ÖNCE", gateOk(ctrl));
  check("§0b′ sonda bellek içi: kapı düşürülünce §0b kırmızı", !gateOk(ctrl.replace(/if \(\(body\.warpBeamIds\?\.length \?\? 0\) > 0 && !\(await readDevereEnabled\(\)\)\)/, "if (false)")));

  const routes = readFileSync(path.join(ROOT, "src/routes/subcontractor.routes.ts"), "utf8");
  const ucKapili = (yol: string): boolean => {
    const i = routes.indexOf(`"${yol}"`);
    if (i < 0) return false;
    const blok = routes.slice(i, routes.indexOf(");", i));
    return blok.indexOf("requireDevereEnabled") > 0 && blok.indexOf("requireDevereEnabled") < blok.indexOf("controller.");
  };
  check("§0c levent dönüş uçları `requireDevereEnabled` taşır (controller'dan önce)", ucKapili("/dispatches/:id/beams/:beamId/return") && ucKapili("/dispatches/:id/beams/:beamId/return-cancel"));

  const beam = readFileSync(path.join(ROOT, "src/services/subcontractor-beam.service.ts"), "utf8");
  const yazici = readFileSync(path.join(ROOT, "src/services/helpers/warp-beam-event.helper.ts"), "utf8");
  check("§0d levent defterinin TEK yazıcısı: fason servisi `warpBeamEvent.create` çağırmaz, `applyWarpBeamEventTx` helper'da dışa açık",
    !/warpBeamEvent\.create\(/.test(beam) && /export async function applyWarpBeamEventTx\(/.test(yazici) && /applyWarpBeamEventTx\(/.test(beam));
  // İplik rejim kapısı geçişli import zincirini ölçer: fason servisi sarım/levent servislerini ithal ETMEZ (iplik defterine yol yok).
  check("§0d′ fason levent servisi `warp-beam-wind.service`/`warp-beam.service`/`yarn.service` ithal etmez (iplik zinciri kesik)",
    !/from "\.\/(warp-beam-wind\.service|warp-beam\.service|yarn\.service)"/.test(beam));

  check("§0e işaret tablosu: SHIP_OUT −1 · SHIP_OUT_CANCEL +1 · RETURNED_IN +1 · RETURNED_IN_CANCEL −1 (kalan = fabrikadaki metre)",
    warpBeamLengthSign("SHIP_OUT") === -1 && warpBeamLengthSign("SHIP_OUT_CANCEL") === 1 && warpBeamLengthSign("RETURNED_IN") === 1 && warpBeamLengthSign("RETURNED_IN_CANCEL") === -1);

  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model SubcontractorDispatchItem {"), schema.indexOf("@@map(\"subcontractor_dispatch_items\")"));
  check("§0f şema: kalem `kind @default(ROLL)` · `rollId String?` · top bağı `onDelete: Restrict` AÇIK (SetNull'a kayma yok) · `warpBeamId`",
    /kind\s+SubcontractorDispatchItemKind @default\(ROLL\)/.test(model) && /rollId\s+String\?/.test(model) && /roll\s+Roll\?\s+@relation\([^)]*onDelete: Restrict\)/.test(model) && /warpBeamId\s+String\?/.test(model));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== POLİMORFİK FASON SEVK KALEMİ (F1 LEVENT) BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, select: { value: true } });
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await ensureTestAdmin();
  if (!item) throw new Error("Seed fixture eksik (PATOS)");
  const whId = await fixtureWarehouseId();
  const st = await prisma.station.create({ data: { name: `${TAG}-HASIL`, code: `${TAG}-HS`.slice(0, 32), type: StationType.EXTERNAL }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} haşılcı` }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const woIds: string[] = [];
  const rollIds: string[] = [];
  const beamIds: string[] = [];
  const dispatchIds: string[] = [];

  async function yeniWo(n: string): Promise<{ woId: string; stepId: string }> {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item!.id, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "PENDING" }] } },
      include: { steps: true },
    });
    woIds.push(wo.id);
    return { woId: wo.id, stepId: wo.steps[0].id };
  }
  async function yeniTop(n: string, qty: number): Promise<string> {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${n}`, itemId: item!.id, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: whId, width: 250 }, select: { id: true } });
    rollIds.push(r.id);
    return r.id;
  }
  async function hazirLevent(n: string, metre: number, govde?: string): Promise<{ id: string; beamNo: string }> {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: metre, originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id, physicalBeamNo: govde ?? null });
    beamIds.push(p.data.id);
    const w = await windWarpBeam(p.data.id, { lengthM: metre, kgSource: WarpKgSource.THEORETICAL });
    return { id: p.data.id, beamNo: w.data.beamNo };
  }
  const durum = async (id: string): Promise<WarpBeamStatus> => (await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const olaylar = (id: string) => prisma.warpBeamEvent.findMany({ where: { beamId: id }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, lengthM: true, reversesEventId: true, dispatchItemId: true } });
  const kalan = async (id: string): Promise<number> => (await getWarpBeam(id)).data.remainingM;
  const sevkKaydet = (r: { data: unknown }): string => {
    const id = (r.data as { id: string }).id;
    if (!dispatchIds.includes(id)) dispatchIds.push(id);
    return id;
  };

  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, create: { key: SETTING_KEYS.DEVERE_ENABLED, value: "true" }, update: { value: "true" } });
    console.log("\n── §1 Fikstür ──");
    const b1 = await hazirLevent("1", 1000, `${TAG}-G1`);
    const b2 = await hazirLevent("2", 800);
    const b3 = await hazirLevent("3", 600);
    check("§1 üç HAZIR levent (1000 · 800 · 600 m), EXTERNAL adım, fasoncu", (await durum(b1.id)) === WarpBeamStatus.READY && (await kalan(b1.id)) === 1000);

    console.log("\n── §2 ROLL yolu değişmedi ──");
    const w1 = await yeniWo("W1");
    const r1 = await yeniTop("1", 100);
    const d1 = sevkKaydet(await svc.dispatch({ workOrderId: w1.woId, stepId: w1.stepId, subcontractorId: sub.id, rollIds: [r1] }, admin.id));
    const d1Items = await prisma.subcontractorDispatchItem.findMany({ where: { dispatchId: d1 } });
    check("§2a top-yalnız sevk: kalem kind=ROLL, warpBeamId null, totalQty = top metresi", d1Items.length === 1 && d1Items[0].kind === SubcontractorDispatchItemKind.ROLL && d1Items[0].warpBeamId === null && Number((await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d1 } })).totalQty) === 100);
    const d1Dto = (await svc.getDispatch(d1)).data as { items: Array<{ roll: unknown }>; beamItemCount: number };
    check("§2b detay: kalem `roll` dolu, beamItemCount 0", d1Dto.items.length === 1 && !!d1Dto.items[0].roll && d1Dto.beamItemCount === 0);
    const d1Doc = await prisma.printedDocument.findFirst({ where: { sourceId: d1, docType: PrintedDocType.SUBCONTRACTOR_DISPATCH }, select: { snapshot: true } });
    const d1Snap = ((d1Doc?.snapshot ?? {}) as { doc?: Record<string, unknown> }).doc ?? {};
    check("§2c donmuş belge levent anahtarı TAŞIMAZ (bayt bayt eski şekil)", !!d1Doc && "rolls" in d1Snap && !("beams" in d1Snap) && !("beamTotals" in d1Snap));
    check("§2d boş liste → 400 'En az bir top seçmelisiniz'", (await beklenenHata(() => svc.dispatch({ workOrderId: w1.woId, stepId: w1.stepId, subcontractorId: sub.id, rollIds: [] }, admin.id)))?.message === "En az bir top seçmelisiniz");

    console.log("\n── §3 Levent sevki ──");
    const w2 = await yeniWo("W2");
    const r2 = await yeniTop("2", 50);
    const d2 = sevkKaydet(await svc.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: sub.id, rollIds: [r2], warpBeamIds: [b1.id, b2.id] }, admin.id));
    const d2Items = await prisma.subcontractorDispatchItem.findMany({ where: { dispatchId: d2 }, orderBy: { createdAt: "asc" } });
    const d2Beams = d2Items.filter((i) => i.kind === SubcontractorDispatchItemKind.WARP_BEAM);
    check("§3a karma sevk: 1 top + 2 levent kalemi; levent kaleminde rollId null, dispatchedQty = kalan metre, dispatchedWeight null",
      d2Items.length === 3 && d2Beams.length === 2 && d2Beams.every((i) => i.rollId === null && i.dispatchedWeight === null) && d2Beams.map((i) => Number(i.dispatchedQty)).sort((a, b) => a - b).join(",") === "800,1000");
    const b1Ev = await olaylar(b1.id);
    check("§3b ⭐ SHIP_OUT aynı tx: levent SHIPPED_OUT, olay kaleme bağlı (dispatchItemId), lengthM 1000",
      (await durum(b1.id)) === WarpBeamStatus.SHIPPED_OUT && b1Ev.length === 2 && b1Ev[1].kind === "SHIP_OUT" && b1Ev[1].dispatchItemId === d2Beams.find((i) => i.warpBeamId === b1.id)?.id && Number(b1Ev[1].lengthM) === 1000);
    check("§3c totalQty = Σ kalem (50 + 1000 + 800) — consistency §19 korunur", Number((await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2 } })).totalQty) === 1850);
    check("§3d ⭐ kalan metre fasondayken 0 (SHIP_OUT düşer)", (await kalan(b1.id)) === 0 && (await kalan(b2.id)) === 0);
    const d2Def = (await svc.getDispatch(d2)).data as { items: Array<{ kind: string; warpBeam?: unknown }>; beamItemCount: number };
    const d2Acik = (await svc.getDispatch(d2, { includeBeams: true })).data as { items: Array<{ kind: string; warpBeam: { beamNo: string } | null }>; beamItemCount: number };
    check("§3e DTO opt-in: varsayılan 1 kalem (ROLL) + beamItemCount 2 · includeBeams 3 kalem, levent `warpBeam.beamNo`",
      d2Def.items.length === 1 && d2Def.beamItemCount === 2 && d2Acik.items.length === 3 && d2Acik.items.some((i) => i.kind === "WARP_BEAM" && i.warpBeam?.beamNo === b1.beamNo));
    const w3 = await yeniWo("W3");
    check("§3f ⭐ SHIPPED_OUT levent yeniden sevk → 409 WARP_BEAM_NOT_READY", kod(await beklenenHata(() => svc.dispatch({ workOrderId: w3.woId, stepId: w3.stepId, subcontractorId: sub.id, rollIds: [], warpBeamIds: [b1.id] }, admin.id))) === "WARP_BEAM_NOT_READY");
    check("§3g OUTSTANDING kümesi levent kalemini DIŞLAR (top kalemi 1, levent 0)", (await prisma.subcontractorDispatchItem.count({ where: { dispatchId: d2, ...OUTSTANDING_ITEM } })) === 1);
    const d2Doc = await prisma.printedDocument.findFirst({ where: { sourceId: d2, docType: PrintedDocType.SUBCONTRACTOR_DISPATCH }, select: { snapshot: true } });
    const snap = ((d2Doc?.snapshot ?? {}) as { doc?: { rolls?: unknown[]; beams?: Array<{ beamNo: string; lengthM: number }>; totals?: { totalQty: number }; beamTotals?: { beamCount: number; totalLengthM: number } } }).doc ?? {};
    check("§3h donmuş belge: kumaş grid'i 1 top (metre 50), `beams` 2 satır, beamTotals 1800", snap.rolls?.length === 1 && snap.totals?.totalQty === 50 && snap.beams?.length === 2 && snap.beamTotals?.beamCount === 2 && snap.beamTotals?.totalLengthM === 1800);
    const d2r = await svc.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: sub.id, rollIds: [r2], warpBeamIds: [b1.id, b2.id] }, admin.id);
    check("§3i idempotent tekrar (aynı top + aynı levent kümesi) → mevcut sevk döner", (d2r.data as { id: string }).id === d2 && /idempotent/.test(d2r.message ?? ""));
    const d3 = sevkKaydet(await svc.dispatch({ workOrderId: w3.woId, stepId: w3.stepId, subcontractorId: sub.id, rollIds: [], warpBeamIds: [b3.id] }, admin.id));
    const d3Row = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d3 }, select: { totalQty: true, batchId: true, _count: { select: { items: true } } } });
    check("§3j levent-yalnız sevk meşru: parti doğdu (boş), 1 kalem, totalQty 600", !!d3Row.batchId && d3Row._count.items === 1 && Number(d3Row.totalQty) === 600 && (await prisma.roll.count({ where: { batchId: d3Row.batchId } })) === 0);
    const b5 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id, physicalBeamNo: `${TAG}-G1` });
    beamIds.push(b5.data.id);
    check("§3k gövde seddi SHIPPED_OUT'u kapsar: fasondaki gövdeye ikinci sarım → 409 WARP_BEAM_PHYSICAL_BUSY", kod(await beklenenHata(() => windWarpBeam(b5.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL }))) === "WARP_BEAM_PHYSICAL_BUSY");

    console.log("\n── §4 Dönüş · storno · LIFO ──");
    check("§4a dönen metre gideni aşamaz → 400 WARP_BEAM_RETURN_EXCEEDS", kod(await beklenenHata(() => returnWarpBeam(d2, { warpBeamId: b1.id, lengthM: 1001 }, admin.id))) === "WARP_BEAM_RETURN_EXCEEDS");
    const tok = crypto.randomUUID();
    const ret = await returnWarpBeam(d2, { warpBeamId: b1.id, lengthM: 950, clientToken: tok }, admin.id);
    check("§4b ⭐ RETURNED_IN: levent READY, olay kaleme bağlı, kalan 950 (fire 50 fark olarak görünür)", ret.data.status === WarpBeamStatus.READY && (await durum(b1.id)) === WarpBeamStatus.READY && (await kalan(b1.id)) === 950 && (await olaylar(b1.id)).at(-1)?.kind === "RETURNED_IN");
    const retR = await returnWarpBeam(d2, { warpBeamId: b1.id, lengthM: 950, clientToken: tok }, admin.id);
    check("§4c replay (aynı token) → aynı olay, ikinci satır YOK", retR.data.eventId === ret.data.eventId && (await prisma.warpBeamEvent.count({ where: { beamId: b1.id, kind: "RETURNED_IN" } })) === 1);
    check("§4d ikinci dönüş → 409 WARP_BEAM_ALREADY_RETURNED", kod(await beklenenHata(() => returnWarpBeam(d2, { warpBeamId: b1.id, lengthM: 10 }, admin.id))) === "WARP_BEAM_ALREADY_RETURNED");
    check("§4e başka sevkin levendi → 404", (await beklenenHata(() => returnWarpBeam(d1, { warpBeamId: b1.id, lengthM: 10 }, admin.id)))?.statusCode === 404);
    const lifo = await beklenenHata(() => svc.cancel(d2, `${TAG} iptal`, admin.id));
    check("§4f ⭐ LIFO uçtan uca: dönmüş kalemin sevki iptal edilemez → 409, sevk açık kaldı", lifo?.statusCode === 409 && (await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2 }, select: { cancelledAt: true } })).cancelledAt === null);
    check("§4f′ ⭐ tx-içi hat tek başına: cancelWarpBeamItemsTx → 409 WARP_BEAM_RETURNED", kod(await beklenenHata(() => prisma.$transaction((tx) => cancelWarpBeamItemsTx(tx, { dispatchId: d2, reason: "sonda", userId: admin!.id })))) === "WARP_BEAM_RETURNED");
    check("§4g tx-dışı sinyal tek kaynakta: resolveDispatchCancelBlockReason({returnedBeamCount:1}) dolu, 0 → null",
      resolveDispatchCancelBlockReason({ cancelledAt: null, directShipmentNo: null, activeReceiptNo: null, movedRollCount: 0, returnedBeamCount: 1 }) !== null &&
      resolveDispatchCancelBlockReason({ cancelledAt: null, directShipmentNo: null, activeReceiptNo: null, movedRollCount: 0, returnedBeamCount: 0 }) === null);
    const cancelGovde = (() => { const t = readFileSync(path.join(ROOT, "src/services/subcontractor.service.ts"), "utf8"); const i = t.indexOf("  async cancel("); return t.slice(i, i + 5000); })();
    check("§4g′ cancel() sinyali SAYIYOR ve helper'a GEÇİRİYOR (countReturnedBeamItems → returnedBeamCount)",
      /const returnedBeamCount = hasBeamItems \? await countReturnedBeamItems\(/.test(cancelGovde) && /movedRollCount: movedRolls\.length,\s*returnedBeamCount,\s*(?:returnedYarnCount,\s*)?\}\)/.test(cancelGovde));
    const rc = await cancelWarpBeamReturn(d2, { warpBeamId: b1.id, reason: `${TAG} yanlış metre` }, admin.id);
    const b1Ev2 = await olaylar(b1.id);
    check("§4h RETURNED_IN_CANCEL: SHIPPED_OUT'a döner, `reversesEventId` = RETURNED_IN, kalan 0", rc.data.status === WarpBeamStatus.SHIPPED_OUT && b1Ev2.at(-1)?.kind === "RETURNED_IN_CANCEL" && b1Ev2.at(-1)?.reversesEventId === ret.data.eventId && (await kalan(b1.id)) === 0);
    check("§4i storno sonrası ikinci storno → 409 WARP_BEAM_NOT_RETURNED", kod(await beklenenHata(() => cancelWarpBeamReturn(d2, { warpBeamId: b1.id, reason: "tekrar" }, admin.id))) === "WARP_BEAM_NOT_RETURNED");
    const ret2 = await returnWarpBeam(d2, { warpBeamId: b1.id, lengthM: 900 }, admin.id);
    const w4 = await yeniWo("W4");
    const d4 = sevkKaydet(await svc.dispatch({ workOrderId: w4.woId, stepId: w4.stepId, subcontractorId: sub.id, rollIds: [], warpBeamIds: [b1.id] }, admin.id));
    check("§4j dön → yeniden sevk: kalem metresi 900 (dönen), levent SHIPPED_OUT", ret2.data.lengthM === 900 && Number((await prisma.subcontractorDispatchItem.findUniqueOrThrow({ where: { dispatchId_warpBeamId: { dispatchId: d4, warpBeamId: b1.id } } })).dispatchedQty) === 900 && (await durum(b1.id)) === WarpBeamStatus.SHIPPED_OUT);
    check("§4k ⭐ LIFO: yeniden sevk edilmiş leventin ESKİ dönüşü storno edilemez → 409 WARP_BEAM_STATE (READY claim düşer)", kod(await beklenenHata(() => cancelWarpBeamReturn(d2, { warpBeamId: b1.id, reason: "geç kaldı" }, admin.id))) === "WARP_BEAM_STATE");

    console.log("\n── §5 Sevk iptali ──");
    await svc.cancel(d4, `${TAG} d4 iptal`, admin.id);
    const b1Ev3 = await olaylar(b1.id);
    const d4Item = await prisma.subcontractorDispatchItem.findUniqueOrThrow({ where: { dispatchId_warpBeamId: { dispatchId: d4, warpBeamId: b1.id } }, select: { id: true } });
    check("§5a ⭐ SHIP_OUT_CANCEL DOĞRU kaleme bağlı (d4'ün SHIP_OUT'u), levent READY, kalan 900",
      (await durum(b1.id)) === WarpBeamStatus.READY && b1Ev3.at(-1)?.kind === "SHIP_OUT_CANCEL" && b1Ev3.at(-1)?.dispatchItemId === d4Item.id && b1Ev3.at(-1)?.reversesEventId === b1Ev3.find((e) => e.kind === "SHIP_OUT" && e.dispatchItemId === d4Item.id)?.id && (await kalan(b1.id)) === 900);
    check("§5b d2'nin dönmüş kalemi hâlâ iptal engeli (b1 döndü) → 409, sevk açık", (await beklenenHata(() => svc.cancel(d2, `${TAG} d2 iptal`, admin.id)))?.statusCode === 409 && (await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2 }, select: { cancelledAt: true } })).cancelledAt === null);
    await svc.cancel(d3, `${TAG} d3 iptal`, admin.id);
    check("§5c levent-yalnız sevk iptali: b3 READY, kalan 600, kalem SİLİNMEDİ", (await durum(b3.id)) === WarpBeamStatus.READY && (await kalan(b3.id)) === 600 && (await prisma.subcontractorDispatchItem.count({ where: { dispatchId: d3 } })) === 1);
    check("§5d ikinci iptal → 409", (await beklenenHata(() => svc.cancel(d3, "tekrar", admin.id)))?.statusCode === 409);

    console.log("\n── §6 DB sedleri ──");
    const d2Row = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2 }, select: { id: true } });
    check("§6a kalem XOR: kind=ROLL + warpBeamId dolu → 23514", (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatch_items (id, "dispatchId", kind, "rollId", "warpBeamId", "dispatchedQty") VALUES (gen_random_uuid(), ${d2Row.id}::uuid, 'ROLL', ${r2}::uuid, ${b2.id}::uuid, 1)`)) === "23514");
    check("§6b kalem XOR: kind=WARP_BEAM + ikisi boş → 23514", (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatch_items (id, "dispatchId", kind, "dispatchedQty") VALUES (gen_random_uuid(), ${d2Row.id}::uuid, 'WARP_BEAM', 1)`)) === "23514");
    check("§6c fason türü kalem bağsız → 23514 · WOUND kalem bağlı → 23514",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus", "lengthM") VALUES (gen_random_uuid(), ${b2.id}::uuid, 'SHIP_OUT', 'READY', 'SHIPPED_OUT', 1)`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus", "dispatchItemId") VALUES (gen_random_uuid(), ${b2.id}::uuid, 'WOUND_CANCEL', 'READY', 'CANCELLED', ${d4Item.id}::uuid)`)) === "23514");
    check("§6d kalem başına TEK SHIP_OUT → 23505", (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus", "lengthM", "dispatchItemId") VALUES (gen_random_uuid(), ${b1.id}::uuid, 'SHIP_OUT', 'READY', 'SHIPPED_OUT', 1, ${d4Item.id}::uuid)`)) === "23505");
    check("§6e tanınmayan tür → 23514 (kind_ck genişledi ama kapalı küme)", (await pgHata(() => prisma.$executeRaw`INSERT INTO warp_beam_events (id, "beamId", kind, "fromStatus", "toStatus") VALUES (gen_random_uuid(), ${b2.id}::uuid, 'MOUNTED', 'READY', 'READY')`)) === "23514");

    console.log("\n── §7 Devere kapalı ──");
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, data: { value: "false" } });
    const w5 = await yeniWo("W5");
    const kapali = await beklenenHata(() => svc.dispatch({ workOrderId: w5.woId, stepId: w5.stepId, subcontractorId: sub.id, rollIds: [], warpBeamIds: [b3.id] }, admin.id));
    check("§7a ⭐ ikinci hat: servis düzeyinde de 403 MODULE_DISABLED (modul devere) — sevk satırı geri alındı", kod(kapali) === "MODULE_DISABLED" && (kapali?.details as { modul?: string })?.modul === "devere" && (await prisma.subcontractorDispatch.count({ where: { workOrderId: w5.woId } })) === 0 && (await durum(b3.id)) === WarpBeamStatus.READY);
    check("§7b dönüş ucu servis düzeyinde de kapalı → 403", kod(await beklenenHata(() => returnWarpBeam(d2, { warpBeamId: b2.id, lengthM: 10 }, admin.id))) === "MODULE_DISABLED");
    await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, data: { value: "true" } });
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...dispatchIds, ...beamIds, ...woIds] } } });
    if (foto) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, data: { value: foto.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_ENABLED } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
