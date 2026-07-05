// =============================================================================
// Test: KK1 ağırlık (kg) girişi feature flag enforcement
// =============================================================================
// kk1.weightEntryEnabled default false. Backend createInitialEntry guard'ı:
//   1. flag KAPALI + weightKg yok  → başarılı (yanlış-pozitif engel yok)
//   2. flag KAPALI + weightKg > 0   → 400 ile reddedilir (UI'yı atlayan kötü
//      niyetli/hatalı payload da girmesin — defense-in-depth)
//   3. flag AÇIK   + weightKg       → başarılı, Roll.weightKg damgalanır
//
// Çalıştır: npx tsx scripts/test_kk1_weight_flag.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import {
  systemSettingService,
  readKk1WeightEntryEnabled,
} from "../src/services/system-setting.service";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

async function main() {
  const admin = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcı",
  );
  const item = need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif ürün",
  );

  const rollIds: string[] = [];
  const original = await readKk1WeightEntryEnabled();

  try {
    // ---- 1) Flag KAPALI ----
    await systemSettingService.setFeatureFlags({ kk1WeightEntryEnabled: false }, admin.id);
    check("flag kapalı olarak okundu", (await readKk1WeightEntryEnabled()) === false);

    // ---- 2) Kapalı + ağırlıksız → başarılı (guard yanlış-pozitif engel değil) ----
    const noWeight = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 40 },
      admin.id,
    );
    rollIds.push(noWeight.data.id);
    check("kapalı + ağırlıksız giriş başarılı", noWeight.data.weightKg == null);

    // ---- 3) Kapalı + weightKg > 0 → 400 reddedilir ----
    let rejected = false;
    let rejectMsg = "";
    try {
      const leak = await inventory.createInitialEntry(
        { itemId: item.id, initialQty: 41, weightKg: 10 },
        admin.id,
      );
      // Beklenmedik: reddetmesi gerekiyordu — sızan topu temizlik listesine al.
      rollIds.push(leak.data.id);
    } catch (e) {
      rejected = true;
      rejectMsg = (e as { message?: string })?.message ?? "";
    }
    check(
      "kapalı + ağırlık girişi 400 ile reddedildi",
      rejected && rejectMsg.includes("Ağırlık"),
      rejectMsg || "hata fırlatılmadı",
    );

    // ---- 4) Flag AÇIK ----
    await systemSettingService.setFeatureFlags({ kk1WeightEntryEnabled: true }, admin.id);
    check("flag açık olarak okundu", (await readKk1WeightEntryEnabled()) === true);

    // ---- 5) Açık + weightKg → başarılı + Roll'a damgalanır ----
    const withWeight = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 42, weightKg: 12.5 },
      admin.id,
    );
    rollIds.push(withWeight.data.id);
    check(
      "açık + ağırlık girişi başarılı + damgalandı (12.5)",
      Number(withWeight.data.weightKg) === 12.5,
      String(withWeight.data.weightKg),
    );
  } finally {
    // Flag'i orijinal değerine döndür (test yan etki bırakmaz).
    await systemSettingService
      .setFeatureFlags({ kk1WeightEntryEnabled: original }, admin.id)
      .catch(() => {});
    // Yaratılan topları temizle (test kendi verisini siler).
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
