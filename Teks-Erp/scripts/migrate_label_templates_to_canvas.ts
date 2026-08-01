// =============================================================================
// Etiket Stüdyosu migration: akış-modeli şablonlar → kanvas boyut varyantı
// =============================================================================
// Her aktif, kind'lı, HENÜZ VARYANTI OLMAYAN şablon için: kind'ın çözülen format
// geometrisi boyutunda TEK isPrimary varyant yaratır; elemanlar mevcut üretici
// iskeletinden koordinatlara yakılır (label-flow-to-canvas). IDEMPOTENT — varyantı
// olan şablon atlanır. Geri dönüş: varyant satırını sil → şablon akış yoluna döner
// (dual-mode), kod değişikliği gerekmez.
//
// Çalıştır: npx tsx scripts/migrate_label_templates_to_canvas.ts [--dry-run] [--only=<templateId>]
// =============================================================================
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { flowTemplateToCanvas } from "../src/services/helpers/label-flow-to-canvas";
import { validateCanvasLayout } from "../src/config/label-elements";
import type { TemplateField } from "../src/config/label-fields";
import { Prisma } from "@prisma/client";

const DRY = process.argv.includes("--dry-run");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;

async function main() {
  const templates = await prisma.labelTemplate.findMany({
    where: {
      deletedAt: null,
      kind: { not: null },
      ...(ONLY ? { id: ONLY } : {}),
    },
    include: { variants: { select: { id: true } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  console.log(`${templates.length} şablon bulundu${DRY ? " (dry-run)" : ""}.`);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of templates) {
    const tag = `[${t.kind}] ${t.name}`;
    if (t.variants.length > 0) {
      skipped++;
      console.log(`↷ ${tag} — zaten ${t.variants.length} varyantı var, atlandı (idempotent)`);
      continue;
    }
    try {
      const format = await resolveLabelFormat({ kind: t.kind! });
      const layout = flowTemplateToCanvas(
        {
          kind: t.kind!,
          fields: (t.fields as unknown as TemplateField[]) ?? [],
          lineStepMm: t.lineStepMm != null ? Number(t.lineStepMm) : null,
          qrScale: t.qrScale,
          lengthBanner: t.lengthBanner,
        },
        format,
      );
      // Yapısal doğrulama — bozuk dönüşüm varyant olarak yazılMAsın (dual-mode korunur).
      validateCanvasLayout(layout, { widthMm: format.widthMm, heightMm: format.heightMm });

      const name = `${format.widthMm}×${format.heightMm} Standart`;
      if (DRY) {
        console.log(
          `→ ${tag} — ${name}: ${layout.elements.length} eleman ` +
            `(${layout.elements.map((e) => e.type).join(", ")})`,
        );
      } else {
        const variant = await prisma.labelTemplateVariant.create({
          data: {
            templateId: t.id,
            name: name.slice(0, 60),
            widthMm: format.widthMm,
            heightMm: format.heightMm,
            isPrimary: true,
            elements: layout as unknown as Prisma.InputJsonValue,
          },
        });
        await AuditService.log({
          // `userId` imzada ZORUNLU (`string | undefined`) — atlanınca derlenmiyordu.
          // Bu bir bakım script'i, arkasında kullanıcı yok → açıkça `undefined`
          // (AuditService bunu `userId: null` olarak yazar: "sistem yaptı").
          userId: undefined,
          action: "CREATE",
          tableName: "LABEL_TEMPLATE_VARIANT",
          recordId: variant.id,
          newData: {
            templateId: t.id,
            templateName: t.name,
            name: variant.name,
            elementCount: layout.elements.length,
            event: "FLOW_TO_CANVAS_MIGRATION",
          },
        }).catch(() => undefined);
        console.log(`✓ ${tag} — ${name} varyantı yaratıldı (${layout.elements.length} eleman)`);
      }
      created++;
    } catch (e) {
      failed++;
      console.error(`✗ ${tag} — DÖNÜŞMEDİ (akış yolunda kalır): ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `\n=== ${DRY ? "DRY-RUN " : ""}Özet: ${created} dönüştü, ${skipped} atlandı, ${failed} başarısız ===`,
  );
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
