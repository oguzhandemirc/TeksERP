// Sipariş içe aktarımı — satır VARYANTI + HEDEF DEĞER sütunları (SY-K3, tasarım §12.5.4).
//
// İki sütun da İSTEĞE BAĞLIDIR ve şablonun SONUNA eklenir: eski dosya (sütunlar yok) hiçbir ek sorgu
// atmaz, payload'a hiçbir alan koymaz → bugünkü sipariş bayt-aynı doğar.
// Varyant `(itemId, variantCode)` ile çözülür; çözülemeyen/belirsiz/pasif varyant SATIR HATASIDIR
// (sessiz desen geneli yok). Hedef değer biçimi `ÖZELLİK=DEĞER; …` (kodlar): panel eşlenmemiş başlığı
// düşürdüğü için tasarımdaki "özellik kodu başlıklı sütun" sabit şablona sığmaz — tek sütun seçildi.
// Doğrulama servisle AYNI kapıdan (`assertTargetValueItems`); uygula servis kapısını yine koşar.

import prisma from "../../../lib/prisma";
import { AppError } from "../../../utils/app-error";
import { upperTr } from "../../../utils/tr-case";
import { assertTargetValueItems, type TargetValueItem } from "../../helpers/workorder-target-value.helper";
import { splitList } from "../import-coerce";
import { resolveReference } from "../import-lookup";
import type { ImportColumn, ImportContext, ImportRowIssue } from "../import.types";

export const ORDER_LINE_EXTRA_COLUMNS: ImportColumn[] = [
  {
    key: "variantCode",
    label: "Varyant Kodu",
    type: "text",
    maxLen: 16,
    child: true,
    help: "Desenin varyant kodu (ör. V01) — kumaşın varyantları arasında aranır; bulunamazsa satır HATA verir. Boş = desen geneli.",
    example: "",
  },
  {
    key: "targetValueCodes",
    label: "Hedef Değerler",
    type: "text",
    maxLen: 500,
    child: true,
    help: "Çeşit özelliği KODU=değer KODU, noktalı virgülle (ör. KUSAK=ZEBRA). Boş = hedefsiz.",
    example: "",
  },
];

type ChildValues = Record<string, unknown>;
type Issue = { column: string; message: string };

/** Varyant hücresini satırın kumaşında çözer; sonuç `variantCode__id`. Hücre boşsa sorgu atılmaz. */
export async function resolveLineVariant(values: ChildValues): Promise<Issue | null> {
  const raw = values.variantCode;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const code = String(raw).trim();
  const itemId = values.itemCode__id;
  if (typeof itemId !== "string") return null; // kumaş hatası zaten yazıldı
  const hits = await prisma.productRecipe.findMany({
    where: { itemId, variantCode: { equals: code, mode: "insensitive" } },
    select: { id: true, isActive: true },
  });
  const fail = (message: string): Issue => ({ column: "variantCode", message });
  if (hits.length === 0) return fail(`'${code}' varyantı bu kumaşta yok.`);
  if (hits.length > 1) return fail(`'${code}' varyant kodu bu kumaşta birden fazla kayda uyuyor — panelden düzeltin.`);
  if (!hits[0]!.isActive) return fail(`'${code}' varyantı pasif; yeni siparişte seçilemez.`);
  values.variantCode__id = hits[0]!.id;
  return null;
}

/** `ÖZELLİK=DEĞER; …` hücresini çözer; sonuç `targetValueCodes__items`. Hücre boşsa sorgu atılmaz. */
export async function resolveLineTargetValues(values: ChildValues, ctx: ImportContext): Promise<ImportRowIssue[]> {
  const raw = values.targetValueCodes;
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  const issues: ImportRowIssue[] = [];
  const fail = (message: string) => issues.push({ column: "targetValueCodes", message });
  const items: TargetValueItem[] = [];
  for (const pair of splitList(String(raw))) {
    const eq = pair.indexOf("=");
    const propCode = eq > 0 ? pair.slice(0, eq).trim() : "";
    const valueCode = eq > 0 ? pair.slice(eq + 1).trim() : "";
    if (!propCode || !valueCode) {
      fail(`'${pair}' hedef değeri ÖZELLİK=DEĞER biçiminde olmalı.`);
      continue;
    }
    const prop = await resolveReference("fabricProperty", propCode, ctx);
    if (prop.error) issues.push({ column: "targetValueCodes", ...prop.error });
    const propertyId = prop.hit?.id;
    if (!propertyId) continue;
    const candidates = await prisma.fabricPropertyValue.findMany({
      where: { propertyId },
      select: { id: true, code: true, isActive: true },
    });
    const match = candidates.filter((c) => upperTr(c.code) === upperTr(valueCode));
    if (match.length === 0) {
      fail(`'${propCode}' özelliğinde '${valueCode}' değeri yok.`);
      continue;
    }
    if (match.length > 1) {
      fail(`'${propCode}=${valueCode}' birden fazla değere uyuyor — panelden düzeltin.`);
      continue;
    }
    if (!match[0]!.isActive) {
      fail(`'${propCode}=${valueCode}' değeri pasif.`);
      continue;
    }
    items.push({ propertyId, valueId: match[0]!.id });
  }
  if (issues.length > 0) return issues;
  try {
    await assertTargetValueItems(prisma, items);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    fail(e.message);
    return issues;
  }
  values.targetValueCodes__items = items;
  return issues;
}

/** Çözülmüş alanları satır gövdesine koyar; boşsa gövdeye dokunmaz (bugünkü payload bayt-aynı). */
export function applyLineExtras(values: ChildValues, line: Record<string, unknown>): void {
  if (typeof values.variantCode__id === "string") line.recipeId = values.variantCode__id;
  const items = values.targetValueCodes__items as TargetValueItem[] | undefined;
  if (items && items.length > 0) line.targetValues = items;
}
