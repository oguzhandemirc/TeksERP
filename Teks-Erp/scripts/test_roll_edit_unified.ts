// =============================================================================
// TEST (2026-07-30): TEK düzeltme sözleşmesi — applyManualProperties birleşimi.
// Çalıştır: npx tsx scripts/test_roll_edit_unified.ts
// =============================================================================
// Eskiden iki uç (relabel `/:id/label` ve `/manual-attributes`) AYNI motoru iki
// farklı kapsamla çağırıyordu; kapsamı belirleyen şey `Boolean(reason)` idi. Bu iki
// tuhaflık üretiyordu: (a) süpervizör istasyondaki topun METRAJINI düzeltemiyordu,
// (b) kapsamı genişleten şey yetki değil sebep alanının dolu olmasıydı.
//
// Yeni sözleşme (kapsam TOPUN DURUMUNDAN çözülür):
//   A) Serbest satılabilir stok (STOCK/WAREHOUSE/A1_STOCK): sebep OPSİYONEL,
//      ek yetki YOK — mobil/depo yolu bozulmaz.
//   B) Serbest stok DIŞI (örn. IN_PRODUCTION): sebep ZORUNLU + `roll:manual-adjust`.
//      permissions verilmezse (dahili çağrı) enforcement atlanır (F221 deseni).
//   C) Fason/kartela/emekli/sevk edilmiş: HER yolla reddedilir.
//   D) Süpervizör artık METRAJ da düzeltebilir (eski boşluk kapandı).
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";

const inv = new InventoryService();

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, msgPart?: string): Promise<void> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let ITEM = "", GRADE = "", ADMIN = "", COLOR = "";
let GRADE_CODE = "";
const rollIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-EDIT-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const allowed = await prisma.itemAllowedColor.findFirst({ where: { itemId: ITEM }, select: { colorId: true } });
  COLOR = allowed?.colorId
    ?? need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk");
}

async function makeRoll(status: RollStatus, qty = 100): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status, qualityGrade: GRADE_CODE, qualityGradeId: GRADE,
      entrySource: "SUPPLIER_RECEIPT", createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

