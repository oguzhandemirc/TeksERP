// =============================================================================
// test_fason_adim_hedef_notu — SY-F4: sipariş satırı hedef değeri → dış (fason) adım notu → çeki talimatı
// =============================================================================
//   §1 ⭐ kuşaklı satırdan doğan iş emrinde, özelliği uygulayan EXTERNAL adımın notuna "Kuşak: Zebra" eklenir;
//      iç adımın notu değişmez
//   §2 ⭐ İDEMPOTENT: not aynı satırı (boşluk/harf farkıyla) zaten taşıyorsa tekrar eklenmez, not BAYT-AYNI kalır
//      (negatif sonda hedefi: idempotent kontrol kaldırılınca çift satır → kırmızı); saf birleştirme iki kez = bir kez
//   §3 SIFIR FARK: çakışan satırlar / hedefsiz satır / gövdedeki açık hedef → not dokunulmaz (bugünkü davranış)
//   §4 yalnız iç istasyon özelliği uyguluyorsa not yazılmaz (talimat fason çekisi içindir)
//   §5 not 500 sınırını aşacaksa eklenmez, uyarı TARGET_NOTE_TOO_LONG
//   §6 ⭐ basılmış çeki değişmez: not YALNIZ doğuşta yazılır — birleştiricinin tek çağıranı createFresh; satır
//      değeri sonradan değişse de adım notu aynı kalır (çeki talimatı sevkte `dispatch.instruction`a donar)
// Çalıştır: npx tsx scripts/test_fason_adim_hedef_notu.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { mergeTargetNoteLines, TARGET_NOTE_TOO_LONG } from "../src/services/helpers/fason-step-target-note.helper";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-SYF4-${Date.now().toString(36).toUpperCase()}`;
const made = {
  customers: [] as string[], items: [] as string[], props: [] as string[], stations: [] as string[],
  routes: [] as string[], wos: [] as string[], categories: [] as string[],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_fason_adim_hedef_notu");
  const orders = (await import("../src/routes/order.routes")).orderService;
  const wos = new WorkOrderService();

  const customer = await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} müşteri` }, select: { id: true } });
  made.customers.push(customer.id);
  const item = await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} tül`, itemType: "FABRIC" }, select: { id: true } });
  made.items.push(item.id);
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-KS`.slice(0, 32), name: `${TAG} Kuşak`, valueType: "FLAG" }, select: { id: true } });
  made.props.push(flag.id);
  const brand = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-KM`.slice(0, 32), name: `${TAG} Kuşak markası`, valueType: "CHOICE", variantOfPropertyId: flag.id,
      values: { create: [{ code: `${TAG}ZB`.slice(0, 32), name: "Zebra" }, { code: `${TAG}JS`.slice(0, 32), name: "Jasmin" }] },
    },
    select: { id: true, values: { select: { id: true, name: true } } },
  });
  made.props.push(brand.id);
  const zebra = brand.values.find((v) => v.name === "Zebra")!.id;
  const jasmin = brand.values.find((v) => v.name === "Jasmin")!.id;
  const category = await prisma.subcontractorCategory.create({
    data: { code: `${TAG}-DT`.slice(0, 32), name: `${TAG} Dış tambur`, appliesProperty: true }, select: { id: true },
  });
  made.categories.push(category.id);
  const inner = await prisma.station.create({ data: { code: `${TAG}-HZ`.slice(0, 32), name: `${TAG} Hazırlık`, type: "INTERNAL" }, select: { id: true } });
  const outer = await prisma.station.create({
    data: { code: `${TAG}-DS`.slice(0, 32), name: `${TAG} Dış tambur`, type: "EXTERNAL", appliesProperty: true, defaultCategoryId: category.id },
    select: { id: true },
  });
  const innerTambur = await prisma.station.create({
    data: { code: `${TAG}-IT`.slice(0, 32), name: `${TAG} İç tambur`, type: "INTERNAL", kind: "TAMBUR", appliesProperty: true }, select: { id: true },
  });
  made.stations.push(inner.id, outer.id, innerTambur.id);
  await prisma.stationProperty.create({ data: { stationId: outer.id, propertyId: flag.id } });
  await prisma.stationProperty.create({ data: { stationId: innerTambur.id, propertyId: flag.id } });

  const mkRoute = async (name: string, outerNote: string | null, stationId = outer.id) => {
    const external = stationId === outer.id;
    const r = await prisma.route.create({
      data: {
        name: `${TAG} ${name}`,
        steps: { create: [
          { stationId: inner.id, sequence: 1, defaultNotes: "İç not" },
          { stationId, sequence: 2, defaultNotes: outerNote, requiredCategoryId: external ? category.id : null },
        ] },
      },
      select: { id: true },
    });
    made.routes.push(r.id);
    return r.id;
  };
  const line = (valueId: string | null) => ({
    itemId: item.id, quantity: 1000, unitPrice: 1, pieceLengthM: 300,
    ...(valueId ? { targetValues: [{ propertyId: brand.id, valueId }] } : { requiredPropertyIds: [flag.id] }),
  });
  const order = async (values: Array<string | null>) => {
    const r = (await orders.create({ customerId: customer.id, currency: "TRY", clientToken: randomUUID(), lines: values.map(line) })) as { data: { id: string } };
    return (await prisma.orderLine.findMany({ where: { orderId: r.data.id }, select: { id: true }, orderBy: { createdAt: "asc" } })).map((l) => l.id);
  };
  const createWo = async (routeTemplateId: string, orderLineIds: string[], extra: Record<string, unknown> = {}) => {
    const r = await wos.create({ routeTemplateId, orderLineIds, width: 280, clientToken: randomUUID(), ...extra } as Parameters<WorkOrderService["create"]>[0]);
    const id = (r.data as { id: string }).id;
    made.wos.push(id);
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: id }, select: { notes: true }, orderBy: { stepSequence: "asc" } });
    return { id, notes: steps.map((s) => s.notes), warnings: r.warnings ?? [] };
  };
  const expectedLine = `${TAG} Kuşak: Zebra`;

  // §1
  const routeA = await mkRoute("rota A", null);
  const [l1] = await order([zebra]);
  const w1 = await createWo(routeA, [l1!]);
  check("§1 ⭐ dış adımın notu = 'Kuşak: Zebra' (BAYRAK adıyla)", w1.notes[1] === expectedLine, JSON.stringify(w1.notes));
  check("§1b iç adım notu değişmez", w1.notes[0] === "İç not", JSON.stringify(w1.notes));
  const routeA2 = await mkRoute("rota A2", "Sıkı sar");
  const w1c = await createWo(routeA2, [l1!]);
  check("§1c elle yazılmış notun ALTINA eklenir", w1c.notes[1] === `Sıkı sar\n${expectedLine}`, JSON.stringify(w1c.notes));

  // §2
  const manual = `Sıkı sar\n  ${TAG} kuşak:   zebra `;
  const routeB = await mkRoute("rota B", manual);
  const w2 = await createWo(routeB, [l1!]);
  check("§2 ⭐ not satırı zaten varsa tekrar eklenmez (not bayt-aynı)", w2.notes[1] === manual, JSON.stringify(w2.notes));
  const once = mergeTargetNoteLines("A", ["Kuşak: Zebra", "kuşak:  zebra"]);
  check("§2b saf birleştirme: iki kez = bir kez; aynı listede tekrar tek satır", once === "A\nKuşak: Zebra" && mergeTargetNoteLines(once, ["Kuşak: Zebra"]) === once, JSON.stringify(once));

  // §3
  const diff = await order([zebra, jasmin]);
  const w3a = await createWo(routeA, diff);
  check("§3a çakışan satırlar → not dokunulmaz", w3a.notes[1] === null, JSON.stringify(w3a.notes));
  const [plain] = await order([null]);
  const w3b = await createWo(routeA, [plain!]);
  check("§3b hedefsiz satır → not dokunulmaz, uyarı yok", w3b.notes[1] === null && w3b.warnings.length === 0, JSON.stringify(w3b));
  const w3c = await createWo(routeA, [plain!], { targetValues: [{ propertyId: brand.id, valueId: zebra }] });
  check("§3c gövdedeki açık hedef nota YAZILMAZ (bugünkü fabrikalarda sıfır fark)", w3c.notes[1] === null, JSON.stringify(w3c.notes));

  // §4
  const routeIn = await mkRoute("iç rota", null, innerTambur.id);
  const w4 = await createWo(routeIn, [l1!]);
  check("§4 özellik iç istasyonda uygulanıyorsa not yazılmaz", w4.notes[1] === null, JSON.stringify(w4.notes));

  // §5
  const longNote = "x".repeat(495);
  const routeL = await mkRoute("uzun", longNote);
  const w5 = await createWo(routeL, [l1!]);
  check("§5 500 sınırı aşılacaksa not aynı + uyarı TARGET_NOTE_TOO_LONG", w5.notes[1] === longNote && w5.warnings.some((w) => w.startsWith(`[${TARGET_NOTE_TOO_LONG}]`)), JSON.stringify(w5.warnings));

  // §6
  await prisma.orderLineTargetValue.updateMany({ where: { orderLineId: l1! }, data: { valueId: jasmin } });
  const after = await prisma.workOrderStep.findMany({ where: { workOrderId: w1.id }, select: { notes: true }, orderBy: { stepSequence: "asc" } });
  check("§6a satır değeri sonradan değişse de doğmuş adım notu aynı", after[1]?.notes === expectedLine, JSON.stringify(after));
  const srcRoot = path.join(__dirname, "..", "src");
  const callers = sourceFiles(srcRoot).flatMap((f) => {
    const n = (readFileSync(f, "utf8").match(/appendTargetNotesToExternalSteps\(/g) ?? []).length;
    return f.endsWith("fason-step-target-note.helper.ts") || n === 0 ? [] : [`${path.relative(srcRoot, f)}×${n}`];
  });
  const svc = readFileSync(path.join(srcRoot, "services", "workorder.service.ts"), "utf8");
  const at = svc.indexOf("appendTargetNotesToExternalSteps(prisma");
  const inCreateFresh = at > svc.indexOf("createFresh(") && at < svc.indexOf("withBarcodeRetry(() => prisma.$transaction", svc.indexOf("createFresh("));
  check("§6b ⭐ birleştiricinin TEK çağıranı createFresh (doğuş öncesi; sevk/düzenleme yolu notu yeniden yazmaz)", callers.join(",") === "services/workorder.service.ts×1" && inCreateFresh, callers.join(","));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  for (const id of made.wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id } }).catch(swallow);
  }
  await prisma.orderLine.deleteMany({ where: { order: { customerId: { in: made.customers } } } }).catch(swallow);
  await prisma.order.deleteMany({ where: { customerId: { in: made.customers } } }).catch(swallow);
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.subcontractorCategory.deleteMany({ where: { id: { in: made.categories } } }).catch(swallow);
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
