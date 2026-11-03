// =============================================================================
// Bekçi: iş emri ETİKET BİLGİSİ + müşteri EN KAYNAĞI (Gülkesim S5, cevap 4/7)
// Çalıştır: npx tsx scripts/test_etiket_ie_bilgisi.ts   (DB'li, _test DB)
// =============================================================================
//   §1 PUT: eksik alan ekle / değiştir / "" boş bas / null kaldır; GET aynı haritayı döner
//   §2 izinsiz anahtar 400 LABEL_OVERRIDE_KEY_UNKNOWN · bozuk en 400 · bayat updatedAt 409
//   §3 audit: WORK_ORDER satırı, before/after
//   §4 getRollLabel: aynı işin topu (tekil yol) etiket bilgisini taşır; boş basılan alan boş
//   §5 en kaynağı: müşteri ayarı yok → güncel en (bugünkü) · INCOMING → ölçüm öncesi en
//      (ata topun izinden) · MEASURED → güncel en
// Negatif sonda (ölçüldü 2026-11-03): getRollLabel'daki applyLabelOverrides satırı
// kapatılınca §4 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { RollOperationType, RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelOverrideService } from "../src/services/label-override.service";
import { LabelService } from "../src/services/label.service";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const svc = new LabelOverrideService();
const labels = new LabelService();
const ts = Date.now().toString().slice(-6);
const ids = { wo: "", customer: "", parent: "", child: "", batch: "" };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const actor = { id: await testActorId() };

  const customer = await prisma.customer.create({ data: { code: `TEST-S5E-${ts}`, name: `TEST S5 En ${ts}` }, select: { id: true } });
  ids.customer = customer.id;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-S5E-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
      width: 150, targetItemId: item.id,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" as const }] },
    },
    include: { steps: true },
  });
  ids.wo = wo.id;
  const batch = await prisma.batch.create({ data: { batchNumber: `TST-S5E-P${ts}`, workOrderId: wo.id }, select: { id: true } });
  ids.batch = batch.id;
  const base = {
    itemId: item.id, colorId: color.id, qualityGrade: grade.code, qualityGradeId: grade.id,
    batchId: batch.id, ownerCustomerId: customer.id,
  };
  const parent = await prisma.roll.create({
    data: { ...base, barcode: `TST-S5E-A${ts}`, status: RollStatus.WAREHOUSE, currentQty: 50, initialQty: 100, width: 148 },
    select: { id: true },
  });
  ids.parent = parent.id;
  // Ata topta en izi: önce 152, sonra 148 → gelen en 152.
  await prisma.rollOperation.create({
    data: {
      rollId: parent.id, workOrderStepId: wo.steps[0]!.id, operationType: RollOperationType.QC2_COMPLETED,
      metadata: { widthBefore: 152, widthAfter: 148 },
    },
  });
  const child = await prisma.roll.create({
    data: { ...base, barcode: `TST-S5E-B${ts}`, status: RollStatus.WAREHOUSE, currentQty: 50, initialQty: 50, width: 148, parentRollId: parent.id },
    select: { id: true },
  });
  ids.child = child.id;

  console.log("\n[§1] PUT/GET");
  const g0 = (await svc.get(wo.id)).data!;
  check("§1 başta boş harita + anahtar listesi", Object.keys(g0.overrides).length === 0 && g0.keys.some((k) => k.key === "deliveryNoteItemText"));
  const u1 = (await svc.update(wo.id, { overrides: { deliveryNoteItemText: "DESEN 77", colorName: "", widthCm: "150,5" }, updatedAt: g0.updatedAt }, actor?.id)).data!;
  check("§1 eklendi + boş bas + en", u1.overrides.deliveryNoteItemText === "DESEN 77" && u1.overrides.colorName === "" && u1.overrides.widthCm === "150,5");
  const u2 = (await svc.update(wo.id, { overrides: { widthCm: null, deliveryNoteItemText: "DESEN 78" } }, actor?.id)).data!;
  check("§1 null kaldırır, değiştirme yazar", !("widthCm" in u2.overrides) && u2.overrides.deliveryNoteItemText === "DESEN 78" && u2.overrides.colorName === "");

  console.log("\n[§2] fail-closed");
  check("§2 izinsiz anahtar 400", (await errCode(svc.update(wo.id, { overrides: { barcode: "X" } }))) === "400:LABEL_OVERRIDE_KEY_UNKNOWN");
  check("§2 bozuk en 400", (await errCode(svc.update(wo.id, { overrides: { widthCm: "abc" } }))) === "400:LABEL_OVERRIDE_INVALID");
  check("§2 uzun metin 400", (await errCode(svc.update(wo.id, { overrides: { itemName: "x".repeat(121) } }))) === "400:LABEL_OVERRIDE_INVALID");
  check("§2 bayat updatedAt 409", (await errCode(svc.update(wo.id, { overrides: { itemName: "Y" }, updatedAt: g0.updatedAt }))) === "409:LABEL_OVERRIDE_STALE");
  check("§2 yok iş emri 404", (await errCode(svc.get(randomUUID()))).startsWith("404"));

  console.log("\n[§3] audit");
  const logs = await prisma.systemLog.findMany({ where: { tableName: "WORK_ORDER", recordId: wo.id }, select: { newData: true } });
  check("§3 iki başarılı yazım → iki audit satırı", logs.length === 2, String(logs.length));
  check("§3 audit olayı WORK_ORDER_LABEL_OVERRIDE", logs.every((l) => (l.newData as Record<string, unknown>)?.event === "WORK_ORDER_LABEL_OVERRIDE"));

  console.log("\n[§4] etikete uygulanır");
  const p1 = (await labels.getRollLabel(child.id)).data!;
  check("§4 desen etiket bilgisinden", p1.deliveryNoteItemText === "DESEN 78", String(p1.deliveryNoteItemText));
  check("§4 renk adı boş basılır", p1.colorName === "", JSON.stringify(p1.colorName));

  console.log("\n[§5] en kaynağı");
  check("§5 ayar yok → güncel en 148 (bugünkü)", p1.widthCm === 148, String(p1.widthCm));
  await prisma.customer.update({ where: { id: customer.id }, data: { labelWidthSource: "INCOMING" } });
  const p2 = (await labels.getRollLabel(child.id)).data!;
  check("§5 INCOMING → atanın ölçüm öncesi eni 152", p2.widthCm === 152, String(p2.widthCm));
  await prisma.customer.update({ where: { id: customer.id }, data: { labelWidthSource: "MEASURED" } });
  const p3 = (await labels.getRollLabel(child.id)).data!;
  check("§5 MEASURED → güncel en 148", p3.widthCm === 148, String(p3.widthCm));
  await svc.update(wo.id, { overrides: { widthCm: "160" } }, actor?.id);
  const p4 = (await labels.getRollLabel(child.id)).data!;
  check("§5 İE etiket bilgisindeki en müşteri ayarını ezer (160)", p4.widthCm === 160, String(p4.widthCm));
}

async function cleanup(): Promise<void> {
  const rollIds = [ids.child, ids.parent].filter(Boolean);
  if (rollIds.length) {
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: ids.child || undefined } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  }
  if (ids.batch) await prisma.batch.deleteMany({ where: { id: ids.batch } });
  if (ids.wo) {
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: ids.wo } });
    await prisma.workOrder.deleteMany({ where: { id: ids.wo } });
  }
  if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
