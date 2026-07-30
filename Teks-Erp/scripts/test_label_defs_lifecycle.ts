// =============================================================================
// Test: Etiket tanımlarında pasife-alma ↔ KALICI silme ayrımı (deletedAt kalıbı)
//       — LabelTemplate yaşam döngüsü.
// Çalıştır: npx tsx scripts/test_label_defs_lifecycle.ts
// Not: "Boyutlar" (LabelFormatProfile) kataloğu 2026-07'de emekliye ayrıldı (medya
//      artık yazıcı cihazında) → profil yaşam döngüsü bölümü kaldırıldı.
// Test verisi üretir, sonunda fiziksel temizler.
// =============================================================================
import { LabelKind, PrinterLanguage } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";
import { resolveLabelRouting } from "../src/services/helpers/label-routing.resolver";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu, atılmadı"); }
  catch { check(label, true); }
}

const tplSvc = new LabelTemplateService();

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const templateIds: string[] = [];
const peripheralIds: string[] = [];

async function main() {
  // Şablon yönlendirmesi için bir yazıcı cihazı (medya cihazın kendinde).
  const dev = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-LDL-PRN-${stamp}`, name: "LDL Yazıcı", kind: "LABEL_PRINTER",
      connectionType: "NETWORK_TCP", languageOverride: PrinterLanguage.PPLA,
      labelWidthMm: 100, labelHeightMm: 58, labelDpi: 203,
    },
    select: { id: true },
  });
  peripheralIds.push(dev.id);

  // === ŞABLON yaşam döngüsü ===
  const tRes = await tplSvc.create({ name: `TEST-LDL-T-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false });
  const tpl = tRes.data;
  templateIds.push(tpl.id);
  await prisma.peripheralTemplateRoute.create({
    data: { peripheralId: dev.id, kind: LabelKind.ROLL_FINISHED, templateId: tpl.id },
  });

  await tplSvc.hardDelete(tpl.id);
  const tAfter = await prisma.labelTemplate.findUnique({ where: { id: tpl.id } });
  check("şablon hardDelete: satır DB'de durur", !!tAfter);
  check("şablon hardDelete: deletedAt + pasif", !!tAfter?.deletedAt && tAfter.isActive === false);
  check("şablon hardDelete: ad DEL- önekiyle serbest", (tAfter?.name ?? "").startsWith("DEL-"));
  const routeCount = await prisma.peripheralTemplateRoute.count({ where: { templateId: tpl.id } });
  check("şablon hardDelete: cihaz yönlendirmeleri silindi", routeCount === 0);
  await expectThrow("silinmiş şablon düzenlenemez", () => tplSvc.update(tpl.id, { name: "X" }));
  await expectThrow("silinmiş şablon default yapılamaz", () => tplSvc.setDefault(tpl.id));
  const tList = await tplSvc.findAll({ kind: LabelKind.ROLL_FINISHED, includeInactive: true });
  check("şablon listesi: silinmiş GİZLİ (pasifler dahil görünümde bile)",
    !tList.data.some((r) => r.id === tpl.id));
  const tRe = await tplSvc.create({ name: `TEST-LDL-T-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false });
  templateIds.push(tRe.data.id);
  check("şablon hardDelete: aynı ad yeniden kullanılabilir", !!tRe.data.id);

  // Routing: silinmiş şablon explicit istense bile çözülmez (kind default'a düşer).
  const routing = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, templateId: tpl.id });
  check("routing: silinmiş şablon explicit çözülmez", routing.template?.id !== tpl.id);

  // Default şablon KALICI silinemez (canlı default'a dokunmadan yalnız guard denenir).
  const liveDefault = await prisma.labelTemplate.findFirst({
    where: { kind: LabelKind.ROLL_FINISHED, isDefault: true, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (liveDefault) {
    await expectThrow("default şablon kalıcı silinemez", () => tplSvc.hardDelete(liveDefault.id));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: peripheralIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
