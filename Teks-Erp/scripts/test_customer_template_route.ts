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
import { Prisma, type LabelKind } from "@prisma/client";

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
let savedSnapshot: unknown = null;
let savedLabelDirty: boolean | null = null;

async function main() {
  // --- Fixture'lar (business-key; hardcoded UUID yok) ---
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const roll = await prisma.roll.findFirst({
    where: { colorId: { not: null }, barcode: { not: null }, status: { notIn: ["CANCELLED"] as never[] } },
    select: { id: true, barcode: true, lastLabelSnapshot: true, labelDirty: true },
  });
  if (!customer || !roll) throw new Error("Fixture eksik: aktif müşteri + bitmiş top gerekli");
  customerId = customer.id;
  rollId = roll.id;
  savedSnapshot = roll.lastLabelSnapshot;
  savedLabelDirty = roll.labelDirty;

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
      if (rollId) {
        await prisma.roll.update({
          where: { id: rollId },
          data: {
            lastLabelSnapshot: (savedSnapshot ?? Prisma.JsonNull) as never,
            labelDirty: savedLabelDirty ?? false,
          },
        });
      }
      if (createdTemplateIds.length) {
        await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: createdTemplateIds } } });
        await prisma.labelTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
      }
      console.log("Cleanup: test kayıtları silindi, top snapshot'ı geri yüklendi.");
    } catch (e) {
      console.error("Cleanup hatası:", e);
    }
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
