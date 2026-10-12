import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { ApprovalAction } from "../ServerUpdates/UpdateApprovalCard";
import { serverRowState, UNREADABLE, type ProblemAction } from "../ServerUpdates/serverRow";
import { UpdateRow } from "./UpdateRow";
import type { ServerUpdateView } from "./useServerUpdateView";

/** Onay düğmeleri yalnız `license:manage`e ve backend'in izin verdiği kadar (`eylemler` — POST kapısıyla AYNI yüklem). */
function ServerActions({ v, awaiting }: { v: ServerUpdateView; awaiting: boolean }) {
  const f = v.full;
  if (v.canManage && f) {
    const e = f.eylemler;
    if (!e.hedefSurum || !(e.hemen || e.pencere)) return null;
    const mode = f.politika?.kip ?? null;
    return (
      <>
        {e.hemen && <ApprovalAction kind="HEMEN" surum={e.hedefSurum} mode={mode} window={f.sonrakiPencere} />}
        {e.pencere && <ApprovalAction kind="PENCERE" surum={e.hedefSurum} mode={mode} window={f.sonrakiPencere} />}
      </>
    );
  }
  return awaiting ? <span className="text-sm text-muted-foreground">Yöneticiniz onaylayacak</span> : null;
}

/** "Sunucu" satırı — kurulu sürüm, tek durum, en fazla iki onay düğmesi; sorun varsa tek cümle + tek eylem. */
export function ServerRow({ v }: { v: ServerUpdateView }) {
  const canSupport = useRoleAccess().hasPermission("support:create");
  const navigateActive = useTabsStore((s) => s.navigateActive);
  if (v.isLoading) return <Skeleton className="h-20 w-full" />;
  const st = v.summary ? serverRowState(v.summary) : UNREADABLE;
  const actionFor = (a: ProblemAction) => {
    if (a === "retry") return <Button size="sm" variant="outline" onClick={v.refetch}>Yeniden dene</Button>;
    if (a === "support" && canSupport) return <Button size="sm" variant="outline" onClick={() => navigateActive("/system/support")}>Destek iste</Button>;
    return undefined;
  };
  return (
    <UpdateRow
      id="sunucu"
      icon={Server}
      title="Sunucu"
      version={v.summary?.kuruluSurum ?? null}
      status={{ label: st.label, tone: st.tone, hint: st.hint }}
      actions={st.problem ? undefined : <ServerActions v={v} awaiting={st.awaitingApproval} />}
      problem={st.problem ? { text: st.problem.text, tone: st.tone, action: actionFor(st.problem.action) } : null}
    />
  );
}
