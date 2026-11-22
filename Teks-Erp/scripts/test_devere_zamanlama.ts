// =============================================================================
// DEVERE ZAMANLAMASI (devere-levent S1) — levent bitiş tahmininde yedek · teslim süresi · "devereye ver" günü
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts devere_zamanlama   (DB'ye YAZAR; TST- fikstürü; ayarlar fotoğrafa döner)
//   §0 saf: `median` (tek/çift adet) · `orderLeadDays` (sevk/kabul yok ya da ters sıra → örnek değil)
//   §1 yedek yok: kart A (devereci SA: 3/4/20 gün → MEDYAN 4) · orderByDay = bitiş − 4 · rozet (devereAcil) var
//   §2 aynı kartta READY levent → spare.count ≥ 1, rozet YOK; açık devere siparişi → yoldaM > 0, rozet YOK
//   §3 geçmiş yok + ayar 0 → leadDays/orderByDay null + gerekçe; ayar 7 → kaynak AYAR, orderByDay = bitiş − 7
//   §4 iptal edilmiş sipariş / iptal sevk / iptal levent medyana GİRMEZ (girseydi medyan 3,5 olurdu)
//   §5 HTTP: yeni alanlar zarfta · devere kapalı → 403 MODULE_DISABLED
// NEGATİF SONDA (arşiv notu "Devere-levent S1"): `median` yerine ortalama → §1a ❌ (9 ≠ 4).
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpingOrderStatus } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { factoryYmd } from "../src/constants/time";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { consumeBeam } from "../src/services/warp-beam-consume.service";
import { addDaysYmd } from "../src/services/helpers/dokuma-levent-rapor.helper";
import { median, orderLeadDays } from "../src/services/warping-order/lead-time";
import { finishForecastReport, type FinishForecastRow } from "../src/services/reports/levent-bitis-tahmini.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TST-DZ-${process.pid}`;
const DAY = 86_400_000;
const FLAGS = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.DEVERE_DEFAULT_LEAD_DAYS];
const setSetting = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE ZAMANLAMASI (S1) ===\n");

  console.log("── §0 Saf yardımcılar ──");
  check("§0a medyan tek adet: [20, 3, 4] → 4 (ortalama 9 değil)", median([20, 3, 4]) === 4);
  check("§0b medyan çift adet: [3, 4, 5, 20] → 4,5 · boş → null", median([3, 4, 5, 20]) === 4.5 && median([]) === null);
  const t0 = new Date();
  check("§0c sevk/kabul yoksa ya da kabul sevkten önceyse örnek değil (null)",
    orderLeadDays(null, t0) === null && orderLeadDays(t0, null) === null && orderLeadDays(t0, new Date(t0.getTime() - 3 * DAY)) === null && orderLeadDays(new Date(t0.getTime() - 3 * DAY), t0) === 3);

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const mk = (n: string) => prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-${n}`, code: `${TAG}-${n}`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true } });
  const t1 = await mk("T1");
  const t2 = await mk("T2");
  const t3 = await mk("T3");
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = (k: string) => prisma.warpSpec.create({ data: { code: `${TAG}-${k}`, name: `${TAG} çözgü ${k}`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const specA = await spec("A");
  const specB = await spec("B");
  const specC = await spec("C");
  const specH = await spec("H"); // yalnız geçmiş siparişler (örnekler) — stoğu rapor kartlarına karışmaz
  const subA = await prisma.subcontractor.create({ data: { code: `${TAG}-SA`, name: `${TAG} devereci A` }, select: { id: true } });
  const beamIds: string[] = [];
  const orderIds: string[] = [];
  let seq = 0;
  const today = factoryYmd();

  // Geçmiş sipariş: sevk `dispatchDaysAgo` gün önce, kabul (WOUND) `receiptDaysAgo` gün önce.
  const history = async (o: { specId: string; dispatchDaysAgo: number | null; receiptDaysAgo: number | null; status?: WarpingOrderStatus; dispatchCancelled?: boolean; beamCancelled?: boolean }) => {
    const n = ++seq;
    const status = o.status ?? WarpingOrderStatus.COMPLETED;
    const now = Date.now();
    const order = await prisma.warpingOrder.create({
      data: {
        orderNo: `${TAG}-WO${n}`, warpSpecId: o.specId, subcontractorId: subA.id, targetLengthM: new Prisma.Decimal(1000), status,
        createdAt: new Date(now - (Math.max(o.dispatchDaysAgo ?? 0, o.receiptDaysAgo ?? 0) + 1) * DAY + n * 1000),
        ...(status === WarpingOrderStatus.COMPLETED ? { completedAt: new Date(now - (o.receiptDaysAgo ?? 0) * DAY + n * 1000) } : {}),
        ...(status === WarpingOrderStatus.CANCELLED ? { cancelledAt: new Date(now), cancelReason: "test" } : {}),
      },
      select: { id: true },
    });
    orderIds.push(order.id);
    if (o.dispatchDaysAgo !== null) {
      await prisma.subcontractorDispatch.create({
        data: { dispatchNo: `${TAG}-SD${n}`, subcontractorId: subA.id, warpingOrderId: order.id, dispatchedAt: new Date(now - o.dispatchDaysAgo * DAY), ...(o.dispatchCancelled ? { cancelledAt: new Date(now) } : {}) },
      });
    }
    if (o.receiptDaysAgo !== null) {
      const beam = await prisma.warpBeam.create({
        data: { beamNo: `${TAG}-H${n}`, warpSpecId: o.specId, plannedLengthM: new Prisma.Decimal(1000), status: o.beamCancelled ? WarpBeamStatus.CANCELLED : WarpBeamStatus.EXHAUSTED, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: subA.id, warpingOrderId: order.id, warpingReceiptKey: randomUUID() },
        select: { id: true },
      });
      beamIds.push(beam.id);
      await prisma.warpBeamEvent.create({ data: { beamId: beam.id, kind: "WOUND", fromStatus: WarpBeamStatus.PLANNED, toStatus: WarpBeamStatus.READY, lengthM: new Prisma.Decimal(1000), endsCount: 3000, denier: 300, theoreticalKg: new Prisma.Decimal(100), kgSource: WarpKgSource.THEORETICAL, createdAt: new Date(now - o.receiptDaysAgo * DAY) } });
    }
    return order.id;
  };
  const sar = async (m: number, specId: string) => {
    const p = await createWarpBeam({ warpSpecId: specId, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: subA.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  // Tezgahta 1000 m, bugün elle 700 m tüketim → günlük ort. 100 → kalan 300 → 3 gün → bitiş bugün + 3.
  const onLoom = async (machineId: string, specId: string) => {
    const id = await sar(1000, specId);
    await mountBeam(id, { machineId, position: 1 });
    await consumeBeam(id, { lengthM: 700, lengthSource: "ESTIMATED", fabricLengthM: 690 });
    return id;
  };

  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, "false");
    await setSetting(SETTING_KEYS.DEVERE_DEFAULT_LEAD_DAYS, 0);

    // Devereci SA örnekleri: 3, 4, 20 gün (medyan 4, ortalama 9) + medyana GİRMEMESİ gereken üç sipariş (her biri 1 gün).
    await history({ specId: specH.id, dispatchDaysAgo: 30, receiptDaysAgo: 27 });
    await history({ specId: specH.id, dispatchDaysAgo: 25, receiptDaysAgo: 21 });
    await history({ specId: specH.id, dispatchDaysAgo: 40, receiptDaysAgo: 20 });
    await history({ specId: specH.id, dispatchDaysAgo: 3, receiptDaysAgo: 2, status: WarpingOrderStatus.CANCELLED });
    await history({ specId: specH.id, dispatchDaysAgo: 3, receiptDaysAgo: 2, dispatchCancelled: true });
    await history({ specId: specH.id, dispatchDaysAgo: 3, receiptDaysAgo: 2, beamCancelled: true });
    // A ve B kartlarının son deverecisi SA (kapanmış, sevksiz bağ siparişi: örnek değil, "yolda" da değil).
    await history({ specId: specA.id, dispatchDaysAgo: null, receiptDaysAgo: null });
    await history({ specId: specB.id, dispatchDaysAgo: null, receiptDaysAgo: null });

    const A = await onLoom(t1.id, specA.id);
    const B = await onLoom(t2.id, specB.id);
    const C = await onLoom(t3.id, specC.id);
    await sar(400, specB.id); // B kartının READY yedeği
    const finish = addDaysYmd(today, 3);

    const rows = (await finishForecastReport({})).data.satirlar;
    const row = (id: string) => rows.find((r) => r.beamId === id) as FinishForecastRow | undefined;
    const a = row(A);
    console.log("\n── §1 Yedek yok → devereye ver = bitiş − medyan ──");
    check("§1a ⭐ A leadDays = 4 (medyan; ortalama 9 olurdu) · kaynak OLCUM · 3 örnek · devereci SA", a?.leadDays === 4 && a?.lead.kaynak === "OLCUM" && a?.lead.ornek === 3 && a?.lead.devereci === `${TAG} devereci A`, JSON.stringify({ l: a?.leadDays, lead: a?.lead }));
    check("§1b ⭐ A bitiş = bugün + 3 · orderByDay = bitiş − 4 (fabrika günü)", a?.tahminiBitisGun === finish && a?.orderByDay === addDaysYmd(finish, -4) && a?.orderByGerekce === null, `${a?.tahminiBitisGun} → ${a?.orderByDay}`);
    check("§1c ⭐ A yedek yok (READY 0, yolda 0) ∧ orderByDay ≤ bugün → devereAcil", a?.spare.count === 0 && a?.spare.yoldaM === 0 && a?.devereAcil === true, JSON.stringify(a?.spare));
    check("§1d A çözgü kartı satırda", a?.warpSpec.id === specA.id, a?.warpSpec.code);

    console.log("\n── §2 Yedek var → rozet yok ──");
    const b = row(B);
    check("§2a ⭐ B aynı kartta READY levent → spare.count 1 · m 400 · rozet YOK", b?.spare.count === 1 && b?.spare.m === 400 && b?.devereAcil === false && b?.orderByDay === addDaysYmd(finish, -4), JSON.stringify({ s: b?.spare, o: b?.orderByDay, acil: b?.devereAcil }));
    const openId = await history({ specId: specA.id, dispatchDaysAgo: 1, receiptDaysAgo: null, status: WarpingOrderStatus.IN_PROGRESS });
    const a2 = (await finishForecastReport({ machineId: t1.id })).data.satirlar.find((r) => r.beamId === A);
    check("§2b A için açık devere siparişi (1000 m kalan) → yoldaM 1000 · yoldaSiparis 1 · rozet YOK", a2?.spare.yoldaM === 1000 && a2?.spare.yoldaSiparis === 1 && a2?.devereAcil === false, JSON.stringify(a2?.spare));
    await prisma.warpingOrder.update({ where: { id: openId }, data: { status: WarpingOrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: "test" } });

    console.log("\n── §3 Geçmiş yok → ölçülemedi / ayar yedeği ──");
    const c = row(C);
    check("§3a ⭐ C devere siparişi yok + ayar 0 → leadDays/orderByDay null + gerekçe, rozet YOK", c?.leadDays === null && c?.orderByDay === null && c?.orderByGerekce === "bu çözgü kartının devere siparişi yok" && c?.devereAcil === false && c?.lead.kaynak === null, JSON.stringify({ l: c?.leadDays, g: c?.orderByGerekce }));
    await setSetting(SETTING_KEYS.DEVERE_DEFAULT_LEAD_DAYS, 7);
    const c2 = (await finishForecastReport({ machineId: t3.id })).data.satirlar.find((r) => r.beamId === C);
    check("§3b ⭐ ayar 7 → C leadDays 7 · kaynak AYAR · orderByDay = bitiş − 7 · rozet", c2?.leadDays === 7 && c2?.lead.kaynak === "AYAR" && c2?.orderByDay === addDaysYmd(finish, -7) && c2?.devereAcil === true, JSON.stringify({ l: c2?.leadDays, k: c2?.lead.kaynak, o: c2?.orderByDay }));
    const a3 = (await finishForecastReport({ machineId: t1.id })).data.satirlar.find((r) => r.beamId === A);
    check("§3c ölçüm varken ayar yedeği KULLANILMAZ (A hâlâ 4 · OLCUM)", a3?.leadDays === 4 && a3?.lead.kaynak === "OLCUM", `${a3?.leadDays} ${a3?.lead.kaynak}`);
    await setSetting(SETTING_KEYS.DEVERE_DEFAULT_LEAD_DAYS, 0);

    console.log("\n── §4 İptaller medyana girmez ──");
    check("§4a ⭐ iptal sipariş · iptal sevk · iptal levent örnek değil: örnek 3, medyan 4 (girseydi 4 örnek, 3,5)", a?.lead.ornek === 3 && a?.leadDays === 4, `${a?.lead.ornek} örnek · ${a?.leadDays}`);

    console.log("\n── §5 HTTP ──");
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password, clientType: "electron" }) });
    const tok = ((await login.json()) as { data?: { token?: string } }).data?.token;
    check("§5z oturum açıldı (körlük zemini)", !!tok, `HTTP ${login.status}`);
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: (await r.json()) as { data?: { satirlar?: FinishForecastRow[]; ozet?: { devereAcil?: number } }; details?: { code?: string } } };
    };
    const ok = await get(`/api/reports/dokuma/levent-bitis-tahmini?machineId=${t1.id}`);
    const hr = ok.body.data?.satirlar?.find((r) => r.beamId === A);
    check("§5a 200 · satırda spare/leadDays/orderByDay/devereAcil · özet devereAcil sayı", ok.status === 200 && !!hr && hr.leadDays === 4 && "spare" in hr && "orderByDay" in hr && typeof ok.body.data?.ozet?.devereAcil === "number", `HTTP ${ok.status}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const off = await get(`/api/reports/dokuma/levent-bitis-tahmini`);
    check("§5b ⭐ devere kapalı → 403 MODULE_DISABLED", off.status === 403 && off.body.details?.code === "MODULE_DISABLED", `HTTP ${off.status}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    const evIds = (await prisma.warpBeamEvent.findMany({ where: { beamId: { in: beamIds } }, select: { id: true } })).map((e) => e.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...beamIds, ...evIds, ...orderIds] } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [specA.id, specB.id, specC.id, specH.id] } } });
    await prisma.item.deleteMany({ where: { id: yarn.id } });
    await prisma.subcontractor.delete({ where: { id: subA.id } }).catch(() => undefined);
    await prisma.machineRun.deleteMany({ where: { machineId: { in: [t1.id, t2.id, t3.id] } } });
    await prisma.machine.deleteMany({ where: { id: { in: [t1.id, t2.id, t3.id] } } });
    await prisma.station.deleteMany({ where: { id: stLoom.id } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
