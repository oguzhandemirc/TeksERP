// =============================================================================
// Test: müşteriye özel şablon ataması (CustomerTemplateRoute) — Etiket Stüdyosu F3
// =============================================================================
// Öncelik matrisi: explicit > MÜŞTERİ > cihaz route > bağlam default.
// + stok baskıda müşteri halkası sorgulanmaz (explicit-only korunur)
// + reprint HER ZAMAN güncel atamayla basar (snapshot şablonu dondurmaz)
// + LABEL_PRINTED audit'ine çözülen templateId yazılır
// + bulk bağlam (buildBulkContext) müşteri route'larını tekil yolla aynı çözer
// Çalıştır: npx tsx scripts/test_customer_template_route.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { LabelTemplateService } from "../src/services/label-template.service";
import { CustomerTemplateRouteService } from "../src/services/customer-template-route.service";
import { resolveLabelRouting } from "../src/services/helpers/label-routing.resolver";
import type { LabelKind } from "@prisma/client";

const FINISHED = "ROLL_FINISHED" as LabelKind;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new LabelService();
const tplSvc = new LabelTemplateService();
const routeSvc = new CustomerTemplateRouteService();

const createdTemplateIds: string[] = [];
let peripheralId: string | null = null;
let customerId: string | null = null;
let rollId: string | null = null;
let itemId: string | null = null;
let colorId: string | null = null;

