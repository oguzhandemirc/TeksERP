// =============================================================================
// Bekçi: ÇOKLU ETİKET — topa seçim yazımı + kesim/önizleme/öneri sözleşmesi (B2, 2026-11-11)
// Çalıştır: npx tsx scripts/test_label_template_choice.ts   (DB'li, _test DB)
// =============================================================================
//   §1 Zod: beş kesim/bitirme şeması `labelTemplateId`yi TAŞIR (strip tuzağı)
//   §2 kesim: teklif edilen şablon çocuğa yazılır (id + bağlam); tekil html/native/önizleme + toplu aynı şablon
//   §3 varsayılan seçilirse topa null yazılır (varsayılan sonradan değişince top uyar)
//   §4 teklif dışı id 400 LABEL_TEMPLATE_NOT_OFFERED (kesim + önizleme)
//   §5 MİRAS YOK: seçimli çocuğun kesiminden doğan torun null
//   §6 üç bitirme yolu (finalize · açık kumaş bitir · depo topu bitir) seçimi yazar
//   §7 PUT /template: teklif listesi · yazım + labelDirty + audit · aynı değer no-op · bayat 409 · sevkli 409 · default → null
//   §8 K3: seçim başka bağlamın (RAW) etiketine aitse FINISHED basımda uygulanmaz (tekil = toplu); bağlamsız eski kayıt uygulanır
//   §9 önizleme: templateId ile çizilen şablon değişir; templateOptions + defaultTemplateId döner
//   §10 öneri ucu `last.templateId` · §11 izin zinciri · §12 kaynak: label.service seçimi yalnız yüklemden okur
// Negatif sondalar (ölçüldü 2026-11-11, dosya dışı, md5 ile geri alındı):
//   (a) `pickBulkRollTemplate`te `appliedRollTemplateId(payload, kind)` → `payload.rollLabelTemplateId` → §8 toplu + §12 ❌
//   (b) `resolveTamburLabelTemplate`te teklif kontrolü kapatıldı → §4 ❌
//   (c) `resolveTamburLabelTemplate`te "varsayılansa null" kapatıldı → §3 ❌
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { LabelKind, RollStage, RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { LabelService } from "../src/services/label.service";
import { RollLabelEditService } from "../src/services/roll-label-edit.service";
import { LabelTemplateOptionService } from "../src/services/label-template-option.service";
import { getTamburLabelPreview } from "../src/services/tambur/label-preview";
import { getTamburLabelSuggestions } from "../src/services/tambur/label-suggestions";
import { cutOpenFabricSchema, cutWarehouseRollSchema, finalizeOpenFabricSchema, finalizeSchema, finalizeWarehouseCutSchema } from "../src/controllers/tambur.controller";
import labelRouter from "../src/routes/label.routes";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { findRouteLayer } from "./lib/router-katmani";

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

function routeAllows(p: string, method: string, permissions: string[]): boolean | null {
  const layer = findRouteLayer(labelRouter, p, method);
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = { user: { permissions }, params: {}, query: {}, body: {} } as unknown as Request;
  for (const link of chain.slice(1, -1)) {
    let err: unknown;
    let called = false;
    link.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called) return false;
    if (err) return (err as { statusCode?: number }).statusCode === 403 ? false : null;
  }
  return true;
}

