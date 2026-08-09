import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** Backend `COMPARE_MODES` ile birebir — ayrışırsa uç 400 döner. */
export type CompareMode = "none" | "prev" | "prevYear" | "custom";

export const COMPARE_LABELS: Record<CompareMode, string> = {
  none: "Karşılaştırma yok",
  prev: "Önceki dönem",
  prevYear: "Geçen yıl aynı dönem",
  custom: "Özel dönem",
};

/**
 * Karşılaştırma modunu URL'de tutar (tarih aralığıyla aynı yerde) — böylece
 * rapor linki paylaşıldığında karşılaştırma da birlikte gider ve sekme yeniden
 * açıldığında aynı görünüm gelir.
 *
 * Varsayılan `none`: karşılaştırma istenmeden backend'de ikinci sorgu KOŞMAZ.
 */
export function useReportCompare() {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("compare");
  const mode: CompareMode =
    raw === "prev" || raw === "prevYear" || raw === "custom" ? raw : "none";
  const compareFrom = searchParams.get("compareFrom") ?? "";
  const compareTo = searchParams.get("compareTo") ?? "";

  const params = useMemo(() => {
    if (mode === "none") return {};
    if (mode === "custom") {
      // Yarım özel aralık backend'de 400 üretir; istek HİÇ gönderilmesin diye
      // burada moda düşülür — kullanıcı iki tarihi de seçene kadar rapor tek
      // dönem gösterir, hata toast'ı yağmaz.
      if (!compareFrom || !compareTo) return {};
      return { compare: mode, compareFrom, compareTo };
    }
    return { compare: mode };
  }, [mode, compareFrom, compareTo]);

  const setMode = (next: CompareMode) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "none") {
      sp.delete("compare");
      sp.delete("compareFrom");
      sp.delete("compareTo");
    } else {
      sp.set("compare", next);
      if (next !== "custom") {
        sp.delete("compareFrom");
        sp.delete("compareTo");
      }
    }
    setSearchParams(sp, { replace: true });
  };

  const setCustom = (from: string, to: string) => {
    const sp = new URLSearchParams(searchParams);
    sp.set("compare", "custom");
    if (from) sp.set("compareFrom", from);
    else sp.delete("compareFrom");
    if (to) sp.set("compareTo", to);
    else sp.delete("compareTo");
    setSearchParams(sp, { replace: true });
  };

  return { mode, params, compareFrom, compareTo, setMode, setCustom };
}
