// =============================================================================
// Test: LabelContextDefault — bağlam-başına varsayılan şablonun yeni tek kaynağı
// (Etiket Stüdyosu F1). setDefault/create/update çift-yazım senkronu + resolver
// zincirinin yeni kaynaktan okuması + default/silme guard'ları + hardDelete'in
// müşteri-atama temizliği.
// Çalıştır: npx tsx scripts/test_label_context_default.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";
import {
  resolveLabelRouting,
  findContextDefaultTemplate,
} from "../src/services/helpers/label-routing.resolver";
import { AppError } from "../src/utils/app-error";
import type { LabelKind } from "@prisma/client";
import { atlamaDefteri } from "./lib/atlama";

const KIND = "ROLL_RAW" as LabelKind; // string literal — modül-üstü enum deref TDZ yasağı

let pass = 0;
let fail = 0;
// ⚠️ ATLAMA ARTIK SAYILIR VE BEYAN EDİLİR (2026-09-13). Eskiden `check(…, true)`
// ile GEÇTİ sayılıyordu: kapsam kaybı sıfır değil EKSİ idi — kapsanmayan şey
// yeşili ARTIRIYORDU. Bu daldan geçen koşum "ölçtüm" değil "bakamadım" der.
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function expectBadRequest(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata beklenirken başarı döndü");
  } catch (e) {
    check(label, e instanceof AppError && e.statusCode === 400, e instanceof Error ? e.message : String(e));
  }
}

const svc = new LabelTemplateService();
const createdIds: string[] = [];

async function main() {
  // --- Mevcut durumu yedekle (testte bozup sonda geri koyacağız) ---
  const originalDefault = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  const originalFlagged = await prisma.labelTemplate.findFirst({
    where: { kind: KIND, isDefault: true },
    select: { id: true },
  });

  // --- İki test şablonu (create default alan listesiyle) ---
  const a = (await svc.create({ name: `TEST-CTXDEF-A-${Date.now()}`, kind: KIND })).data;
  createdIds.push(a.id);
  const b = (await svc.create({ name: `TEST-CTXDEF-B-${Date.now()}`, kind: KIND })).data;
  createdIds.push(b.id);
  check("create: yeni şablonlar default değil", !a.isDefault && !b.isDefault);

  // --- setDefault(A): tablo + çift-yazım ---
  await svc.setDefault(a.id);
  let row = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  check("setDefault(A): LabelContextDefault → A", row?.templateId === a.id);
  const aAfter = await prisma.labelTemplate.findUnique({ where: { id: a.id } });
  check("setDefault(A): isDefault çift-yazımı", aAfter?.isDefault === true);
  if (originalFlagged && originalFlagged.id !== a.id) {
    const orig = await prisma.labelTemplate.findUnique({ where: { id: originalFlagged.id } });
    check("setDefault(A): eski default'un bayrağı düştü", orig?.isDefault === false);
  }

  // --- findDefault + resolver yeni kaynaktan okuyor ---
  const viaService = await svc.findDefault(KIND);
  check("findDefault: LabelContextDefault'tan", viaService?.id === a.id);
  const viaHelper = await findContextDefaultTemplate(KIND);
  check("findContextDefaultTemplate: aynı sonuç", viaHelper?.id === a.id);
  const routing = await resolveLabelRouting({ kind: KIND });
  check("resolveLabelRouting (cihazsız): bağlam default'u A", routing.template?.id === a.id);

  // --- setDefault(B): devir ---
  await svc.setDefault(b.id);
  row = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  const aFlag = await prisma.labelTemplate.findUnique({ where: { id: a.id } });
  check("setDefault(B): tablo B'ye devretti", row?.templateId === b.id);
  check("setDefault(B): A'nın bayrağı düştü (çift-yazım)", aFlag?.isDefault === false);

  // --- update(isDefault:false): bağlam default'suz kalabilir (eski davranış) ---
  await svc.update(b.id, { isDefault: false });
  row = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  check("update(B, isDefault:false): tablo kaydı silindi", row == null);
  check("findDefault: null (bağlam default'suz)", (await svc.findDefault(KIND)) == null);
  const routingNoDef = await resolveLabelRouting({ kind: KIND });
  check("resolver: default yokken template null (katalog fallback)", routingNoDef.template == null);

  // --- create(isDefault:true): tabloya yazar ---
  const c = (await svc.create({ name: `TEST-CTXDEF-C-${Date.now()}`, kind: KIND, isDefault: true })).data;
  createdIds.push(c.id);
  row = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  check("create(isDefault:true): tablo → C", row?.templateId === c.id);

  // --- guard'lar: bağlam default'u pasifleştirilemez/silinemez ---
  await expectBadRequest("guard: default şablon pasifleştirilemez", () => svc.deactivate(c.id));
  await expectBadRequest("guard: default şablon kalıcı silinemez", () => svc.hardDelete(c.id));

  // --- hardDelete: müşteri atamalarını temizler ---
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (customer) {
    await prisma.customerTemplateRoute.create({
      data: { customerId: customer.id, kind: KIND, templateId: a.id },
    });
    await svc.hardDelete(a.id); // A default değil → silinebilir
    const routes = await prisma.customerTemplateRoute.count({ where: { templateId: a.id } });
    const aDeleted = await prisma.labelTemplate.findUnique({ where: { id: a.id } });
    check("hardDelete(A): müşteri atamaları temizlendi", routes === 0);
    check("hardDelete(A): deletedAt damgalı + pasif", aDeleted?.deletedAt != null && aDeleted?.isActive === false);
  } else {
    ATLAMA.atla("hardDelete müşteri-atama temizliği", "müşteri fixture yok");
  }

  // --- Geri yükleme: C'yi default'luktan düşür, orijinali geri koy ---
  await svc.update(c.id, { isDefault: false });
  if (originalDefault) {
    await prisma.labelContextDefault.upsert({
      where: { kind: KIND },
      create: { kind: KIND, templateId: originalDefault.templateId },
      update: { templateId: originalDefault.templateId },
    });
    await prisma.labelTemplate.update({
      where: { id: originalDefault.templateId },
      data: { isDefault: true },
    });
  }
  const restored = await prisma.labelContextDefault.findUnique({ where: { kind: KIND } });
  check(
    "geri yükleme: orijinal bağlam default'u yerinde",
    originalDefault ? restored?.templateId === originalDefault.templateId : restored == null,
  );
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    // Cleanup: test şablonları (atamaları önce) — fiziksel silme yalnız TEST- verisi.
    try {
      await prisma.customerTemplateRoute.deleteMany({ where: { templateId: { in: createdIds } } });
      await prisma.labelContextDefault.deleteMany({ where: { templateId: { in: createdIds } } });
      await prisma.labelTemplate.deleteMany({ where: { id: { in: createdIds } } });
      console.log("Cleanup: test kayıtları silindi.");
    } catch (e) {
      console.error("Cleanup hatası:", e);
    }
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
