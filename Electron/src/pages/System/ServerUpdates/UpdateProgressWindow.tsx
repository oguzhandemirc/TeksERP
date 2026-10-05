import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import type { UpdateStatus } from "@/types/server-update";
import { useServerUpdateStatus } from "./hooks";
import { estimateSeconds, nextProgress, PHASES, phaseOfStep, type ProgressState } from "./updateProgress";

const fmtDuration = (sec: number): string => (sec < 90 ? `${sec} sn` : `${Math.round(sec / 60)} dk`);

function Steps({ adim }: { adim: string | null }) {
  const { phase } = phaseOfStep(adim);
  const at = phase ? PHASES.findIndex((p) => p.key === phase) : -1;
  return (
    <ol className="space-y-1">
      {PHASES.map((p, i) => (
        <li key={p.key} className={cn("flex items-center gap-2 text-sm", i > at && "text-muted-foreground")} data-state={i < at ? "done" : i === at ? "active" : "todo"}>
          {i < at ? <CheckCircle2 className="h-4 w-4 text-success" /> : i === at ? <Loader2 className="h-4 w-4 animate-spin" /> : <Circle className="h-4 w-4" />}
          {p.label}
        </li>
      ))}
    </ol>
  );
}

function Running({ st, estimate, now }: { st: Extract<ProgressState, { kind: "running" }>; estimate: number | null; now: number }) {
  const rollback = phaseOfStep(st.adim).rollback;
  const elapsed = Math.max(0, Math.round((now - st.startedAt) / 1000));
  return (
    <>
      <p className="font-medium">{rollback ? "Güncelleme geri alınıyor" : `Sunucu ${st.version} sürümüne güncelleniyor`}</p>
      <Steps adim={st.adim} />
      <p className="text-xs text-muted-foreground">
        {st.unreachable ? "Sunucu yeniden başlıyor; bağlantı kendiliğinden geri gelir. " : ""}
        {`Geçen süre ${fmtDuration(elapsed)} · ${estimate ? `tahmini ~${fmtDuration(estimate)}` : "tahmini birkaç dakika"}`}
      </p>
    </>
  );
}

/**
 * Canlı güncelleme penceresi: güncelleyici işlemi UYGULARKEN kendiliğinden açılır (adım adım), bitince kapanır ve
 * sonucu bildirir. MODAL DEĞİL (köşe kartı, `ServerOfflineBanner` kalıbı: yarım form kaybolmaz). Sunucu yeniden
 * başlarken ulaşılamazlık beklenen haldir — son bilinen adım gösterilir. Başarısız bitiş kapanmaz (müdahale gerekir).
 * Okuma `license:view ∨ license:manage` (durum ucunun izni); izinsiz kullanıcıda istek atılmaz.
 */
export function UpdateProgressWindow() {
  const { hasPermission } = useRoleAccess();
  const enabled = hasPermission("license:view") || hasPermission("license:manage");
  const q = useServerUpdateStatus(enabled);
  const [st, setSt] = useState<ProgressState>({ kind: "idle" });
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const last = useRef<UpdateStatus | undefined>(undefined);
  if (q.data) last.current = q.data;

  useEffect(() => {
    if (!enabled) return;
    const res = (q.error as { response?: { status?: number } } | null)?.response;
    const unreachable = q.isError && (!res || (res.status ?? 0) >= 500);
    const fresh = q.isError ? undefined : q.data;
    setSt((p) => nextProgress(p, { status: fresh, unreachable, now: Date.now() }));
  }, [enabled, q.data, q.isError, q.error, q.dataUpdatedAt, q.errorUpdatedAt]);

  useEffect(() => {
    if (st.kind === "idle") setHidden(false);
    if (st.kind !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st.kind]);

  useEffect(() => {
    if (st.kind !== "done" || st.outcome === "BASARISIZ") return;
    if (st.outcome === "BASARILI") toast.success(`Sunucu ${st.version} sürümüne güncellendi`);
    else toast.warning("Güncelleme geri alındı, sistem eski sürümde çalışıyor");
    setSt({ kind: "idle" });
    setHidden(false);
  }, [st]);

  if (st.kind === "idle" || (st.kind === "running" && hidden) || (st.kind === "done" && st.outcome !== "BASARISIZ")) return null;
  const close = () => {
    setHidden(true);
    if (st.kind === "done") setSt({ kind: "idle" });
  };
  return (
    <div role="status" data-testid="guncelleme-ilerleme" className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
      {st.kind === "running" ? (
        <Running st={st} estimate={estimateSeconds(last.current?.gecmis ?? [])} now={now} />
      ) : (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm font-medium">Güncelleme tamamlanamadı — müdahale gerekiyor. Sunucu Durumu ekranına bakın ya da destekle görüşün.</p>
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={close}>
          {st.kind === "running" ? "Gizle" : "Kapat"}
        </Button>
      </div>
    </div>
  );
}
