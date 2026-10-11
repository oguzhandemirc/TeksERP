// =============================================================================
// ALARM SORUMLULARI — Tanımlar › Alarm Sorumluları (`/definitions/loom-alarm-duty`, dokuma alarmı A4)
// =============================================================================
// Alarm kademesi çaldığında kime bildirileceği: ① hol × vardiya sorumluları ② tek vardiyalık nöbet değişikliği
// ③ kademe kuralları. Bildirilenler çalma anında RAISED satırına DONAR — buradaki değişiklik geçmiş alarmı değiştirmez.
// Kapı: route `loom:spec-manage` + `ROUTE_MODULE` (tezgah); alarm bayrağı kapalıysa sunucu 403 → "kapalı" denir.
// Kaldırma silme değil damgadır (`revokedAt`); onay penceresi etkilenen kaydı adıyla gösterir.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { isAlarmClosedError } from "@/pages/Operations/LoomAlarms/alarm-access";
import { AlarmClosedNotice } from "@/pages/Operations/LoomAlarms/AlarmClosedNotice";
import { personOptions } from "./duty-model";
import { OverridesSection } from "./OverridesSection";
import { ResponsibleGrid } from "./ResponsibleGrid";
import { RulesSection } from "./RulesSection";
import { loomAlarmDutyService, type DutyKind } from "./service";
import { LOOM_ALARM_DUTY_QUERY_ROOT, useDutyActions } from "./useDutyActions";

interface PendingRevoke { kind: DutyKind; id: string; text: string }

function useDutyData() {
  const overview = useQuery({ queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT, "overview"], queryFn: () => loomAlarmDutyService.overview(), retry: false });
  const ok = overview.isSuccess;
  const options = useQuery({ queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT, "options"], queryFn: () => loomAlarmDutyService.options(), enabled: ok, staleTime: 60_000 });
  const candidates = useQuery({ queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT, "candidates"], queryFn: () => loomAlarmDutyService.candidates(), enabled: ok, staleTime: 60_000 });
  return { overview, options: options.data, people: personOptions(candidates.data ?? []) };
}

export function LoomAlarmDutyPage() {
  const { overview, options, people } = useDutyData();
  const actions = useDutyActions();
  const [pending, setPending] = useState<PendingRevoke | null>(null);
  const d = overview.data;
  const halls = options?.halls ?? [];
  return (
    <PageShell>
      <PageHeader
        title="Alarm Sorumluları"
        description="Tezgah alarmı çaldığında kime bildirilir — hol × vardiya sorumlusu, nöbet değişikliği, kademe kuralı"
        actions={<RefreshButton queryKey={[LOOM_ALARM_DUTY_QUERY_ROOT]} />}
      />
      <PageBody className="space-y-5 p-4">
        {!d ? (
          overview.isError && isAlarmClosedError(overview.error) ? (
            <AlarmClosedNotice error={overview.error} />
          ) : (
            <p className="py-16 text-center text-muted-foreground">{overview.isError ? "Okunamadı — bağlantıyı kontrol edip yenileyin." : "Yükleniyor…"}</p>
          )
        ) : (
          <>
            {d.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {d.warnings.map((w) => <li key={w} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {w}</li>)}
              </ul>
            )}
            <section className="rounded-xl border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Hol × vardiya sorumluları</h3>
              <p className="mb-3 text-xs text-muted-foreground">Sorumlu tanımlı değilse bildirim alarm yetkisi olan herkese gider (K1 görenler, K2 üst kademe yetkisi olanlar).</p>
              <ResponsibleGrid halls={halls} shifts={options?.shifts ?? []} responsibles={d.responsibles} people={people} busy={actions.isPending}
                onAdd={(b) => void actions.addResponsible(b)}
                onRevoke={(r) => setPending({ kind: "responsibles", id: r.id, text: `${r.station.name} · ${r.shiftDefinition.name} · Kademe ${r.tier}: ${r.user.name}` })} />
            </section>
            <OverridesSection overrides={d.overrides} halls={halls} people={people} busy={actions.isPending} onAdd={actions.addOverride}
              onRevoke={(o) => setPending({ kind: "overrides", id: o.id, text: `${o.station.name} · Kademe ${o.tier}: ${o.user.name}` })} />
            <RulesSection rules={d.rules} people={people} permissions={options?.permissions ?? []} busy={actions.isPending} onAdd={actions.addRule}
              onRevoke={(r) => setPending({ kind: "rules", id: r.id, text: `Kademe ${r.tier} kuralı` })} />
          </>
        )}
      </PageBody>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Kaldırılsın mı?"
        description={pending ? `${pending.text}. Kayıt silinmez, kaldırıldı olarak damgalanır; geçmiş alarmların alıcıları değişmez.` : undefined}
        confirmLabel="Kaldır"
        destructive
        isPending={actions.isPending}
        onConfirm={async () => {
          if (pending && (await actions.revoke(pending.kind, pending.id))) setPending(null);
        }}
      />
    </PageShell>
  );
}
