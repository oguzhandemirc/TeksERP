// =============================================================================
// BEKÇİ — TOPUN DEPOSU: her doğuş yolu `Roll.warehouseId` damgalar mı?
// =============================================================================
// Çalıştırma: npx tsx scripts/test_roll_warehouse_stamp.ts
//
// NEDEN VAR: `warehouseId` bugün NULLABLE (9 fiziksel `roll.create` noktasından
// biri gözden kaçarsa NOT NULL production'da 500 üretirdi). Nullable olduğu için
// EKSİK DAMGA SESSİZDİR: top doğar, listede görünür, yalnız hangi depoda olduğu
// bilinmez ve çok depolu kurulumda envanter sessizce yanlışlanır. Derleyici bunu
// göremez (alan opsiyonel), mevcut testler de görmez (hepsi kendi verisini
// silerek çıkar, damgaya bakmaz).
//
// ÖLÇÜLENLER:
//   A) Varsayılan damga — depo SÖYLENMEDİĞİNDE varsayılan depoya yazılır
//      (fabrika akışlarının tamamı bu daldan geçer; davranış değişmemeli).
//   B) Açık depo — verilen depoya yazılır.
//   C) PASİF depo → 400 (açık seçim sessizce başka depoya SAPMAMALI).
//   D) Var olmayan depo → 400.
//   E) ⭐ KESİM MİRASI — çocuk EBEVEYNİN deposunda doğar, varsayılana DEĞİL.
//      Bu kontrol testin kalbi: kesmek malı TAŞIMAZ. Ebeveyn varsayılan-DIŞI bir
//      depoya konur; kod mirası atlayıp varsayılana yazarsa burası kırmızı olur.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const inventory = new InventoryService();
const tambur = new TamburService();

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

const createdRollIds: string[] = [];
const createdWarehouseIds: string[] = [];
const TAG = `TEST-WH-${Date.now()}`;

