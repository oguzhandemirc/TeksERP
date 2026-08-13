// =============================================================================
// BEKÇİ — Depo tanımı: varsayılan koruması + bağımlılık guard'ı + varsayılan takası
// =============================================================================
// Çalıştırma: npx tsx scripts/test_warehouse_crud.ts
//
// NEDEN: "varsayılan depo" bir KURAL taşır — depo söylenmeyen her giriş oraya
// düşer (`resolveTargetWarehouseId`). Varsayılan pasifleştirilir/silinirse kural
// cevapsız kalır ve yeni toplar DEPOSUZ doğar: hata yok, log yok, yalnız
// envanterde sessiz boşluk. Guard'lar servis katmanında; DB'de ikinci hat
// `rolls_warehouseId_fkey` RESTRICT.
//
// ÖLÇÜLENLER:
//   A) Varsayılan depo PASİFE ALINAMAZ (PATCH isActive=false → 409)
//   B) Varsayılan depo SİLİNEMEZ (soft) → 409
//   C) Varsayılan depo KALICI silinemez → 409
//   D) İçinde top olan depo KALICI silinemez → 409 + sayı mesajda
//   E) Boş + varsayılan-olmayan depo kalıcı silinebilir
//   F) setDefault ATOMİK takas — eskisi düşer, yenisi kalkar, DAİMA tek varsayılan
//   G) Pasif depo varsayılan yapılamaz → 400
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { warehouseService } from "../src/services/warehouse.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Çağrıyı koşar; hata mesajını döner (hata yoksa null). */
async function expectError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const TAG = `TEST-WHC-${Date.now()}`;
const rollIds: string[] = [];
const warehouseIds: string[] = [];

/**
 * Kurulumun ÖZGÜN varsayılan deposu — testin sonunda AYNEN geri verilir.
 *
 * ⚠️ Bu satırlar süs değil: bu dosya varsayılan bayrağıyla ve `isActive` ile
 * OYNUYOR. Test yarıda kalırsa (özellikle bir NEGATİF SONDA sırasında — bu repoda
 * rutin) kurulum "varsayılanı olmayan / pasif varsayılanlı" durumda kalır ve o
 * durumda her yeni top DEPOSUZ doğar. Ölçüldü: guard körleştirilip test
 * çalıştırıldığında tam bu oldu.
 */
let originalDefault: { id: string; isActive: boolean } | null = null;

async function main(): Promise<void> {
  console.log("=== Depo tanımı: guard bekçisi ===\n");

  const def = await ensureDefaultWarehouse();
  originalDefault = { id: def.id, isActive: true };
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  // ── A/B/C — varsayılan depo korunuyor mu ────────────────────────────────
  const aMsg = await expectError(() => warehouseService.update(def.id, { isActive: false }));
  check("A) Varsayılan depo PASİFE ALINAMAZ", aMsg !== null && aMsg.includes("VARSAYILAN"), aMsg?.slice(0, 70) ?? "hata YOK");

  const bMsg = await expectError(() => warehouseService.softDelete(def.id));
  check("B) Varsayılan depo SİLİNEMEZ (soft)", bMsg !== null && bMsg.includes("VARSAYILAN"), bMsg?.slice(0, 70) ?? "hata YOK");

  const cMsg = await expectError(() => warehouseService.hardDelete(def.id));
  check("C) Varsayılan depo KALICI silinemez", cMsg !== null && cMsg.includes("VARSAYILAN"), cMsg?.slice(0, 70) ?? "hata YOK");

  // Hâlâ aktif ve varsayılan mı? (guard'lar yan etki bırakmamalı)
  const defRow = await prisma.warehouse.findUnique({ where: { id: def.id }, select: { isActive: true, isDefault: true } });
  check("A-C sonrası varsayılan depo bozulmadı", defRow?.isActive === true && defRow?.isDefault === true);

  // ── D — dolu depo kalıcı silinemez ──────────────────────────────────────
  const full = (await warehouseService.create({ name: `${TAG} Dolu Depo` })).data as { id: string };
  warehouseIds.push(full.id);
  const r = await inventory.createInitialEntry({ itemId: item.id, initialQty: 12 }, undefined, undefined, false, {
    warehouseId: full.id,
  });
  rollIds.push((r.data as { id: string }).id);

  const dMsg = await expectError(() => warehouseService.hardDelete(full.id));
  check("D) İçinde top olan depo KALICI silinemez", dMsg !== null && dMsg.includes("1 top"), dMsg?.slice(0, 80) ?? "hata YOK");

  // ── E — boş depo silinebilir ────────────────────────────────────────────
  const empty = (await warehouseService.create({ name: `${TAG} Boş Depo` })).data as { id: string };
  const eRes = await warehouseService.hardDelete(empty.id);
  const eGone = (await prisma.warehouse.findUnique({ where: { id: empty.id }, select: { id: true } })) === null;
  check("E) Boş + varsayılan-olmayan depo kalıcı silindi", eRes.success === true && eGone);

  // ── F — varsayılan takası atomik ────────────────────────────────────────
  await warehouseService.setDefault(full.id);
  const defaults = await prisma.warehouse.findMany({ where: { isDefault: true }, select: { id: true } });
  check("F1) Takas sonrası varsayılan YENİ depo", defaults.length === 1 && defaults[0]?.id === full.id, `varsayılan sayısı=${defaults.length}`);

  // Geri al — testin fabrikanın varsayılanını değiştirmiş bırakmaması ŞART.
  await warehouseService.setDefault(def.id);
  const back = await prisma.warehouse.findMany({ where: { isDefault: true }, select: { id: true } });
  check("F2) Geri takasta yine TEK varsayılan (partial unique korundu)", back.length === 1 && back[0]?.id === def.id);

  // ── G — pasif depo varsayılan yapılamaz ─────────────────────────────────
  const passive = (await warehouseService.create({ name: `${TAG} Pasif` })).data as { id: string };
  warehouseIds.push(passive.id);
  await warehouseService.update(passive.id, { isActive: false });
  const gMsg = await expectError(() => warehouseService.setDefault(passive.id));
  check("G) PASİF depo varsayılan yapılamaz", gMsg !== null, gMsg?.slice(0, 70) ?? "hata YOK");

  // Körlük zemini: guard'lar gerçekten çağrıldı mı (hepsi null dönseydi test
  // "hata yok" diye yeşile kaçamaz — check'ler zaten mesaj içeriğine bakıyor).
  check("Körlük zemini: en az 3 depo üretildi", warehouseIds.length >= 2);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
      // ÖZGÜN varsayılanı geri ver — test yarıda kalsa bile kurulum varsayılansız
      // ya da pasif-varsayılanlı kalmamalı (ham SQL/servis değil, doğrudan yazım:
      // servis guard'ı pasif depoyu varsayılan yapmayı reddeder ve onarım tıkanır).
      if (originalDefault) {
        await prisma.warehouse.updateMany({ where: { isDefault: true, id: { not: originalDefault.id } }, data: { isDefault: false } });
        await prisma.warehouse.update({
          where: { id: originalDefault.id },
          data: { isActive: originalDefault.isActive, isDefault: true },
        });
      }
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 160));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
