// =============================================================================
// TeksERP - "Tükenene kadar" kartın ÇIKIŞ MATRİSİ (URUN-YASAM-DONGUSU.md §4.1)
// =============================================================================
// Kök kural: çıkışsız kapı üreten ayar yazılır ama açılmaz. Üç "Tükenene kadar" ayarı
// (yeni sipariş · açık satır miktarı · yeni plan) × sevkiyat sipariş kuralı = 54 birleşim;
// HER birinde karttaki depoda duran, açık satırı olmayan malın en az bir çıkışı olmalı.
// Çıkış GERÇEK yüklemlerle sayılır (kopya kural yok):
//   · malı yürütmek (çuval/sevk)       → assertItemUsable(EXISTING_GOODS)   — şart
//   · toplardan hızlı sipariş          → assertItemUsable(NEW_ORDER, okutulan toplar)
//   · siparişsiz sevk                  → assertOrderLinkAllowed(kural, sipariş yok)
//   · "Siparişsiz devam et" beyanı     → assertOrderLinkAllowed(kural, orderless)
// KAPALI + sevkte sipariş zorunlu birleşiminin tek çıkışı beyandır; ayar kaydı bunu
// iki yönde `warnings[]` ile söyler (1e kararı 2026-09-25 — çapraz kapı reddedildi).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { ItemLifecycleStatus } from "@prisma/client";
import { assertItemUsable } from "../src/services/helpers/item-usage.helper";
import { assertOrderLinkAllowed } from "../src/services/helpers/shipment-order-requirement.helper";
import {
  PHASE_OUT_EXIT_WARNING,
  PHASE_OUT_LINE_QTY_VALUES,
  PHASE_OUT_NEW_ORDER_VALUES,
} from "../src/services/helpers/item-lifecycle-settings.helper";
import {
  SETTING_KEYS,
  SHIPMENT_ORDER_REQUIREMENTS,
  SystemSettingService,
} from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const ok = async (fn: () => unknown): Promise<boolean> => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};

const TAG = `TST-CK-${Date.now()}`;
const KEYS = [
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER,
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY,
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN,
  SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT,
];
const original = new Map<string, unknown>();
const itemIds: string[] = [];

async function put(key: string, value: string | boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value, description: `${TAG} bekçi` } });
}

async function main(): Promise<void> {
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    original.set(k, row ? row.value : undefined);
  }
  const admin = await ensureTestAdmin();
  const r = await itemService.create({ name: `${TAG} KART`, itemType: "FABRIC", unit: "MT" });
  const P = (r.data as { id: string }).id;
  itemIds.push(P);
  await itemService.transitionLifecycle(P, ItemLifecycleStatus.PHASE_OUT, null, admin.id);

  try {
    console.log("=== 1) 54 birleşim — her birinde çıkış ≥ 1 ===");
    let birlesim = 0;
    let cikissiz = 0;
    let yalnizBeyan = 0;
    for (const newOrder of PHASE_OUT_NEW_ORDER_VALUES) {
      for (const lineQty of PHASE_OUT_LINE_QTY_VALUES) {
        for (const newPlan of [true, false]) {
          for (const req of SHIPMENT_ORDER_REQUIREMENTS) {
            birlesim++;
            await put(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER, newOrder);
            await put(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY, lineQty);
            await put(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN, newPlan);
            const yurutulur = await ok(() => assertItemUsable(prisma, P, "EXISTING_GOODS"));
            const cikislar = {
              hizliSiparis: await ok(() => assertItemUsable(prisma, P, "NEW_ORDER", { fromScannedRolls: true })),
              siparissizSevk: await ok(() => assertOrderLinkAllowed(req, { orderIds: [] })),
              beyanliSevk: await ok(() => assertOrderLinkAllowed(req, { orderIds: [], orderless: true })),
            };
            const n = yurutulur ? Object.values(cikislar).filter(Boolean).length : 0;
            if (n === 0) {
              cikissiz++;
              console.log(`   · ÇIKIŞSIZ: yeniSiparis=${newOrder} miktar=${lineQty} plan=${newPlan} sevk=${req}`);
            }
            if (n === 1 && cikislar.beyanliSevk) yalnizBeyan++;
          }
        }
      }
    }
    check("54 birleşim tarandı", birlesim === 54, `${birlesim}`);
    check("⭐ hiçbir birleşimde çıkış 0 değil", cikissiz === 0, `çıkışsız ${cikissiz}`);
    // Körlük zemini: tek çıkışı beyan olan birleşim gerçekten var (KAPALI + block × 6).
    check("tek çıkışı 'Siparişsiz devam et' olan birleşim sayısı = 6 (KAPALI + block)", yalnizBeyan === 6, `${yalnizBeyan}`);

    console.log("\n=== 2) KAPALI + block kaydı iki yönde uyarı verir, reddetmez ===");
    const svc = new SystemSettingService();
    for (const k of KEYS) await prisma.systemSetting.deleteMany({ where: { key: k } });
    const a = await svc.setFeatureFlags({ shippingOrderRequirement: "block" }, admin.id);
    check("block tek başına: uyarı yok", !(a.warnings ?? []).includes(PHASE_OUT_EXIT_WARNING));
    const b = await svc.setFeatureFlags({ itemPhaseOutNewOrder: "KAPALI" }, admin.id);
    check("block varken KAPALI kaydı KABUL + uyarı", (b.warnings ?? []).includes(PHASE_OUT_EXIT_WARNING), (b.warnings ?? []).join("|"));
    await svc.setFeatureFlags({ shippingOrderRequirement: "warn" }, admin.id);
    const c = await svc.setFeatureFlags({ shippingOrderRequirement: "block" }, admin.id);
    check("KAPALI varken block kaydı KABUL + uyarı (ters yön)", (c.warnings ?? []).includes(PHASE_OUT_EXIT_WARNING));
    const d = await svc.setFeatureFlags({ itemPhaseOutNewOrder: "OKUTULAN_TOPLAR" }, admin.id);
    check("birleşim bozulunca uyarı yok", !(d.warnings ?? []).includes(PHASE_OUT_EXIT_WARNING));
    const e = await svc.setFeatureFlags({ itemPhaseOutLineQty: "KILITLI" }, admin.id);
    check("ilgisiz ayar kaydı uyarı üretmiyor", !(e.warnings ?? []).includes(PHASE_OUT_EXIT_WARNING));
  } finally {
    await temizleAyarlar();
  }
}

/** Dört ayarı ÖNCEKİ hâline döndürür (yoksa satırı siler). */
async function temizleAyarlar(): Promise<void> {
  for (const k of KEYS) {
    const v = original.get(k);
    if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
    else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
  }
}

async function temizle(): Promise<void> {
  if (itemIds.length === 0) return;
  await prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle().catch((e) => console.error("temizlik:", (e as Error).message));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
