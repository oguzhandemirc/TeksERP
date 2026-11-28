// Ürün kartı (T3): "Bu taharın takılı olduğu tezgâhlar" — aynı tekrar birimi özetli tahar takılı aktif dokuma
// tezgâhları; bu tezgâhlara kumaş tahar değiştirmeden (düğümle) girer. Liste sunucudan, süzme yok.
import { useQuery } from "@tanstack/react-query";
import { machineDrawingInApi, SOURCE_LABEL } from "./machine-fit";

export function PlanMachinesList({ planId }: { planId: string }) {
  const q = useQuery({ queryKey: ["drawing-in-plans", "machines", planId], queryFn: () => machineDrawingInApi.machinesForPlan(planId), enabled: !!planId });
  if (!q.data) return null;
  const list = q.data.machines;
  return (
    <div className="mt-3 border-t pt-2" data-testid="plan-machines">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Bu taharın takılı olduğu tezgâhlar</p>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">Şu an bu tahar takılı tezgâh yok — kumaş her tezgâhta yeni tahar ister.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((m) => (
            <li
              key={m.id}
              className="rounded-badge border border-success/30 bg-success/10 px-1.5 py-0.5 text-xs"
              title={`${m.name}${m.source ? ` · ${SOURCE_LABEL[m.source]}` : ""}${m.frameCount ? ` · ${m.frameCount} çerçeve` : ""}`}
            >
              <span className="font-mono font-medium">{m.code}</span>
              {m.planId !== planId && m.planCode && <span className="ml-1 text-muted-foreground">({m.planCode})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
