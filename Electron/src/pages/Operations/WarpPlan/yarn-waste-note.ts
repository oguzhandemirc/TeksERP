// B6: "bu ipliğe hangi fire uygulandı" görünür metni. Karar SUNUCUDA (`resolveYarnWastePct`: iplik kartı firesi doluysa
// çözgü kartı firesinin YERİNE geçer); burada yalnız sunucunun döndüğü yüzde + kaynak cümleye çevrilir.
import { formatQty } from "@/lib/format";

/** Backend `YarnWasteSource` aynası: IPLIK = iplik kartı, KART = çözgü kartı fire zinciri. */
export type YarnWasteSourceCode = "IPLIK" | "KART";

const pct = (v: number | string) => `%${formatQty(v, 2, 0)}`;

/** Satır kaynağı etiketi; yüzde fire yoksa null (sütunda "—"). */
export function wasteSourceText(source: YarnWasteSourceCode | undefined, wastePct: number | string): "iplik kartı" | "çözgü kartı" | null {
  if (!source || Number(wastePct) <= 0) return null;
  return source === "IPLIK" ? "iplik kartı" : "çözgü kartı";
}

/** İplik kendi firesini taşıyorsa uyarı cümlesi; çözgü firesi girilmişse "uygulanmaz" eki. Değilse null. */
export function yarnOwnWasteNote(source: YarnWasteSourceCode | undefined, wastePct: number | string, specWastePct: number | string | null | undefined): string | null {
  if (source !== "IPLIK") return null;
  const spec = specWastePct == null || specWastePct === "" ? null : Number(specWastePct);
  const tail = spec !== null && Number.isFinite(spec) && spec > 0 ? ` (çözgü firesi ${pct(spec)} uygulanmaz)` : "";
  return `Bu iplik için iplik kartındaki ${pct(wastePct)} kullanılıyor${tail}.`;
}
