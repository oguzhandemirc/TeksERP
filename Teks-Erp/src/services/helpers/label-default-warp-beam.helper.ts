// =============================================================================
// Varsayılan LEVENT etiket şablonu — ihtiyaç anında kurulum (devere-levent S5)
// =============================================================================
// Levent etiketi FAIL-CLOSED: bağlam varsayılanı yoksa 400 `LABEL_TEMPLATE_MISSING`. Seed üretimde koşmadığı için
// kurulumlar (Seyitoğlu) şablonsuz kalıyordu. Bağlam varsayılanı SATIRI HİÇ YOKSA standart şablon + kanvas varyantı +
// bağlam varsayılanı tek tx'te doğar. Satır varsa (pasif şablona işaret etse bile) DOKUNULMAZ: o kullanıcının kararıdır.
// Yarış: `label_context_defaults.kind @unique` — ikinci yazar P2002 alır, tx'i geri döner (artık şablon kalmaz).
// =============================================================================
import { LabelKind, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { buildDefaultFields } from "../../config/label-fields";
import { AuditService } from "../audit.service";

export const DEFAULT_WARP_BEAM_TEMPLATE_NAME = "Standart Levent Etiketi";

/** Kanvas (100×70): barkod + QR = levent no; gövde no / çözgü / kumaş / metre / sarım tarihi. Her elemanda `id` zorunlu. */
const WARP_BEAM_CANVAS = {
  v: 1,
  elements: [
    { id: "code128-lv1", type: "code128", x: 5, y: 5, wMm: 62, hMm: 16 },
    { id: "qr-lv2", type: "qr", x: 72, y: 5, wMm: 22, hMm: 22 },
    { id: "field-lv3", type: "field", x: 5, y: 26, bind: "beamNo", label: "Levent No", bold: true },
    { id: "field-lv4", type: "field", x: 5, y: 34, bind: "bodyNo", label: "Gövde" },
    { id: "field-lv5", type: "field", x: 5, y: 42, bind: "warpSpecName", label: "Çözgü" },
    { id: "field-lv6", type: "field", x: 5, y: 50, bind: "itemName", label: "Kumaş" },
    { id: "field-lv7", type: "field", x: 5, y: 58, bind: "woundLengthM", label: "Metre" },
    { id: "field-lv8", type: "field", x: 45, y: 58, bind: "woundAt", label: "Sarım" },
  ],
};

/** Bağlam varsayılanı yoksa kurar; kurduysa true. Başka yazar aynı anda kurduysa false (çağıran yeniden çözer). */
export async function ensureDefaultWarpBeamLabelTemplate(userId?: string): Promise<boolean> {
  const existing = await prisma.labelContextDefault.findUnique({ where: { kind: LabelKind.WARP_BEAM }, select: { id: true } });
  if (existing) return false;
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Kind başına tek isDefault (kısmi unique) — `writeContextDefaultTx` ile aynı sıra: eskiyi düşür, yeniyi yaz.
      await tx.labelTemplate.updateMany({ where: { kind: LabelKind.WARP_BEAM, isDefault: true }, data: { isDefault: false } });
      // Ad tekil: aynı adlı kullanılabilir levent şablonu varsa (eski otomatik kurulum, bağlamı sonradan kaldırılmış) o atanır.
      const same = await tx.labelTemplate.findFirst({
        where: { name: DEFAULT_WARP_BEAM_TEMPLATE_NAME, kind: LabelKind.WARP_BEAM, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      });
      if (same) {
        await tx.labelTemplate.update({ where: { id: same.id }, data: { isDefault: true } });
        const def = await tx.labelContextDefault.create({ data: { kind: LabelKind.WARP_BEAM, templateId: same.id }, select: { templateId: true } });
        return { tpl: same, def, reused: true };
      }
      const tpl = await tx.labelTemplate.create({
        data: {
          // isDefault: v2 geçişinin çift-yazımı (`writeContextDefaultTx` ile aynı sözleşme).
          name: DEFAULT_WARP_BEAM_TEMPLATE_NAME, kind: LabelKind.WARP_BEAM, isDefault: true,
          fields: buildDefaultFields(LabelKind.WARP_BEAM) as unknown as Prisma.InputJsonValue,
          variants: { create: { name: "100x70", widthMm: 100, heightMm: 70, isPrimary: true, elements: WARP_BEAM_CANVAS } },
        },
        select: { id: true, name: true },
      });
      // `create` (upsert değil): eşzamanlı ikinci yazar P2002 alır, kendi şablonu tx ile geri döner.
      const def = await tx.labelContextDefault.create({ data: { kind: LabelKind.WARP_BEAM, templateId: tpl.id }, select: { templateId: true } });
      return { tpl, def, reused: false };
    });
    // Tablo adı `label-template.service` ile aynı (`LABEL_TEMPLATE`; bağlam varsayılanı kayıt kimliği = kind).
    void AuditService.logMany([
      ...(created.reused ? [] : [{ userId, action: "CREATE" as const, tableName: "LABEL_TEMPLATE", recordId: created.tpl.id, newData: { name: created.tpl.name, kind: LabelKind.WARP_BEAM, source: "AUTO_DEFAULT" } }]),
      { userId, action: "UPDATE", tableName: "LABEL_TEMPLATE", recordId: LabelKind.WARP_BEAM, newData: { event: "SET_CONTEXT_DEFAULT", kind: LabelKind.WARP_BEAM, templateId: created.def.templateId } },
    ]);
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}
