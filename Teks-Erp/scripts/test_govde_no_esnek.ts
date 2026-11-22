// =============================================================================
// GÖVDE NO ESNEK EŞLEŞME + TARTILI BİTİŞTE DARA GÖVDEDEN — devere S3 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §0 saf kural: backend ↔ mobil kopya BAYT-AYNI · vektör tablosu · TEK boğaz (bodyNo eşitliği yalnız helper'da)
//   §1 ayar KAPALI: "0042"/"lg 42" bulunmaz (404) · birebir bulunur (matchedBy yok, uyarı yok) — bugünkü davranış
//   §2 ayar AÇIK + tek aday → bulunur + matchedBy NORMALIZED + uyarı
//   §3 iki aday → 409 BEAM_BODY_NO_AMBIGUOUS + aday listesi · kayıtta normalize çakışma UYARIR (engellemez)
//   §4 tartılı bitiş, ayar AÇIK + gövde darası → WEIGHED, metre = warpLengthFromWeight, dara olaya kopya, not
//   §5 ayar KAPALI → ESTIMATED 0 (bugün) · §6 gövdesiz levent ayar açıkken de ESTIMATED 0 · §6b beyan dara önceliklidir
// NEGATİF SONDA: `stripZeros` sondaki sıfır kuralı kaldırılınca §0b ve §2a kırmızı (2026-11-22).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Prisma, StationType, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { createBeamBody } from "../src/services/beam-body/write";
import { resolveBeamBody } from "../src/services/beam-body/read";
import { exhaustBeam } from "../src/services/warp-beam-consume.service";
import { warpLengthFromWeight } from "../src/services/helpers/warp-beam-mount.helper";
import { beamBodyNoKey, beamBodyNoLooseMatch } from "../src/utils/beam-body-no";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TSTGN${process.pid}`;
type Err = { status?: number; code?: string; details?: Record<string, unknown>; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: Record<string, unknown> & { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, details: x.details, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, SETTING_KEYS.DEVERE_RESIDUAL_TARE_FROM_BODY,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

const ROOT = path.resolve(__dirname, "..", "..");
const VECTORS: Array<[string, string, boolean]> = [
  ["012", "12", true], ["lg 12", "LG-12", true], ["LG-012", "LG-12", true], ["12", "LG-0012", true], ["012", "LG-12", true],
  ["12", "LG-112", false], ["LG-12", "12", false], ["MX-12", "LG-12", false], ["", "LG-12", false], ["TSTGN1234 42", "TSTGN1234-0042", true],
];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function staticChecks(): void {
  const be = readFileSync(path.join(ROOT, "Teks-Erp/src/utils/beam-body-no.ts"));
  const mo = readFileSync(path.join(ROOT, "mobil/src/utils/beamBodyNo.ts"));
  check("§0a backend ↔ mobil kural kopyası bayt-aynı", be.equals(mo), `${be.length}/${mo.length} bayt`);
  const bad = VECTORS.filter(([a, b, ok]) => beamBodyNoLooseMatch(a, b) !== ok);
  check("§0b vektör tablosu (baştaki sıfır · ayraç · yalnız-rakam kuyruk · ön ek farkı)", bad.length === 0 && beamBodyNoKey("LG-012") === "lg12", bad.map((v) => v.join("↔")).join(" | "));
  // TEK boğaz: gövde no eşitliği (`bodyNo: { equals`) yalnız helper'da ve iki kayıt kapısının tekillik yükleminde
  // (elle kayıt + devere dönüşünde yerinde tanım) — tekillik birebirdir, esnek değildir.
  const allowed = new Set(["src/services/helpers/beam-body-no.helper.ts", "src/services/beam-body/write.ts", "src/services/warping-order/receive-body.ts"]);
  const files = [...listTs(path.join(ROOT, "Teks-Erp/src")), path.join(ROOT, "Teks-Erp/scripts/fix_beam_body_from_physical_no.ts")];
  const hits = files.filter((f) => /bodyNo:\s*\{\s*equals/.test(readFileSync(f, "utf8"))).map((f) => path.relative(path.join(ROOT, "Teks-Erp"), f));
  const stray = hits.filter((h) => !allowed.has(h));
  check("§0c gövde no eşitliği yalnız helper'da (çözüm ucu + onarım betiği helper'dan geçer)", stray.length === 0 && hits.includes("src/services/helpers/beam-body-no.helper.ts"), stray.join(", ") || `${hits.length} izinli`);
  const fix = readFileSync(path.join(ROOT, "Teks-Erp/scripts/fix_beam_body_from_physical_no.ts"), "utf8");
  check("§0d onarım betiği matchBeamBodyNo kullanır", /matchBeamBodyNo\(/.test(fix));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== GÖVDE NO ESNEK + DARA GÖVDEDEN (devere S3) ===");
  staticChecks();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const mk = async (bodyNo: string, tareKg: number | null = null) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo, owner: { kind: "OURS" }, warehouseId: W, tareKg }, U));
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DOKUMA_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"],
      [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"], [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_MOUNT_TRACKING, "true"],
      [SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "false"], [SETTING_KEYS.DEVERE_RESIDUAL_TARE_FROM_BODY, "false"]] as const) await setSetting(k, v);

    // ── §1 ayar KAPALI ────────────────────────────────────────────────────
    const A = (await mk(`${TAG}-0042`, 95)).data;
    const off1 = await errOf(() => resolveBeamBody(`${TAG} 42`));
    const off2 = await errOf(() => resolveBeamBody(`${TAG}-42`));
    check("§1a kapalı: ayraç/sıfır farklı yazım bulunmaz → 404 BEAM_BODY_NOT_FOUND", off1?.code === "BEAM_BODY_NOT_FOUND" && off2?.code === "BEAM_BODY_NOT_FOUND", `${show(off1)} · ${show(off2)}`);
    const ex = await resolveBeamBody(`${TAG.toLowerCase()}-0042`);
    check("§1b kapalı: birebir (harf farkı) bulunur, matchedBy/uyarı yok", ex.data.id === A.id && ex.data.matchedBy === undefined && ex.warnings === undefined);

    // ── §2 ayar AÇIK, tek aday ───────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "true");
    const on1 = await resolveBeamBody(`${TAG.toLowerCase()} 42`).catch((e: unknown) => String(e));
    check("§2a açık: \"tag 42\" → A + matchedBy NORMALIZED + uyarı", typeof on1 !== "string" && on1.data.id === A.id && on1.data.matchedBy === "NORMALIZED" && (on1.warnings?.length ?? 0) === 1, typeof on1 === "string" ? on1.slice(0, 140) : JSON.stringify({ m: on1.data.matchedBy, w: on1.warnings }));
    const on2 = await resolveBeamBody(`${TAG}-0042`);
    check("§2b açık: birebir yine EXACT (uyarısız)", on2.data.id === A.id && on2.data.matchedBy === undefined && on2.warnings === undefined);

    // ── §3 iki aday · kayıt çakışma uyarısı ─────────────────────────────
    const Bout = await mk(`${TAG}-42.`, null);
    check("§3a kayıt: normalize çakışma uyarır, engellemez", (Bout.warnings?.length ?? 0) === 1 && Bout.warnings![0]!.includes(A.bodyNo), JSON.stringify(Bout.warnings));
    const amb = await errOf(() => resolveBeamBody(`${TAG} 042`));
    const cands = (amb?.details?.candidates as Array<{ bodyNo: string }> | undefined) ?? [];
    check("§3b iki aday → 409 BEAM_BODY_NO_AMBIGUOUS + aday listesi", amb?.status === 409 && amb.code === "BEAM_BODY_NO_AMBIGUOUS" && cands.length === 2, show(amb));
    await setSetting(SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "false");
    const quiet = await mk(`${TAG}-0042-X`, null);
    check("§3c ayar kapalıyken kayıt uyarısız (bugün)", quiet.warnings === undefined);

    // ── §4–§6 tartılı bitiş ──────────────────────────────────────────────
    const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    yarnIds.push(yarn.id);
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L` }, select: { id: true } });
    lotIds.push(lot.id);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id, reason: `${TAG} giriş` }));
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn.id, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } });
    specIds.push(spec.id);
    const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 5, beamLengthM: 100 }] }, U);
    orderIds.push(r.data.id);
    await dispatchWarpingOrder(r.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn.id, warehouseId: W, lotId: lot.id, qtyKg: 50 }] }, U);
    const C = (await mk(`${TAG}-C1`, 95)).data;
    const D = (await mk(`${TAG}-D1`, 95)).data;
    const E = (await mk(`${TAG}-E1`, 95)).data;
    const L = (extra: Partial<WarpingReceiveBeamInput> = {}): WarpingReceiveBeamInput => ({ lengthM: 100, ...extra });
    const rec = await receiveWarpingOrder(r.data.id, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-DV`, beams: [L({ beamBodyId: C.id }), L({ beamBodyId: D.id }), L(), L({ beamBodyId: E.id })] }, U);
    const beams = await prisma.warpBeam.findMany({ where: { warpingReceiptKey: rec.receiptKey }, orderBy: { beamNo: "asc" }, select: { id: true, beamBodyId: true } });
    const onC = beams.find((b) => b.beamBodyId === C.id)!;
    const onD = beams.find((b) => b.beamBodyId === D.id)!;
    const onE = beams.find((b) => b.beamBodyId === E.id)!;
    const bare = beams.find((b) => b.beamBodyId === null)!;
    const lastEx = (beamId: string) => prisma.warpBeamEvent.findFirst({ where: { beamId, kind: "EXHAUSTED" }, select: { lengthM: true, lengthSource: true, tareKg: true, reason: true } });
    const kgPerM = new Prisma.Decimal(3000).mul(150).div(9_000_000);

    await setSetting(SETTING_KEYS.DEVERE_RESIDUAL_TARE_FROM_BODY, "true");
    await exhaustBeam(onC.id, { grossKg: 96 }, U);
    const eC = await lastEx(onC.id);
    const want = warpLengthFromWeight(96, 95, kgPerM);
    check("§4a açık + gövde darası → WEIGHED, metre = warpLengthFromWeight(96, 95)", eC?.lengthSource === "WEIGHED" && want !== null && eC.lengthM?.equals(want) === true, `${eC?.lengthSource} ${eC?.lengthM?.toString()} / ${want?.toString()}`);
    check("§4b dara olaya kopyalandı + \"dara gövdeden\" notu", eC?.tareKg?.toNumber() === 95 && /dara gövdeden/i.test(eC.reason ?? ""), `${eC?.tareKg?.toString()} ${eC?.reason}`);

    const wBare = await exhaustBeam(bare.id, { grossKg: 96 }, U);
    const eBare = await lastEx(bare.id);
    check("§6 gövdesiz levent: açıkken de ESTIMATED 0 + uyarı", eBare?.lengthSource === "ESTIMATED" && eBare.lengthM === null && eBare.tareKg === null && (wBare.warnings?.length ?? 0) > 0, `${eBare?.lengthSource} ${eBare?.lengthM?.toString()}`);
    await exhaustBeam(onE.id, { grossKg: 96, tareKg: 94 }, U);
    const eE = await lastEx(onE.id);
    check("§6b beyan dara önceliklidir (gövde darası kullanılmaz, not yok)", eE?.tareKg?.toNumber() === 94 && !/dara gövdeden/i.test(eE.reason ?? ""), `${eE?.tareKg?.toString()} ${eE?.reason}`);

    await setSetting(SETTING_KEYS.DEVERE_RESIDUAL_TARE_FROM_BODY, "false");
    await exhaustBeam(onD.id, { grossKg: 96 }, U);
    const eD = await lastEx(onD.id);
    check("§5 kapalı → ESTIMATED 0, dara null (bugünkü davranış)", eD?.lengthSource === "ESTIMATED" && eD.lengthM === null && eD.tareKg === null, `${eD?.lengthSource} ${eD?.lengthM?.toString()} ${eD?.tareKg?.toString()}`);
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { beamBodyId: { in: ids } }] }, select: { id: true } })).map((x) => x.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...ids, ...beamIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
