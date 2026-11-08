// =============================================================================
// BEKÇİ — İŞ EMRİ "ANA HAMMADDEYİ KİM VERDİ" ALANI (fason F7b, 2026-11-08)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_is_emri_malzeme_veren
// =============================================================================
// `WorkOrder.materialProvidedBy` (CUSTOMER | US | MIXED, NULL = bilinmiyor) BU FABRİKANIN bakışıdır.
//   §1 create: alan yazılır ve okunur; gönderilmezse NULL (eski istemci = bugünkü)
//   §2 PUT (replace) alanı GÖNDERMEZSE değer KORUNUR (eski panel/tablet silmez); null açıkça temizler
//   §3 PUT değiştirir → hareket defterine FIELD_CHANGED satırı (okunur etiketle) + audit
//   §4 PATCH (update) değiştirir → defter satırı; gönderilmeyen PATCH alanı dokunmaz
//   §5 gövde sözleşmesi: create · PATCH · PUT Zod şemalarının üçü de alanı TANIR (istemci gövdesi sessiz
//      allowlist; tanımayan şema alanı siler) ve aynı enum şemasını kullanır
//   §6 Zod enum şeması geçersiz değeri reddeder, üç değeri + null'ı kabul eder
//   §7 parti ayırma (NEW_COLOR → yeni İE, `cloneWorkOrderTx`) alanı kaynaktan KOPYALAR (inceleme ORTA-1)
//   §8 quickStart (top okutarak açılan İE) alanı yazar
//   §9 Fason (müşteri malı) türüne US yazılınca `warnings`te Türkçe uyarı — ENGEL DEĞİL; diğer değer/türde uyarı yok
// NEGATİF SONDALAR (2026-11-08): replace yazımı `data.materialProvidedBy ?? null` yapılınca §2 ❌ ·
// update yazımından alan silinince §4 ❌ · PUT şemasından alan silinince §5 ❌ ·
// izlenen alan kümesinden (`WORK_ORDER_TRACKED_FIELDS`) çıkarılınca §3/§4 defter ❌ ·
// klon yazımından `materialProvidedBy: src.materialProvidedBy` silinince §7 ❌ · uyarı helper'ı hep null dönünce §9 ❌.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import prisma, { pool } from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { WorkOrderService } from "../src/services/workorder.service";
import { roleGrade } from "./fixture-quality-grade";
import { MATERIAL_PROVIDERS } from "../src/constants/material-provider";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const TAG = `TST-WOMAT-${Date.now()}`;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_FASON = "", ST_TAMBUR = "", CAT_BOYA = "", COLOR = "", COLOR2 = "";
const woIds: string[] = [];
const rollBarcodes: string[] = [];
const customerIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_FASON = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  CAT_BOYA = need(await prisma.subcontractorCategory.findFirst({ where: { code: "BOYA" }, select: { id: true } }), "kategori BOYA").id;
  COLOR = need(await prisma.color.findFirst({ where: { code: "MAVI" }, select: { id: true } }), "renk MAVI").id;
  COLOR2 = need(await prisma.color.findFirst({ where: { code: { not: "MAVI" }, isActive: true }, orderBy: { code: "asc" }, select: { id: true } }), "ikinci renk").id;
}

async function yeniTop(gradeId: string, gradeCode: string): Promise<string> {
  const barcode = `${TAG}-R${rollBarcodes.length + 1}`;
  await prisma.roll.create({ data: { barcode, itemId: ITEM, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: gradeCode, qualityGradeId: gradeId, width: 180, createdById: ADMIN } });
  rollBarcodes.push(barcode);
  return barcode;
}

const STEPS = () => [{ stationId: ST_FASON }, { stationId: ST_TAMBUR }];
type CreateInput = Parameters<typeof svc.create>[0];
type ReplaceInput = Parameters<typeof svc.replace>[1];

async function yeniWo(extra: Partial<CreateInput> = {}): Promise<string> {
  const res = await svc.create({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS(), ...extra }, ADMIN);
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

const deger = async (id: string) =>
  (await prisma.workOrder.findUniqueOrThrow({ where: { id }, select: { materialProvidedBy: true } })).materialProvidedBy;

/** PUT gövdesi — eski istemci gibi alanı HİÇ taşımaz. */
async function eskiGovde(id: string): Promise<ReplaceInput> {
  const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id }, select: { plannedStartDate: true, plannedEndDate: true } });
  return {
    type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS(),
    plannedStartDate: wo.plannedStartDate?.toISOString(), plannedEndDate: wo.plannedEndDate?.toISOString(),
  } as ReplaceInput;
}

const defterSatiri = (id: string) =>
  prisma.workOrderEvent.findMany({
    where: { workOrderId: id, type: "FIELD_CHANGED", field: "materialProvidedBy" },
    orderBy: { createdAt: "asc" },
    select: { fromValue: true, toValue: true, fromLabel: true, toLabel: true, trigger: true },
  });

