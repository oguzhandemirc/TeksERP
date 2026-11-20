import { useDestekStore } from "./destek-store";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { useDestekStatus, useReportShortcut, useUnreadPolling } from "./useDestekShell";

/**
 * Kabukta (AppShell) bir kez bağlanır: özellik durumu, rozet yoklaması, kısayol ve "Sorun bildir" formu.
 * Özellik kapalıyken yalnız `durum` sorusu gider; form hiç bağlanmaz.
 */
export function DestekRoot() {
  useDestekStatus();
  useUnreadPolling();
  useReportShortcut();
  const enabled = useDestekStore((s) => s.enabled);
  return enabled ? <ReportIssueDialog /> : null;
}
