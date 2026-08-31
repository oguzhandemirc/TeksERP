// =============================================================================
// Satırdaki kalemin TÜRÜ (FABRIC | YARN | CONSUMABLE) — form yüzeyi lookup'ı
// =============================================================================
// Mal kabul formunda satırın davranışı kalemin türüne bağlıdır: iplik satırı
// renk/en/kat/özellik TAŞIYAMAZ (backend `addYarnLine` 400 verir) ve miktarı
// KG'dir. `ReferenceSelect` yalnız id döndürür; tür buradan çözülür.
//
// ⚠️ Sorgu anahtarı BİLEREK `ReferenceSelect`'in seçili-kayıt anahtarıyla
// aynıdır (`["items", "ref-select-by-id", id]`, staleTime de eş) — aynı kalem
// için ikinci bir GET atılmaz, cache paylaşılır. Picker-list (`loadAllForPicker`)
// KULLANILMAZ: o yol 500 kayıt sınırında fırlatır ve büyük katalogda tür
// haritası sessizce boş kalırdı; fişte tipik olarak ≤20 ayrı kalem vardır.
//
// ⚠️ TÜR ÇÖZÜLENE KADAR SATIR "KUMAŞ" SAYILIR (fail-open): yanlış tarafta
// kalınsa bile backend guard'ı anlamlı 400 döner — bu yolda SESSİZ yanlış
// yazım imkânsızdır; ekran yalnız kısa süreliğine kumaş hücrelerini gösterir.
import { useQueries } from "@tanstack/react-query";
import { itemService } from "@/pages/Items/service";
import type { ItemType } from "@/types/enums";

/** Verilen kalem id'leri için `id → ItemType` haritası. Harita kimliği her
 *  render'da değişebilir — memo bağımlılığına KOYMA, içeriği ucuzdur. */
export function useItemTypes(itemIds: Array<string | null | undefined>): Map<string, ItemType> {
  const ids = [...new Set(itemIds.filter((x): x is string => Boolean(x)))].sort();
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["items", "ref-select-by-id", id],
      queryFn: () => itemService.getById(id),
      staleTime: 5 * 60_000,
    })),
  });
  const map = new Map<string, ItemType>();
  queries.forEach((q, i) => {
    const t = q.data?.data?.itemType;
    const id = ids[i];
    if (t && id) map.set(id, t);
  });
  return map;
}

/** Haritadan İPLİK kalem id kümesi — `receiptTotals`/`expandLines` sözleşmesi. */
export function yarnIdsFrom(types: Map<string, ItemType>): Set<string> {
  const s = new Set<string>();
  for (const [id, t] of types) if (t === "YARN") s.add(id);
  return s;
}
