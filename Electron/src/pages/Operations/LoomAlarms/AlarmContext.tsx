// Alarm sayfası bağlamı (tasarım §A.7-4/5/6): tezgahta koşan dokuma iş emri, takılı levent,
// bu sebeple geçmiş duruşlar ve son duruşlar. Ölçülmeyen blok çizilmez (uydurulmaz).
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { TERIM } from "@/lib/terim";
import { formatSeconds } from "./alarm-format";
import { loomAlarmService } from "./service";
import type { LoomAlarmDetail, LoomAlarmStopStat } from "./types";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** Takılı levent: yalnız levent bağ defteri açıksa ve okuma izni varsa sorulur; hata sessiz. */
function useMountedBeams(machineId: string) {
  const flags = useFeatureFlags().data?.data;
  const { hasPermission } = useRoleAccess();
  const on = Boolean(flags?.devereEnabled && flags?.devereMountTracking) && hasPermission("warpbeam:read");
  const q = useQuery({
    queryKey: ["loom-alarms", "beams", machineId],
    queryFn: () => loomAlarmService.mountedBeams(machineId),
    enabled: on,
    staleTime: 60_000,
    retry: false,
  });
  return on ? (q.data ?? null) : null;
}

function StatRow({ label, s }: { label: string; s: LoomAlarmStopStat }) {
  return (
    <tr className="border-t">
      <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{s.count}</td>
      <td className="py-1.5 text-right tabular-nums">{formatSeconds(s.totalSec)}</td>
      <td className="py-1.5 text-right tabular-nums">{formatSeconds(s.avgSec)}</td>
    </tr>
  );
}

export function AlarmContext({ detail }: { detail: LoomAlarmDetail }) {
  const { alarm, context, similar, recentStops } = detail;
  const beams = useMountedBeams(alarm.machine.id);
  return (
    <div className="space-y-4">
      <Block title={beams && beams.length > 0 ? `${TERIM.dokumaIsEmri.tekil} ve levent` : TERIM.dokumaIsEmri.tekil}>
        <div className="space-y-1.5">
          {context.job ? (
            <>
              <Field label="No" value={context.job.weavingOrderNumber} />
              <Field label="Kumaş" value={[context.job.itemName, context.job.colorName].filter(Boolean).join(" · ")} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Tezgahta açık {TERIM.dokumaIsEmri.tekilKucuk} yok.</p>
          )}
          {beams?.map((b) => (
            <Field
              key={b.id}
              label={`Levent ${b.beamNo}${b.position !== null ? ` (yuva ${b.position})` : ""}`}
              value={`${b.remainingM.toLocaleString("tr-TR")} / ${b.plannedLengthM.toLocaleString("tr-TR")} m kaldı`}
            />
          ))}
        </div>
      </Block>
      {similar && (
        <Block title="Bu sebeple geçmiş duruşlar">
          {similar.machine30d.count > 1 && (
            <p className="mb-2 text-sm font-medium">
              Tezgah {alarm.machine.code} son 30 günde bu sebeple {similar.machine30d.count}. kez duruyor.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pb-1 text-left font-normal" />
                <th className="pb-1 text-right font-normal">Adet</th>
                <th className="pb-1 text-right font-normal">Toplam</th>
                <th className="pb-1 text-right font-normal">Ortalama</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Bu tezgah · 7 gün" s={similar.machine7d} />
              <StatRow label="Bu tezgah · 30 gün" s={similar.machine30d} />
              <StatRow label="Tüm salon · 30 gün" s={similar.floor30d} />
            </tbody>
          </table>
        </Block>
      )}
      <Block title="Bu tezgahın son duruşları">
        {recentStops.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıtlı duruş yok.</p>
        ) : (
          <ul className="space-y-1.5">
            {recentStops.map((s) => (
              <li key={s.id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="tabular-nums text-muted-foreground">{fmtFactoryDateTime(s.startedAt)}</span> ·{" "}
                  {s.reasonLabel ?? s.reasonCode ?? "Sebep bekleniyor"}
                </span>
                <span className="shrink-0 tabular-nums">{s.endedAt ? formatSeconds(s.durationSec) : "sürüyor"}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}
