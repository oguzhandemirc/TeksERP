// =============================================================================
// FASON DEVERE D8b — iplik ihtiyacında "Deverecide" + fason kokpitinde devere gecikmeleri (GERÇEK DB, servis + HTTP)
// =============================================================================
//   §1 İplik ihtiyacı: deverecideKg = "Fasondaki İplik" toplamı (TEK okuyucu `loadWarpingYarnHoldings`; iade düşer) ·
//      emanet payı ayrı · VARSAYILAN eksik bugünkü formülle (deverecide düşülmez) · `deverecideDus=1` → sevk öncesi eksikle
//      aynı (fabrika malı payı düşer, emanet düşmez) · sunum kolonu + parametre yalnız açıkken
//   §2 Devere kapalı → satır/özet/meta'da D8b anahtarı YOK, kolon/parametre YOK (bugünkü yanıt)
//   §3 Gecikmeler: sipariş termini dün → OVERDUE/1 gün/ORDER · terminsiz + sevk termini dün → OVERDUE/DISPATCH · yarın →
//      DUE_SOON · terminsiz sevksiz → NO_DUE_DATE · iptal edilen listede yok · durum süzgeci listeyi daraltır, sayaçlar aynı ·
//      gelen/kalan metre
//   §4 HTTP: 200 · tanınmayan durum 400 FILTER_INVALID · tanınmayan süzgeç 400 FILTER_UNKNOWN · izinsiz 403 ·
//      devere kapalı 403 MODULE_DISABLED · iplik ihtiyacı şeması `deverecideDus` alır, bozuk değeri reddeder
// NEGATİF SONDA: arşiv notu "Fason devere D8b".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { ensureTestAdmin, kosumaOzguParola, testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { cancelWarpingOrder } from "../src/services/warping-order/cancel";
import { returnWarpingYarn, warpingYarnAtSubcontractors } from "../src/services/warping-order/yarn-return";
import { listWarpingDelays } from "../src/services/warping-order/delays";
import { yarnNeedReport, yarnShortKg, type YarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { buildYarnNeedSunumu } from "../src/services/reports/yarn-need.sunum";
import { yarnNeedQuerySchema } from "../src/routes/reports/maliyet.report.routes";
import { factoryDayEndOfKey, factoryYmd } from "../src/constants/time";
import { addDaysToDayKey } from "../src/services/helpers/fason-expected-return.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-D8B-${process.pid}`;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SETTING_FOTO = [
  SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED,
  SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DOKUMA_YARN_RESERVATION_ENABLED,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const dayEnd = (offset: number) => factoryDayEndOfKey(addDaysToDayKey(factoryYmd(new Date()), offset)).toISOString();

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE D8b ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const orderIds: string[] = [];
  const userIds: string[] = [];
  const customerIds: string[] = [];
  const salesOrderIds: string[] = [];
  const lotIds: string[] = [];
  let f: MaliyetFikstur | null = null;
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await setSetting(SETTING_KEYS.DOKUMA_YARN_RESERVATION_ENABLED, "false");
    await reconcileReasonPresets();

    // ── Fikstür: kumaş (çözgü C75, 9600 tel) + 5000 m açık sipariş; çözgü ipliği 300 kg serbest + 50 kg emanet lot ──
    f = await fiksturKur(`${TAG}-`);
    await altinYapiYaz(f);
    await prisma.item.updateMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } }, data: { unit: "KG" } });
    const cust = await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} müşteri` }, select: { id: true } });
    customerIds.push(cust.id);
    const so = await prisma.order.create({ data: { orderNumber: `${TAG}-S`, customerId: cust.id, lines: { create: [{ itemId: f.fabricId, quantity: D(5000) }] } }, select: { id: true } });
    salesOrderIds.push(so.id);
    const lot = (await prisma.yarnLot.create({ data: { itemId: f.warpYarnId, lotNo: `${TAG}-EL`, ownerCustomerId: cust.id }, select: { id: true } })).id;
    lotIds.push(lot);
    const stockIn = (lotId: string | null, qtyKg: number) =>
      prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: f!.warpYarnId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg, lotId, reason: `${TAG} giriş` }));
    await stockIn(null, 300);
    await stockIn(lot, 50);
    const W = f.warpYarnId;
    const rowOf = (r: YarnNeedReport) => r.satirlar.find((s) => s.iplikId === W);
    const need = (o: { deverecideDus?: boolean } = {}) => yarnNeedReport({ urunId: f!.fabricId, ...o });

    const r0 = await need();
    const w0 = rowOf(r0);
    check("§1a sevk öncesi: çözgü satırı var, eksik > 0, deverecide 0", !!w0 && Number(w0.eksikKg) > 0 && w0.deverecideKg === "0.000" && r0.meta.kaynaklar.deverecide === true, JSON.stringify(w0 ?? null).slice(0, 300));

    // ── Devere siparişleri + sevk: 100 kg fabrika malı + 10 kg emanet ─────────
    const mkOrder = async (expectedReturnAt?: string | null) => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: f!.warpSpecId, beamLines: [{ beamCount: 1, beamLengthM: 1000 }], ...(expectedReturnAt !== undefined ? { expectedReturnAt } : {}) }, U);
      orderIds.push(r.data.id);
      return r.data;
    };
    const O1 = await mkOrder(dayEnd(-1));
    const dsp = await dispatchWarpingOrder(O1.id, { clientToken: randomUUID(), lines: [{ yarnItemId: W, warehouseId: whId, lotId: null, qtyKg: 100 }] }, U);
    // Sahip karışımı tek siparişte 409 OWNER_MISMATCH → emanet ayrı siparişle (termin ileride, gecikme bölümünü etkilemez).
    const O1b = await mkOrder(dayEnd(30));
    await dispatchWarpingOrder(O1b.id, { clientToken: randomUUID(), lines: [{ yarnItemId: W, warehouseId: whId, lotId: lot, qtyKg: 10 }] }, U);
    const r1 = await need();
    const w1 = rowOf(r1)!;
    check("§1b sevk sonrası: deverecide 110 · emanet payı 10 · özet deverecide 110", w1.deverecideKg === "110.000" && w1.deverecideEmanetKg === "10.000" && r1.ozet.deverecideKg === "110.000", `${w1.deverecideKg}/${w1.deverecideEmanetKg}/${r1.ozet.deverecideKg}`);
    const expectDefault = yarnShortKg(D(w1.ihtiyacKg), D(w1.serbestStokKg!), w1.acikAlisKg === null ? null : D(w1.acikAlisKg)).toFixed(3);
    check("§1c VARSAYILAN: eksik = ihtiyaç − serbest stok − açık alış (deverecide düşülmez; meta.deverecideDus false)", w1.eksikKg === expectDefault && r1.meta.deverecideDus === false, `${w1.eksikKg} vs ${expectDefault}`);
    check("§1d serbest stok sevkle 100 düştü (emanet lot serbest stoğa zaten girmez)", D(w0!.serbestStokKg!).minus(w1.serbestStokKg!).eq(100), `${w0!.serbestStokKg} → ${w1.serbestStokKg}`);
    const r2 = await need({ deverecideDus: true });
    const w2 = rowOf(r2)!;
    check("§1e `deverecideDus` açık: eksik sevk öncesiyle AYNI (fabrika malı 100 düşer, emanet 10 düşmez)", w2.eksikKg === w0!.eksikKg && r2.meta.deverecideDus === true, `${w2.eksikKg} vs ${w0!.eksikKg}`);

    const item = dsp.yarnItems.find((y) => y.lotId === null) ?? dsp.yarnItems[0]!;
    await returnWarpingYarn(O1.id, { dispatchItemId: item.dispatchItemId, qtyKg: 20, reasonCode: "KALAN_IPLIK" }, U);
    const r3 = await need();
    const at = await warpingYarnAtSubcontractors({ yarnItemIds: [W] });
    const atSum = at.reduce((a, g) => a.plus(g.kg), D(0)).toFixed(3);
    check("§1f iade 20 → deverecide 90 = \"Fasondaki İplik\" toplamı (tek okuyucu)", rowOf(r3)!.deverecideKg === "90.000" && atSum === "90.000", `${rowOf(r3)!.deverecideKg} / ${atSum}`);
    const sun = buildYarnNeedSunumu(r3, { urunId: f.fabricId });
    check("§1g sunum: \"Deverecide\" kolonu + toplam + `deverecideDus` parametresi + tanım",
      sun.tablo!.kolonlar.some((k) => k.anahtar === "deverecideKg") && sun.tablo!.toplam?.deverecideKg === 90 && (sun.parametreler ?? []).some((p) => p.ad === "deverecideDus") && sun.tanimlar.some((t) => t.ad.startsWith("Deverecide")));

    // ── §2 devere kapalı → bugünkü yanıt ───────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const rOff = await need({ deverecideDus: true });
    const wOff = rowOf(rOff)!;
    const sunOff = buildYarnNeedSunumu(rOff, { urunId: f.fabricId });
    check("§2a devere kapalı: satır/özet/meta'da D8b anahtarı yok",
      !("deverecideKg" in wOff) && !("deverecideEmanetKg" in wOff) && !("deverecideKg" in rOff.ozet) && !("deverecideDus" in rOff.meta) && !("deverecide" in rOff.meta.kaynaklar), JSON.stringify(rOff.meta.kaynaklar));
    check("§2b devere kapalı: kolon/parametre yok; seçenek verilse de eksik bugünkü formül",
      !sunOff.tablo!.kolonlar.some((k) => k.anahtar === "deverecideKg") && !(sunOff.parametreler ?? []).some((p) => p.ad === "deverecideDus")
        && wOff.eksikKg === yarnShortKg(D(wOff.ihtiyacKg), D(wOff.serbestStokKg!), wOff.acikAlisKg === null ? null : D(wOff.acikAlisKg)).toFixed(3));
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const rNoYarn = await need();
    check("§2c iplik kapalı: deverecide okunmaz (anahtar yok)", !("deverecideKg" in (rowOf(rNoYarn) ?? {})) && !("deverecide" in rNoYarn.meta.kaynaklar));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");

    // ── §3 gecikmeler ───────────────────────────────────────────────────
    const O2 = await mkOrder(null);
    await dispatchWarpingOrder(O2.id, { clientToken: randomUUID(), expectedReturnAt: dayEnd(-1), lines: [{ yarnItemId: W, warehouseId: whId, lotId: null, qtyKg: 5 }] }, U);
    const O3 = await mkOrder(dayEnd(1));
    const O4 = await mkOrder(null);
    const O5 = await mkOrder(dayEnd(-3));
    await cancelWarpingOrder(O5.id, `${TAG} iptal`, U);
    const O6 = await mkOrder(dayEnd(30));
    const all = await listWarpingDelays({ state: "ALL", subcontractorIds: [sub.id] });
    const by = (id: string) => all.data.data.find((r) => r.warpingOrderId === id);
    const a1 = by(O1.id);
    check("§3a sipariş termini dün → OVERDUE · 1 gün · kaynak ORDER · ilk sevk dolu", a1?.state === "OVERDUE" && a1.overdueDays === 1 && a1.dueSource === "ORDER" && !!a1.firstDispatchedAt, JSON.stringify(a1 ?? null).slice(0, 300));
    const a2 = by(O2.id);
    check("§3b terminsiz sipariş, sevk termini dün → OVERDUE · kaynak DISPATCH", a2?.state === "OVERDUE" && a2.dueSource === "DISPATCH" && a2.overdueDays === 1, JSON.stringify(a2 ?? null).slice(0, 200));
    check("§3c termin yarın → DUE_SOON", by(O3.id)?.state === "DUE_SOON" && by(O3.id)?.overdueDays === -1);
    check("§3d terminsiz + sevksiz → NO_DUE_DATE (sıranın sonunda)", by(O4.id)?.state === "NO_DUE_DATE" && by(O4.id)?.expectedReturnAt === null && all.data.data.findIndex((r) => r.warpingOrderId === O4.id) > all.data.data.findIndex((r) => r.warpingOrderId === O3.id));
    check("§3e iptal edilen sipariş listede yok · termini ileride olan ALL'da LATER", !by(O5.id) && by(O6.id)?.state === "LATER");
    check("§3f sıra: en geç kalan önce", (all.data.data[0]?.overdueDays ?? 0) >= (all.data.data[1]?.overdueDays ?? -Infinity));
    check("§3g hedef/gelen/kalan metre (dönüş yok → kalan = hedef)", a1?.targetLengthM === "1000.000" && a1.receivedLengthM === "0.000" && a1.remainingLengthM === "1000.000");
    const s = all.data.summary;
    check("§3h sayaçlar listeyle tutarlı", s.overdueCount === all.data.data.filter((r) => r.state === "OVERDUE").length && s.dueSoonCount === all.data.data.filter((r) => r.state === "DUE_SOON").length
      && s.noDueDateCount === all.data.data.filter((r) => r.state === "NO_DUE_DATE").length && s.openCount === all.data.data.length, JSON.stringify(s));
    const soon = await listWarpingDelays({ state: "DUE_SOON", subcontractorIds: [sub.id] });
    check("§3i DUE_SOON süzgeci yalnız yaklaşanları döker; sayaçlar değişmez", soon.data.data.length > 0 && soon.data.data.every((r) => r.state === "DUE_SOON") && JSON.stringify(soon.data.summary) === JSON.stringify(s));
    const over = await listWarpingDelays({ state: "OVERDUE", subcontractorIds: [sub.id] });
    check("§3j OVERDUE süzgeci O1 + O2'yi içerir, O3/O4/O6'yı içermez", [O1.id, O2.id].every((id) => over.data.data.some((r) => r.warpingOrderId === id)) && ![O3.id, O4.id, O6.id].some((id) => over.data.data.some((r) => r.warpingOrderId === id)));
    const other = await listWarpingDelays({ state: "ALL", subcontractorIds: [randomUUID()] });
    check("§3k başka devereci süzgeci → boş + sıfır sayaç", other.data.data.length === 0 && other.data.summary.openCount === 0);

    // ── §4 HTTP ─────────────────────────────────────────────────────────
    const login = async (username: string, password: string): Promise<string> => {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const user = async (suffix: string, perms: string[]): Promise<string> => {
      const parola = kosumaOzguParola();
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      userIds.push(u.id);
      return login(u.username, parola);
    };
    const get = async (p: string, token: string) => {
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { data?: { data?: unknown[]; summary?: unknown }; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tkRead = await user("read", ["warping-order:read"]);
    const tkNone = await user("none", ["warehouse:read"]);
    const ok = await get(`/api/warping-orders/delays?filter[state]=OVERDUE&filter[subcontractorId]=${sub.id}`, tkRead);
    check("§4a 200 · gövde { data, summary }", ok.status === 200 && Array.isArray(ok.data?.data) && !!ok.data?.summary && ok.data.data.length === over.data.data.length, `${ok.status} ${ok.code ?? ""}`);
    const bad = await get(`/api/warping-orders/delays?filter[state]=LATE`, tkRead);
    check("§4b tanınmayan durum → 400 FILTER_INVALID", bad.status === 400 && bad.code === "FILTER_INVALID", `${bad.status} ${bad.code ?? ""}`);
    const unk = await get(`/api/warping-orders/delays?filter[foo]=1`, tkRead);
    check("§4c tanınmayan süzgeç → 400 FILTER_UNKNOWN", unk.status === 400 && unk.code === "FILTER_UNKNOWN", `${unk.status} ${unk.code ?? ""}`);
    const badId = await get(`/api/warping-orders/delays?filter[subcontractorId]=x`, tkRead);
    check("§4d bozuk devereci kimliği → 400 FILTER_INVALID", badId.status === 400 && badId.code === "FILTER_INVALID", `${badId.status} ${badId.code ?? ""}`);
    const no = await get(`/api/warping-orders/delays`, tkNone);
    check("§4e izinsiz → 403", no.status === 403, `${no.status}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const off = await get(`/api/warping-orders/delays`, tkRead);
    check("§4f devere kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code ?? ""}`);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    check("§4g iplik ihtiyacı şeması `deverecideDus=1` alır, `2`yi reddeder",
      yarnNeedQuerySchema.safeParse({ deverecideDus: "1" }).success && !yarnNeedQuerySchema.safeParse({ deverecideDus: "2" }).success);
  } catch (e) {
    fail++;
    console.error("💥", e);
  } finally {
    server.close();
    stopNotificationJobs();
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: dids } } }).catch(() => undefined);
    if (f) {
      await prisma.yarnMovement.deleteMany({ where: { itemId: f.warpYarnId } });
      await prisma.yarnStock.deleteMany({ where: { itemId: f.warpYarnId } });
    }
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids] } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: salesOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: salesOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    if (f) await fiksturSil(f).catch((e) => console.error("fikstür temizliği", e));
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } }).catch(() => undefined);
    for (const key of SETTING_FOTO) {
      const ft = foto.find((x) => x.key === key);
      if (ft) await prisma.systemSetting.update({ where: { key }, data: { value: ft.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

void main();
