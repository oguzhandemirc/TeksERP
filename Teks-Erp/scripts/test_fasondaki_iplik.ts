// =============================================================================
// FASONDAKİ İPLİK — `GET /api/warping-orders/yarn-at-subcontractor` lot süzgeci · arama · değer (2026-11-19)
// =============================================================================
//   §1 `filter[lotId]` yalnız o lotun satırını döner · bilinmeyen lot boş · geçersiz kimlik 400 (HTTP)
//   §2 `search` lot no / sipariş no / iplik adıyla eşleşir (her kelime AND) · eşleşmeyen boş · 101 karakter 400 (HTTP)
//   §3 değer: lot fiyatı = ACTIVE fişlerin kg-ağırlıklı ortalaması (fiş para birimi) · iptal fiş sayılmaz · karışık para
//      birimi fiyatsız · lotsuz NO_LOT · değer = kg × fiyat
//   §4 OPT-IN: `goods-receipt:read` yoksa HTTP gövdesinde fiyat alanı YOK; varsa var · servis `withValue` yokken alan yok
// NEGATİF SONDA: bkz. arşiv notu "Fasondaki İplik 7 iyileştirme".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { Currency, GoodsReceiptStatus, Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { ensureTestAdmin, kosumaOzguParola, testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { warpingYarnAtSubcontractors } from "../src/services/warping-order/yarn-at-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FIP-${process.pid}`;
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASONDAKİ İPLİK: LOT SÜZGECİ · ARAMA · DEĞER ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const receiptIds: string[] = [];
  const userIds: string[] = [];
  let specId = "";
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.TICARET_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await reconcileReasonPresets();

    // ── Fikstür: X (lotlu: L1 fiyatlı · L2 karışık para birimi · L3 yalnız iptal fişli) + Y (lotsuz) ─────────
    const mkYarn = async (k: string) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
      yarnIds.push(y.id);
      return y.id;
    };
    const X = await mkYarn("X");
    const Y = await mkYarn("Y");
    const mkLot = async (no: string) => {
      const id = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-${no}` }, select: { id: true } })).id;
      lotIds.push(id);
      return id;
    };
    const L1 = await mkLot("L1");
    const L2 = await mkLot("L2");
    const L3 = await mkLot("L3");
    let seq = 0;
    const receipt = async (currency: Currency, status: GoodsReceiptStatus = GoodsReceiptStatus.ACTIVE) => {
      const r = await prisma.goodsReceipt.create({
        data: { receiptNo: `${TAG}-${++seq}`.slice(0, 32), warehouseId: whId, currency, status, ...(status === GoodsReceiptStatus.CANCELLED ? { cancelledAt: new Date(), cancelReason: `${TAG}` } : {}) },
        select: { id: true },
      });
      receiptIds.push(r.id);
      return r.id;
    };
    const stockIn = async (itemId: string, lotId: string | null, qtyKg: number, priced?: { receiptId: string; unitPrice: string }) => {
      const m = await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg, lotId, goodsReceiptId: priced?.receiptId ?? null, reason: `${TAG} giriş` }));
      // Fiyat mal kabul servisinin işi; fikstür fiyatı satıra doğrudan yazar (okuyucuyu ölçmek için).
      if (priced) await prisma.yarnMovement.update({ where: { id: m.movementId }, data: { unitPrice: new Prisma.Decimal(priced.unitPrice) } });
    };
    const rUsd = await receipt(Currency.USD);
    const rUsd2 = await receipt(Currency.USD);
    const rEur = await receipt(Currency.EUR);
    const rCancelled = await receipt(Currency.USD, GoodsReceiptStatus.CANCELLED);
    await stockIn(X, L1, 60, { receiptId: rUsd, unitPrice: "2.5" });
    await stockIn(X, L1, 40, { receiptId: rUsd2, unitPrice: "3.5" }); // ağırlıklı: (60×2.5 + 40×3.5) / 100 = 2.9
    await stockIn(X, L1, 10, { receiptId: rCancelled, unitPrice: "100" }); // iptal fiş → sayılmaz
    await stockIn(X, L2, 20, { receiptId: rUsd, unitPrice: "2" });
    await stockIn(X, L2, 20, { receiptId: rEur, unitPrice: "2" });
    await stockIn(X, L3, 20, { receiptId: rCancelled, unitPrice: "9" });
    await stockIn(Y, null, 50);
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XY`, name: `${TAG} kart`, yarnItemId: X, endsCount: 5400, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }] } },
      select: { id: true },
    });
    specId = spec.id;
    const order = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
    orderIds.push(order.data.id);
    await dispatchWarpingOrder(order.data.id, {
      clientToken: randomUUID(),
      lines: [
        { yarnItemId: X, warehouseId: whId, lotId: L1, qtyKg: 10 },
        { yarnItemId: X, warehouseId: whId, lotId: L2, qtyKg: 5 },
        { yarnItemId: X, warehouseId: whId, lotId: L3, qtyKg: 4 },
        { yarnItemId: Y, warehouseId: whId, lotId: null, qtyKg: 3 },
      ],
    }, U);
    const orderNo = order.data.orderNo;
    const mine = { yarnItemIds: [X, Y] };

    // ── §1 lot süzgeci ──────────────────────────────────────────────────
    const all = await warpingYarnAtSubcontractors(mine);
    check("§1a körlük zemini: süzgeçsiz dört satır (L1 · L2 · L3 · lotsuz Y)", all.length === 4, all.map((r) => r.lotNo ?? "lotsuz").join(","));
    const byL1 = await warpingYarnAtSubcontractors({ ...mine, lotIds: [L1] });
    check("§1b filter lotId=L1 → yalnız L1 satırı (10 kg)", byL1.length === 1 && byL1[0]?.lotId === L1 && byL1[0].kg === "10.000", JSON.stringify(byL1.map((r) => [r.lotNo, r.kg])));
    const byTwo = await warpingYarnAtSubcontractors({ ...mine, lotIds: [L1, L3] });
    check("§1c CSV iki lot → iki satır", byTwo.length === 2 && byTwo.every((r) => r.lotId === L1 || r.lotId === L3));
    const byUnknown = await warpingYarnAtSubcontractors({ ...mine, lotIds: [randomUUID()] });
    check("§1d bilinmeyen lot → boş", byUnknown.length === 0);

    // ── §2 arama ───────────────────────────────────────────────────────
    const sLot = await warpingYarnAtSubcontractors({ ...mine, search: `${TAG}-L2` });
    check("§2a lot no araması → yalnız L2", sLot.length === 1 && sLot[0]?.lotId === L2, JSON.stringify(sLot.map((r) => r.lotNo)));
    const sOrder = await warpingYarnAtSubcontractors({ ...mine, search: orderNo });
    check("§2b sipariş no araması → siparişin bütün satırları", sOrder.length === 4, String(sOrder.length));
    const sYarn = await warpingYarnAtSubcontractors({ ...mine, search: `iplik Y` });
    check("§2c iplik adı (iki kelime, AND) → yalnız lotsuz Y", sYarn.length === 1 && sYarn[0]?.yarnItemId === Y, JSON.stringify(sYarn.map((r) => r.yarnItemCode)));
    const sNone = await warpingYarnAtSubcontractors({ ...mine, search: `${TAG}-YOKBOYLE` });
    check("§2d eşleşmeyen arama → boş", sNone.length === 0);

    // ── §3 değer ───────────────────────────────────────────────────────
    const v = await warpingYarnAtSubcontractors({ ...mine, withValue: true });
    const row = (lot: string | null) => v.find((r) => r.lotId === lot);
    const v1 = row(L1);
    check("§3a L1: ağırlıklı fiyat 2.9000 USD (iptal fiş sayılmaz) · değer 10 × 2.9 = 29.00", v1?.priceStatus === "PRICE" && v1.unitPrice === "2.9000" && v1.currency === "USD" && v1.value === "29.00", JSON.stringify(v1 && { s: v1.priceStatus, p: v1.unitPrice, c: v1.currency, v: v1.value }));
    const v2 = row(L2);
    check("§3b L2: USD + EUR fiş → MIXED_CURRENCY, fiyat/değer null (kur çevrilmez)", v2?.priceStatus === "MIXED_CURRENCY" && v2.unitPrice === null && v2.value === null && v2.currency === null);
    const v3 = row(L3);
    check("§3c L3: yalnız iptal fişte fiyat → NO_PRICE", v3?.priceStatus === "NO_PRICE" && v3.value === null);
    const vY = row(null);
    check("§3d lotsuz satır → NO_LOT", vY?.priceStatus === "NO_LOT" && vY.value === null);
    check("§4a servis withValue yokken fiyat alanları yok", all.every((r) => !("value" in r) && !("unitPrice" in r) && !("priceStatus" in r)));

    // ── HTTP: 400'ler + OPT-IN ─────────────────────────────────────────
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
    type Resp = { status: number; code?: string; data?: Array<Record<string, unknown>> };
    const get = async (p: string, token: string): Promise<Resp> => {
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>>; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tkRead = await user("read", ["warping-order:read"]);
    const tkPrice = await user("price", ["warping-order:read", "goods-receipt:read"]);
    check("§4 giriş (iki dar izinli kullanıcı)", tkRead.length > 0 && tkPrice.length > 0);
    const P = `/api/warping-orders/yarn-at-subcontractor?filter[yarnItemId]=${X},${Y}`;
    const hLot = await get(`${P}&filter[lotId]=${L1}`, tkRead);
    check("§1e HTTP filter[lotId] → 200, tek satır", hLot.status === 200 && hLot.data?.length === 1 && hLot.data[0]?.lotId === L1, `${hLot.status} ${hLot.data?.length}`);
    const hBad = await get(`${P}&filter[lotId]=not-a-uuid`, tkRead);
    check("§1f HTTP geçersiz lot kimliği → 400 FILTER_INVALID", hBad.status === 400 && hBad.code === "FILTER_INVALID", `${hBad.status} ${hBad.code}`);
    const hBare = await get(`${P}&lotId=${L1}`, tkRead);
    check("§1g HTTP çıplak lotId → 400 BARE_FILTER_PARAM", hBare.status === 400 && hBare.code === "BARE_FILTER_PARAM", `${hBare.status} ${hBare.code}`);
    const hSearch = await get(`${P}&search=${encodeURIComponent(`${TAG}-L2`)}`, tkRead);
    check("§2e HTTP search → yalnız L2", hSearch.status === 200 && hSearch.data?.length === 1 && hSearch.data[0]?.lotId === L2, `${hSearch.status} ${hSearch.data?.length}`);
    const hLong = await get(`${P}&search=${"a".repeat(101)}`, tkRead);
    check("§2f HTTP 101 karakter arama → 400 LIST_SEARCH_TOO_LONG", hLong.status === 400 && hLong.code === "LIST_SEARCH_TOO_LONG", `${hLong.status} ${hLong.code}`);
    const hNoPrice = await get(P, tkRead);
    check("§4b `goods-receipt:read` YOK → gövdede fiyat alanı yok", hNoPrice.status === 200 && (hNoPrice.data ?? []).length === 4 && (hNoPrice.data ?? []).every((r) => !("value" in r) && !("unitPrice" in r) && !("currency" in r)), JSON.stringify(Object.keys(hNoPrice.data?.[0] ?? {})));
    const hPrice = await get(P, tkPrice);
    const p1 = hPrice.data?.find((r) => r.lotId === L1);
    check("§4c `goods-receipt:read` VAR → L1 değeri 29.00 USD", hPrice.status === 200 && p1?.value === "29.00" && p1.currency === "USD", JSON.stringify(p1 ? { v: p1.value, c: p1.currency } : null));
    await setSetting(SETTING_KEYS.TICARET_ENABLED, "false");
    const hOff = await get(P, tkPrice);
    // Fiyat kapısı yalnız izindir: ticaret kapalıyken iplik zinciri ucu bütünüyle kapatır (fiş fiyatı sızmaz).
    check("§4d ticaret kapalı → uç 403 MODULE_DISABLED (fiyat da gelmez)", hOff.status === 403 && hOff.code === "MODULE_DISABLED", `${hOff.status} ${hOff.code}`);
    await setSetting(SETTING_KEYS.TICARET_ENABLED, "true");
  } catch (e) {
    fail++;
    console.error("💥", e);
  } finally {
    server.close();
    stopNotificationJobs();
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: dids } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids] } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } }).catch(() => undefined);
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

void main();
