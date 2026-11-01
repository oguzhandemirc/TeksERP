// Cari kilidi bölümü (D4-I3; tasarım DALGA4 §10.8) — aktif kilit + koy/aç + tarihçe. Cari kartının "Kilit"
// sekmesi (kart kimliğiyle) ve Cari Hesaplar satırının "Kilit" diyaloğu (hesap kimliğiyle) aynı bileşeni kullanır.
// Düğmeler izinsiz kullanıcıda ÇİZİLMEZ (finance:hold · finance:hold-release ayrı — SoD).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { apiErrorText } from "@/lib/api-error";
import { getCariHolds, scopeLabels, type CariHoldRow, type CariHoldTarget } from "./cariHoldService";
import { PlaceHoldDialog } from "./PlaceHoldDialog";
import { ReleaseHoldDialog } from "./ReleaseHoldDialog";

const when = (iso: string | null) => formatFactory(iso, "dd.MM.yyyy HH:mm");

interface Props {
  target: CariHoldTarget;
  cariName: string;
}

export function CariHoldPanel({ target, cariName }: Props) {
  const [placing, setPlacing] = useState(false);
  const [releasing, setReleasing] = useState<CariHoldRow | null>(null);
  const q = useQuery({ queryKey: ["cari-hold", target], queryFn: () => getCariHolds(target) });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (q.isError || !q.data) return <Callout tone="danger">{apiErrorText(q.error, "Kilit bilgisi okunamadı.")}</Callout>;
  const { cariId, active, history } = q.data;

  return (
    <div className="space-y-4 text-sm">
      {active ? (
        <Callout tone="warning" icon={Lock} title={`Cari kilitli — ${scopeLabels(active.scopes)} durdu`}>
          <p>
            Sebep: {active.reasonLabel}
            {active.reasonText ? ` — ${active.reasonText}` : ""}
          </p>
          <p>Koyan: {active.placedByName ?? "—"} · {when(active.createdAt)}</p>
          <PermissionGate permission="finance:hold-release">
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setReleasing(active)}>
              <LockOpen className="mr-1 h-4 w-4" /> Kilidi aç
            </Button>
          </PermissionGate>
        </Callout>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
          <span className="text-muted-foreground">Bu caride aktif kilit yok.</span>
          <PermissionGate permission="finance:hold">
            <Button size="sm" variant="destructive" onClick={() => setPlacing(true)}>
              <Lock className="mr-1 h-4 w-4" /> Kilit koy
            </Button>
          </PermissionGate>
        </div>
      )}

      <div>
        <h4 className="mb-2 font-medium">Kilit geçmişi</h4>
        {history.length === 0 ? (
          <p className="text-muted-foreground">Bu cariye hiç kilit konmadı.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Kapsam</th>
                  <th className="px-2 py-1.5 text-left">Sebep</th>
                  <th className="px-2 py-1.5 text-left">Konan</th>
                  <th className="px-2 py-1.5 text-left">Açılan</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t align-top">
                    <td className="px-2 py-1.5">{scopeLabels(h.scopes)}</td>
                    <td className="px-2 py-1.5">
                      {h.reasonLabel}
                      {h.reasonText && <span className="block text-muted-foreground">{h.reasonText}</span>}
                    </td>
                    <td className="px-2 py-1.5">{h.placedByName ?? "—"}<span className="block text-muted-foreground">{when(h.createdAt)}</span></td>
                    <td className="px-2 py-1.5">
                      {h.releasedAt ? (
                        <>
                          {h.releasedByName ?? "—"}
                          <span className="block text-muted-foreground">{when(h.releasedAt)}{h.releaseReason ? ` — ${h.releaseReason}` : ""}</span>
                        </>
                      ) : (
                        <span className="font-medium text-amber-700 dark:text-amber-400">Aktif</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {placing && <PlaceHoldDialog cariId={cariId} cariName={cariName} onClose={() => setPlacing(false)} />}
      {releasing && <ReleaseHoldDialog hold={releasing} onClose={() => setReleasing(null)} />}
    </div>
  );
}
