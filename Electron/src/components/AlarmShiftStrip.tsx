// Dokuma alarmı vardiya şeridi — Tezgah Salonu ve ayar ekranı (Tezgah izleme) ORTAK bileşeni.
// Kod sunucudan gelir (`alarmNotice` / durum ucu `notice`); bağlantı yalnız Vardiya Tanımları karosunu
// görebilen kullanıcıya çizilir (karo kuralının aynısı: dokuma görünürlüğü + `loom:spec-manage`).
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { alarmShiftNoticeText, SHIFT_DEFINITIONS_PATH } from "@/lib/alarm-shift-notice";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isShiftDefinitionsVisible } from "@/pages/ShiftDefinitions/shift-regime";

export function useShiftDefinitionsLinkVisible(): boolean {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  return isShiftDefinitionsVisible(ctx) && (isAdmin || hasPermission("loom:spec-manage"));
}

export function AlarmShiftStrip({ notice, linkVisible }: { notice: string | null | undefined; linkVisible: boolean }) {
  const text = alarmShiftNoticeText(notice);
  if (!text) return null;
  return (
    <div
      role="status"
      data-testid="alarm-shift-strip"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      <span>{text}</span>
      {linkVisible ? (
        <Link to={SHIFT_DEFINITIONS_PATH} className="font-semibold underline underline-offset-2">
          Vardiya Tanımları
        </Link>
      ) : null}
    </div>
  );
}

/** Panel salonunda bağlantı kullanıcının karo görünürlüğüne göre; TV kipi bağlantısız `AlarmShiftStrip` çizer. */
export function LinkedAlarmShiftStrip({ notice }: { notice: string | null | undefined }) {
  return <AlarmShiftStrip notice={notice} linkVisible={useShiftDefinitionsLinkVisible()} />;
}
