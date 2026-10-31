// =============================================================================
// test_siparis_hedef_deger_kopya — SY-F1: sipariş satırı hedef değeri → iş emri, Tambur özeti, ihtiyaç raporu
// =============================================================================
//   §1 ⭐ kuşaklı satırdan iş emri DOĞAR (BAYRAK ikizi rota kapsamasından geçer), değer WorkOrderTargetValue'a kopyalanır
//      (negatif sonda hedefi: kopya adımı kaldırılınca kırmızı)
//   §2 ⭐ aynı değerli iki satır → kopya; farklı değerli iki satır → iş emri doğar, kopya YOK, uyarı TARGET_VALUE_CONFLICT;
//      biri boş → yine çakışma
//   §3 gövdedeki açık hedef satırdan üstündür; hedefsiz satır → bugünkü gibi (hedef yok, uyarı yok)
//   §4 Tambur adım özeti `targetValues` çipini taşır (özellik + değer adı); hedefsiz iş emrinde boş dizi
//   §5 ⭐ kuşak ihtiyacı raporu: kalan metre ÷ top boyu yukarı yuvarlanır; top boyu yoksa "bilinmeyen" (0 değil);
//      iptal edilen kalem sayılmaz
// Çalıştır: npx tsx scripts/test_siparis_hedef_deger_kopya.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TamburService } from "../src/services/tambur.service";
import { TARGET_VALUE_CONFLICT } from "../src/services/helpers/order-line-target-copy.helper";
import { targetValueNeedReport } from "../src/services/reports/target-value-need.report";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-SYF1-${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], items: [] as string[], props: [] as string[], stations: [] as string[], routes: [] as string[], wos: [] as string[] };

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_siparis_hedef_deger_kopya");
  const orders = (await import("../src/routes/order.routes")).orderService;
  const wos = new WorkOrderService();
  const tambur = new TamburService();

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
  const station = await prisma.station.create({
    data: { code: `${TAG}-TB`.slice(0, 32), name: `${TAG} Tambur`, type: "INTERNAL", kind: "TAMBUR", appliesProperty: true },
    select: { id: true },
  });
  made.stations.push(station.id);
  await prisma.stationProperty.create({ data: { stationId: station.id, propertyId: flag.id } });
  const route = await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);

  const line = (valueId: string | null, extra: Record<string, unknown> = {}) => ({
    itemId: item.id, quantity: 1000, unitPrice: 1, pieceLengthM: 300,
    ...(valueId ? { targetValues: [{ propertyId: brand.id, valueId }] } : {}), ...extra,
  });
  const order = async (lines: Array<Record<string, unknown>>) => {
    const r = (await orders.create({ customerId: customer.id, currency: "TRY", clientToken: randomUUID(), lines })) as { data: { id: string } };
    return (await prisma.orderLine.findMany({ where: { orderId: r.data.id }, select: { id: true }, orderBy: { createdAt: "asc" } })).map((l) => l.id);
  };
  const createWo = async (orderLineIds: string[], extra: Record<string, unknown> = {}) => {
    const r = await wos.create({ routeTemplateId: route.id, orderLineIds, width: 280, clientToken: randomUUID(), ...extra } as Parameters<WorkOrderService["create"]>[0]);
    const id = (r.data as { id: string }).id;
    made.wos.push(id);
    const tv = await prisma.workOrderTargetValue.findMany({ where: { workOrderId: id, revokedAt: null }, select: { propertyId: true, valueId: true } });
    return { id, tv, warnings: r.warnings ?? [] };
  };
  const hasConflict = (w: string[]) => w.some((x) => x.startsWith(`[${TARGET_VALUE_CONFLICT}]`));

  // §1
  const [l1] = await order([line(zebra)]);
  const w1 = await createWo([l1!]);
  check("§1 ⭐ kuşaklı satırdan iş emri doğar, Zebra kopyalanır", w1.tv.length === 1 && w1.tv[0]!.valueId === zebra && w1.tv[0]!.propertyId === brand.id, JSON.stringify(w1.tv));
  const tp = await prisma.workOrderTargetProperty.findMany({ where: { workOrderId: w1.id }, select: { propertyId: true } });
  check("§1b BAYRAK (Kuşak) iş emri hedef özelliklerinde, çakışma uyarısı yok", tp.some((p) => p.propertyId === flag.id) && !hasConflict(w1.warnings), JSON.stringify(w1.warnings));

  // §2
  const same = await order([line(zebra), line(zebra)]);
  const w2a = await createWo(same);
  check("§2a aynı değerli iki satır → kopya", w2a.tv.length === 1 && w2a.tv[0]!.valueId === zebra && !hasConflict(w2a.warnings));
  const diff = await order([line(zebra), line(jasmin)]);
  const w2b = await createWo(diff);
  check("§2b ⭐ farklı değerli iki satır → iş emri doğar, kopya YOK, uyarı TARGET_VALUE_CONFLICT", w2b.tv.length === 0 && hasConflict(w2b.warnings), JSON.stringify(w2b.warnings));
  check("§2c uyarı iki değeri de adlandırır", w2b.warnings.some((w) => w.includes("Zebra") && w.includes("Jasmin")));
  const partial = await order([line(zebra), line(null, { requiredPropertyIds: [flag.id] })]);
  const w2d = await createWo(partial);
  check("§2d bir satırda değer yok → çakışma (kuşaksız kaleme Zebra yazılmaz)", w2d.tv.length === 0 && w2d.warnings.some((w) => w.includes("boş")), JSON.stringify(w2d.warnings));

  // §3
  const w3 = await createWo(diff, { targetValues: [{ propertyId: brand.id, valueId: jasmin }] });
  check("§3a gövdedeki açık hedef satırdan üstün, çakışma uyarısı yok", w3.tv.length === 1 && w3.tv[0]!.valueId === jasmin && !hasConflict(w3.warnings), JSON.stringify(w3));
  const [plain] = await order([line(null)]);
  const w3b = await createWo([plain!]);
  check("§3b hedefsiz satır → bugünkü gibi (hedef yok, uyarı yok)", w3b.tv.length === 0 && w3b.warnings.length === 0, JSON.stringify(w3b.warnings));

  // §4
  const step1 = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: w1.id }, select: { id: true } });
  const s1 = (await tambur.getStep(step1.id)).data;
  check("§4a Tambur özeti çipi taşır (Kuşak markası: Zebra)", s1.targetValues.length === 1 && s1.targetValues[0]!.valueName === "Zebra" && s1.targetValues[0]!.propertyName === `${TAG} Kuşak markası`, JSON.stringify(s1.targetValues));
  const stepPlain = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: w3b.id }, select: { id: true } });
  check("§4b hedefsiz iş emrinde boş dizi", (await tambur.getStep(stepPlain.id)).data.targetValues.length === 0);

  // §5 — l1(Zebra) + same(2×Zebra) + diff(Zebra,Jasmin) + partial(Zebra) = 5 Zebra, 1 Jasmin kalemi; her biri 1000 m / 300 m → 4 top
  const [noLen] = await order([line(zebra, { pieceLengthM: null })]);
  const [cancelled] = await order([line(zebra)]);
  await prisma.orderLine.update({ where: { id: cancelled! }, data: { cancelledAt: new Date(), cancelReason: "test" } });
  void noLen;
  const rep = await targetValueNeedReport({ musteriId: customer.id });
  const z = rep.satirlar.find((s) => s.deger === "Zebra");
  const j = rep.satirlar.find((s) => s.deger === "Jasmin");
  check("§5a ⭐ Zebra: 6 kalem (iptal hariç), 5×⌈1000÷300⌉ = 20 top, 1 kalemin top boyu yok", z?.kalemSayisi === 6 && z.beklenenTop === 20 && z.topuBilinmeyenKalem === 1 && z.kalanMetre === "6000.000", JSON.stringify(z));
  check("§5b Jasmin: 1 kalem, 4 top", j?.kalemSayisi === 1 && j.beklenenTop === 4, JSON.stringify(j));
  check("§5c özet: hedefli kalemlerin kalanı ve topu (hedefsiz kalem yok)", rep.ozet.beklenenTop === 24 && rep.ozet.topuBilinmeyenKalem === 1, JSON.stringify(rep.ozet));
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
