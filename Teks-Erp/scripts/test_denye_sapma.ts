// =============================================================================
// DEVERE F1 — DENYE SAPMA raporu + [Uygula] (GERÇEK DB, servis yolu)
// =============================================================================
// Fikstür (900 tel × 1000 m; 70 den → 7 kg nominal): X 5 tartılı sarım +%4 (net 7,28) → öneri 72,80 ·
//   Y (50 den) 2 sarım → yetersiz · Z (60 den) 3 sarım +%1 → eşik altı · karma kart (X+Y) 2 sarım → karma satırı ·
//   darasız / tartısız sarım sayılmaz · geri alınmış kabul sayılmaz · başka devereci süzgeçle düşer.
// Kapsam: F1 · F2 · F3 · F4 · F5 (storno) · F7 süzgeç sunucuda + fabrika günü + aralık 400 · F8 [Uygula] atomik
//   (kart güncellenir, WOUND kopyası değişmez, tekrar deneme idempotent, bayat beklenen 409, yarışta tek kazanan,
//   iplik dışı 400, geçersiz 400, yok 404, audit) · iki eşik ayarı okuyucusu (kayıt yok = 3 / 2, çöp → varsayılan).
// NEGATİF SONDA (koşuldu 2026-11-20): bkz. arşiv notu "Devere F1 — denye sapma raporu".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, ensureTestSander, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { SETTING_KEYS, readDevereDenierSuggestMinBeams, readDevereDenierSuggestThresholdPct } from "../src/services/system-setting.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { applyDenierSuggestion, getDenierDeviationReport, type DenierDeviationQuery } from "../src/services/denier-deviation.service";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-DNS-${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE F1 — DENYE SAPMA ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sander = await ensureTestSander();
  const orderIds: string[] = [];
  const itemIds: string[] = [];
  const specIds: string[] = [];
  try {
    for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT] } } });

    // ── Ayar okuyucuları ────────────────────────────────────────────────
    check("Ayar: kayıt yokken en az levent 3, eşik %2 (kullanıcı kararı)", (await readDevereDenierSuggestMinBeams()) === 3 && (await readDevereDenierSuggestThresholdPct()) === 2);
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, 2.5);
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT, 0);
    check("Ayar: tam sayı olmayan levent / 0 eşik → varsayılana düşer (öneri sessizce gevşemez)", (await readDevereDenierSuggestMinBeams()) === 3 && (await readDevereDenierSuggestThresholdPct()) === 2);
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT] } } });

    const yarn = async (s: string, den: number) => {
      const id = (await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} iplik ${s}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } })).id;
      itemIds.push(id);
      return id;
    };
    const X = await yarn("X", 70);
    const Y = await yarn("Y", 50);
    const Z = await yarn("Z", 60);
    const fabric = (await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    itemIds.push(fabric);
    const spec = async (s: string, lines: Array<[string, number]>) => {
      const id = (await prisma.warpSpec.create({ data: { code: `${TAG}-${s}`, name: `${TAG} kart ${s}`, yarnItemId: lines[0]![0], endsCount: lines.reduce((a, l) => a + l[1], 0),
        yarns: { create: lines.map(([yarnItemId, endsCount], sortOrder) => ({ yarnItemId, endsCount, sortOrder })) } }, select: { id: true } })).id;
      specIds.push(id);
      return id;
    };
    const sX = await spec("SX", [[X, 900]]);
    const sY = await spec("SY", [[Y, 900]]);
    const sZ = await spec("SZ", [[Z, 900]]);
    const sM = await spec("SM", [[X, 450], [Y, 450]]);
    const order = async (warpSpecId: string, subcontractorId = sub.id) => {
      const r = await createWarpingOrder({ subcontractorId, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId, beamLines: [{ beamCount: 6, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    type B = { lengthM: number; grossKg?: number | null; tareKg?: number | null };
    const receive = async (orderId: string, beams: B[], note: string) => (await receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: note, beams }, U)).receiptKey;
    const w = (gross: number): B => ({ lengthM: 1000, grossKg: gross, tareKg: 10 });

    const oX = await order(sX);
    await receive(oX, [w(17.28), w(17.28), w(17.28)], `${TAG}-1`);
    await receive(oX, [w(17.28), w(17.28), { lengthM: 1000 }, { lengthM: 1000, grossKg: 30 }], `${TAG}-2`);
    const oX2 = await order(sX);
    const stornoKey = await receive(oX2, [w(40)], `${TAG}-3`);
    await cancelWarpingReceipt(oX2, stornoKey, `${TAG} geri`, U);
    const oXs = await order(sX, sander.id);
    await receive(oXs, [w(20)], `${TAG}-4`);
    const oY = await order(sY);
    await receive(oY, [w(15.1), w(15.1)], `${TAG}-5`);
    const oZ = await order(sZ);
    await receive(oZ, [w(16.06), w(16.06), w(16.06)], `${TAG}-6`);
    const oM = await order(sM);
    await receive(oM, [w(16.5), w(16.5)], `${TAG}-7`);

    const report = (q: DenierDeviationQuery = {}) => getDenierDeviationReport({ subcontractorId: sub.id, ...q });
    const rowOf = async (yarnItemId: string, q: DenierDeviationQuery = {}) => (await report({ yarnItemId, ...q })).rows.find((r) => r.yarnItemId === yarnItemId);

    // ── F1 · F5 · darasız/tartısız ────────────────────────────────────────
    const rX = await rowOf(X);
    check("F1 X: 5 tartılı sarım, nominal 35, net 36,4 → sapma +%4,00, tartı denyesi 72,80, kart 70 → ÖNERİ 72,80",
      rX?.beamCount === 5 && rX.nominalKg === "35.000" && rX.weighedNetKg === "36.400" && rX.deviationPct === "4.00" && rX.weighedDenier === "72.80"
      && rX.cardDenier === "70" && rX.cardDeviationPct === "4.00" && rX.status === "SUGGEST" && rX.suggestedDenier === "72.80" && rX.copiedDenier === "70" && rX.name === `${TAG} iplik X`,
      JSON.stringify(rX));
    check("F5 + tartısız: darasız, tartısız ve geri alınmış kabulün sarımı sayılmaz (X = 5)", rX?.beamCount === 5);
    // C1 aktif reti K3 yüklemine ekleyecek; rapor onu ancak TEK yüklemi okursa kalıtır (bugün WOUND tersi süzgeci örter).
    const src = readFileSync(join(__dirname, "../src/services/denier-deviation.service.ts"), "utf8");
    check("F5 tek kaynak: rapor sorgusu K3 `ACCEPTED_WARPING_BEAM_WHERE` parçasını where'e koyar", /AND:\s*\[\s*ACCEPTED_WARPING_BEAM_WHERE,/.test(src));
    // ── F2 · F3 · F4 ─────────────────────────────────────────────────────
    const rY = await rowOf(Y);
    check("F2 Y: 2 sarım < 3 → YETERSİZ, öneri yok", rY?.beamCount === 2 && rY.status === "INSUFFICIENT" && rY.suggestedDenier === null && rY.deviationPct === "2.00", JSON.stringify(rY));
    const rZ = await rowOf(Z);
    check("F3 Z: 3 sarım, sapma +%1 ≤ %2 → eşik altı, öneri yok", rZ?.beamCount === 3 && rZ.deviationPct === "1.00" && rZ.status === "WITHIN_THRESHOLD" && rZ.suggestedDenier === null, JSON.stringify(rZ));
    const mx = (await report({ yarnItemId: X })).mixed;
    check("F4 karma: çok iplikli 2 sarım tek karma satırında (iplik satırına girmez), iki iplik listelenir",
      mx?.beamCount === 2 && mx.nominalKg === "12.000" && mx.weighedNetKg === "13.000" && mx.yarnItemIds.includes(X) && mx.yarnItemIds.includes(Y), JSON.stringify(mx));
    // ── F7 süzgeçler ─────────────────────────────────────────────────────
    const rXall = (await getDenierDeviationReport({ yarnItemId: X })).rows.find((r) => r.yarnItemId === X);
    check("F7 devereci süzgeci sunucuda: süzgeçsiz başka deverecinin sarımı da girer (6), süzgeçle düşer (5)", rXall?.beamCount === 6 && rX?.beamCount === 5, String(rXall?.beamCount));
    const today = factoryYmd();
    const tomorrow = factoryYmd(new Date(Date.now() + 86_400_000));
    check("F7 fabrika günü: bugün dahil, yarından başlayan aralıkta satır yok",
      (await rowOf(X, { from: today, to: today }))?.beamCount === 5 && (await rowOf(X, { from: tomorrow, to: tomorrow })) === undefined);
    const r0 = await report({ yarnItemId: X });
    check("F7 varsayılan aralık: bitiş bugün, 90 günlük pencere; ayarlar cevaba yazılır", r0.range.to === today && r0.settings.minBeams === 3 && r0.settings.thresholdPct === 2, JSON.stringify(r0.range));
    const eRange = await errOf(() => report({ from: "2024-01-01", to: "2026-01-01" }));
    const eBad = await errOf(() => report({ from: "2026-13-45" }));
    check("F7 366 günü aşan / bozuk gün → 400 INVALID_RANGE", eRange?.status === 400 && eRange.code === "INVALID_RANGE" && eBad?.status === 400 && eBad.code === "INVALID_RANGE", `${show(eRange)} | ${show(eBad)}`);
    // ── Eşik ayarları raporu yönetir ─────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, 6);
    check("Ayar en az levent 6 → X yetersiz", (await rowOf(X))?.status === "INSUFFICIENT");
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, 2);
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT, 5);
    check("Ayar en az 2 + eşik %5 → X eşik altı, Y (sapma %2) eşik altı", (await rowOf(X))?.status === "WITHIN_THRESHOLD" && (await rowOf(Y))?.status === "WITHIN_THRESHOLD");
    await setSetting(SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT, 4);
    check("Eşik AŞAN sapma öneri doğurur: tam %4 eşiğinde öneri yok", (await rowOf(X))?.status === "WITHIN_THRESHOLD");
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_DENIER_SUGGEST_MIN_BEAMS, SETTING_KEYS.DEVERE_DENIER_SUGGEST_THRESHOLD_PCT] } } });

    // ── F8 [Uygula] ──────────────────────────────────────────────────────
    check("Rapor kartı değiştirmez: X kartı hâlâ 70", (await prisma.item.findUniqueOrThrow({ where: { id: X }, select: { linearDensityDen: true } })).linearDensityDen?.toString() === "70");
    const ap = await applyDenierSuggestion({ yarnItemId: X, expectedDenier: rX!.cardDenier, newDenier: rX!.suggestedDenier! }, U);
    const cardX = await prisma.item.findUniqueOrThrow({ where: { id: X }, select: { linearDensityDen: true, updatedById: true } });
    check("F8 [Uygula]: kart 70 → 72,8; eski/yeni döner; son değiştiren yazılır", !ap.unchanged && ap.oldDenier === "70" && cardX.linearDensityDen?.toString() === "72.8" && cardX.updatedById === U, JSON.stringify(ap));
    const audit = await prisma.systemLog.findFirst({ where: { recordId: X, tableName: "ITEM", action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
    check("F8 audit: ITEM UPDATE satırı (kaynak denye raporu)", JSON.stringify(audit?.newData ?? {}).includes("denier-deviation"));
    const copies = await prisma.warpBeamEventYarn.findMany({ where: { yarnItemId: X, event: { beam: { warpingOrderId: oX } } }, select: { denier: true } });
    check("F8 geçmiş WOUND kırılım kopyaları DEĞİŞMEZ (hepsi 70)", copies.length === 7 && copies.every((c) => c.denier.toString() === "70"), String(copies.length));
    const rXafter = await rowOf(X);
    check("F8 sonrası rapor: kart 72,8, tartı denyesiyle fark 0 → eşik altı (öneri tekrar etmez)", rXafter?.cardDenier === "72.8" && rXafter.cardDeviationPct === "0.00" && rXafter.status === "WITHIN_THRESHOLD", JSON.stringify(rXafter));
    const again = await applyDenierSuggestion({ yarnItemId: X, expectedDenier: "70", newDenier: "72.80" }, U);
    check("F8 tekrar deneme (cevap kayboldu): kart zaten hedefte → 200 unchanged, yazım yok", again.unchanged && again.newDenier === "72.8");
    const stale = await errOf(() => applyDenierSuggestion({ yarnItemId: X, expectedDenier: "70", newDenier: "73" }, U));
    check("F8 bayat beklenen (kart arada değişti) → 409 DENIER_CHANGED", stale?.status === 409 && stale.code === "DENIER_CHANGED", show(stale));
    const race = await Promise.allSettled([
      applyDenierSuggestion({ yarnItemId: Z, expectedDenier: "60", newDenier: "61" }, U),
      applyDenierSuggestion({ yarnItemId: Z, expectedDenier: "60", newDenier: "62" }, U),
    ]);
    const zNow = (await prisma.item.findUniqueOrThrow({ where: { id: Z }, select: { linearDensityDen: true } })).linearDensityDen?.toString();
    const won = race.filter((r) => r.status === "fulfilled");
    check("F8 yarış: aynı beklenenle iki uygulama → tek kazanan, öteki 409; kart kazananın değerinde",
      won.length === 1 && race.some((r) => r.status === "rejected" && (r.reason as { details?: { code?: string } }).details?.code === "DENIER_CHANGED")
      && zNow === (won[0] as PromiseFulfilledResult<{ newDenier: string }>).value.newDenier, `${zNow}`);
    const eFab = await errOf(() => applyDenierSuggestion({ yarnItemId: fabric, expectedDenier: null, newDenier: "70" }, U));
    const eZero = await errOf(() => applyDenierSuggestion({ yarnItemId: Y, expectedDenier: "50", newDenier: "0" }, U));
    const eText = await errOf(() => applyDenierSuggestion({ yarnItemId: Y, expectedDenier: "50", newDenier: "abc" }, U));
    const eNone = await errOf(() => applyDenierSuggestion({ yarnItemId: randomUUID(), expectedDenier: null, newDenier: "70" }, U));
    check("F8 iplik dışı kart 400 DENIER_NOT_YARN · 0/metin 400 DENIER_INVALID · olmayan kart 404",
      eFab?.status === 400 && eFab.code === "DENIER_NOT_YARN" && eZero?.code === "DENIER_INVALID" && eText?.code === "DENIER_INVALID" && eNone?.status === 404,
      `${show(eFab)} | ${show(eZero)} | ${show(eText)} | ${show(eNone)}`);
    check("F8 reddedilen istekler Y kartına dokunmaz (50)", (await prisma.item.findUniqueOrThrow({ where: { id: Y }, select: { linearDensityDen: true } })).linearDensityDen?.toString() === "50");
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEventYarn.deleteMany({ where: { event: { beamId: { in: beamIds } } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: beamIds } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...beamIds, ...itemIds] } } });
    await prisma.warpSpecYarn.deleteMany({ where: { warpSpecId: { in: specIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
