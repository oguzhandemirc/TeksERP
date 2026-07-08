// =============================================================================
// P2 inventory bucket testi — F114 (relabel/supervisor kapsam ayrımı) + F116
// (explicit colorId processingStatus'u EZMEZ).  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_inventory.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import type { Request } from "express";
import { InventoryService } from "../src/services/inventory.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";

const inv = new InventoryService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expect400(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return e instanceof AppError && e.statusCode === 400; }
}
function fakeReq(query: Record<string, string>): Request {
  return { query, params: {}, headers: {} } as unknown as Request;
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const grade = await prisma.qualityGrade.findFirst({ select: { id: true, code: true } });
  const admin = await prisma.user.findFirst({ select: { id: true } });
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true } });
  if (!item || !grade || !admin || colors.length < 2) throw new Error("fixture eksik (item/grade/user/2renk)");
  const [colorA, colorB] = colors;
  const tag = `TESTINV-${Date.now()}`;
  const rollIds: string[] = [];

  const mkRoll = async (status: RollStatus, colorId: string | null): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${tag}-${rollIds.length}`,
        itemId: item.id, colorId, initialQty: 100, currentQty: 100,
        status, qualityGrade: grade.code, qualityGradeId: grade.id,
        entrySource: "SUPPLIER_RECEIPT", createdById: admin.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  try {
    // --- F114: relabel (reason YOK) IN_PRODUCTION'ı bloklar (strict stok) ---
    const rInProd = await mkRoll(RollStatus.IN_PRODUCTION, colorA.id);
    const relabelBlocked = await expect400(() =>
      inv.applyManualProperties(rInProd, { colorId: colorB.id, propertyIds: [] }, admin.id)); // reason YOK
    check("F114: relabel (reason'sız) IN_PRODUCTION topu bloklar", relabelBlocked);

    // --- F114: supervisor (reason VAR) IN_PRODUCTION'ı KABUL eder (açık kumaş) ---
    let supOk = false;
    try {
      await inv.applyManualProperties(rInProd, { colorId: colorB.id, propertyIds: [], reason: "süpervizör düzeltme" }, admin.id);
      supOk = true;
    } catch { supOk = false; }
    check("F114: supervisor (reason'lı) IN_PRODUCTION'ı düzeltebilir", supOk);

    // --- F114: supervisor bile AT_SUBCONTRACTOR (fasonda) topu bloklar ---
    const rFason = await mkRoll(RollStatus.AT_SUBCONTRACTOR, colorA.id);
    const fasonBlocked = await expect400(() =>
      inv.applyManualProperties(rFason, { colorId: colorB.id, propertyIds: [], reason: "dene" }, admin.id));
    check("F114: supervisor fasondaki (AT_SUBCONTRACTOR) topu bloklar", fasonBlocked);

    // --- F114: relabel WAREHOUSE (serbest stok) KABUL eder ---
    const rWh = await mkRoll(RollStatus.WAREHOUSE, colorA.id);
    let whOk = false;
    try { await inv.applyManualProperties(rWh, { colorId: colorB.id, propertyIds: [] }, admin.id); whOk = true; }
    catch { whOk = false; }
    check("F114: relabel WAREHOUSE topu düzeltebilir", whOk);

    // --- F116: processingStatus=processed + colorId=A → yalnız A renkli işlenmiş ---
    // colorA IN_PRODUCTION (işlenmiş=renk kazanmış aktif) + colorB IN_PRODUCTION.
    const rProcA = await mkRoll(RollStatus.IN_PRODUCTION, colorA.id);
    const rProcB = await mkRoll(RollStatus.IN_PRODUCTION, colorB.id);
    const res = await inv.findAllRolls(fakeReq({
      "filter[processingStatus]": "processed",
      "filter[colorId]": colorA.id,
      pageSize: "100",
    }));
    const rows = (res.data as Array<{ id: string; colorId: string | null }>);
    const returnedIds = new Set(rows.map((r) => r.id));
    check("F116: processed+colorA → colorA işlenmiş top döner", returnedIds.has(rProcA),
      `dönen=${rows.length}`);
    check("F116: processed+colorA → colorB topu SIZMAZ (renk ezilmedi)", !returnedIds.has(rProcB));
    check("F116: dönen tüm satırlar colorA", rows.every((r) => r.colorId === colorA.id));
  } finally {
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