async function main(): Promise<void> {
  console.log("=== İş emri: ana hammaddeyi kim verdi (fason F7b) ===");
  await fikstur();
  try {
    // §1
    const a = await yeniWo({ materialProvidedBy: "CUSTOMER" });
    const det = await svc.findById(a);
    check("§1 create yazar; detay ucu döner", (await deger(a)) === "CUSTOMER" && (det.data as { materialProvidedBy?: string } | null)?.materialProvidedBy === "CUSTOMER",
      JSON.stringify((det.data as { materialProvidedBy?: string } | null)?.materialProvidedBy));
    const b = await yeniWo();
    check("§1 create alan yok ⇒ NULL (eski istemci = bugünkü)", (await deger(b)) === null);

    // §2
    await svc.replace(a, await eskiGovde(a), ADMIN);
    check("§2 PUT alanı göndermez ⇒ değer KORUNUR (CUSTOMER)", (await deger(a)) === "CUSTOMER", String(await deger(a)));
    check("§2 değişmeyen alan deftere satır YAZMAZ", (await defterSatiri(a)).length === 0);

    // §3
    await svc.replace(a, { ...(await eskiGovde(a)), materialProvidedBy: "US" }, ADMIN);
    const d3 = await defterSatiri(a);
    check("§3 PUT değiştirir (CUSTOMER → US)", (await deger(a)) === "US");
    check("§3 defter satırı: değer + okunur etiket", d3.length === 1 && d3[0].fromValue === "CUSTOMER" && d3[0].toValue === "US"
      && d3[0].fromLabel === "Müşteri verdi" && d3[0].toLabel === "Bu fabrika verdi", JSON.stringify(d3));
    const audit = await prisma.systemLog.findFirst({ where: { recordId: a, tableName: "WORK_ORDER", action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
    check("§3 audit yükü alanı taşır", JSON.stringify(audit?.newData ?? {}).includes('"materialProvidedBy":"US"'), JSON.stringify(audit?.newData));
    await svc.replace(a, { ...(await eskiGovde(a)), materialProvidedBy: null }, ADMIN);
    check("§2 PUT null ⇒ açıkça temizler", (await deger(a)) === null);

    // §4
    await svc.update(b, { materialProvidedBy: "MIXED" }, ADMIN);
    const d4 = await defterSatiri(b);
    check("§4 PATCH değiştirir (NULL → MIXED) + defter satırı", (await deger(b)) === "MIXED" && d4.length === 1 && d4[0].toLabel === "Karışık (müşteri + bu fabrika)" && d4[0].fromValue === null,
      JSON.stringify(d4));
    await svc.update(b, { targetQuantity: 500 }, ADMIN);
    check("§4 alanı taşımayan PATCH dokunmaz", (await deger(b)) === "MIXED");

    // §5
    const ctrl = fs.readFileSync(path.join(__dirname, "../src/controllers/workorder.controller.ts"), "utf8");
    const govdeOf = (bas: string): string => {
      const i = ctrl.indexOf(bas);
      if (i < 0) return "";
      // Şemanın kapanışı: düz `});` ya da refine'li `}).refine(`; çekirdek şekil `};`.
      const ends = bas.endsWith("z.object({") ? ["\n});", "\n}).refine("] : ["\n};"];
      const js = ends.map((e) => ctrl.indexOf(e, i)).filter((x) => x >= 0);
      const j = js.length > 0 ? Math.min(...js) : -1;
      return j < 0 ? "" : ctrl.slice(i, j);
    };
    const sekiller: Array<[string, string]> = [
      ["create/quick-start ortak şekli", govdeOf("const workOrderCoreShape = {")],
      ["PATCH şeması", govdeOf("const updateWorkOrderSchema = z.object({")],
      ["PUT şeması", govdeOf("const replaceWorkOrderSchema = z.object({")],
    ];
    for (const [ad, govde] of sekiller) {
      check(`§5 ${ad} alanı tanır (aynı enum şeması)`, govde.length > 0 && /\n\s+materialProvidedBy:\s*materialProvidedBySchema,/.test(govde), govde.length === 0 ? "şekil bulunamadı (ÖLÇÜLEMEDİ)" : "alan yok");
    }

    // §6
    const sema = z.enum(MATERIAL_PROVIDERS).nullable().optional();
    check("§6 geçersiz değer reddedilir ('SUPPLIER', 'us')", !sema.safeParse("SUPPLIER").success && !sema.safeParse("us").success);
    check("§6 üç değer + null + yok kabul", ["CUSTOMER", "US", "MIXED", null, undefined].every((v) => sema.safeParse(v).success));
    check("§6 kontrolcü şeması aynı listeden kurulur", /z\.enum\(MATERIAL_PROVIDERS\b/.test(ctrl));

    // §7 — parti ayırma: boyanıp Tambur'a gelmiş partinin yarısı farklı renge yeni İE'ye.
    const g = await roleGrade("FIRST");
    const src = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${TAG}-SPL`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 180, targetQuantity: 1000,
        targetItemId: ITEM, targetColorId: COLOR, materialProvidedBy: "US",
        steps: { create: [{ stationId: ST_FASON, stepSequence: 1, status: "PENDING", requiredCategoryId: CAT_BOYA }, { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" }] },
      },
      include: { steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
    });
    woIds.push(src.id);
    await prisma.travelerCard.create({ data: { cardNumber: src.workOrderNumber, barcode: src.workOrderNumber, workOrderId: src.id, version: 1, status: "ACTIVE" } });
    const bcs = [await yeniTop(g.id, g.code), await yeniTop(g.id, g.code), await yeniTop(g.id, g.code), await yeniTop(g.id, g.code)];
    const batchId = (await svc.attachRolls(src.id, bcs, ADMIN)).data!.batch!.id;
    await prisma.roll.updateMany({ where: { batchId }, data: { currentStepId: src.steps[1].id, colorId: COLOR, status: RollStatus.IN_PRODUCTION } });
    const half = (await prisma.roll.findMany({ where: { batchId }, orderBy: { barcode: "asc" }, select: { id: true } })).slice(0, 2).map((r) => r.id);
    const split = (await svc.splitBranch(src.id, { batchId, mode: "NEW_COLOR", newColorId: COLOR2, rollIds: half, reason: "TEST F7b" }, ADMIN)).data as { newWorkOrderId: string };
    woIds.push(split.newWorkOrderId);
    check("§7 parti ayırmanın yeni İE'si kaynağın değerini taşır (US)", (await deger(split.newWorkOrderId)) === "US", String(await deger(split.newWorkOrderId)));

    // §8 — quickStart (top okutarak).
    const qs = await svc.quickStart({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS(), rollBarcodes: [await yeniTop(g.id, g.code)], materialProvidedBy: "CUSTOMER" } as never, ADMIN);
    const qsWo = (qs.data as { workOrder: { id: string } }).workOrder.id;
    woIds.push(qsWo);
    check("§8 quickStart alanı yazar (CUSTOMER)", (await deger(qsWo)) === "CUSTOMER", String(await deger(qsWo)));

    // §9 — Fason (müşteri malı) + US ⇒ uyarı, engel yok.
    const cust = await prisma.customer.create({ data: { code: `TWM${Date.now().toString().slice(-8)}`, name: `TEST-WOMAT ${TAG}`, isCustomerRole: true }, select: { id: true } });
    customerIds.push(cust.id);
    const uyariVar = (w: unknown) => Array.isArray(w) && w.some((x) => typeof x === "string" && x.includes("Bu fabrika verdi"));
    const cg = await svc.create({ type: "CUSTOMER_GOODS_SERVICE", targetItemId: ITEM, width: 180, steps: STEPS(), customerId: cust.id, materialProvidedBy: "US" }, ADMIN);
    const cgId = (cg.data as { id: string }).id;
    woIds.push(cgId);
    check("§9 create Fason + US ⇒ yazılır + uyarı", (await deger(cgId)) === "US" && uyariVar(cg.warnings), JSON.stringify(cg.warnings));
    const cgPatch = await svc.update(cgId, { materialProvidedBy: "US" }, ADMIN);
    check("§9 PATCH Fason + US ⇒ uyarı", uyariVar(cgPatch.warnings), JSON.stringify(cgPatch.warnings));
    const cgPut = await svc.replace(cgId, { type: "CUSTOMER_GOODS_SERVICE", targetItemId: ITEM, width: 180, steps: STEPS(), customerId: cust.id, materialProvidedBy: "US" } as ReplaceInput, ADMIN);
    check("§9 PUT Fason + US ⇒ uyarı", uyariVar(cgPut.warnings), JSON.stringify(cgPut.warnings));
    const cgCust = await svc.update(cgId, { materialProvidedBy: "CUSTOMER" }, ADMIN);
    const stUs = await svc.create({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS(), materialProvidedBy: "US" }, ADMIN);
    woIds.push((stUs.data as { id: string }).id);
    check("§9 Fason + CUSTOMER ve Stok + US ⇒ uyarı YOK", !uyariVar(cgCust.warnings) && !uyariVar(stUs.warnings), JSON.stringify([cgCust.warnings, stUs.warnings]));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  // Ayırma klonları kaynağa splitFromId ile bağlı; toplar/partiler/hareketler İE'lerden önce.
  const batchIds = (await prisma.batch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((b) => b.id);
  const rollIds = (await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { in: rollBarcodes } }] }, select: { id: true } })).map((r) => r.id);
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds }, splitFromId: { not: null } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...batchIds] } } });
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((c) => c.id);
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...stepIds] } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds }, splitFromId: { not: null } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = 1;
});
