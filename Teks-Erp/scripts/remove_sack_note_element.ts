// =============================================================================
// ÇUVAL ETİKETİNDEN İÇ NOT ALANINI KALDIR (`sackNote`)
// =============================================================================
// Çalıştırma:  npx tsx scripts/remove_sack_note_element.ts            (DRY-RUN)
//              npx tsx scripts/remove_sack_note_element.ts --apply
//
// NEDEN (2026-08-14 denetim bulgusu): `Sack.notes` çuvalın **İÇ** serbest
// notudur — "kendimiz için" yazılır (kök CLAUDE.md 2026-07-30 notu). Kurulumun
// SACK bağlam varsayılanı şablonuna stüdyodan bir `sackNote` alanı sürüklenmiş
// ve o alan MÜŞTERİYE GİDEN fiziksel çuval etiketine basılıyor.
//
// ⚠️ BU BİR KOD HATASI DEĞİLDİ. Kök CLAUDE.md'ye göre alanın gösterimi
// "OPSİYONEL + varsayılan KAPALI"dır ve stüdyodan sürüklemek onu AÇMANIN
// kanonik yoludur — yani veri, özelliği tasarlandığı gibi kullanıyordu.
// Bekçi (`scripts/test_sack_label.ts` "0)") tam da bu soruyu sordurmak için
// yazılmıştı ("bir kurulum bunu bilerek eklerse test kırılır ve gerekçe
// sorulur"); soru soruldu ve KULLANICI KALDIRILMASINA KARAR VERDİ (2026-08-14).
//
// ⚠️ BASILMIŞ ETİKETLER DEĞİŞMEZ ve `labelDirty` İŞARETLENMEZ. Bu bilinçli:
// projenin yazılı asimetrisi "şablon düzenlemesi kaydı bayat İŞARETLEMEZ"
// (refakat kartı `contentDirty` notundaki aynı ayrım). Elde dolaşan eski
// etiketlerde not kalır; yenileri basmaz.
//
// KAPSAM: yalnız `LabelKind.SACK` şablonlarının varyantlarındaki
// `elements.elements[]` dizisinden `bind === "sackNote"` olan elemanlar. Başka
// hiçbir alan, başka hiçbir kind, hiçbir `Sack.notes` VERİSİ silinmez — not
// alanı ekranlarda ve iç kayıtta AYNEN kalır, yalnız KÂĞIDA basılmaz.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";

const APPLY = process.argv.includes("--apply");

interface Element {
  id?: string;
  bind?: string;
  type?: string;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  console.log(`=== Çuval etiketinden iç not (sackNote) kaldırma — ${APPLY ? "UYGULA" : "DRY-RUN"} ===\n`);

  const variants = await prisma.labelTemplateVariant.findMany({
    where: { template: { kind: "SACK" } },
    select: {
      id: true,
      name: true,
      elements: true,
      template: { select: { id: true, name: true, isActive: true, isDefault: true } },
    },
  });

  console.log(`SACK varyantı taranıyor: ${variants.length}\n`);

  let touched = 0;
  for (const v of variants) {
    const blob = (v.elements ?? {}) as { v?: unknown; elements?: Element[] };
    const list = Array.isArray(blob.elements) ? blob.elements : [];
    const hits = list.filter((e) => e.bind === "sackNote");

    if (hits.length === 0) {
      console.log(`  ✓ ${v.template.name} / ${v.name} — sackNote YOK (dokunulmadı)`);
      continue;
    }

    // ⚠️ ETKİLENEN HER KAYIT SOMUT LİSTELENİR (kök CLAUDE.md: "Toplu veri
    // düzeltmesi yapan script dry-run varsayılan olur ve `--apply` öncesi
    // etkilenecek her kaydı somut listeler"). "N kayıt etkilenecek" YETMEZ.
    console.log(`  ⚠️ ${v.template.name} / ${v.name}`);
    console.log(`     şablon=${v.template.id}  varyant=${v.id}`);
    console.log(`     eleman ${list.length} → ${list.length - hits.length}`);
    for (const h of hits) {
      console.log(`     KALDIRILACAK: id=${h.id} bind=${h.bind} x=${String(h.x)} y=${String(h.y)}`);
    }
    console.log(`     KALACAK: ${list.filter((e) => e.bind !== "sackNote").map((e) => e.bind ?? e.type).join(", ")}`);

    if (!APPLY) {
      touched++;
      continue;
    }

    // ⚠️ ÜST SEVİYE ANAHTARLAR KORUNUR (`v` = şema sürümü). Yalnız `elements`
    // dizisi süzülür; blob'u baştan kurmak sürüm alanını düşürür ve renderer
    // bilinmeyen bir şekil görür.
    const next = { ...blob, elements: list.filter((e) => e.bind !== "sackNote") };
    // ⚠️ Cast ZORUNLU: Prisma'nın `InputJsonValue` tipi indeks imzalı bir nesne
    // bekler; bizim `Element[]` şeklimiz ona atanamaz. `tsx` tip kontrolü
    // YAPMAZ, yani bu satır cast'siz de KOŞAR — ama `npm test`'in tip geçidi
    // (`tsconfig.scripts.json`) onu düşürür. İlk yazımda tam bu oldu.
    await prisma.labelTemplateVariant.update({
      where: { id: v.id },
      data: { elements: next as unknown as Prisma.InputJsonValue },
    });

    await AuditService.log({
      userId: undefined,
      action: "UPDATE",
      tableName: "LABEL_TEMPLATE_VARIANT",
      recordId: v.id,
      oldData: { elements: list.map((e) => e.bind ?? e.type) },
      newData: {
        elements: next.elements.map((e) => e.bind ?? e.type),
        reason: "İç not (sackNote) müşteriye giden çuval etiketinden kaldırıldı — kullanıcı kararı 2026-08-14",
      },
    });

    console.log(`     ✅ uygulandı`);
    touched++;
  }

  console.log(`\n${touched} varyant ${APPLY ? "GÜNCELLENDİ" : "etkilenecek"}.`);
  if (!APPLY && touched > 0) {
    console.log("Uygulamak için: npx tsx scripts/remove_sack_note_element.ts --apply");
  }
  if (APPLY) {
    console.log("\nDoğrulama: npx tsx scripts/test_sack_label.ts   (\"0)\" kontrolü yeşile dönmeli)");
  }

  await prisma.$disconnect();
  await pool.end();
}

void main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