async function main(): Promise<void> {
  console.log("=== Topun deposu: damga bekçisi ===\n");

  // Koşum başlangıcı — "bu koşumda doğan top" ölçüsünün sınırı (aşağıya bak).
  const runStart = new Date();

  const def = await ensureDefaultWarehouse();
  console.log(`Varsayılan depo: ${def.name} (${def.action})\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (önce npm run seed).");

  // Testin kendi depoları (fabrika verisine dokunulmaz).
  const alt = await prisma.warehouse.create({
    data: { code: `${TAG}-ALT`, name: `${TAG} İkinci Depo` },
    select: { id: true },
  });
  const passive = await prisma.warehouse.create({
    data: { code: `${TAG}-PASIF`, name: `${TAG} Pasif Depo`, isActive: false },
    select: { id: true },
  });
  createdWarehouseIds.push(alt.id, passive.id);

  // ── A) Depo söylenmezse varsayılana yazılır ─────────────────────────────
  const a = await inventory.createInitialEntry({ itemId: item.id, initialQty: 100 });
  const aRoll = a.data as { id: string };
  createdRollIds.push(aRoll.id);
  const aRow = await prisma.roll.findUnique({ where: { id: aRoll.id }, select: { warehouseId: true } });
  check("A) Depo verilmeyen giriş varsayılan depoya yazıldı", aRow?.warehouseId === def.id, `warehouseId=${aRow?.warehouseId}`);

  // ── B) Açık depo ────────────────────────────────────────────────────────
  const b = await inventory.createInitialEntry(
    { itemId: item.id, initialQty: 50 },
    undefined,
    undefined,
    false,
    { warehouseId: alt.id },
  );
  const bRoll = b.data as { id: string };
  createdRollIds.push(bRoll.id);
  const bRow = await prisma.roll.findUnique({ where: { id: bRoll.id }, select: { warehouseId: true } });
  check("B) Açıkça verilen depoya yazıldı", bRow?.warehouseId === alt.id, `warehouseId=${bRow?.warehouseId}`);

  // ── C) Pasif depo reddedilir ────────────────────────────────────────────
  let passiveRejected = false;
  let passiveMsg = "";
  try {
    const c = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 10 },
      undefined,
      undefined,
      false,
      { warehouseId: passive.id },
    );
    createdRollIds.push((c.data as { id: string }).id);
  } catch (e) {
    passiveRejected = true;
    passiveMsg = (e as Error).message;
  }
  check("C) PASİF depo reddedildi (sessizce sapmadı)", passiveRejected, passiveMsg.slice(0, 80));

  // ── D) Var olmayan depo reddedilir ──────────────────────────────────────
  let ghostRejected = false;
  try {
    const d = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 10 },
      undefined,
      undefined,
      false,
      { warehouseId: "00000000-0000-4000-8000-000000000000" },
    );
    createdRollIds.push((d.data as { id: string }).id);
  } catch {
    ghostRejected = true;
  }
  check("D) Var olmayan depo reddedildi", ghostRejected);

  // ── E) KESİM MİRASI (testin kalbi) ──────────────────────────────────────
  // Ebeveyn VARSAYILAN-DIŞI depoda; çocuk da orada doğmalı.
  const parent = await inventory.createInitialEntry(
    { itemId: item.id, initialQty: 200 },
    undefined,
    undefined,
    false,
    { warehouseId: alt.id, forcedStatus: RollStatus.WAREHOUSE },
  );
  const parentId = (parent.data as { id: string }).id;
  createdRollIds.push(parentId);

  // `qualityGrade` AÇIKÇA: giriş topu gradesiz doğuyor,
  // `quality.gradeRequiredEnabled` AÇIKKEN kesim GRADE_REQUIRED verirdi ve
  // depo damgası bekçisi kendi konusunu ölçemezdi.
  const cut = await tambur.cutWarehouseRoll(parentId, {
    cutLength: 40,
    rawDestination: "WAREHOUSE",
    qualityGrade: "1.KALITE",
  });
  const childId = (cut.data as { childRoll?: { id: string } }).childRoll?.id;
  if (childId) createdRollIds.push(childId);
  const childRow = childId
    ? await prisma.roll.findUnique({ where: { id: childId }, select: { warehouseId: true } })
    : null;

  check("E1) Kesim çocuğu doğdu", Boolean(childId));
  check(
    "E2) ⭐ Çocuk EBEVEYNİN deposunda (varsayılana sapmadı)",
    childRow?.warehouseId === alt.id,
    `çocuk=${childRow?.warehouseId} · ebeveyn=${alt.id} · varsayılan=${def.id}`,
  );

  // ── Körlük zemini ───────────────────────────────────────────────────────
  check(
    "Körlük zemini: ikinci depo varsayılandan FARKLI (E anlamlı)",
    alt.id !== def.id,
  );
  // ── Damga kapsaması ─────────────────────────────────────────────────────
  // ⚠️ KAPSAM DÜZELTMESİ (2026-09-05 yeşile-çekme). Burası eskiden DB GENELİNDE
  // `warehouseId: null` sayıyor ve 0 bekliyordu; etiketi ise "bu koşumda" idi.
  // İki ölçü uyuşmuyordu: tam paket koşumunda BAŞKA bekçilerin temizliği eksik
  // kalan `TEST-`/`TST-` ön ekli topları (ölçüldü: 140, hepsi test ön ekli)
  // burada birikiyor ve bu bekçi KOD sağlamken sonsuza dek kırmızı kalıyordu.
  // Bekçinin sorusu iki ayrı ölçüye bölündü:
  //   1) BU KOŞUMDA doğan her top damgalı mı (etiketin gerçekten söylediği şey),
  //   2) CANLI/gerçek veride (test ön eki DIŞINDA) deposuz top var mı.
  const bornThisRun = await prisma.roll.count({ where: { createdAt: { gte: runStart } } });
  check(
    "Körlük zemini: bu koşumda top doğdu (damga ölçümü anlamlı)",
    bornThisRun >= 3,
    `doğan=${bornThisRun}`,
  );
  const unstampedThisRun = await prisma.roll.findMany({
    where: { createdAt: { gte: runStart }, warehouseId: null },
    select: { barcode: true },
    take: 10,
  });
  check(
    "Bu koşumda doğan her top damgalı",
    unstampedThisRun.length === 0,
    unstampedThisRun.map((r) => r.barcode ?? "(barkodsuz)").join(", ") || `doğan=${bornThisRun}`,
  );

  // Gerçek (test ön eki olmayan) veride deposuz top KALMAMALI — backfill + 9
  // create noktasının kapsaması buradan görünür. Test artıkları sayımdan
  // ÇIKARILIR ama gizlenmez: adedi basılır ki "0 çıktı çünkü hiç bakılmadı"
  // ile "0 çıktı çünkü temiz" ayırt edilebilsin.
  const nullTotal = await prisma.roll.count({ where: { warehouseId: null } });
  const nullReal = await prisma.roll.count({
    where: {
      warehouseId: null,
      NOT: [{ barcode: { startsWith: "TEST" } }, { barcode: { startsWith: "TST" } }],
    },
  });
  check(
    "Test-dışı deposuz top yok (canlı veri damgalı)",
    nullReal === 0,
    `deposuz(test-dışı)=${nullReal} · test artığı=${nullTotal - nullReal}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik — test kendi ürettiğini siler.
    try {
      if (createdRollIds.length) {
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRollIds } } });
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRollIds } } });
        await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRollIds } } });
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: createdRollIds } } });
        // Çocuk → ebeveyn sırası (parentRollId FK).
        await prisma.roll.deleteMany({ where: { id: { in: createdRollIds }, parentRollId: { not: null } } });
        await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
      }
      if (createdWarehouseIds.length) {
        await prisma.warehouse.deleteMany({ where: { id: { in: createdWarehouseIds } } });
      }
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 160));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