const DEPO_PERMS = ["roll:write", "label:edit"] as const;
const SUPER_PERMS = ["roll:write", "roll:manual-adjust"] as const;

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === A) Serbest satılabilir stok: sebep opsiyonel, ek yetki yok ===
    console.log("\n=== A) Serbest stok (WAREHOUSE): sebepsiz geçer, depo yetkisi yeter ===");
    {
      const id = await makeRoll(RollStatus.WAREHOUSE);
      await inv.applyManualProperties(
        id, { colorId: COLOR, propertyIds: [] }, ADMIN, { permissions: DEPO_PERMS },
      );
      const r = await prisma.roll.findUnique({ where: { id }, select: { colorId: true } });
      check("sebepsiz düzeltme geçti (depo yolu bozulmadı)", r?.colorId === COLOR);

      // Metraj da bu yolda düzeltilebilir (eskiden de öyleydi).
      await inv.applyManualProperties(
        id, { colorId: COLOR, propertyIds: [], currentQty: 250 }, ADMIN, { permissions: DEPO_PERMS },
      );
      const r2 = await prisma.roll.findUnique({ where: { id }, select: { currentQty: true, initialQty: true } });
      check("metraj düzeltildi + initialQty senkron",
        Number(r2?.currentQty) === 250 && Number(r2?.initialQty) === 250,
        `${r2?.currentQty}/${r2?.initialQty}`);
    }

    // === B) Serbest stok DIŞI: sebep zorunlu + roll:manual-adjust ===
    console.log("\n=== B) Üretimdeki top (IN_PRODUCTION): sebep + yetki zorunlu ===");
    {
      const id = await makeRoll(RollStatus.IN_PRODUCTION);

      await expectThrow(
        "sebepsiz → 400",
        () => inv.applyManualProperties(id, { colorId: COLOR, propertyIds: [] }, ADMIN, { permissions: SUPER_PERMS }),
        "işlem nedeni",
      );
      await expectThrow(
        "yetkisiz (depo izinleri) → 403",
        () => inv.applyManualProperties(
          id, { colorId: COLOR, propertyIds: [], reason: "yanlış renk" }, ADMIN, { permissions: DEPO_PERMS },
        ),
        "roll:manual-adjust",
      );
      // Sebep + yetki birlikte → geçer
      await inv.applyManualProperties(
        id, { colorId: COLOR, propertyIds: [], reason: "KK1'de yanlış renk girilmiş" }, ADMIN,
        { permissions: SUPER_PERMS },
      );
      const r = await prisma.roll.findUnique({ where: { id }, select: { colorId: true } });
      check("sebep + roll:manual-adjust ile geçti", r?.colorId === COLOR);

      // F221: permissions verilmezse enforcement atlanır (dahili/test çağrısı).
      await inv.applyManualProperties(id, { colorId: null, propertyIds: [], reason: "dahili çağrı" }, ADMIN);
      const r2 = await prisma.roll.findUnique({ where: { id }, select: { colorId: true } });
      check("permissions omit → enforcement atlanır (F221)", r2?.colorId === null);
    }

    // === C) Fason/sevk edilmiş: her yolla red ===
    console.log("\n=== C) Fasonda / sevk edilmiş top: her yolla reddedilir ===");
    {
      const atSub = await makeRoll(RollStatus.AT_SUBCONTRACTOR);
      await expectThrow(
        "AT_SUBCONTRACTOR + sebep + yetki → red",
        () => inv.applyManualProperties(
          atSub, { colorId: COLOR, propertyIds: [], reason: "denemek" }, ADMIN, { permissions: SUPER_PERMS },
        ),
        "fason/kartelada",
      );
      const shipped = await makeRoll(RollStatus.SHIPPED);
      await expectThrow(
        "SHIPPED + sebep + yetki → red",
        () => inv.applyManualProperties(
          shipped, { colorId: COLOR, propertyIds: [], reason: "denemek" }, ADMIN, { permissions: SUPER_PERMS },
        ),
        "sevk edilmiş",
      );
      const scrap = await makeRoll(RollStatus.SCRAP);
      await expectThrow(
        "SCRAP → red (hurda/iptal)",
        () => inv.applyManualProperties(
          scrap, { colorId: COLOR, propertyIds: [], reason: "denemek" }, ADMIN, { permissions: SUPER_PERMS },
        ),
        "Hurda/iptal",
      );
    }

    // === D) Kapanan boşluk: süpervizör artık METRAJ düzeltebilir ===
    console.log("\n=== D) Süpervizör üretimdeki topun METRAJINI düzeltebiliyor (eski boşluk) ===");
    {
      const id = await makeRoll(RollStatus.IN_PRODUCTION, 800);
      await inv.applyManualProperties(
        id,
        { colorId: COLOR, propertyIds: [], currentQty: 700, reason: "ölçüm yanlış girilmiş" },
        ADMIN,
        { permissions: SUPER_PERMS },
      );
      const r = await prisma.roll.findUnique({
        where: { id },
        select: { currentQty: true, initialQty: true, colorId: true },
      });
      check("istasyondaki topun metrajı düzeltildi",
        Number(r?.currentQty) === 700 && Number(r?.initialQty) === 700,
        `${r?.currentQty}/${r?.initialQty}`);
      check("aynı çağrıda renk de uygulandı", r?.colorId === COLOR);
    }

    // === E) Audit event ayrımı korunuyor ===
    console.log("\n=== E) Audit izi: sebep → MANUAL_ATTRIBUTE, sebepsiz → RELABEL ===");
    {
      const withReason = await makeRoll(RollStatus.WAREHOUSE);
      await inv.applyManualProperties(
        withReason, { colorId: COLOR, propertyIds: [], reason: "sebepli düzeltme" }, ADMIN,
        { permissions: DEPO_PERMS },
      );
      const noReason = await makeRoll(RollStatus.WAREHOUSE);
      await inv.applyManualProperties(
        noReason, { colorId: COLOR, propertyIds: [] }, ADMIN, { permissions: DEPO_PERMS },
      );
      const logs = await prisma.systemLog.findMany({
        where: { tableName: "ROLL_MANUAL_OVERRIDE", recordId: { in: [withReason, noReason] } },
        select: { recordId: true, newData: true },
      });
      const eventOf = (id: string) =>
        logs.filter((l) => l.recordId === id)
          .map((l) => (l.newData as Record<string, unknown> | null)?.event)
          .find((e) => e === "MANUAL_ATTRIBUTE" || e === "RELABEL");
      check("sebepli → MANUAL_ATTRIBUTE", eventOf(withReason) === "MANUAL_ATTRIBUTE", String(eventOf(withReason)));
      check("sebepsiz → RELABEL", eventOf(noReason) === "RELABEL", String(eventOf(noReason)));
    }

    // === F) rollId ile relabel-context (barkodsuz açık kumaş) ===
    console.log("\n=== F) relabel-context rollId ile çalışıyor (barkodsuz top) ===");
    {
      const r = await prisma.roll.create({
        data: {
          barcode: null, itemId: ITEM, initialQty: 120, currentQty: 120,
          status: RollStatus.IN_PRODUCTION, entrySource: "SUBCONTRACTOR_RETURN", createdById: ADMIN,
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      const ctx = await inv.getRelabelContext({ rollId: r.id });
      const data = ctx.data as { id: string; barcode: string | null; status: string } | null;
      check("barkodsuz top rollId ile çözüldü", data?.id === r.id && data?.barcode === null, String(data?.status));
      const miss = await inv.getRelabelContext({ rollId: "00000000-0000-0000-0000-000000000000" });
      check("olmayan rollId → success=false", miss.success === false);
    }
  } finally {
    await cleanup();
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    // Metraj düzeltmesi 2026-09-14'ten beri deftere yazar (ENTRY_CORRECTION + sapma satırı):
    // çocuklar topun ÖNCE silinir (RESTRICT), yoksa temizlik FK'ya çarpar ve kalıntı büyür.
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
