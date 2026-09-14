// =============================================================================
// LEVENT TEZGAH BAĞI — devere Faz 3: tak → tüket/düzelt → sök → bitir/hurda → LIFO geri alma
// =============================================================================
// NEDEN: Faz 3 leventi tezgaha BAĞLAR (yuva seddi + "şu an ne" kolonları) ve kalanı DEFTERDEN
// türetir. Bu bekçi tasarımın (DEVERE-LEVENT-TARAMASI §4.7 · §7.3) kalemlerini GERÇEK DB'de ölçer:
// bayrak kapısı (varsayılan KAPALI = bugün, ölçülü), yuva aralığı/dolu yuva, yöntem zorunluluğu
// bayrağı, tüketim/düzeltme/eksiye düşme yasağı, açık koşumda söküm kapısı, ölçülen kalana kapatma,
// tartıdan metre, terminal bitiş/hurda, LIFO iptal, paralel bağlamada TAM BİRİ.
//
// Bölümler: §0 statik · §1 fikstür + bayrak KAPALI 409 · §2 bağla · §3 zorunlu bayrağı · §4 tüket/
//   düzelt · §5 koşum kapısı + ölçülü söküm · §6 LIFO · §7 yarış · §8 bitiş · §9 hurda.
// NEGATİF SONDALAR (2026-09-14): `assertCoversRemaining` gövdesi boşaltıldı → §4b kırmızı ·
//   `assertSlotFreeTx` çağrısı düşürüldü → §2e kırmızı (sed 409'a çevrilir ama meşgul levent ADI kaybolur) · `assertMountTrackingOnTx`
//   boşaltıldı → §1b kırmızı · `activeForwardStatusEventTx` orderBy asc → §6b HATA (en yeni yerine en eski olay).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { WARP_BEAM_CANCEL_OF, WARP_BEAM_STATUS_EVENT_KINDS, warpBeamLengthSign } from "../src/constants/warp-beam";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelStatusEvent, dismountBeam, listMountedOnMachine, mountBeam } from "../src/services/warp-beam-mount.service";
import { adjustBeam, cancelConsumed, consumeBeam, exhaustBeam, scrapBeam, scrapPreview } from "../src/services/warp-beam-consume.service";
import { closeMachineRun, openMachineRun } from "../src/services/machine-run.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { ACTIVE_FORWARD_EVENT_SQL, BEAMS_MOUNTED_DURING_SQL } from "../src/services/helpers/warp-beam-mount.helper";
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
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const TAG = `TEST-LM-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const kalan = async (id: string) => (await getWarpBeam(id)).data.remainingM;
const durum = async (id: string) => prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: { status: true, currentMachineId: true, currentPosition: true } });
const olay = (beamId: string, kind: string) => prisma.warpBeamEvent.findFirst({ where: { beamId, kind }, orderBy: { createdAt: "desc" }, select: { id: true, lengthM: true, machineId: true, mountPosition: true, reasonCode: true, lengthSource: true, reversesEventId: true } });

function statik(): void {
  console.log("── §0 Statik ──");
  const cift = Object.entries(WARP_BEAM_CANCEL_OF).filter(([k, c]) => warpBeamLengthSign(k as never) + warpBeamLengthSign(c as never) !== 0);
  check("§0a her ileri/ters çiftinin işaret toplamı 0 (geri alma kalanı tam geri getirir)", cift.length === 0, cift.map(([k]) => k).join(","));
  const svc = ["src/services/warp-beam-mount.service.ts", "src/services/warp-beam-consume.service.ts", "src/services/helpers/warp-beam-ledger.helper.ts", "src/services/helpers/warp-beam-mount.helper.ts"].map((f) => readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  check("§0b Faz 3 yazarlarında defter satırına update/delete YOK", !/warpBeamEvent\.(update|updateMany|delete|deleteMany|upsert)\(/.test(svc));
  const rt = readFileSync(path.join(ROOT, "src/routes/warp-beam-mount.routes.ts"), "utf8");
  const yikici = ["/:id/scrap", "/:id/events/:eventId/cancel", "/:id/consumed/:eventId/cancel"].filter((p) => !new RegExp(`"${p.replace(/[/:]/g, (c) => "\\" + c)}", requireAnyPermission\\("warpbeam:cancel"`).test(rt));
  check("§0c yıkıcı uçlar (hurda · geri almalar) `warpbeam:cancel` taşır", yikici.length === 0, yikici.join(","));
  check("§0d ACTIVE_FORWARD_EVENT_SQL ↔ WARP_BEAM_STATUS_EVENT_KINDS (boğaz-ikiz)", WARP_BEAM_STATUS_EVENT_KINDS.every((k) => ACTIVE_FORWARD_EVENT_SQL.includes(`'${k}'`)));
  check("§0e koşum penceresi SQL'i dört kapatıcıyı tanır (DISMOUNTED · EXHAUSTED · SCRAPPED · SHIP_OUT)", ["DISMOUNTED", "EXHAUSTED", "SCRAPPED", "SHIP_OUT"].every((k) => BEAMS_MOUNTED_DURING_SQL.includes(`'${k}'`)));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== LEVENT TEZGAH BAĞI BEKÇİSİ (Faz 3) ===\n");
  statik();
  await reconcileReasonPresets();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stDv = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, consumesWarpBeam: true }, select: { id: true } });
  const mkDv = await prisma.machine.create({ data: { stationId: stDv.id, name: `${TAG}-DV1`, code: `${TAG}-DV1`.slice(0, 32) }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true, code: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const beamIds: string[] = [];
  const runIds: string[] = [];
  const sar = async (m: number) => {
    // Fason köken: iplik defteri devre dışı (iplik modülü KAPALI) — bu bekçi yalnız levent defterini ölçer.
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  try {
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, false);
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED] } } });

    console.log("\n── §1 Fikstür · bayrak KAPALI (varsayılan = bugün) ──");
    const b1 = await sar(1000);
    check("§1a levent READY, kalan 1000, tezgah bağı boş", (await durum(b1)).status === WarpBeamStatus.READY && (await kalan(b1)) === 1000 && (await durum(b1)).currentMachineId === null);
    check("§1b ⭐ bayrak satırı YOK → bağlama 409 WARP_MOUNT_TRACKING_OFF (bugünkü davranış: levent hazır kalır)", kod(await beklenenHata(() => mountBeam(b1, { machineId: loom.id, position: 1 }))) === "WARP_MOUNT_TRACKING_OFF" && (await durum(b1)).status === WarpBeamStatus.READY);
    check("§1c bayrak KAPALI: tüketim de 409 (kalan defteri yazılmaz)", kod(await beklenenHata(() => consumeBeam(b1, { lengthM: 10, lengthSource: "LOOM_COUNTER" }))) === "WARP_MOUNT_TRACKING_OFF");
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);

    console.log("\n── §2 Bağla ──");
    check("§2a devere makinesine bağlama → 400 WARP_BEAM_MACHINE_NOT_LOOM", kod(await beklenenHata(() => mountBeam(b1, { machineId: mkDv.id, position: 1 }))) === "WARP_BEAM_MACHINE_NOT_LOOM");
    check("§2b yuva 3 (makinede 2) → 400 WARP_SLOT_OUT_OF_RANGE", kod(await beklenenHata(() => mountBeam(b1, { machineId: loom.id, position: 3 }))) === "WARP_SLOT_OUT_OF_RANGE");
    const tok = crypto.randomUUID();
    const m1 = await mountBeam(b1, { machineId: loom.id, position: 1, mountMethod: "DRAWING_IN", clientToken: tok });
    check("§2c MOUNTED · currentMachine/yuva 1 · MOUNTED satırı makine+yuva taşır", m1.data.status === WarpBeamStatus.MOUNTED && m1.data.currentMachine?.id === loom.id && m1.data.currentPosition === 1 && (await olay(b1, "MOUNTED"))?.mountPosition === 1);
    const m1r = await mountBeam(b1, { machineId: loom.id, position: 1, clientToken: tok });
    check("§2d aynı token → replay, ikinci MOUNTED satırı YOK", /yeniden gönderim/.test(m1r.message ?? "") && (await prisma.warpBeamEvent.count({ where: { beamId: b1, kind: "MOUNTED" } })) === 1);
    const b2 = await sar(500);
    const e2e = await beklenenHata(() => mountBeam(b2, { machineId: loom.id, position: 1 }));
    check("§2e ⭐ dolu yuvaya ikinci levent → 409 WARP_SLOT_BUSY, meşgul levent ADIYLA (ön kontrol; sed yalnız yarış hattı)", kod(e2e) === "WARP_SLOT_BUSY" && (e2e?.details as { busyBeamNo?: string } | undefined)?.busyBeamNo === m1.data.beamNo, kod(e2e));
    check("§2f MOUNTED levent yeniden bağlanamaz → 409 WARP_BEAM_STATE", kod(await beklenenHata(() => mountBeam(b1, { machineId: loom.id, position: 2 }))) === "WARP_BEAM_STATE");
    const mounted = await listMountedOnMachine(loom.id);
    check("§2g makinedeki bağlı liste: 1 levent, yuva 1, kalan 1000", mounted.data.length === 1 && mounted.data[0].position === 1 && mounted.data[0].remainingM === 1000);

    console.log("\n── §3 Zorunlu bayrağı (yöntem + başlangıç) ──");
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED, true);
    check("§3a zorunlu AÇIK, yöntemsiz → 400 WARP_MOUNT_METHOD_REQUIRED", kod(await beklenenHata(() => mountBeam(b2, { machineId: loom.id, position: 2 }))) === "WARP_MOUNT_METHOD_REQUIRED");
    const m2 = await mountBeam(b2, { machineId: loom.id, position: 2, mountMethod: "TYING_IN", setupStartedAt: new Date(Date.now() - 3_600_000), setupMinutes: 45 });
    check("§3b yöntem + saat ile bağlandı (yuva 2, setupMinutes 45)", m2.data.status === WarpBeamStatus.MOUNTED && m2.data.currentPosition === 2 && (await prisma.warpBeamEvent.findFirst({ where: { beamId: b2, kind: "MOUNTED" }, select: { setupMinutes: true } }))?.setupMinutes === 45);
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED, false);

    console.log("\n── §4 Tüket · düzelt · eksiye düşme yasağı ──");
    const ctok = crypto.randomUUID();
    await consumeBeam(b1, { lengthM: 300, lengthSource: "LOOM_COUNTER", machineCounter: 300, clientToken: ctok });
    await consumeBeam(b1, { lengthM: 300, lengthSource: "LOOM_COUNTER", clientToken: ctok });
    check("§4a 300 m tüketildi, replay ikinci satır yazmadı: kalan 700, durum MOUNTED değişmedi", (await kalan(b1)) === 700 && (await prisma.warpBeamEvent.count({ where: { beamId: b1, kind: "CONSUMED" } })) === 1 && (await durum(b1)).status === WarpBeamStatus.MOUNTED);
    check("§4b ⭐ 800 m tüketim (kalan 700) → 409 WARP_BEAM_REMAINING_EXCEEDED", kod(await beklenenHata(() => consumeBeam(b1, { lengthM: 800, lengthSource: "ESTIMATED" }))) === "WARP_BEAM_REMAINING_EXCEEDED" && (await kalan(b1)) === 700);
    check("§4c düzeltme sebepsiz → 400 REASON_CODE_REQUIRED", kod(await beklenenHata(() => adjustBeam(b1, { direction: "OUT", lengthM: 10, reasonCode: "" }))) === "REASON_CODE_REQUIRED");
    check("§4d geçersiz sebep → 400 REASON_CODE_INVALID", kod(await beklenenHata(() => adjustBeam(b1, { direction: "OUT", lengthM: 10, reasonCode: `YOK-${process.pid}` }))) === "REASON_CODE_INVALID");
    await adjustBeam(b1, { direction: "OUT", lengthM: 100, reasonCode: "SAYAC_DUZELTME" });
    check("§4e ADJUST_OUT 100 (SAYAC_DUZELTME) → kalan 600", (await kalan(b1)) === 600 && (await olay(b1, "ADJUST_OUT"))?.reasonCode === "SAYAC_DUZELTME");
    check("§4f ADJUST_OUT 700 (kalan 600) → 409 (aynı tek kapı)", kod(await beklenenHata(() => adjustBeam(b1, { direction: "OUT", lengthM: 700, reasonCode: "SAYAC_DUZELTME" }))) === "WARP_BEAM_REMAINING_EXCEEDED");
    const cons = await olay(b1, "CONSUMED");
    await cancelConsumed(b1, cons!.id, `${TAG} yanlış sayaç`);
    check("§4g CONSUMED_CANCEL → kalan 900; satır silinmedi, ters bağ (reversesEventId)", (await kalan(b1)) === 900 && (await prisma.warpBeamEvent.count({ where: { beamId: b1, kind: "CONSUMED" } })) === 1 && (await olay(b1, "CONSUMED_CANCEL"))?.reversesEventId === cons!.id);
    check("§4h aynı tüketim ikinci kez geri alınamaz → 409 WARP_BEAM_ALREADY_CANCELLED", kod(await beklenenHata(() => cancelConsumed(b1, cons!.id, "tekrar"))) === "WARP_BEAM_ALREADY_CANCELLED");

    console.log("\n── §5 Açık koşum kapısı · ölçülü söküm ──");
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    const r1 = await openMachineRun({ machineId: loom.id, productionLineNo: 1 });
    runIds.push(r1.data.id);
    check("§5a iki yuva dolu → koşum açılışında levent uyarısı YOK", !(r1.warnings ?? []).some((w) => /levent/.test(w)));
    const d2 = await dismountBeam(b2, {});
    check("§5b açık koşumda ikinci leventi sökmek → geçer + UYARI (2 yuvadan 1 dolu)", d2.data.status === WarpBeamStatus.READY && (d2.warnings ?? []).some((w) => /yuvadan 1 dolu/.test(w)));
    check("§5c ⭐ açık koşumda SON leventi sökmek → 409 WARP_DISMOUNT_OPEN_RUN", kod(await beklenenHata(() => dismountBeam(b1, {}))) === "WARP_DISMOUNT_OPEN_RUN" && (await durum(b1)).status === WarpBeamStatus.MOUNTED);
    await closeMachineRun(r1.data.id, {});
    const d1 = await dismountBeam(b1, { remainingM: 850, lengthSource: "DIAMETER" });
    const dEv = await olay(b1, "DISMOUNTED");
    check("§5d ölçülen kalan 850 (< türetilen 900) → önce CONSUMED 50 (DIAMETER), sonra DISMOUNTED; kalan 850, READY, yuva boş", d1.data.status === WarpBeamStatus.READY && (await kalan(b1)) === 850 && (await prisma.warpBeamEvent.count({ where: { beamId: b1, kind: "CONSUMED", lengthM: 50, lengthSource: "DIAMETER" } })) === 1 && (await durum(b1)).currentMachineId === null);
    check("§5e DISMOUNTED satırı makine + yuvayı KOPYALAR (rapor penceresi)", dEv?.machineId === loom.id && dEv?.mountPosition === 1);
    const r2 = await openMachineRun({ machineId: loom.id, productionLineNo: 1 });
    runIds.push(r2.data.id);
    check("§5f leventsiz koşum AÇILIR ama uyarır (bağlı levent yok)", r2.success && (r2.warnings ?? []).some((w) => /bağlı levent yok/.test(w)));
    await closeMachineRun(r2.data.id, {});
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, false);

    console.log("\n── §6 LIFO geri alma ──");
    const mEv = await olay(b1, "MOUNTED");
    check("§6a ⭐ eski MOUNTED geri alınamaz (son durum olayı DISMOUNTED) → 409 WARP_BEAM_CANCEL_NOT_LAST", kod(await beklenenHata(() => cancelStatusEvent(b1, mEv!.id, `${TAG} deneme`))) === "WARP_BEAM_CANCEL_NOT_LAST");
    const dc = await cancelStatusEvent(b1, dEv!.id, `${TAG} yanlış söküm`);
    check("§6b DISMOUNT_CANCEL → MOUNTED, yuva 1'e geri; kalan 850 değişmedi", dc.data.status === WarpBeamStatus.MOUNTED && dc.data.currentPosition === 1 && (await kalan(b1)) === 850 && (await olay(b1, "DISMOUNT_CANCEL"))?.reversesEventId === dEv!.id);
    await mountBeam(b2, { machineId: loom.id, position: 2 });
    await dismountBeam(b2, {});
    const b3 = await sar(200);
    await mountBeam(b3, { machineId: loom.id, position: 2 });
    const d2Ev = await olay(b2, "DISMOUNTED");
    check("§6c yuvası başka leventle dolmuş sökümü geri almak → 409 WARP_SLOT_BUSY", kod(await beklenenHata(() => cancelStatusEvent(b2, d2Ev!.id, `${TAG} geri`))) === "WARP_SLOT_BUSY" && (await durum(b2)).status === WarpBeamStatus.READY);
    const wEv = await olay(b2, "WOUND");
    check("§6d WOUND bu uçtan geri alınmaz (LIFO'da son değil → 409; kendi ucu var)", kod(await beklenenHata(() => cancelStatusEvent(b2, wEv!.id, `${TAG} sarım`))) === "WARP_BEAM_CANCEL_NOT_LAST");
    await dismountBeam(b3, {});

    console.log("\n── §7 Paralel bağlama: TAM BİRİ ──");
    const yaris = await Promise.allSettled([b2, b3].map((id) => mountBeam(id, { machineId: loom.id, position: 2 })));
    const gecen = yaris.filter((r) => r.status === "fulfilled").length;
    const red = yaris.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    check("§7 ⭐ aynı yuvaya iki paralel bağlamadan TAM BİRİ geçti, diğeri 409 WARP_SLOT_BUSY", gecen === 1 && kod(red?.reason instanceof AppError ? red.reason : null) === "WARP_SLOT_BUSY", `geçen=${gecen} kod=${kod(red?.reason instanceof AppError ? red.reason : null)}`);
    const slot2 = await prisma.warpBeam.count({ where: { status: WarpBeamStatus.MOUNTED, currentMachineId: loom.id, currentPosition: 2 } });
    check("§7b yuva 2'de tam bir levent (sed + claim tutarlı)", slot2 === 1);

    console.log("\n── §8 Bitiş (EXHAUSTED) ──");
    const x1 = await exhaustBeam(b1, { residualM: 50 });
    check("§8a artık 50 (türetilen 850) → CONSUMED 800 sonra EXHAUSTED 50; kalan 0, terminal, yuva boşaldı", x1.data.status === WarpBeamStatus.EXHAUSTED && (await kalan(b1)) === 0 && (await olay(b1, "EXHAUSTED"))?.lengthM?.toNumber() === 50 && (await prisma.warpBeamEvent.count({ where: { beamId: b1, kind: "CONSUMED", lengthM: 800 } })) === 1 && (await durum(b1)).currentMachineId === null);
    check("§8b terminal levente tüketim → 409 WARP_BEAM_STATE", kod(await beklenenHata(() => consumeBeam(b1, { lengthM: 1, lengthSource: "ESTIMATED" }))) === "WARP_BEAM_STATE");
    const xc = await cancelStatusEvent(b1, (await olay(b1, "EXHAUSTED"))!.id, `${TAG} erken bitiş`);
    check("§8c EXHAUST_CANCEL → MOUNTED yuva 1'e döner, kalan 50 (kapatma satırı kalır — ölçüm defteri)", xc.data.status === WarpBeamStatus.MOUNTED && xc.data.currentPosition === 1 && (await kalan(b1)) === 50);
    const b4 = await sar(100);
    const x4 = await exhaustBeam(b4, { grossKg: 20, tareKg: 8 });
    const adj = await olay(b4, "ADJUST_IN");
    check("§8d ⭐ tartı: (20−8) ÷ (3500×300÷9e6) = 102,857 m > kalan 100 → ADJUST_IN 2,857 (OLCUM_FARKI) + EXHAUSTED WEIGHED; kalan 0", x4.data.status === WarpBeamStatus.EXHAUSTED && adj?.reasonCode === "OLCUM_FARKI" && adj?.lengthM?.toNumber() === 2.857 && (await olay(b4, "EXHAUSTED"))?.lengthSource === "WEIGHED" && (await kalan(b4)) === 0, String(adj?.lengthM));
    const b5 = await sar(30);
    const x5 = await exhaustBeam(b5, { grossKg: 5 });
    check("§8e dara yok → metre türetilemez: ESTIMATED, artık 0 (lengthM null), UYARI", x5.data.status === WarpBeamStatus.EXHAUSTED && (x5.warnings ?? []).some((w) => /Dara/.test(w)) && (await olay(b5, "EXHAUSTED"))?.lengthM === null && (await olay(b5, "EXHAUSTED"))?.lengthSource === "ESTIMATED");

    console.log("\n── §9 Hurda (SCRAPPED) ──");
    const pv = await scrapPreview(b1);
    check("§9a önizleme: kalan 50, tezgah + yuva 1, açık koşum 0", pv.data.remainingM === 50 && pv.data.currentMachine?.id === loom.id && pv.data.currentPosition === 1 && pv.data.openRunsOnMachine === 0);
    check("§9b sebepsiz hurda → 400 REASON_CODE_REQUIRED", kod(await beklenenHata(() => scrapBeam(b1, { reasonCode: "" }))) === "REASON_CODE_REQUIRED");
    const s1 = await scrapBeam(b1, { reasonCode: "DIP_TELEF" });
    check("§9c SCRAPPED terminal, lengthM = kalan (50), kalan 0, yuva boş", s1.data.status === WarpBeamStatus.SCRAPPED && (await olay(b1, "SCRAPPED"))?.lengthM?.toNumber() === 50 && (await kalan(b1)) === 0 && (await durum(b1)).currentPosition === null);
    const sc = await cancelStatusEvent(b1, (await olay(b1, "SCRAPPED"))!.id, `${TAG} yanlış hurda`);
    check("§9d SCRAP_CANCEL → MOUNTED yuva 1, kalan 50", sc.data.status === WarpBeamStatus.MOUNTED && sc.data.currentPosition === 1 && (await kalan(b1)) === 50);
    check("§9e mutabakat: MOUNTED ⇔ (currentMachineId ∧ currentPosition) tüm fikstürde", (await prisma.warpBeam.count({ where: { id: { in: beamIds }, OR: [{ status: WarpBeamStatus.MOUNTED, currentMachineId: null }, { status: { not: WarpBeamStatus.MOUNTED }, currentMachineId: { not: null } }] } })) === 0);
  } finally {
    await prisma.machineRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.yarnMovement.deleteMany({ where: { warpBeamId: { in: beamIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: { in: [mkDv.id, loom.id] } } });
    await prisma.station.deleteMany({ where: { id: { in: [stDv.id, stLoom.id] } } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
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
