// =============================================================================
// Test: Etiket tanımlarında pasife-alma ↔ KALICI silme ayrımı (deletedAt kalıbı)
//       — LabelFormatProfile + LabelTemplate yaşam döngüsü.
// Çalıştır: npx tsx scripts/test_label_defs_lifecycle.ts
// Test verisi üretir, sonunda fiziksel temizler.
// =============================================================================
import { LabelKind, PrinterLanguage } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { LabelFormatProfileService } from "../src/services/label-format-profile.service";
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

const profileSvc = new LabelFormatProfileService({
  modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", searchFields: ["code", "name"], uniqueField: "code",
});
const tplSvc = new LabelTemplateService();

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const profileIds: string[] = [];
const templateIds: string[] = [];
const peripheralIds: string[] = [];

async function main() {
  // === 1) FORMAT PROFİLİ yaşam döngüsü ===
  const pRes = await profileSvc.create({ code: `TEST-LDL-P-${stamp}`, name: "LDL Profil", widthMm: 100, heightMm: 58 });
  const prof = pRes.data as { id: string };
  profileIds.push(prof.id);

  // Bu profili kullanan bir cihaz — silmede referans sökülmeli.
  const dev = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-LDL-PRN-${stamp}`, name: "LDL Yazıcı", kind: "LABEL_PRINTER",
      connectionType: "NETWORK_TCP", languageOverride: PrinterLanguage.PPLA, formatProfileId: prof.id,
    },
    select: { id: true },
  });
  peripheralIds.push(dev.id);

  await profileSvc.hardDelete(prof.id);
  const pAfter = await prisma.labelFormatProfile.findUnique({ where: { id: prof.id } });
  check("profil hardDelete: satır DB'de durur", !!pAfter);
  check("profil hardDelete: deletedAt + pasif + rollDefault düşük",
    !!pAfter?.deletedAt && pAfter.isActive === false && pAfter.isRollDefault === false);
  check("profil hardDelete: kod DEL- önekiyle serbest", (pAfter?.code ?? "").startsWith("DEL-"));
  const devAfter = await prisma.peripheralDevice.findUnique({ where: { id: dev.id }, select: { formatProfileId: true } });
  check("profil hardDelete: cihaz referansı söküldü (→ sistem profili)", devAfter?.formatProfileId === null);
  await expectThrow("silinmiş profil düzenlenemez", () => profileSvc.update(prof.id, { name: "X" }));
  const pAgain = await profileSvc.hardDelete(prof.id);
  check("profil hardDelete: idempotent", pAgain.success === true);
  const pRe = await profileSvc.create({ code: `TEST-LDL-P-${stamp}`, name: "LDL Profil 2", widthMm: 100, heightMm: 58 });
  const profRe = pRe.data as { id: string };
  profileIds.push(profRe.id);
  check("profil hardDelete: aynı kod yeniden kullanılabilir", !!profRe.id);
  const pList = await profileSvc.findAll({ query: {} } as never) as { data: Array<{ id: string }> };
  check("profil listesi: silinmiş GİZLİ, yeni görünür",
    !pList.data.some((r) => r.id === prof.id) && pList.data.some((r) => r.id === profRe.id));

  // === 2) ŞABLON yaşam döngüsü ===
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
  await prisma.labelFormatProfile.deleteMany({ where: { id: { in: profileIds } } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
