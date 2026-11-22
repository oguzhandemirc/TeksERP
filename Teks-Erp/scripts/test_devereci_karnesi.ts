// =============================================================================
// DEVERECİ KARNESİ (devere-levent S2) — devereci başına altı ölçü, elle hesapla eşit
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts devereci_karnesi   (DB'ye YAZAR; TST- fikstürü; ayarlar fotoğrafa döner)
//   §1 iki devereci, bilinen fikstür: teslim/zamanında · süre medyanı · fire/tolerans · ret · denye · 100 m başına çözgü hatası
//   §2 iptal edilen sipariş, yeniden açılan kapanış, iptal edilen ret ve geri alınan tüketim SAYILMAZ
//   §3 top↔levent bağı yalnız rollId'den; bağ yoksa null + gerekçe (sıfır değil)
//   §4 meta.ufuk = LOOM_HORIZON_DAY · özet Σ/Σ
//   §5 HTTP: zarf + süzgeç (suzgec, tek satır) · strict 400 · devere kapalı → 403 MODULE_DISABLED
// NEGATİF SONDA (arşiv notu "Devere-levent S2"): servisteki COZGU süzgeci kaldırılınca §1f ❌ (0,8 ≠ 0,6).
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpingOrderStatus } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { factoryYmd } from "../src/constants/time";
import { LOOM_HORIZON_DAY } from "../src/constants/dokuma-ufku";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { addDaysYmd } from "../src/services/helpers/dokuma-levent-rapor.helper";
import { devereciKarnesiReport, type DevereciKarnesiRow } from "../src/services/reports/devereci-karnesi.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TST-DK-${process.pid}`;
const DAY = 86_400_000;
const FLAGS = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const setSetting = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
const ago = (d: number) => new Date(Date.now() - d * DAY);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERECİ KARNESİ (S2) ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-C`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const subA = await prisma.subcontractor.create({ data: { code: `${TAG}-SA`, name: `${TAG} A devereci` }, select: { id: true } });
  const subB = await prisma.subcontractor.create({ data: { code: `${TAG}-SB`, name: `${TAG} B devereci` }, select: { id: true } });
  const dtCozgu = await prisma.defectType.create({ data: { code: `${TAG}-CZ`.slice(0, 32), name: `${TAG} çözgü hatası`, defectGroup: "COZGU" }, select: { id: true, name: true } });
  const dtAtki = await prisma.defectType.create({ data: { code: `${TAG}-AT`.slice(0, 32), name: `${TAG} atkı hatası`, defectGroup: "ATKI" }, select: { id: true, name: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true } });
  const wh = await fixtureWarehouseId();
  const orderIds: string[] = [];
  const beamIds: string[] = [];
  const rollIds: string[] = [];
  const rejectionIds: string[] = [];
  let seq = 0;

  const order = async (o: { subId: string; dispatchAgo: number; dueAgo: number | null; status?: WarpingOrderStatus }) => {
    const n = ++seq;
    const status = o.status ?? WarpingOrderStatus.IN_PROGRESS;
    const w = await prisma.warpingOrder.create({
      data: {
        orderNo: `${TAG}-WO${n}`, warpSpecId: spec.id, subcontractorId: o.subId, targetLengthM: new Prisma.Decimal(1000), status,
        createdAt: ago(o.dispatchAgo + 1), ...(o.dueAgo !== null ? { expectedReturnAt: ago(o.dueAgo) } : {}),
        ...(status === WarpingOrderStatus.CANCELLED ? { cancelledAt: new Date(), cancelReason: "test" } : {}),
      },
      select: { id: true },
    });
    orderIds.push(w.id);
    await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-SD${n}`, subcontractorId: o.subId, warpingOrderId: w.id, dispatchedAt: ago(o.dispatchAgo) } });
    return w.id;
  };
  // Kabul: sarım + WOUND (isteğe bağlı tartı + iplik kırılımı — denye ölçüsü).
  const beam = async (b: { orderId: string; subId: string; receiptAgo: number; weighed?: { grossKg: number; tareKg: number } }) => {
    const n = ++seq;
    const wb = await prisma.warpBeam.create({
      data: { beamNo: `${TAG}-L${n}`, warpSpecId: spec.id, plannedLengthM: new Prisma.Decimal(1000), status: WarpBeamStatus.READY, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: b.subId, warpingOrderId: b.orderId, warpingReceiptKey: randomUUID() },
      select: { id: true },
    });
    beamIds.push(wb.id);
    await prisma.warpBeamEvent.create({
      data: {
        beamId: wb.id, kind: "WOUND", fromStatus: WarpBeamStatus.PLANNED, toStatus: WarpBeamStatus.READY, lengthM: new Prisma.Decimal(1000), endsCount: 3000, denier: 300,
        theoreticalKg: new Prisma.Decimal(100), kgSource: WarpKgSource.THEORETICAL, createdAt: ago(b.receiptAgo),
        ...(b.weighed ? { grossKg: new Prisma.Decimal(b.weighed.grossKg), tareKg: new Prisma.Decimal(b.weighed.tareKg), yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, denier: 300, theoreticalKg: new Prisma.Decimal(100) }] } } : {}),
      },
    });
    return wb.id;
  };
  const roll = async () => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${++seq}`, itemId: fabric.id, initialQty: 100, currentQty: 100, warehouseId: wh }, select: { id: true } });
    rollIds.push(r.id);
    return r.id;
  };
  const consume = (beamId: string, rollId: string, fabricM: number, daysAgo: number) =>
    prisma.warpBeamEvent.create({ data: { beamId, kind: "CONSUMED", fromStatus: WarpBeamStatus.MOUNTED, toStatus: WarpBeamStatus.MOUNTED, machineId: loom.id, lengthM: new Prisma.Decimal(fabricM + 10), fabricLengthM: new Prisma.Decimal(fabricM), rollId, createdAt: ago(daysAgo) }, select: { id: true } });
  const reject = async (beamId: string, orderId: string, subId: string, cancelled: boolean) => {
    const ev = await prisma.warpBeamEvent.create({ data: { beamId, kind: "REJECT_OUT", fromStatus: WarpBeamStatus.READY, toStatus: WarpBeamStatus.REJECTED }, select: { id: true } });
    const r = await prisma.warpingBeamRejection.create({
      data: { docNo: `${TAG}-RET${++seq}`, warpingOrderId: orderId, subcontractorId: subId, reasonCode: "DIGER", reasonText: "test", expectRework: false, rejectedAt: ago(1), ...(cancelled ? { cancelledAt: new Date(), cancelReason: "test" } : {}), items: { create: [{ warpBeamId: beamId, eventId: ev.id }] } },
      select: { id: true },
    });
    rejectionIds.push(r.id);
    if (!cancelled) await prisma.warpBeam.update({ where: { id: beamId }, data: { status: WarpBeamStatus.REJECTED } });
  };
  const settle = (orderId: string, wastePct: number, overTolerance: boolean) =>
    prisma.warpingOrderSettlement.create({ data: { warpingOrderId: orderId, kind: "SETTLE", wastePct: new Prisma.Decimal(wastePct), tolerancePct: new Prisma.Decimal(5), overTolerance }, select: { id: true } });

  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, "false");

    // Devereci A — üç sipariş: O1 süre 5, termin 6 gün önce, kabul 5 gün önce → 1 gün geç · O2 süre 3, zamanında ·
    // O3 süre 20, terminsiz. Medyan 5 (ortalama 9,33). İptal edilen O4 (süre 1) hiçbir ölçüye girmez.
    const o1 = await order({ subId: subA.id, dispatchAgo: 10, dueAgo: 6 });
    const b1 = await beam({ orderId: o1, subId: subA.id, receiptAgo: 5, weighed: { grossKg: 210, tareKg: 100 } });
    const b2 = await beam({ orderId: o1, subId: subA.id, receiptAgo: 5 });
    const o2 = await order({ subId: subA.id, dispatchAgo: 12, dueAgo: 2 });
    const b3 = await beam({ orderId: o2, subId: subA.id, receiptAgo: 9 });
    const o3 = await order({ subId: subA.id, dispatchAgo: 33, dueAgo: null });
    const b4 = await beam({ orderId: o3, subId: subA.id, receiptAgo: 13 });
    const o4 = await order({ subId: subA.id, dispatchAgo: 3, dueAgo: 1, status: WarpingOrderStatus.CANCELLED });
    await beam({ orderId: o4, subId: subA.id, receiptAgo: 2 });
    // Devereci B — tek sipariş: süre 4, termin 2 gün önce, kabul 4 gün önce → zamanında; tüketimi yok.
    const o5 = await order({ subId: subB.id, dispatchAgo: 8, dueAgo: 2 });
    await beam({ orderId: o5, subId: subB.id, receiptAgo: 4 });

    // Ret: b2 canlı ret · b3 iptal edilmiş ret (sayılmaz). İptal sipariş O4'ün leventi CANCELLED değil ama sipariş iptal →
    // ret paydası sipariş durumuna değil levent kabulüne bakar: A dönen = b1, b2, b3, b4 + O4 leventi = 5.
    await reject(b2, o1, subA.id, false);
    await reject(b3, o2, subA.id, true);
    // Fire: O1 %2, O2 %6 (tolerans aşımı); O3 %9 kapanışı yeniden açılmış (sayılmaz).
    await settle(o1, 2, false);
    await settle(o2, 6, true);
    const s3 = await settle(o3, 9, true);
    await prisma.warpingOrderSettlement.create({ data: { warpingOrderId: o3, kind: "REOPEN", reversesId: s3.id } });
    // Çözgü hatası: R1 (b1, 200 m) 2 COZGU + 1 ATKI · R2 (b3, 300 m) 1 COZGU · R3 (b4, 400 m) 5 COZGU ama tüketim geri alınmış.
    const r1 = await roll();
    const r2 = await roll();
    const r3 = await roll();
    await consume(b1, r1, 200, 3);
    await consume(b3, r2, 300, 3);
    const c3 = await consume(b4, r3, 400, 3);
    await prisma.warpBeamEvent.create({ data: { beamId: b4, kind: "CONSUMED_CANCEL", fromStatus: WarpBeamStatus.MOUNTED, toStatus: WarpBeamStatus.MOUNTED, reversesEventId: c3.id } });
    await prisma.rollError.createMany({ data: [
      { rollId: r1, startMeter: 10, defectTypeId: dtCozgu.id, errorType: dtCozgu.name },
      { rollId: r1, startMeter: 20, defectTypeId: dtCozgu.id, errorType: dtCozgu.name },
      { rollId: r1, startMeter: 30, defectTypeId: dtAtki.id, errorType: dtAtki.name },
      { rollId: r2, startMeter: 40, defectTypeId: dtCozgu.id, errorType: dtCozgu.name },
      ...[1, 2, 3, 4, 5].map((i) => ({ rollId: r3, startMeter: i * 10, defectTypeId: dtCozgu.id, errorType: dtCozgu.name })),
    ] });

    const today = factoryYmd();
    const from = addDaysYmd(today, -30);
    const rep = (await devereciKarnesiReport({ from, to: today })).data;
    const row = (id: string) => rep.satirlar.find((r) => r.subcontractor.id === id) as DevereciKarnesiRow | undefined;
    const a = row(subA.id);
    const b = row(subB.id);
    console.log("── §1 Bilinen fikstür, elle hesap ──");
    check("§1a ⭐ A teslim: 3 sipariş · 2 terminli · 1 zamanında · 1 geç → %50 · ort. gecikme 1 gün", a?.teslim.siparis === 3 && a.teslim.terminli === 2 && a.teslim.zamaninda === 1 && a.teslim.gecikmeli === 1 && a.teslim.zamanindaPct === 50 && a.teslim.ortGecikmeGun === 1, JSON.stringify(a?.teslim));
    check("§1b ⭐ A süre medyanı 5 gün (örnek 3; ortalama 9,33 olurdu)", a?.sure.medyanGun === 5 && a.sure.ornek === 3, JSON.stringify(a?.sure));
    check("§1c ⭐ A fire: 2 kapanış · ort. %4 · en yüksek %6 · 1 tolerans aşımı", a?.fire.kapanis === 2 && a.fire.ortPct === 4 && a.fire.enYuksekPct === 6 && a.fire.toleransAsimi === 1, JSON.stringify(a?.fire));
    check("§1d ⭐ A ret: dönen 5 · reddedilen 1 → %20", a?.ret.donenLevent === 5 && a.ret.reddedilen === 1 && a.ret.oranPct === 20, JSON.stringify(a?.ret));
    check("§1e ⭐ A denye: 1 tartılı levent · nominal 100 · net 110 → +%10", a?.denye.levent === 1 && a.denye.nominalKg === 100 && a.denye.tartiNetKg === 110 && a.denye.sapmaPct === 10, JSON.stringify(a?.denye));
    check("§1f ⭐ A çözgü hatası: 2 top · 500 m · 3 COZGU hatası → 100 m başına 0,6 (ATKI ve geri alınan tüketim hariç)", a?.cozguHatasi.top === 2 && a.cozguHatasi.kumasM === 500 && a.cozguHatasi.hata === 3 && a.cozguHatasi.yuzMetreBasina === 0.6 && a.cozguHatasi.gerekce === null, JSON.stringify(a?.cozguHatasi));
    check("§1g B teslim: 1 sipariş zamanında %100 · süre 4 · ret 0/1 → %0 · fire yok (null)", b?.teslim.zamanindaPct === 100 && b.sure.medyanGun === 4 && b.ret.donenLevent === 1 && b.ret.oranPct === 0 && b.fire.kapanis === 0 && b.fire.ortPct === null, JSON.stringify({ t: b?.teslim, s: b?.sure, r: b?.ret, f: b?.fire }));

    console.log("\n── §2 İptaller sayılmaz ──");
    check("§2a iptal edilen sipariş (O4) teslim/süreye girmez (girseydi 4 sipariş, medyan 4)", a?.teslim.siparis === 3 && a.sure.ornek === 3);
    check("§2b yeniden açılan kapanış (%9) fireye girmez", a?.fire.kapanis === 2 && a.fire.enYuksekPct === 6);
    check("§2c iptal edilen ret sayılmaz; geri alınan tüketimin topu (R3, 5 hata) girmez", a?.ret.reddedilen === 1 && a.cozguHatasi.top === 2 && a.cozguHatasi.hata === 3);

    console.log("\n── §3 Top↔levent bağı yoksa ölçülemedi ──");
    check("§3a ⭐ B'nin topa bağlı tüketimi yok → 100 m başına null (0 değil) + gerekçe (otomatik tüketim kapalı)", b?.cozguHatasi.yuzMetreBasina === null && b.cozguHatasi.kumasM === 0 && (b.cozguHatasi.gerekce ?? "").includes("otomatik tüketim kapalı"), JSON.stringify(b?.cozguHatasi));
    check("§3b meta.otomatikTuketim ayarı yansıtır (false)", rep.meta.otomatikTuketim === false);

    console.log("\n── §4 Ufuk ve özet ──");
    check("§4a ⭐ meta.ufuk = LOOM_HORIZON_DAY", rep.meta.ufuk === LOOM_HORIZON_DAY, rep.meta.ufuk);
    const mine = await devereciKarnesiReport({ from, to: today, subcontractorId: subA.id });
    check("§4b süzgeçli rapor: tek satır · dusenSatir ≥ 1 · özet = A satırı · seçeneklerde iki devereci de var", mine.data.satirlar.length === 1 && (mine.dusenSatir ?? 0) >= 1 && mine.data.ozet.cozguHatasi.yuzMetreBasina === 0.6 && mine.data.ozet.teslim.siparis === 3
      && [subA.id, subB.id].every((id) => mine.data.meta.secenekler.subcontractorId.some((s) => s.id === id)), JSON.stringify({ n: mine.data.satirlar.length, d: mine.dusenSatir }));
    const outside = await devereciKarnesiReport({ from: addDaysYmd(today, -2), to: today });
    check("§4c dönem dışı kabuller sayılmaz: son 3 günde A'nın siparişi yok", (outside.data.satirlar.find((r) => r.subcontractor.id === subA.id)?.teslim.siparis ?? 0) === 0);

    console.log("\n── §5 HTTP ──");
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password, clientType: "electron" }) });
    const tok = ((await login.json()) as { data?: { token?: string } }).data?.token;
    check("§5z oturum açıldı (körlük zemini)", !!tok, `HTTP ${login.status}`);
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: (await r.json()) as { data?: { satirlar?: DevereciKarnesiRow[]; meta?: { ufuk?: string } }; suzgec?: unknown; details?: { code?: string } } };
    };
    const ok = await get(`/api/reports/dokuma/devereci-karnesi?from=${from}&to=${today}&subcontractorId=${subA.id}`);
    check("§5a 200 · tek satır (A) · suzgec kökte · meta.ufuk", ok.status === 200 && ok.body.data?.satirlar?.length === 1 && ok.body.data.satirlar[0]!.subcontractor.id === subA.id && !!ok.body.suzgec && ok.body.data.meta?.ufuk === LOOM_HORIZON_DAY, `HTTP ${ok.status}`);
    const bad = await get(`/api/reports/dokuma/devereci-karnesi?from=${from}&to=${today}&x=1`);
    const noFrom = await get(`/api/reports/dokuma/devereci-karnesi?to=${today}`);
    check("§5b tanınmayan parametre ve eksik dönem → 400", bad.status === 400 && noFrom.status === 400, `${bad.status} ${noFrom.status}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const off = await get(`/api/reports/dokuma/devereci-karnesi?from=${from}&to=${today}`);
    check("§5c ⭐ devere kapalı → 403 MODULE_DISABLED", off.status === 403 && off.body.details?.code === "MODULE_DISABLED", `HTTP ${off.status}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    const evIds = (await prisma.warpBeamEvent.findMany({ where: { beamId: { in: beamIds } }, select: { id: true } })).map((e) => e.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...beamIds, ...evIds, ...orderIds, ...rollIds] } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warpingBeamRejectionItem.deleteMany({ where: { rejectionId: { in: rejectionIds } } });
    await prisma.warpingBeamRejection.deleteMany({ where: { id: { in: rejectionIds } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds }, kind: "REOPEN" } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: spec.id } });
    await prisma.defectType.deleteMany({ where: { id: { in: [dtCozgu.id, dtAtki.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, fabric.id] } } });
    await prisma.subcontractor.deleteMany({ where: { id: { in: [subA.id, subB.id] } } });
    await prisma.machine.deleteMany({ where: { id: loom.id } });
    await prisma.station.deleteMany({ where: { id: st.id } });
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
