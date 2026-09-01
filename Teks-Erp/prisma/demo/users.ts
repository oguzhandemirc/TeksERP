// =============================================================================
// DEMO SEED — DEMO KULLANICISININ YETKİLERİ + FİRMA KÜNYESİ
// =============================================================================
// ÖLÇÜLDÜ: `seed-ticaret-demo.ts` `demo` kullanıcısına yalnız **WEB_TRADE**
// şablonunu uyguluyor ve o şablonda `workorder:*`, `kartela:*`, `station:*`,
// `roll:manual-adjust`, `admin:settings`, `data:import`, `document-template:*`
// ve DÖRT rapor kategorisi (üretim · kalite · fason · denetim) YOK.
// Sonuç: müşteri `demo` hesabıyla girdiğinde İş Emirleri, Kartela, İstasyon
// tanımları ve dört rapor sekmesinde 403 görür — 86 iznin 46'sı eksikti.
//
// KARAR: demo hesabı **ADMIN_FULL** alır (`mode: "all"` — katalogla her boot'ta
// eşitlenir, yani yeni izin eklendiğinde demo hesabı OTOMATİK kapsar).
// Gerekçe: demoyu gezen kişi "her şeyi kurcalayacak"; yetki duvarına çarpması
// ürünün eksikliği gibi okunur. Ayrı bir hesap olması (admin yedekte) bilinçli.
//
// ⚠️ `merge` DEĞİL `replace` DE DEĞİL — `applyTemplate(..., "merge", ...)`:
// ADMIN_FULL zaten "her şey" demek; merge, hesapta elle verilmiş başka bir izni
// düşürmez ve ikinci koşumda da güvenlidir.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { PermissionManagementService } from "../../src/services/permission-management.service";
import { systemSettingService } from "../../src/services/system-setting.service";
import { adim, say, not } from "./_kit";

export async function demoKullanicisiYetkilendir(): Promise<void> {
  adim("Demo kullanıcısı — tam yetki");
  const kullanici = await prisma.user.findFirst({
    where: { username: "demo" },
    select: { id: true },
  });
  if (!kullanici) {
    not("`demo` kullanıcısı yok — önce `seed-ticaret-demo.ts` koşmalı.");
    return;
  }
  const sablon = await prisma.permissionTemplate.findFirst({
    where: { code: "ADMIN_FULL" },
    select: { id: true },
  });
  if (!sablon) {
    not("ADMIN_FULL şablonu DB'de yok — boot uzlaştırması koşmamış olabilir.");
    return;
  }

  const once = await prisma.userPermission.count({ where: { userId: kullanici.id } });
  await PermissionManagementService.applyTemplate(kullanici.id, sablon.id, "merge", undefined);
  const sonra = await prisma.userPermission.count({ where: { userId: kullanici.id } });
  say("demo hesabına eklenen izin", sonra - once);
  console.log(`   demo hesabı: ${once} → ${sonra} izin`);
}

/**
 * FİRMA KÜNYESİ — belge çıktılarının başlığı.
 *
 * ⚠️ Boş künye ile basılan irsaliye/fatura "antetsiz" çıkar ve demoyu gezen
 * kişi bunu ürünün eksikliği sanar. Ad NÖTR bir demo firmasıdır — gerçek bir
 * firmanın kimliğini taşıyan belge üretmek yanlış olurdu.
 */
export async function firmaKunyesiKur(): Promise<void> {
  adim("Firma künyesi (belge anteti)");
  // ⚠️ `systemSettingService.set` `userId` YOKSA 401 atar (`AppError.unauthorized`)
  // — ayar yazımı DAİMA bir aktöre bağlanır (audit izinin çıpası). Seed'in
  // aktörü admin hesabıdır.
  const aktor = await prisma.user.findFirst({
    where: { username: "admin" },
    select: { id: true },
  });
  if (!aktor) {
    not("`admin` kullanıcısı yok — firma künyesi yazılamaz (ayar yazımı aktör ister).");
    return;
  }
  try {
    await systemSettingService.setFeatureFlags(
      {
        companyName: "DEMOTEKS Tekstil San. ve Tic. A.Ş.",
        // ⚠️ Şema DAR: `addressLine` · `phone` · `taxInfo` · `extraLines[]`.
        // Serbest `line1..5` alanları sanitize'da SESSİZCE düşerdi.
        companyLetterhead: {
          addressLine: "Organize Sanayi Bölgesi 5. Cadde No: 42, Nilüfer / BURSA",
          phone: "0224 000 00 00",
          taxInfo: "Demo Vergi Dairesi · VKN 0000000000",
          extraLines: ["demo@demoteks.example", "www.demoteks.example"],
        },
      } as never,
      aktor.id,
    );
    say("firma künyesi");
  } catch (e) {
    not(`Firma künyesi yazılamadı: ${(e as Error).message}`);
  }
}