const tambur = new TamburService();
const labels = new LabelService();
const edit = new RollLabelEditService();
const optSvc = new LabelTemplateOptionService();
const FIN = LabelKind.ROLL_FINISHED;
const ts = Date.now().toString().slice(-6);
const customerIds: string[] = [];
const parentIds: string[] = [];
const extraRollIds: string[] = [];
const woIds: string[] = [];
const batchIds: string[] = [];
const templateIds: string[] = [];
let seq = 0;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const actor = await testActorId();

  const cust = await prisma.customer.create({ data: { code: `TEST-LTC-${ts}`, name: `TEST Etiket Secim ${ts}` }, select: { id: true } });
  customerIds.push(cust.id);
  const mkTemplate = async (tag: string) => {
    const t = await prisma.labelTemplate.create({
      data: {
        name: `TEST-LTC-${tag}-${ts}`, kind: FIN, isActive: true, fields: [] as never,
        variants: {
          create: [{
            name: `V-${tag}`, widthMm: 100, heightMm: 50, isPrimary: true,
            elements: { v: 1, elements: [
              { id: "b", type: "code128", x: 3, y: 2, hMm: 9, human: true },
              { id: "m", type: "text", x: 3, y: 15, text: `MARK${tag}${ts}`, font: "md" },
              { id: "f", type: "field", x: 3, y: 20, bind: "itemName", font: "md" },
            ] } as never,
          }],
        },
      },
      select: { id: true },
    });
    templateIds.push(t.id);
    return t.id;
  };
  const tDef = await mkTemplate("DEF");
  const tA = await mkTemplate("AAA");
  const tB = await mkTemplate("BBB");
  const tOut = await mkTemplate("OUT");
  const mark = (tag: string) => `MARK${tag}${ts}`;
  // Müşteri seti: varsayılan DEF + A + B; global set bu müşteriye gösterilmez (ortamdan yalıtım).
  await optSvc.setCustomer(cust.id, { kind: FIN, templateIds: [tDef, tA, tB], defaultTemplateId: tDef, showGlobalTemplates: false }, actor);

  const warehouseRoll = async (status: RollStatus = RollStatus.WAREHOUSE) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-LTC-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status, stage: RollStage.FINISHED,
        currentQty: 100, initialQty: 100, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id,
        ownerCustomerId: cust.id, labelCustomerId: cust.id, lastLabelSnapshot: { customerId: cust.id },
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return r.id;
  };
  const openFabric = async () => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-LTC-WO-${seq++}-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
        width: 150, targetItemId: item.id, targetColorId: color.id,
        steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" as const }] },
      },
      include: { steps: true },
    });
    woIds.push(wo.id);
    const batch = await prisma.batch.create({ data: { batchNumber: `TST-LTC-P${seq++}-${ts}`, workOrderId: wo.id }, select: { id: true } });
    batchIds.push(batch.id);
    const r = await prisma.roll.create({
      data: {
        barcode: null, itemId: item.id, colorId: color.id, status: RollStatus.IN_PRODUCTION, currentQty: 100, initialQty: 100,
        width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, currentStepId: wo.steps[0]!.id,
        entrySource: "SUBCONTRACTOR_RETURN", ownerCustomerId: cust.id, batchId: batch.id,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return { rollId: r.id, workOrderId: wo.id };
  };
  const tplOf = (id: string) => prisma.roll.findUnique({ where: { id }, select: { labelTemplateId: true, labelTemplateKind: true, labelDirty: true, labelEditedAt: true } });

  console.log("\n[§1] Zod şemaları");
  const T = { labelTemplateId: tA };
  check("§1 cutWarehouseRollSchema taşır", cutWarehouseRollSchema.parse({ cutLength: 5, ...T }).labelTemplateId === tA);
  check("§1 cutOpenFabricSchema taşır", cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", ...T }).labelTemplateId === tA);
  check("§1 finalizeWarehouseCutSchema taşır", finalizeWarehouseCutSchema.parse({ remainingAction: "keep_1kalite", ...T }).labelTemplateId === tA);
  check("§1 finalizeOpenFabricSchema taşır", finalizeOpenFabricSchema.parse({ remainingAction: "keep_1kalite", ...T }).labelTemplateId === tA);
  check("§1 finalizeSchema taşır", finalizeSchema.parse({ rollId: "00000000-0000-4000-8000-000000000000", ...T }).labelTemplateId === tA);

  console.log("\n[§2] kesimde seçim → çocuk");
  const o1 = await openFabric();
  const c1 = (await tambur.cutOpenFabric(o1.rollId, { lengthMeters: 10, status: "WAREHOUSE", labelTemplateId: tA, confirmMismatch: true }, actor)).data!.childRoll.id;
  let v = await tplOf(c1);
  check("§2 açık kumaş kesimi: çocuk labelTemplateId = A, bağlam ROLL_FINISHED", v?.labelTemplateId === tA && v.labelTemplateKind === FIN, JSON.stringify(v));
  const pv = (await labels.getRollPreview(c1)).data!;
  check("§2 tekil önizleme A'yı çözer", pv.meta.templateId === tA, String(pv.meta.templateName));
  const nat = (await labels.getRollLabelNative(c1)).data!;
  check("§2 native A'yı çözer", nat.meta.templateId === tA);
  const html = (await labels.getRollLabelHtml(c1)).data!.html;
  check("§2 tekil HTML A'nın işaretini basar", html.includes(mark("AAA")) && !html.includes(mark("DEF")));
  const bulk = (await labels.getBulkRollLabelsHtml([c1])).data?.html ?? "";
  check("§2 toplu HTML aynı şablon (tekil = toplu)", bulk.includes(mark("AAA")) && !bulk.includes(mark("DEF")));
  const c0 = (await tambur.cutOpenFabric(o1.rollId, { lengthMeters: 10, status: "WAREHOUSE", confirmMismatch: true }, actor)).data!.childRoll.id;
  v = await tplOf(c0);
  check("§2 seçimsiz kesim bugünkü gibi: null + varsayılan basılır", v?.labelTemplateId === null && v.labelTemplateKind === null && (await labels.getRollPreview(c0)).data!.meta.templateId === tDef);

  console.log("\n[§3] varsayılan seçimi → null");
  const w1 = await warehouseRoll();
  const c3 = (await tambur.cutWarehouseRoll(w1, { cutLength: 10, labelTemplateId: tDef }, actor)).data!.childRoll.id;
  v = await tplOf(c3);
  check("§3 varsayılan seçilen kesimde topa null yazılır", v?.labelTemplateId === null && v.labelTemplateKind === null, JSON.stringify(v));

  console.log("\n[§4] teklif dışı");
  check("§4 kesimde teklif dışı şablon 400 LABEL_TEMPLATE_NOT_OFFERED",
    (await errCode(tambur.cutWarehouseRoll(w1, { cutLength: 5, labelTemplateId: tOut }, actor))) === "400:LABEL_TEMPLATE_NOT_OFFERED");
  const o9 = await openFabric();
  check("§4 önizlemede teklif dışı şablon 400 LABEL_TEMPLATE_NOT_OFFERED",
    (await errCode(getTamburLabelPreview({ rollId: o9.rollId, customerId: cust.id, templateId: tOut, draft: {} }))) === "400:LABEL_TEMPLATE_NOT_OFFERED");

  console.log("\n[§5] miras yok");
  const g1 = (await tambur.cutWarehouseRoll(c1, { cutLength: 3 }, actor)).data!.childRoll.id;
  extraRollIds.push(g1);
  v = await tplOf(g1);
  check("§5 seçimli çocuğun kesiminden doğan torun null", v?.labelTemplateId === null && v.labelTemplateKind === null, JSON.stringify(v));

  console.log("\n[§6] bitirme yolları");
  const f1 = await tambur.finalizeWarehouseCut(w1, { remainingAction: "keep_1kalite", labelTemplateId: tB }, actor);
  v = f1.data?.remainingChild ? await tplOf(f1.data.remainingChild.id) : null;
  check("§6 depo topu bitir: kalan B", v?.labelTemplateId === tB && v.labelTemplateKind === FIN, JSON.stringify(v));
  const f2 = await tambur.finalizeOpenFabric(o1.rollId, { remainingAction: "keep_1kalite", labelTemplateId: tB, confirmMismatch: true }, actor);
  v = f2.data?.remainingChildId ? await tplOf(f2.data.remainingChildId) : null;
  check("§6 açık kumaş bitir: kalan B", v?.labelTemplateId === tB && v.labelTemplateKind === FIN, JSON.stringify(v));
  const o2 = await openFabric();
  const f3 = await tambur.finalize({ rollId: o2.rollId, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [] }], labelTemplateId: tB, confirmMismatch: true }, actor);
  const kids = await Promise.all((f3.data?.splitRolls ?? []).map((r) => tplOf(r.id)));
  check("§6 finalize: her parça B", kids.length >= 1 && kids.every((k) => k?.labelTemplateId === tB && k.labelTemplateKind === FIN), JSON.stringify(kids));

  console.log("\n[§7] yeniden basım seçimi (PUT /template)");
  const r7 = await warehouseRoll();
  const opts7 = (await edit.getTemplateOptions(r7)).data!;
  const ids7 = opts7.options.map((o) => o.id);
  check("§7 teklif: DEF (varsayılan) + A + B, teklif dışı yok", opts7.defaultTemplateId === tDef && ids7[0] === tDef && ids7.includes(tA) && ids7.includes(tB) && !ids7.includes(tOut) && opts7.currentTemplateId === null, JSON.stringify(opts7.options.map((o) => o.source)));
  const s1 = await edit.setTemplate(r7, { templateId: tA }, actor);
  v = await tplOf(r7);
  check("§7 yazım: A + bağlam + labelDirty + changed", s1.data?.changed === true && v?.labelTemplateId === tA && v.labelTemplateKind === FIN && v.labelDirty === true && s1.data.currentTemplateId === tA);
  const a7 = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: r7, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  check("§7 audit event ROLL_LABEL_TEMPLATE", (a7?.newData as Record<string, unknown> | null)?.event === "ROLL_LABEL_TEMPLATE");
  const s2 = await edit.setTemplate(r7, { templateId: tA }, actor);
  check("§7 aynı değer no-op (changed=false)", s2.data?.changed === false);
  check("§7 bayat sürüm 409 LABEL_EDIT_STALE", (await errCode(edit.setTemplate(r7, { templateId: tB, expectedEditedAt: new Date(0).toISOString() }, actor))) === "409:LABEL_EDIT_STALE");
  check("§7 teklif dışı 400 LABEL_TEMPLATE_NOT_OFFERED", (await errCode(edit.setTemplate(r7, { templateId: tOut }, actor))) === "400:LABEL_TEMPLATE_NOT_OFFERED");
  await edit.setTemplate(r7, { templateId: tDef, expectedEditedAt: v?.labelEditedAt?.toISOString() ?? null }, actor);
  v = await tplOf(r7);
  check("§7 varsayılan seçilince null yazılır", v?.labelTemplateId === null && v.labelTemplateKind === null, JSON.stringify(v));
  const rShip = await warehouseRoll(RollStatus.SHIPPED);
  check("§7 sevkli top 409 ROLL_SHIPPED", (await errCode(edit.setTemplate(rShip, { templateId: tA }, actor))) === "409:ROLL_SHIPPED");

  console.log("\n[§8] K3 — bağlam değişince seçim uygulanmaz");
  const r8 = await warehouseRoll();
  await prisma.roll.update({ where: { id: r8 }, data: { labelTemplateId: tA, labelTemplateKind: LabelKind.ROLL_RAW } });
  const p8 = (await labels.getRollPreview(r8)).data!;
  check("§8 RAW seçimi FINISHED tekil basımda uygulanmaz → varsayılan", p8.meta.templateId === tDef, String(p8.meta.templateName));
  const b8 = (await labels.getBulkRollLabelsHtml([r8])).data?.html ?? "";
  check("§8 toplu yol da aynı (tekil = toplu)", b8.includes(mark("DEF")) && !b8.includes(mark("AAA")));
  check("§8 düzenleme formu ve teklif uygulanmayan seçimi göstermez",
    (await edit.getEditForm(r8)).data!.templateId === null && (await edit.getTemplateOptions(r8)).data!.currentTemplateId === null);
  await prisma.roll.update({ where: { id: r8 }, data: { labelTemplateKind: null } });
  const b8n = (await labels.getBulkRollLabelsHtml([r8])).data?.html ?? "";
  check("§8 bağlamsız eski kayıt her bağlamda uygulanır (tekil + toplu)", (await labels.getRollPreview(r8)).data!.meta.templateId === tA && b8n.includes(mark("AAA")));

  console.log("\n[§9] tambur önizlemesi");
  const pv0 = await getTamburLabelPreview({ rollId: o9.rollId, customerId: cust.id, draft: {} });
  const pvA = await getTamburLabelPreview({ rollId: o9.rollId, customerId: cust.id, templateId: tA, draft: {} });
  check("§9 seçimsiz önizleme varsayılanı çizer", pv0.templateId === tDef);
  check("§9 templateId ile çizilen şablon ve adı değişir", pvA.templateId === tA && pvA.templateName === `TEST-LTC-AAA-${ts}`);
  check("§9 templateOptions + defaultTemplateId döner", pvA.defaultTemplateId === tDef && pvA.templateOptions.map((o) => o.id).join() === [tDef, tA, tB].join() && pvA.templateOptions[0]!.isDefault);

  console.log("\n[§10] öneri ucu");
  const sug = await getTamburLabelSuggestions({ workOrderId: o2.workOrderId });
  check("§10 last.templateId = İE'nin son kesimindeki seçim", sug.last?.templateId === tB, JSON.stringify(sug.last));

  console.log("\n[§11] izin");
  check("§11 GET template-options zinciri okunabildi", routeAllows("/rolls/:id/template-options", "get", ["label:read"]) !== null);
  check("§11 GET: label:read ve mobile:tambur geçer, order:read 403",
    routeAllows("/rolls/:id/template-options", "get", ["label:read"]) === true && routeAllows("/rolls/:id/template-options", "get", ["mobile:tambur"]) === true
    && routeAllows("/rolls/:id/template-options", "get", ["order:read"]) === false);
  check("§11 PUT: label:edit / roll:write / mobile:kk1 geçer, label:print 403",
    routeAllows("/rolls/:id/template", "put", ["label:edit"]) === true && routeAllows("/rolls/:id/template", "put", ["roll:write"]) === true
    && routeAllows("/rolls/:id/template", "put", ["mobile:kk1"]) === true && routeAllows("/rolls/:id/template", "put", ["label:print"]) === false);

  console.log("\n[§12] kaynak taraması");
  const src = fs.readFileSync(path.resolve(__dirname, "../src/services/label.service.ts"), "utf8");
  const reads = [...src.matchAll(/payload\.rollLabelTemplateId(?!\s*=[^=])/g)].length;
  const via = [...src.matchAll(/appliedRollTemplateId\(payload, kind\)/g)].length;
  check("§12 label.service topun seçimini ham okumaz (yalnız yüklemden)", reads === 0, `${reads} ham okuma`);
  check("§12 körlük zemini: yüklem tekil + toplu + basım izinde (≥3)", via >= 3, `${via}`);
}

async function cleanup(): Promise<void> {
  const all = { in: [...parentIds, ...extraRollIds] };
  await prisma.rollVariance.deleteMany({ where: { roll: { parentRollId: all } } }).catch(() => undefined);
  await prisma.rollVariance.deleteMany({ where: { rollId: all } }).catch(() => undefined);
  await prisma.rollOperation.deleteMany({ where: { roll: { parentRollId: all } } }).catch(() => undefined);
  await prisma.rollMovement.deleteMany({ where: { roll: { parentRollId: all } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { parentRollId: { in: extraRollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: extraRollIds } } });
  await prisma.roll.deleteMany({ where: { parentRollId: { in: parentIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { id: { in: parentIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.customerLabelTemplateOption.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customerTemplateRoute.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: templateIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await cleanupTestCustomers(customerIds);
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
