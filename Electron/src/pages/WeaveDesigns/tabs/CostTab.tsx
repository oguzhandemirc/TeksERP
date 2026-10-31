// Maliyet sekmesi: desene bağlı her kumaş için "≈ X $/m" — sayı YALNIZ `POST /api/cost/preview` yanıtından
// (istemci hesaplamaz; sunum dövizi ayarı TRY iken TL/m). Ayrıntılı döküm ürünün maliyet kartında.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fmtDec } from "@/pages/Cost/shared/format";
import type { CostPreview } from "@/pages/Cost/shared/cost-types";
import { previewFabricCost } from "../service";
import type { DesignFabric } from "../types";

/** Sunucunun sunum alanlarından tek satırlık "≈ …/m" metni; sonuç yoksa eksik sayısı. */
export function costPerMeterLabel(p: CostPreview | undefined): string {
  if (!p) return "…";
  const s = p.sonuc;
  if (!s) return `Hesaplanamadı — ${p.eksikler.length} eksik girdi`;
  if (s.sunumDovizi) {
    return s.standartDovizM == null ? `${s.sunumDovizi} kuru yok` : `≈ ${fmtDec(s.standartDovizM, 4)} ${s.sunumDovizi}/m`;
  }
  return `≈ ${fmtDec(s.standartTlM, 2)} TL/m`;
}

function FabricCostRow({ fabric }: { fabric: DesignFabric }) {
  const q = useQuery({ queryKey: ["cost-preview", "fabric", fabric.id], queryFn: () => previewFabricCost(fabric.id), staleTime: 30_000 });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
      <span className="font-mono text-xs">{fabric.code}</span>
      <span>{fabric.name}</span>
      <span className="ml-auto font-semibold tabular-nums" data-testid={`cost-${fabric.id}`}>{q.isError ? "Önizleme alınamadı" : costPerMeterLabel(q.data)}</span>
      <Link className="text-xs text-primary underline" to={`/cost/items/${fabric.id}`}>Döküm</Link>
    </li>
  );
}

export function CostTab({ fabrics }: { fabrics: DesignFabric[] }) {
  if (fabrics.length === 0) return <p className="text-sm text-muted-foreground">Bu desene bağlı kumaş yok.</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">{fabrics.map((f) => <FabricCostRow key={f.id} fabric={f} />)}</ul>
      <p className="text-xs text-muted-foreground">Varyantın değişen atkı ipliği ve tarifesi, varyant bazlı standart maliyet sürümüyle hesaba girer.</p>
    </div>
  );
}
