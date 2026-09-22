// =============================================================================
// ÇUVAL ETİKETİ — "bu alan etkin şablonda basılıyor mu?" (labelDirty ön koşulu)
// =============================================================================
// `sackNote` için `ShippingService.sackNoteAppearsOnLabel` olarak doğdu; sevk
// partisi (`packageNo` · `packingGroupName`) aynı soruyu sorunca alan-parametreli
// tek helper'a çıktı. İki servis de (shipping · packing-group) buradan geçer —
// packing-group.service shipping.service'i import EDEMEZ (döngü: shipping, parti
// kancalarını ondan alır).
//
// Şablon zinciri `markSackLabelsStaleOnCustomerChangeTx` ile AYNI:
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

/**
 * Müşteri değişiminde ÇUVALIN ve İÇİNDEKİ TOPLARIN etiketini "bayat" işaretler —
 * YALNIZ etkin şablon değişiyorsa. Döner: işaretlenen top adedi (çuvalın kendi
 * bayrağı `Sack.labelDirty` ayrıca yazılır).
 *
 * Etkin şablon = `CustomerTemplateRoute(müşteri, kind)` ?? bağlam varsayılanı.
 * Top kind'ı renginden türer (renksiz → ROLL_RAW, renkli → ROLL_FINISHED,
 * `label-routing.resolver` ile aynı kural); ÇUVAL için kind = SACK.
 * Eski ve yeni müşterinin rotası aynı şablona çıkıyorsa (çoğu kurulumda ikisi de
 * rotasız) HİÇBİR ŞEY yapılmaz — gereksiz "yeniden bas" uyarısı operatörü körleştirir.
 *
 * SACK dalı 2026-07-30'da eklendi: çuval etiketinin müşteri rotası o tarihte
 * canlandırıldı (öncesinde `buildSackRenderInput` `customerId` geçirmiyordu →
 * rota ölüydü, dolayısıyla çuval etiketi müşteri değişiminden ETKİLENMİYORDU).
 */
export async function markSackLabelsStaleOnCustomerChangeTx(
  /** ⚠️ tx ZORUNLU: müşteri claim'i ile AYNI transaction'da koşmalı (D1) — ayrı
   *  koşarsa claim commit olur ama bayatlama/audit kaybolabilir. */
  tx: Prisma.TransactionClient,
  sackId: string,
  oldCustomerId: string | null,
  newCustomerId: string | null,
): Promise<number> {
  const rolls = await tx.roll.findMany({
    where: { sackId },
    select: { id: true, colorId: true },
  });

  // ÇUVAL kind'ı her zaman sorgulanır (çuvalın kendi etiketi topların varlığından
  // BAĞIMSIZ — boş çuvalın da basılı etiketi olabilir), top kind'ları içerikten.
  const rollKinds = [
    ...new Set(rolls.map((r) => (r.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED))),
  ];
  const kinds = [...new Set([...rollKinds, LabelKind.SACK])];
  const routesFor = async (cid: string | null): Promise<Map<LabelKind, string>> => {
    if (!cid) return new Map();
    const rows = await tx.customerTemplateRoute.findMany({
      where: { customerId: cid, kind: { in: kinds } },
      select: { kind: true, templateId: true },
    });
    return new Map(rows.map((r) => [r.kind, r.templateId]));
  };
  // SIRALI await (tx client'ta Promise.all YASAK — pg adapter tek connection).
  const oldRoutes = await routesFor(oldCustomerId);
  const newRoutes = await routesFor(newCustomerId);

  // Şablonu DEĞİŞEN kind'lar (yok → bağlam varsayılanı; iki taraf da yok = değişmedi).
  const changed = new Set(kinds.filter((k) => (oldRoutes.get(k) ?? null) !== (newRoutes.get(k) ?? null)));
  if (changed.size === 0) return 0;

  // ÇUVALIN KENDİ etiketi — top sayısından bağımsız.
  if (changed.has(LabelKind.SACK)) {
    await tx.sack.updateMany({ where: { id: sackId, labelDirty: false }, data: { labelDirty: true } });
  }

  const affected = rolls
    .filter((r) => changed.has(r.colorId == null ? LabelKind.ROLL_RAW : LabelKind.ROLL_FINISHED))
    .map((r) => r.id);
  if (affected.length === 0) return 0;
  // Yalnız henüz işaretsizleri güncelle (count gerçek değişimi yansıtsın).
  return (
    await tx.roll.updateMany({
      where: { id: { in: affected }, labelDirty: false },
      data: { labelDirty: true },
    })
  ).count;
}
