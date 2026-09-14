// =============================================================================
// LEVENT YAŞAM DÖNGÜSÜ — devere Faz 1b: plan → sar (WOUND + brüt iplik + dip iadesi) → sarım iptali (net ters)
// =============================================================================
// NEDEN: levent defteri (`WarpBeamEvent`) ile iplik defteri (`YarnMovement`) AYNI tx'te yazılır ve
// tersleri tipli çiftlerdir. Bu bekçi tasarımın (DEVERE-LEVENT-TARAMASI §4.7 · §4.9) kalemlerini
// GERÇEK DB'de ölçer: köken XOR kapısı, atomik claim, replay, WOUND gerçekleri (formül fixture'ı
// 3500 × 300 × 7000 → 816,667 kg), brüt çıkış + ayrı iade, iptalde iki toplamın AYRI AYRI sıfırlanması,
// çift iptal seddi, taslak silme (④ sınıfı), fason/hazır alım kökeninde iplik satırının YOKLUĞU,
// devere olmayan istasyon makinesinin reddi, paralel sarımda TAM BİRİNİN geçmesi.
//
// Bölümler: §0 statik (tür listesi ↔ CHECK iki yönlü · defter satırına update/delete YOK · eksi-bakiye
//   kümesi · elle iplik ucu WARP_* kabul etmez) · §1 fikstür/körlük · §2 plan + replay + XOR ·
//   §3 sarım + gerçekler + iplik bakiyesi · §4 durum claim + replay · §5 iptal önizleme + net ters +
//   çift iptal · §6 taslak silme · §7 fason köken · §8 devere olmayan makine · §9 paralel sarım.
//
// NEGATİF SONDALAR (2026-09-14, cp+sha256 ile geri):
//   · `warp-beam-wind.service.ts` sarım claim'i `from: WarpBeamStatus.PLANNED` → `from: beam.status` (durum
//     süzgeci düştü) → §4a ikinci sarım claim'i GEÇER, ikinci WOUND `one_wound_uq` seddine çarpar (P2002) ⇒
//     kod WARP_BEAM_STATE değil P2002 ⇒ kırmızı (kapı yerine sed yakaladı — ölçüldü 2026-09-14)
//   · `constants/warp-beam.ts` WARP_BEAM_EVENT_KINDS'a "MOUNTED" eklendi → §0a iki yönlü eşitlik kırmızı
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar (devere · iplik) FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { WARP_BEAM_EVENT_KINDS } from "../src/constants/warp-beam";
import { createWarpBeam, deleteWarpBeamDraft, getWarpBeam, updateWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, cancelWoundPreview, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { AppError } from "../src/utils/app-error";

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
    // DB seddi (P2002 vb.) bir AppError DEĞİLDİR ama sondada "kapı yerine sed yakaladı" diye OKUNABİLMELİ.
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");

const TAG = `TEST-LV-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED];

async function bakiye(itemId: string, warehouseId: string): Promise<number> {
  const r = await prisma.yarnStock.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } }, select: { balanceKg: true } });
  return r ? Number(r.balanceKg) : 0;
}
async function netToplam(beamId: string, kind: YarnMovementKind, ters: YarnMovementKind): Promise<number> {
  const rows = await prisma.yarnMovement.findMany({ where: { warpBeamId: beamId, kind: { in: [kind, ters] } }, select: { kind: true, qtyKg: true } });
  return rows.reduce((acc, r) => acc + Number(r.qtyKg) * (r.kind === kind ? 1 : -1), 0);
}

function statik(): void {
  console.log("── §0 Statik ──");
  const mig = readFileSync(path.join(ROOT, "prisma/migrations/20260914125000_devere_warp_beams/migration.sql"), "utf8");
  const m = /"warp_beam_events_kind_ck" CHECK \("kind" IN \(([^)]*)\)\)/.exec(mig);
  const checkList = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort();
  check("§0a WARP_BEAM_EVENT_KINDS ↔ kind_ck İKİ YÖNLÜ eşit", JSON.stringify(checkList) === JSON.stringify([...WARP_BEAM_EVENT_KINDS].sort()), `${checkList.join(",")} ↔ ${WARP_BEAM_EVENT_KINDS.join(",")}`);
  const svc = readFileSync(path.join(ROOT, "src/services/warp-beam.service.ts"), "utf8") + readFileSync(path.join(ROOT, "src/services/warp-beam-wind.service.ts"), "utf8");
  check("§0b defter satırına update/delete YOK (append-only; iki servis dosyası)", !/warpBeamEvent\.(update|updateMany|delete|deleteMany|upsert)\(/.test(svc));
  const guard = readFileSync(path.join(ROOT, "src/services/helpers/yarn-balance-guard.helper.ts"), "utf8");
  check("§0c eksi-bakiye kümesi WARP_ISSUE ve WARP_RETURN_REVERSAL'ı kapılar", /GATED_KINDS[\s\S]*YarnMovementKind\.WARP_ISSUE[\s\S]*YarnMovementKind\.WARP_RETURN_REVERSAL/.test(guard));
  const routes = readFileSync(path.join(ROOT, "src/routes/yarn.routes.ts"), "utf8");
  const createEnum = /kind: z\.enum\(\[([^\]]*)\]\),\n/.exec(routes)?.[1] ?? "";
  check("§0d elle iplik hareketi ucu (create) WARP_* kabul ETMEZ", createEnum.length > 0 && !createEnum.includes("WARP_"), createEnum);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== LEVENT YAŞAM DÖNGÜSÜ BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const stDiger = await prisma.station.create({ data: { name: `${TAG}-TAMBUR`, code: `${TAG}-TB`.slice(0, 32), type: StationType.INTERNAL }, select: { id: true } });
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
  const mkDiger = await prisma.machine.create({ data: { stationId: stDiger.id, name: `${TAG}-M2`, code: `${TAG}-M2`.slice(0, 32) }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 1000 } });
  await prisma.yarnStock.create({ data: { itemId: yarn.id, warehouseId: wh.id, balanceKg: 1000 } });
  const beamIds: string[] = [];
  try {
    console.log("\n── §1 Körlük zemini ──");
    check("§1 fikstür doğdu (devere istasyonu + makine · iplik 300 den · çözgü 3500 tel · depo 1000 kg)", !!mk.id && (await bakiye(yarn.id, wh.id)) === 1000);

    console.log("\n── §2 Plan · replay · köken XOR ──");
    const token = crypto.randomUUID();
    const p1 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 7000, originKind: WarpBeamOrigin.IN_HOUSE, clientToken: token });
    beamIds.push(p1.data.id);
    check("§2a PLANNED doğdu, numara LV+GGAAYY+NNNN", p1.data.status === WarpBeamStatus.PLANNED && /^LV\d{6}\d{4}$/.test(p1.data.beamNo), p1.data.beamNo);
    const p1r = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 7000, originKind: WarpBeamOrigin.IN_HOUSE, clientToken: token });
    check("§2b aynı token → aynı levent (replay), ikinci satır YOK", p1r.data.id === p1.data.id && (await prisma.warpBeam.count({ where: { clientToken: token } })) === 1);
    check("§2c SUBCONTRACT fasoncusuz → 400 WARP_BEAM_ORIGIN_PARTY", kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.SUBCONTRACT }))) === "WARP_BEAM_ORIGIN_PARTY");
    check("§2d PURCHASED iki taraf birden → 400 (TAM BİRİ)", kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id, supplierId: sub.id }))) === "WARP_BEAM_ORIGIN_PARTY");
    check("§2e IN_HOUSE'a taraf yazıldı → 400", kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE, subcontractorId: sub.id }))) === "WARP_BEAM_ORIGIN_PARTY");
    const u = await updateWarpBeam(p1.data.id, { plannedLengthM: 7100 });
    check("§2f PLANNED düzenlenir", u.data.plannedLengthM === 7100);

    console.log("\n── §3 Sarım: WOUND gerçekleri + brüt iplik + dip iadesi ──");
    const wtoken = crypto.randomUUID();
    const w = await windWarpBeam(p1.data.id, { lengthM: 7000, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 850 }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 20, reasonCode: "DEPOYA_IADE" }], breakCount: 3, clientToken: wtoken });
    check("§3a READY, WOUND satırı: tel 3500 · denye 300 · 7000 m", w.data.status === WarpBeamStatus.READY && w.data.wound?.endsCount === 3500 && w.data.wound?.denier === 300 && w.data.wound?.lengthM === 7000);
    check("§3b ⭐ nominal kg = 3500 × 300 × 7000 / 9.000.000 = 816,667", w.data.wound?.theoreticalKg === 816.667, String(w.data.wound?.theoreticalKg));
    check("§3c iplik bakiyesi 1000 − 850 (brüt) + 20 (dip) = 170", (await bakiye(yarn.id, wh.id)) === 170, String(await bakiye(yarn.id, wh.id)));
    const det = await getWarpBeam(p1.data.id);
    check("§3d kalan metre 7000 · iplik satırları WARP_ISSUE 850 + WARP_RETURN 20 (sebep DEPOYA_IADE)", det.data.remainingM === 7000 && det.data.yarnLines.some((l) => l.kind === "WARP_ISSUE" && l.qtyKg === 850) && det.data.yarnLines.some((l) => l.kind === "WARP_RETURN" && l.reasonCode === "DEPOYA_IADE"));
    check("§3e PLANNED olmayan düzenlenemez → 409 WARP_BEAM_NOT_PLANNED", kod(await beklenenHata(() => updateWarpBeam(p1.data.id, { plannedLengthM: 1 }))) === "WARP_BEAM_NOT_PLANNED");

    console.log("\n── §4 Durum claim · replay ──");
    check("§4a ⭐ ikinci sarım → 409 WARP_BEAM_STATE (claim durum süzer)", kod(await beklenenHata(() => windWarpBeam(p1.data.id, { lengthM: 7000, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }] }))) === "WARP_BEAM_STATE");
    const wr = await windWarpBeam(p1.data.id, { lengthM: 7000, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 850 }], clientToken: wtoken });
    check("§4b aynı olay token'ı → idempotent (yeni satır/iplik YOK)", /yeniden gönderim/.test(wr.message ?? "") && (await prisma.warpBeamEvent.count({ where: { beamId: p1.data.id } })) === 1 && (await bakiye(yarn.id, wh.id)) === 170);
    const p2 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p2.data.id);
    check("§4c geçersiz dip sebebi → 400 REASON_CODE_INVALID, levent PLANNED kaldı", kod(await beklenenHata(() => windWarpBeam(p2.data.id, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10 }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 1, reasonCode: `YOK-${process.pid}` }] }))) === "REASON_CODE_INVALID" && (await prisma.warpBeam.findUnique({ where: { id: p2.data.id }, select: { status: true } }))?.status === WarpBeamStatus.PLANNED);

    console.log("\n── §5 Sarım iptali: önizleme · net ters · çift iptal ──");
    const pv = await cancelWoundPreview(p1.data.id);
    check("§5a önizleme: 850 kg çıkış tersi + 20 kg dip iadesi düşer (adıyla)", pv.data.issueReversals[0]?.qtyKg === 850 && pv.data.returnReversals[0]?.qtyKg === 20 && pv.data.returnReversals[0]?.reasonCode === "DEPOYA_IADE");
    const c = await cancelWound(p1.data.id, `${TAG} yanlış kart`);
    const ev = await prisma.warpBeamEvent.findMany({ where: { beamId: p1.data.id }, orderBy: { createdAt: "asc" }, select: { kind: true, reversesEventId: true, id: true } });
    check("§5b CANCELLED (terminal) + WOUND_CANCEL orijinaline bağlı", c.data.status === WarpBeamStatus.CANCELLED && ev.length === 2 && ev[1].kind === "WOUND_CANCEL" && ev[1].reversesEventId === ev[0].id);
    check("§5c ⭐ iplik NET geri: bakiye 1000; ISSUE net 0 VE RETURN net 0 (iki toplam AYRI AYRI)", (await bakiye(yarn.id, wh.id)) === 1000 && (await netToplam(p1.data.id, YarnMovementKind.WARP_ISSUE, YarnMovementKind.WARP_ISSUE_REVERSAL)) === 0 && (await netToplam(p1.data.id, YarnMovementKind.WARP_RETURN, YarnMovementKind.WARP_RETURN_REVERSAL)) === 0);
    check("§5d ters satırlar sebep taşır (WARP_RETURN_REVERSAL reasonCode DEPOYA_IADE)", (await prisma.yarnMovement.count({ where: { warpBeamId: p1.data.id, kind: YarnMovementKind.WARP_RETURN_REVERSAL, reasonCode: "DEPOYA_IADE" } })) === 1);
    check("§5e ikinci iptal → 409 (durum CANCELLED)", kod(await beklenenHata(() => cancelWound(p1.data.id, "tekrar"))) === "WARP_BEAM_STATE");
    check("§5f kalan metre 0", (await getWarpBeam(p1.data.id)).data.remainingM === 0);
    check("§5g iptal edilmiş token'la yeniden plan → 409 WARP_BEAM_CANCELLED", kod(await beklenenHata(() => createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 7100, originKind: WarpBeamOrigin.IN_HOUSE, clientToken: token }))) === "WARP_BEAM_CANCELLED");

    console.log("\n── §6 Taslak silme (④ sınıfı) ──");
    await deleteWarpBeamDraft(p2.data.id);
    check("§6a PLANNED taslak silindi (deftere hiç yazmamıştı)", (await prisma.warpBeam.count({ where: { id: p2.data.id } })) === 0);
    beamIds.splice(beamIds.indexOf(p2.data.id), 1);
    check("§6b sarılmış/iptal levent silinemez → 409", kod(await beklenenHata(() => deleteWarpBeamDraft(p1.data.id))) === "WARP_BEAM_NOT_PLANNED");

    console.log("\n── §7 Fason köken: iplik satırı YOK ──");
    const p3 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 1200, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p3.data.id);
    check("§7a fason levente iplik satırı yazılırsa → 400", (await beklenenHata(() => windWarpBeam(p3.data.id, { lengthM: 1200, kgSource: WarpKgSource.THEORETICAL, yarnIssues: [{ warehouseId: wh.id, qtyKg: 5 }] })))?.statusCode === 400);
    const w3 = await windWarpBeam(p3.data.id, { lengthM: 1200, kgSource: WarpKgSource.THEORETICAL });
    check("§7b fason sarım READY, machineId NULL, iplik satırı 0, bakiye değişmedi", w3.data.status === WarpBeamStatus.READY && w3.data.wound?.machine === null && (await prisma.yarnMovement.count({ where: { warpBeamId: p3.data.id } })) === 0 && (await bakiye(yarn.id, wh.id)) === 1000);

    console.log("\n── §8 Devere olmayan makine ──");
    const p4 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 300, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p4.data.id);
    check("§8 tambur makinesiyle sarım → 400 WARP_BEAM_MACHINE_NOT_DEVERE", kod(await beklenenHata(() => windWarpBeam(p4.data.id, { lengthM: 300, kgSource: WarpKgSource.WEIGHED, machineId: mkDiger.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 30 }] }))) === "WARP_BEAM_MACHINE_NOT_DEVERE");

    console.log("\n── §9 Paralel sarım: TAM BİRİ geçer ──");
    const yaris = await Promise.allSettled([1, 2].map(() => windWarpBeam(p4.data.id, { lengthM: 300, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 30 }] })));
    const gecen = yaris.filter((r) => r.status === "fulfilled").length;
    check("§9 ⭐ iki paralel sarımdan TAM BİRİ geçti; tek WOUND, iplik bir kez düştü (970)", gecen === 1 && (await prisma.warpBeamEvent.count({ where: { beamId: p4.data.id, kind: "WOUND" } })) === 1 && (await bakiye(yarn.id, wh.id)) === 970, `geçen=${gecen}`);
  } finally {
    await prisma.yarnMovement.deleteMany({ where: { OR: [{ warpBeamId: { in: beamIds } }, { itemId: yarn.id }] } });
    await prisma.yarnStock.deleteMany({ where: { itemId: yarn.id } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: { in: [mk.id, mkDiger.id] } } });
    await prisma.station.deleteMany({ where: { id: { in: [st.id, stDiger.id] } } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.update({ where: { key }, data: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
