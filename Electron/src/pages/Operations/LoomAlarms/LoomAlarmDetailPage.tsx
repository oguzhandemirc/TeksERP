// =============================================================================
// ALARM SAYFASI — "durumu anlatan yer" (`/operations/loom-alarms/:id`, tasarım §A.7)
// =============================================================================
// Zil, liste ve Tezgah Salonu buraya açar. Başlık + canlı sayaç · eylemler (izne göre) ·
// zaman çizgisi (defterden) · bağlam. Veri 15 sn'de tazelenir; eylem sonrası hemen.
// Kapı: route `loom:alarm-view` + `ROUTE_MODULE` (tezgah); bayrak kapalıysa sunucu 403
// `LOOM_ALARM_DISABLED` → sayfa "kapalı" der (yetki hatası gibi gösterilmez).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAuthStore } from "@/store/auth";
import { errorCodeOf, isAlarmClosedError, useLoomAlarmAccess, useServerNow } from "./alarm-access";
import { AlarmActionBar } from "./AlarmActionBar";
import { AlarmClosedNotice } from "./AlarmClosedNotice";
import { AlarmContext } from "./AlarmContext";
import { AlarmHeaderCard } from "./AlarmHeaderCard";
import { AlarmNotifications } from "./AlarmNotifications";
import { AlarmTimeline } from "./AlarmTimeline";
import { loomAlarmService } from "./service";
import { LOOM_ALARMS_QUERY_ROOT, useLoomAlarmActions } from "./useLoomAlarmActions";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";

export const LOOM_ALARM_DETAIL_POLL_MS = 15_000;

function Notice({ text }: { text: string }) {
  return <p className="py-16 text-center text-muted-foreground">{text}</p>;
}

function errorText(error: unknown): string {
  if (errorCodeOf(error) === "LOOM_ALARM_NOT_FOUND") return "Alarm bulunamadı.";
  return "Alarm okunamadı — bağlantıyı kontrol edip yenileyin.";
}

export function LoomAlarmDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const access = useLoomAlarmAccess();
  const { hasPermission } = useRoleAccess();
  const meId = useAuthStore((s) => s.user?.userId ?? null);
  const now = useServerNow();
  const actions = useLoomAlarmActions(id);
  const tabActive = useIsTabActive();
  const q = useQuery({
    queryKey: [LOOM_ALARMS_QUERY_ROOT, "detail", id],
    queryFn: () => loomAlarmService.detail(id),
    enabled: id !== "",
    refetchInterval: (query) => (!tabActive || isAlarmClosedError(query.state.error) ? false : LOOM_ALARM_DETAIL_POLL_MS),
    retry: false,
  });
  const d = q.data;
  const showFloor = d && hasPermission("loom:live-view")
    ? () => navigate(`/operations/weaving-floor?tezgah=${d.alarm.machine.id}`)
    : null;

  return (
    <PageShell>
      <PageHeader
        title={d ? `Alarm — Tezgah ${d.alarm.machine.code}` : "Tezgah Alarmı"}
        description="Duruşun durumu, kim üstlendi ve sonraki adım"
        actions={<RefreshButton queryKey={[LOOM_ALARMS_QUERY_ROOT, "detail", id]} />}
      />
      <PageBody className="space-y-5 p-4">
        {!d ? (
          q.isError && isAlarmClosedError(q.error) ? (
            <AlarmClosedNotice error={q.error} />
          ) : (
            <Notice text={q.isError ? errorText(q.error) : "Alarm yükleniyor…"} />
          )
        ) : (
          <>
            <AlarmHeaderCard alarm={d.alarm} now={now} />
            <AlarmActionBar alarm={d.alarm} access={access} meId={meId} now={now} actions={actions} onShowFloor={showFloor} />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="rounded-xl border bg-card p-4">
                <h3 className="mb-4 text-sm font-semibold text-muted-foreground">Zaman çizgisi</h3>
                <AlarmTimeline detail={d} canAct={access.canAct} meId={meId} onRetract={(eid) => void actions.retractNote(eid)} busy={actions.isPending} />
              </section>
              <div className="space-y-5">
                <AlarmNotifications detail={d} />
                <AlarmContext detail={d} />
              </div>
            </div>
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
