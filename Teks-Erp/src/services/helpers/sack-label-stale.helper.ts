// =============================================================================
// ÇUVAL ETİKETİ — "bu alan etkin şablonda basılıyor mu?" (labelDirty ön koşulu)
// =============================================================================
// `sackNote` için `ShippingService.sackNoteAppearsOnLabel` olarak doğdu; sevk
// partisi (`packageNo` · `packingGroupName`) aynı soruyu sorunca alan-parametreli
// tek helper'a çıktı. İki servis de (shipping · packing-group) buradan geçer —
// packing-group.service shipping.service'i import EDEMEZ (döngü: shipping, parti
// kancalarını ondan alır).
//
// Şablon zinciri `markSackLabelsStaleOnCustomerChange` ile AYNI:
// `CustomerTemplateRoute(müşteri, SACK)` ?? bağlam varsayılanı (`LabelContextDefault`).
// Cihaz (peripheral) rotası BİLEREK dışarıda — düzenleme anında hangi yazıcıya
// basılacağı bilinmez; tahmin etmek yanlış şablona bakıp sessizce yanlış cevap
// vermek olurdu.
//
// FAIL-OPEN'IN TERSİ: şablon çözülemezse (atama yok / pasif / silinmiş) `false` —
// basılacak bir düzen yoksa bayatlayacak kâğıt da yoktur. Çuval etiketi
// BASKISININ fail-closed davranışıyla (şablon yoksa 400) çelişmez: orada soru
// "basayım mı", burada "basılmışı yalanladım mı".
//
// Koşullu (`showIf`) eleman SAYILMAZ — `collectBoundKeys` sözleşmesi: o küme
// "her baskıda çıkan alanlar"dır.
// =============================================================================
import { LabelKind, Prisma } from "@prisma/client";

import prisma from "../../lib/prisma";
import { collectBoundKeys } from "./label-context-fit";

export async function sackFieldsAppearOnLabel(
  customerId: string | null,
  keys: readonly string[],
): Promise<boolean> {
  const select = {
    name: true,
    rawCode: true,
    isActive: true,
    deletedAt: true,
    variants: { select: { elements: true } },
  } as const;
  type Tpl = { name: string; rawCode: Prisma.JsonValue | null; isActive: boolean; deletedAt: Date | null; variants: { elements: Prisma.JsonValue }[] };
  const usable = (t: Tpl | null | undefined): Tpl | null =>
    t && t.isActive && t.deletedAt == null ? t : null;

  let tpl: Tpl | null = null;
  if (customerId) {
    const route = await prisma.customerTemplateRoute.findUnique({
      where: { customerId_kind: { customerId, kind: LabelKind.SACK } },
      select: { template: { select } },
    });
    tpl = usable(route?.template);
  }
  if (!tpl) {
    const def = await prisma.labelContextDefault.findUnique({
      where: { kind: LabelKind.SACK },
      select: { template: { select } },
    });
    tpl = usable(def?.template);
  }
  if (!tpl) return false;

  const bound = collectBoundKeys({ name: tpl.name, variants: tpl.variants });
  if (keys.some((k) => bound.has(k))) return true;
  // Uzman raw-code override: kanvas hiç çizilmez, `{{alan}}` yer tutucusu
  // doldurulur (`label-rawcode`). Dil bilinmediği için TÜM diller taranır.
  const raw = tpl.rawCode;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const v of Object.values(raw)) {
      if (typeof v === "string" && keys.some((k) => v.includes(k))) return true;
    }
  }
  return false;
}
