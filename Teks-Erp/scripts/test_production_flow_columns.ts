// =============================================================================
// Test: getProductionFlow — tüm kolonlar hatasız döner (kuyruk kolonları dahil)
// Çalıştır: npx tsx scripts/test_production_flow_columns.ts
// Gerekçe: parti-redesign rename kaçağı (workOrder.batchNumber select'i) kuyruk
// kolonlarını (includeQueues=true) her çağrıda Prisma validation hatasıyla 500'e
// düşürüyordu; typecheck Promise.all excess-property bastırması yüzünden
// yakalayamıyor (2026-07-15 düzeltildi). Bu script canlı sorguyu çalıştırarak
// select alanlarının şemayla senkron kaldığını garanti eder.
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const inv = new InventoryService();

async function main() {
  // 1) Kuyruklar + sevk AÇIK — bayat select burada patlıyordu.
  const full = await inv.getProductionFlow({ includeQueues: true, includeSevk: true });
  check("includeQueues=true hatasız döndü", full.success === true);
  const d = full.data;
  check(
    "6 kolon da mevcut",
    !!d && ["hamStok", "fason", "kursun", "tambur", "depo", "sevk"].every((k) => k in d),
  );
  check(
    "kuyruk kartları workOrderNumber taşıyor (İE…)",
    (d?.kursun.cards ?? []).concat(d?.tambur.cards ?? [])
      .every((c) => typeof c.workOrderNumber === "string" && c.workOrderNumber.length > 0),
    `kursun=${d?.kursun.total} tambur=${d?.tambur.total}`,
  );

  // 2) Yetkisiz varyant — kuyruklar/sevk kapalıyken de sorunsuz.
  const limited = await inv.getProductionFlow({ includeQueues: false, includeSevk: false });
  check("includeQueues=false hatasız + boş kuyruklar", limited.data?.kursun.total === 0 && limited.data?.tambur.total === 0);

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
