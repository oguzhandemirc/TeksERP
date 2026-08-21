// =============================================================================
// BEKÇİ — Etiket ÖNİZLEMESİ her zaman TEK kopya (2026-08-17)
// Çalıştır: npx tsx scripts/test_label_preview_single_copy.ts
// =============================================================================
// Saha geri bildirimi: "çıktı 2 tane ise o etiketi 2 kez gösteriyoruz".
//
// Kopya adedi bir ÇIKTI kararıdır (`label.copies`, varsayılan 2), içerik kararı
// değil. Önizleme onu devralınca aynı etiket ekranda alt alta tekrarlanıyor;
// operatörün kontrol edeceği YENİ bir bilgi yok, yalnız kaydırma yükü var.
//
// ⚠️ Raster dalı bunu zaten `copies: 1` ile yapıyordu; HTML ve komut dalları
// devralmaya devam ediyordu. Bu testin işi, düzeltmenin ÜÇ dalda birden
// geçerli kalmasını sağlamak — biri regresyona uğrarsa sessizce geri döner
// (ekranda iki etiket, hata yok, log yok).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { InventoryService } from "../src/services/inventory.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const labelSvc = new LabelService();
  const invSvc = new InventoryService();
  const rollIds: string[] = [];
  let itemId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-LBLPRV-${ts}`, name: `TEST LABEL PREVIEW ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;

    const created = await invSvc.createInitialEntry({ itemId, initialQty: 120 });
    const roll = created.data as { id: string; barcode: string | null };
    rollIds.push(roll.id);
    check("fixture topu oluştu (barkodlu)", Boolean(roll.barcode), roll.barcode ?? "barkod yok");

    // Ayarı ÇOKLU kopyaya çek — fixture ayırt edici olmazsa test vakumen yeşil
    // kalır ("1 kopya bulundu" ama zaten 1 isteniyordu).
    const prevRow = await prisma.systemSetting.findUnique({ where: { key: "label.copies" } });
    await prisma.systemSetting.upsert({
      where: { key: "label.copies" },
      create: { key: "label.copies", value: 3, description: "test — önizleme kopya bekçisi" },
      update: { value: 3 },
    });
    // ⚠️ Ham satırdan oku — `SystemSettingService.get` bir ApiResponse zarfı
    // döndürür, değeri değil; zarfı String()'lemek "[object Object]" verir ve
    // kontrol HER ZAMAN kırmızı kalırdı.
    const effective = (await prisma.systemSetting.findUnique({ where: { key: "label.copies" } }))?.value;
    check("ayar çoklu kopyaya çekildi (fixture ayırt edici)", String(effective) === "3", String(effective));

    const res = await labelSvc.getRollPreview(roll.id);
    const { mode, content } = res.data;
    check(`önizleme üretildi (mod: ${mode})`, typeof content === "string" && content.length > 0);

    // `applyCopies` çoklu kopyada her bloğu `page-break-after: always` ile
    // sarar — tek kopyada o sarmalayıcı HİÇ üretilmez. En doğrudan parmak izi.
    const pageBreaks = (content.match(/page-break-after/g) ?? []).length;
    check("önizlemede sayfa-sonu sarmalayıcı YOK (tek kopya)", pageBreaks === 0, `bulunan: ${pageBreaks}`);

    // İkinci parmak izi: barkod metni önizlemede birden çok kez geçmemeli.
    // (Bazı dillerde barkod görsel olarak gömülüdür; o durumda kontrol atlanır.)
    if (roll.barcode && content.includes(roll.barcode)) {
      const occurrences = content.split(roll.barcode).length - 1;
      check(
        "barkod önizlemede tekrarlanmıyor",
        occurrences <= 2, // metin + görsel alt yazısı olabilir; 3+ = kopya
        `geçiş sayısı: ${occurrences}`,
      );
    } else {
      console.log("   ℹ️  Barkod metni önizlemede gömülü değil — 2. parmak izi atlandı.");
    }

    // Ayarı geri al (paylaşımlı dev DB — bırakılan ayar sonraki koşumları etkiler).
    if (prevRow) {
      await prisma.systemSetting.update({
        where: { key: "label.copies" },
        data: { value: prevRow.value as never },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: "label.copies" } });
    }
    const restoredRow = await prisma.systemSetting.findUnique({ where: { key: "label.copies" } });
    const restored = restoredRow ? String(restoredRow.value) : "—";
    const expected = prevRow ? String(prevRow.value) : "—";
    check("ayar geri alındı", restored === expected, `${restored} (beklenen ${expected})`);
  } finally {
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
