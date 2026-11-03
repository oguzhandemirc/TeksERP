// =============================================================================
// GELEN BELGE → İŞ EMRİ FORMU: okuma özetinin `formFields` + `suggestions` alanları (K30 S16a, salt okunur)
// =============================================================================
// `gelenBelge.desenRenkEslesme=ONER` iken okunan desen/renk yazısına adı (katlanmış, `nameFold`) ya da kodu BİREBİR tutan
// TEK canlı kayıt önerilir — benzerlik/bulanık arama YOK (yanlış öneri işi yavaşlatır); iki aday → öneri yok. Öneri yazmaz,
// görevli formda onaylar. Ürün yalnız top doğurabilen türden (`ROLL_BEARING_ITEM_TYPES`) ve aktif/birleşmemiş olur.
// =============================================================================
import prisma from "../lib/prisma";
import { foldSearchText } from "../utils/search-fold";
import { formFieldsFromRegion, type FormFields } from "../lib/gelen-belge/form-alanlari";
import { readFirstRegion } from "./gelen-belge-parti-metre.service";
import { itemProblem, ROLL_BEARING_ITEM_TYPES } from "./gelen-belge-ayar.service";
import { readDesenRenkEslesme } from "./system-setting.service";

export interface FormSuggestions {
  targetItem?: { id: string; name: string; code: string };
  targetColor?: { id: string; name: string };
}

/** Kod önce (tekil), sonra katlanmış ad; tam bir canlı kayıt değilse undefined. */
async function matchItem(raw: string): Promise<FormSuggestions["targetItem"]> {
  const live = { isActive: true, mergedIntoId: null, itemType: { in: [...ROLL_BEARING_ITEM_TYPES] } };
  const select = { id: true, name: true, code: true } as const;
  const byCode = await prisma.item.findMany({ where: { ...live, code: { equals: raw, mode: "insensitive" } }, select, take: 2 });
  if (byCode.length === 1) return byCode[0];
  const fold = foldSearchText(raw);
  if (!fold) return undefined;
  const byName = await prisma.item.findMany({ where: { ...live, nameFold: fold }, select, take: 2 });
  return byName.length === 1 ? byName[0] : undefined;
}

async function matchColor(raw: string): Promise<FormSuggestions["targetColor"]> {
  const live = { isActive: true, mergedIntoId: null };
  const select = { id: true, name: true } as const;
  const byCode = await prisma.color.findMany({ where: { ...live, code: { equals: raw, mode: "insensitive" } }, select, take: 2 });
  if (byCode.length === 1) return byCode[0];
  const fold = foldSearchText(raw);
  if (!fold) return undefined;
  const byName = await prisma.color.findMany({ where: { ...live, nameFold: fold }, select, take: 2 });
  return byName.length === 1 ? byName[0] : undefined;
}

/** Okuma özetine eklenen form alanları + (ONER kipinde) kayıt önerileri. Eski tablet alanları yok sayar. */
export async function noteFormFields(noteId: string): Promise<{ formFields: FormFields; suggestions: FormSuggestions }> {
  const mode = await readDesenRenkEslesme();
  const region = await readFirstRegion(prisma, noteId);
  const formFields = formFieldsFromRegion(region?.fields, mode);
  const suggestions: FormSuggestions = {};
  if (mode === "ONER") {
    const item = formFields.desenText ? await matchItem(formFields.desenText) : undefined;
    const color = formFields.renkText ? await matchColor(formFields.renkText) : undefined;
    // Önerilen ürün form ucunun kapısından (`itemProblem`) geçmeli — geçmeyeni önermek kayıtta 400'e götürürdü.
    if (item && !(await itemProblem(item.id)).problem) suggestions.targetItem = item;
    if (color) suggestions.targetColor = color;
  }
  return { formFields, suggestions };
}
