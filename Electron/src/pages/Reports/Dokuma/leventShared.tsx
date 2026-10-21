// =============================================================================
// LEVENT / KAPASİTE RAPORLARI — ortak parçalar: kumaş kaynağı şeridi · ufuk satırı · URL süzgeci
// =============================================================================
// Rapor değişmezi ①: gerçek kumaş "otomatik (top doğuşundan) / elle" kırılımıyla basılır,
// tek sayıya çökertilmez. ②: `meta.ufuk` her sayfada yazılır.
// =============================================================================
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { fmtMeters } from "../_components/formatters";
import type { KumasKaynak } from "./leventReportTypes";

export const KAYNAK_ETIKET = { otomatik: "Ölçülen (top doğuşundan otomatik)", elle: "Elle tüketim" } as const;

/** Kaynak kırılımı metni — ekran şeridi ve çıktı notu AYNI cümleyi kullanır. */
export function kumasKaynakNotu(k: KumasKaynak | undefined, baslik: string): string | null {
  if (!k) return null;
  return `${baslik}: ${KAYNAK_ETIKET.otomatik} ${fmtMeters(k.otomatik)} · ${KAYNAK_ETIKET.elle} ${fmtMeters(k.elle)} — tek yüzdeye çökertilmez.`;
}

export function KumasKaynakStrip({ kaynak, baslik }: { kaynak: KumasKaynak | undefined; baslik: string }) {
  if (!kaynak) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="font-semibold text-muted-foreground">{baslik}:</span>
      <Badge variant="secondary">{KAYNAK_ETIKET.otomatik}: {fmtMeters(kaynak.otomatik)}</Badge>
      <Badge variant="outline">{KAYNAK_ETIKET.elle}: {fmtMeters(kaynak.elle)}</Badge>
      <span className="text-muted-foreground">— tek yüzdeye çökertilmez.</span>
    </div>
  );
}

/** Ufuk notu metni — ekranda ve çıktıda aynı. */
export function horizonNote(meta: { ufuk: string; ufukOncesiSatir: number } | undefined): string | null {
  if (!meta) return null;
  return `Ölçüm ufku: ${meta.ufuk} sonrası ölçülüdür${meta.ufukOncesiSatir > 0 ? ` · ufuk öncesi ${meta.ufukOncesiSatir} satır (eksik olabilir)` : ""}`;
}

export function HorizonLine({ meta }: { meta: { ufuk: string; ufukOncesiSatir: number } | undefined }) {
  const metin = horizonNote(meta);
  return metin ? <p className="text-xs text-muted-foreground">{metin}</p> : null;
}

/** Tek seçimli URL süzgeci (`""` = Tümü ⇒ istekte parametre yok — bugünkü davranış). */
export function useUrlFilter(param: string): [string, (id: string) => void] {
  const [sp, setSp] = useSearchParams();
  const set = (id: string) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set(param, id);
      else n.delete(param);
      return n;
    }, { replace: true });
  return [sp.get(param) ?? "", set];
}

/** Gerekçe hücresi — sunucu gerekçe vermediyse "—" (uydurulmaz). */
export const gerekce = (v: string | null | undefined): string => v ?? "—";
