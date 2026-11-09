// =============================================================================
// GELEN BELGE → İŞ EMRİ FORMU: okuma özetinin `formFields` + `suggestions` alanları (K30 S16a, salt okunur)
// =============================================================================
// `gelenBelge.desenRenkEslesme=ONER` (varsayılan; KAPALI açıkça seçilmediyse) iken okunan desen/renk yazısına öğrenilmiş eşleme ya da adı (katlanmış, `nameFold`)/kodu BİREBİR tutan
// TEK canlı kayıt önerilir — benzerlik/bulanık arama YOK (yanlış öneri işi yavaşlatır); iki aday → öneri yok. Öneri yazmaz,
// görevli formda onaylar. Ürün yalnız top doğurabilen türden (`ROLL_BEARING_ITEM_TYPES`) ve aktif/birleşmemiş olur.
// =============================================================================
import prisma from "../lib/prisma";
import { foldSearchText } from "../utils/search-fold";
import { formFieldsFromRegion, type FormFields } from "../lib/gelen-belge/form-alanlari";
import { readFirstRegion } from "./gelen-belge-parti-metre.service";
import { guardKgFields } from "../lib/gelen-belge/kg-koruma";
import { itemProblem, ROLL_BEARING_ITEM_TYPES } from "./gelen-belge-ayar.service";
import { readDesenRenkEslesme } from "./system-setting.service";
import type { TrustMode } from "./gelen-belge-parti-metre.service";
import { aliasTarget } from "./gelen-belge-eslestirme.service";

export interface FormSuggestions {
  targetItem?: { id: string; name: string; code: string };
  targetColor?: { id: string; name: string };
}

/**
 * Belgenin gelen kumaş/renk BEYANI (2026-11-09) — İE hedefinden AYRI alanlar: `itemText`/`colorText` müşterinin yazdığı
 * (gelen metre gibi), `suggestedItem`/`suggestedColor` beyanın eşlendiği kart (yalnız ONER kipinde; `suggestions` ile aynı
 * değer). Form açılışında boş hedefe öneri olur, sonra bağımsızdır. Beyan yoksa blok yok.
 */
export interface IncomingDeclared {
  itemText: string | null;
  colorText: string | null;
  suggestedItem: { id: string; name: string; code: string } | null;
  suggestedColor: { id: string; name: string } | null;
}

/** Öğrenilmiş eşleme (`DeliveryNoteAlias`, gönderene özel önce) → kod (tekil) → katlanmış ad; tam bir canlı kayıt değilse undefined. */
async function matchItem(raw: string, senderCustomerId: string | null): Promise<FormSuggestions["targetItem"]> {
  const live = { isActive: true, mergedIntoId: null, itemType: { in: [...ROLL_BEARING_ITEM_TYPES] } };
  const select = { id: true, name: true, code: true } as const;
  const learned = await aliasTarget("ITEM", senderCustomerId, raw);
  const byAlias = learned ? await prisma.item.findFirst({ where: { ...live, id: learned }, select }) : null;
  if (byAlias) return byAlias;
  const byCode = await prisma.item.findMany({ where: { ...live, code: { equals: raw, mode: "insensitive" } }, select, take: 2 });
  if (byCode.length === 1) return byCode[0];
  const fold = foldSearchText(raw);
  if (!fold) return undefined;
  const byName = await prisma.item.findMany({ where: { ...live, nameFold: fold }, select, take: 2 });
  return byName.length === 1 ? byName[0] : undefined;
}

async function matchColor(raw: string, senderCustomerId: string | null): Promise<FormSuggestions["targetColor"]> {
  const live = { isActive: true, mergedIntoId: null };
  const select = { id: true, name: true } as const;
  const learned = await aliasTarget("COLOR", senderCustomerId, raw);
  const byAlias = learned ? await prisma.color.findFirst({ where: { ...live, id: learned }, select }) : null;
  if (byAlias) return byAlias;
  const byCode = await prisma.color.findMany({ where: { ...live, code: { equals: raw, mode: "insensitive" } }, select, take: 2 });
  if (byCode.length === 1) return byCode[0];
  const fold = foldSearchText(raw);
  if (!fold) return undefined;
  const byName = await prisma.color.findMany({ where: { ...live, nameFold: fold }, select, take: 2 });
  return byName.length === 1 ? byName[0] : undefined;
}

/** Okuma özetine eklenen form alanları + (ONER kipinde) kayıt önerileri. Eski tablet alanları yok sayar. */
export async function noteFormFields(noteId: string, trust: TrustMode = "NORMAL"): Promise<{ formFields: FormFields; suggestions: FormSuggestions; incomingDeclared?: IncomingDeclared }> {
  // K30-B BLIND (SORMA + tanıtılmamış): GENEL sözlük tahmini forma dolmaz.
  if (trust === "BLIND") return { formFields: {}, suggestions: {} };
  const mode = await readDesenRenkEslesme();
  const region = await readFirstRegion(prisma, noteId);
  // Metre hücresinden okunan kg (hedef/gelen) forma dolmaz; uyarıyı okuma özeti verir (`noteIncomingKg.kgFromMeterCell`).
  const formFields = formFieldsFromRegion(guardKgFields(region).fields, mode);
  const suggestions: FormSuggestions = {};
  if (mode === "ONER" && (formFields.desenText || formFields.renkText)) {
    const sender = (await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { senderCustomerId: true } }))?.senderCustomerId ?? null;
    const item = formFields.desenText ? await matchItem(formFields.desenText, sender) : undefined;
    const color = formFields.renkText ? await matchColor(formFields.renkText, sender) : undefined;
    // Önerilen ürün form ucunun kapısından (`itemProblem`) geçmeli — geçmeyeni önermek kayıtta 400'e götürürdü.
    if (item && !(await itemProblem(item.id)).problem) suggestions.targetItem = item;
    if (color) suggestions.targetColor = color;
  }
  if (!formFields.desenText && !formFields.renkText) return { formFields, suggestions };
  const incomingDeclared: IncomingDeclared = {
    itemText: formFields.desenText ?? null, colorText: formFields.renkText ?? null,
    suggestedItem: suggestions.targetItem ?? null, suggestedColor: suggestions.targetColor ?? null,
  };
  return { formFields, suggestions, incomingDeclared };
}