async function main() {
  // --- Fixture'lar: test KENDİ kayıtlarını yaratır (TEST- prefix'li) ---
  // Eski hali seed'den ödünç top/müşteri arıyordu; seed Roll üretmediği için
  // taze kurulumda (CI) "Fixture eksik" ile patlıyordu ve gerçek bir topun
  // snapshot'ını mutasyona uğratıp geri yüklüyordu. Kendi fixture'ı hem CI'da
  // deterministik hem paylaşılan veriye dokunmuyor.
  const ts = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-CTR-${ts}`, name: `TEST ŞABLON MÜŞTERİSİ ${ts}` },
    select: { id: true, name: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-CTR-I-${ts}`, name: `TEST ŞABLON ÜRÜN ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-CTR-C-${ts}`, name: "TEST ŞABLON RENK", hex: "#336699" },
    select: { id: true },
  });
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-CTR-R-${ts}`,
      itemId: item.id,
      colorId: color.id,
      status: "WAREHOUSE",
      currentQty: 50,
      initialQty: 50,
      width: 150,
      qualityGrade: "A",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  customerId = customer.id;
  rollId = roll.id;
  itemId = item.id;
  colorId = color.id;

  // --- Test şablonları ---
  const tCust = (await tplSvc.create({ name: `TEST-CTR-CUST-${Date.now()}`, kind: FINISHED })).data;
  const tCust2 = (await tplSvc.create({ name: `TEST-CTR-CUST2-${Date.now()}`, kind: FINISHED })).data;
  const tDev = (await tplSvc.create({ name: `TEST-CTR-DEV-${Date.now()}`, kind: FINISHED })).data;
  const tExp = (await tplSvc.create({ name: `TEST-CTR-EXP-${Date.now()}`, kind: FINISHED })).data;
  createdTemplateIds.push(tCust.id, tCust2.id, tDev.id, tExp.id);

  // --- Cihaz route'lu test yazıcısı ---
  const peripheral = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-CTR-PRN-${Date.now().toString(36)}`,
      name: "TEST müşteri-route yazıcı",
      kind: "LABEL_PRINTER" as never,
      connectionType: "NETWORK_TCP" as never,
      isActive: true,
      templateRoutes: { create: { kind: FINISHED, templateId: tDev.id } },
    },
    select: { id: true },
  });
  peripheralId = peripheral.id;

  // --- Müşteri ataması ---
  await routeSvc.set(customer.id, FINISHED, tCust.id);
  const listed = (await routeSvc.list(customer.id)).data;
  check("atama listesi: kind→şablon", listed.some((r) => r.kind === FINISHED && r.templateId === tCust.id));

  // --- Öncelik matrisi (resolver düzeyi) ---
  const rCust = await resolveLabelRouting({ kind: FINISHED, customerId: customer.id });
  check("müşteri > bağlam default", rCust.template?.id === tCust.id);

  const rCustDev = await resolveLabelRouting({ kind: FINISHED, customerId: customer.id, peripheralId: peripheral.id });
  check("müşteri > cihaz route", rCustDev.template?.id === tCust.id);

  const rDev = await resolveLabelRouting({ kind: FINISHED, peripheralId: peripheral.id });
  check("müşterisiz: cihaz route kazanır", rDev.template?.id === tDev.id);

  const rExp = await resolveLabelRouting({ kind: FINISHED, customerId: customer.id, templateId: tExp.id });
  check("explicit > müşteri", rExp.template?.id === tExp.id);

  const rNone = await resolveLabelRouting({ kind: FINISHED });
  check("müşterisiz+cihazsız: bağlam default (müşteri şablonu DEĞİL)", rNone.template?.id !== tCust.id);

  // --- Servis uçtan uca: meta.templateId ---
  const nCust = await svc.getRollLabelNative(roll.id, undefined, { customerId: customer.id });
  check("native (müşteri-explicit): meta.templateId = müşteri şablonu", nCust.data.meta.templateId === tCust.id);

  const nStock = await svc.getRollLabelNative(roll.id, undefined, { stock: true });
  check("native (STOK): müşteri şablonu TETİKLENMEZ", nStock.data.meta.templateId !== tCust.id);

  // --- Reprint güncel atamayla: snapshot müşteriyi taşır, şablonu TAŞIMAZ ---
  await svc.seedRollLabelSnapshot(roll.id, undefined, { customerId: customer.id });
  const nSnap = await svc.getRollLabelNative(roll.id); // bağlamsız reprint → snapshot müşterisi
  check("reprint: snapshot müşterisi → müşteri şablonu", nSnap.data.meta.templateId === tCust.id);

  await routeSvc.set(customer.id, FINISHED, tCust2.id); // atama değişti
  const nSnap2 = await svc.getRollLabelNative(roll.id);
  check("reprint: atama değişince GÜNCEL şablon (dondurma yok)", nSnap2.data.meta.templateId === tCust2.id);

  // --- Audit: LABEL_PRINTED newData.templateId ---
  await svc.recordPrintEvent(roll.id, undefined, { customerId: customer.id });
  const lastLog = await prisma.systemLog.findFirst({
    where: { tableName: "LABEL_PRINT_EVENT", recordId: roll.id },
    orderBy: { createdAt: "desc" },
  });
  const logged = (lastLog?.newData ?? {}) as Record<string, unknown>;
  check("audit: çözülen templateId yazıldı", logged.templateId === tCust2.id, `templateId=${String(logged.templateId)}`);

  // --- Bulk bağlam paritesi: müşteri route'ları batch'te de aynı çözülür ---
  type SvcPrivate = {
    buildBulkContext: (ids: string[], copies: number) => Promise<{
      customerTemplateByKey: Map<string, { template: { id: string } }>;
    }>;
  };
  const ctx = await (svc as unknown as SvcPrivate).buildBulkContext([roll.id], 1);
  const bulkEntry = ctx.customerTemplateByKey.get(`${FINISHED}|${customer.id}`);
  check("bulk: customerTemplateByKey tekil yolla aynı şablon", bulkEntry?.template.id === tCust2.id);

  // --- Atama kaldırma: null → default'a düşer ---
  await routeSvc.set(customer.id, FINISHED, null);
  const rAfter = await resolveLabelRouting({ kind: FINISHED, customerId: customer.id });
  check("atama kaldırıldı: müşteri halkası boş → default", rAfter.template?.id !== tCust2.id);
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    try {
      if (customerId) await prisma.customerTemplateRoute.deleteMany({ where: { customerId } });
      if (peripheralId) {
        await prisma.peripheralTemplateRoute.deleteMany({ where: { peripheralId } });
        await prisma.peripheralDevice.delete({ where: { id: peripheralId } });
      }
      // Test kendi TEST- fixture'ını siler (paylaşılan veri yok).
      if (rollId) await prisma.roll.delete({ where: { id: rollId } }).catch(() => {});
      if (itemId) await prisma.item.delete({ where: { id: itemId } }).catch(() => {});
      if (colorId) await prisma.color.delete({ where: { id: colorId } }).catch(() => {});
      if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
      if (createdTemplateIds.length) {
        await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: createdTemplateIds } } });
        await prisma.labelTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
      }
      console.log("Cleanup: test kayıtları silindi.");
    } catch (e) {
      console.error("Cleanup hatası:", e);
    }
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
