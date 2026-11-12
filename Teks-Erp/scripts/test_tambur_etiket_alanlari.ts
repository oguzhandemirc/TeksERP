// =============================================================================
// Bekçi: tambur etiket alanları — alıcı alanı, alıcı şablonu halkası, önizleme alanları (2026-11-10)
// Çalıştır: npx tsx scripts/test_tambur_etiket_alanlari.ts   (DB'li, _test DB)
// =============================================================================
//   §1 `consigneeName` alanı: katalogda OPT-IN (ROLL_RAW + ROLL_FINISHED) · alıcılı topta payload'da + basılır ·
//      alıcısız topta payload'da yok, `present:false`
//   §2 şablon sırası (K4): elle seçim > ALICI şablonu > müşteri route > cihaz/bağlam — tekil `resolveLabelRouting`
//      ve toplu bağlam (`buildBulkContext` + `buildRollRenderInput`) AYNI sonucu verir; pasif alıcı şablonu atlanır
//   §3 `GET /tambur/label-preview-fields` servisi: sahibin müşteri route'u (kanvas → bağlı alanlar, barkod/QR/tarih
//      atılır) · Kime? verilse de emanet topta sahip · alıcı şablonu önce · akış şablonunda görünür alanlar · yok top 404
//   §4 tambur roll özeti `ownerCustomerName` taşır
// Negatif sonda (2026-11-10): önizleme servisinde `customerId` sahip yerine null verilince §3 müşteri route'u ❌;
// toplu yoldan alıcı halkası çıkarılınca §2 "toplu = tekil" ❌.
// =============================================================================
import { LabelKind, RollStage, RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { FIELD_CATALOG } from "../src/config/label-fields";
import { LabelService } from "../src/services/label.service";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { resolveLabelRouting } from "../src/services/helpers/label-routing.resolver";
import { getTamburLabelPreviewFields } from "../src/services/tambur/label-preview-fields";
import { loadTamburRolls } from "../src/services/tambur/read";
import { TamburService } from "../src/services/tambur.service";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

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

type RenderOut = { input: { template: { id: string } | null } };
type LabelPrivate = {
  buildRollRenderInput(rollId: string, kind: LabelKind | undefined, opts?: unknown, preloaded?: unknown): Promise<RenderOut>;
  buildBulkContext(ids: string[], copies: number): Promise<unknown>;
};

const ts = Date.now().toString().slice(-6);
const customerIds: string[] = [];
const rollIds: string[] = [];
const templateIds: string[] = [];
const woIds: string[] = [];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const labels = new LabelService();
  const priv = labels as unknown as LabelPrivate;

  const mkCustomer = async (tag: string) => {
    const c = await prisma.customer.create({ data: { code: `TEST-TEA-${tag}-${ts}`, name: `TEST Etiket Alan ${tag} ${ts}` }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const owner = await mkCustomer("O");
  const mkTemplate = async (tag: string, opts: { canvas?: unknown; fields?: unknown; isActive?: boolean } = {}) => {
    const t = await prisma.labelTemplate.create({
      data: {
        name: `TEST-TEA-${tag}-${ts}`, kind: LabelKind.ROLL_FINISHED, isActive: opts.isActive ?? true,
        fields: (opts.fields ?? []) as never,
        ...(opts.canvas ? { variants: { create: [{ name: `V-${tag}`, widthMm: 100, heightMm: 50, elements: opts.canvas as never, isPrimary: true }] } } : {}),
      },
      select: { id: true },
    });
    templateIds.push(t.id);
    return t.id;
  };
  const canvas = (binds: string[]) => ({
    v: 1,
    elements: [
      { id: "b", type: "barcode", x: 2, y: 2, wMm: 40, hMm: 10 },
      ...binds.map((bind, i) => ({ id: `f${i}`, type: "field", x: 3, y: 15 + i * 4, bind, label: bind === "weightKg" ? "KG" : undefined, font: "md" })),
    ],
  });
  const tCust = await mkTemplate("CUST", { canvas: canvas(["itemName", "weightKg", "printedAt"]) });
  const tCons = await mkTemplate("CONS", { canvas: canvas(["consigneeName", "widthCm"]) });
  const tFlow = await mkTemplate("FLOW", { fields: [
    { key: "barcode", label: "Barkod", order: 1, isVisible: true },
    { key: "colorName", label: "Renk", order: 2, isVisible: true },
    { key: "weightKg", label: "Kg", order: 3, isVisible: false },
  ] });
  const tOff = await mkTemplate("OFF", { canvas: canvas(["itemName"]), isActive: false });
  await prisma.customerTemplateRoute.create({ data: { customerId: owner, kind: LabelKind.ROLL_FINISHED, templateId: tCust } });
  const consA = await prisma.customerConsignee.create({ data: { customerId: owner, name: `TEST Alıcı A ${ts}`, labelTemplateId: tCons }, select: { id: true } });
  const consOff = await prisma.customerConsignee.create({ data: { customerId: owner, name: `TEST Alıcı Pasif Şablon ${ts}`, labelTemplateId: tOff }, select: { id: true } });
  const consNone = await prisma.customerConsignee.create({ data: { customerId: owner, name: `TEST Alıcı Şablonsuz ${ts}` }, select: { id: true } });

  const mkRoll = async (labelConsigneeId: string | null) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-TEA-${rollIds.length}-${ts}`, itemId: item.id, colorId: color.id, status: RollStatus.WAREHOUSE, stage: RollStage.FINISHED,
        currentQty: 50, initialQty: 50, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id,
        ownerCustomerId: owner, labelCustomerId: owner, lastLabelSnapshot: { customerId: owner }, labelConsigneeId,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  const rA = await mkRoll(consA.id);
  const rOff = await mkRoll(consOff.id);
  const rNone = await mkRoll(consNone.id);
  const rBare = await mkRoll(null);

  console.log("\n[§1] consigneeName alanı");
  const optIn = (["ROLL_RAW", "ROLL_FINISHED"] as const).every((k) => FIELD_CATALOG[k].some((f) => f.key === "consigneeName" && f.defaultVisible === false));
  check("§1 katalogda OPT-IN (ROLL_RAW + ROLL_FINISHED)", optIn);
  const pA = (await labels.getRollLabel(rA, {})).data;
  check("§1 alıcılı top: payload consigneeName + basılır", pA.consigneeName === `TEST Alıcı A ${ts}` && fieldDisplayValue(pA, "consigneeName").present);
  const pBare = (await labels.getRollLabel(rBare, {})).data;
  check("§1 alıcısız top: alan yok, present:false", !("consigneeName" in pBare) && !fieldDisplayValue(pBare, "consigneeName").present);

  console.log("\n[§2] şablon sırası — tekil ve toplu");
  const single = async (consigneeId: string | null, templateId?: string) =>
    (await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, customerId: owner, consigneeId, templateId })).template?.id ?? null;
  check("§2 tekil: alıcı şablonu müşteri route'unu geçer", (await single(consA.id)) === tCons);
  check("§2 tekil: alıcısız → müşteri route", (await single(null)) === tCust);
  check("§2 tekil: şablonsuz alıcı → müşteri route", (await single(consNone.id)) === tCust);
  check("§2 tekil: pasif alıcı şablonu atlanır → müşteri route", (await single(consOff.id)) === tCust);
  check("§2 tekil: elle seçim alıcı şablonunu geçer", (await single(consA.id, tFlow)) === tFlow);
  const ids = [rA, rOff, rNone, rBare];
  const ctx = await priv.buildBulkContext(ids, 1);
  const bulk: Record<string, string | null> = {};
  const one: Record<string, string | null> = {};
  for (const id of ids) {
    bulk[id] = (await priv.buildRollRenderInput(id, LabelKind.ROLL_FINISHED, undefined, ctx)).input.template?.id ?? null;
    one[id] = (await priv.buildRollRenderInput(id, LabelKind.ROLL_FINISHED, {})).input.template?.id ?? null;
  }
  check("§2 render tekil: alıcılı top alıcı şablonuyla", one[rA] === tCons, String(one[rA]));
  check("§2 toplu = tekil (4 top: alıcı · pasif şablon · şablonsuz · alıcısız)", ids.every((id) => bulk[id] === one[id]), JSON.stringify(ids.map((id) => [bulk[id] === tCons ? "CONS" : bulk[id] === tCust ? "CUST" : bulk[id], one[id] === tCons ? "CONS" : one[id] === tCust ? "CUST" : one[id]])));

  console.log("\n[§3] önizleme alanları");
  const pv = await getTamburLabelPreviewFields({ rollId: rBare });
  check("§3 sahibin müşteri route'u (kanvas)", pv.templateId === tCust && pv.kind === LabelKind.ROLL_FINISHED, String(pv.templateName));
  check("§3 kanvasta bağlı alanlar; barkod/tarih atıldı, eleman etiketi korunur", JSON.stringify(pv.fields?.map((f) => f.key)) === '["itemName","weightKg"]' && pv.fields?.[1]?.label === "KG", JSON.stringify(pv.fields));
  const other = await mkCustomer("K");
  const pvOther = await getTamburLabelPreviewFields({ rollId: rBare, customerId: other });
  check("§3 Kime?=başka müşteri verilse de emanet topta sahip", pvOther.templateId === tCust);
  const pvCons = await getTamburLabelPreviewFields({ rollId: rBare, consigneeId: consA.id });
  check("§3 alıcı şablonu önce", pvCons.templateId === tCons && JSON.stringify(pvCons.fields?.map((f) => f.key)) === '["consigneeName","widthCm"]');
  await prisma.customerTemplateRoute.updateMany({ where: { customerId: owner, kind: LabelKind.ROLL_FINISHED }, data: { templateId: tFlow } });
  const pvFlow = await getTamburLabelPreviewFields({ rollId: rBare });
  check("§3 akış şablonunda yalnız görünür, barkodsuz alanlar", JSON.stringify(pvFlow.fields?.map((f) => f.key)) === '["colorName"]', JSON.stringify(pvFlow.fields));
  check("§3 yok top 404", (await errCode(getTamburLabelPreviewFields({ rollId: "00000000-0000-4000-8000-000000000000" }))).startsWith("404"));

  console.log("\n[§4] roll özeti sahibi");
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-TEA-WO-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: item.id,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  const stepId = wo.steps[0]!.id;
  const rStep = await prisma.roll.create({
    data: {
      barcode: null, itemId: item.id, colorId: color.id, status: RollStatus.IN_PRODUCTION, currentQty: 40, initialQty: 40,
      qualityGrade: grade.code, qualityGradeId: grade.id, currentStepId: stepId, ownerCustomerId: owner,
      movements: { create: [{ workOrderStepId: stepId, enteredAt: new Date(), qtyIn: 40 }] },
    },
    select: { id: true },
  });
  rollIds.push(rStep.id);
  const summary = await loadTamburRolls.call(new TamburService() as never, { id: stepId, workOrderId: wo.id });
  const row = summary.find((r) => r.rollId === rStep.id);
  check("§4 ownerCustomerId + ownerCustomerName", row?.ownerCustomerId === owner && row?.ownerCustomerName === `TEST Etiket Alan O ${ts}`, JSON.stringify({ id: row?.ownerCustomerId, name: row?.ownerCustomerName }));
}

async function cleanup(): Promise<void> {
  for (const m of ["rollMovement", "rollOperation", "rollProperty", "warehouseMovement"] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
  }
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.customerConsignee.deleteMany({ where: { customerId: { in: customerIds } } });
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
