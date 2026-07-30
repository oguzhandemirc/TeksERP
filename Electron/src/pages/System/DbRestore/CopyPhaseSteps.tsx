import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { fmtBytes } from "../ServerStatus/serverHealth";
import type { CopyPhase, DbCopyJob } from "./types";

const STEPS: Array<{ phase: CopyPhase; label: string }> = [
  { phase: "creating", label: "Veritabanı oluşturuluyor" },
  { phase: "restoring", label: "Yedek geri yükleniyor (pg_restore)" },
  { phase: "verifying", label: "Doğrulanıyor" },
  { phase: "ready", label: "Hazır" },
];

const ORDER: CopyPhase[] = ["queued", "creating", "restoring", "verifying", "ready"];

function humanMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

/**
 * Faz göstergesi — YÜZDE YOK, bilerek.
 *
 * `pg_restore` ilerleme bildirmez ve index'ler en sonda kurulduğu için herhangi
 * bir oran doğrusal değildir; yüzde göstermek yalan söylemek olur. Bunun yerine
 * (a) hangi fazdayız, (b) o faz ne kadardır sürüyor, (c) kopyanın BÜYÜYEN boyutu —
 * üçü de ölçülmüş gerçek sinyaller.
 */
export function CopyPhaseSteps({
  job,
  copyBytes,
  liveBytes,
}: {
  job: DbCopyJob;
  copyBytes: number | null;
  liveBytes: number | null;
}) {
  const currentIdx = ORDER.indexOf(job.phase);
  const failed = job.phase === "failed";
  const phaseMs = Date.now() - new Date(job.phaseStartedAt).getTime();

  return (
    <ol className="space-y-1.5">
      {STEPS.map((s) => {
        const idx = ORDER.indexOf(s.phase);
        const isActive = job.phase === s.phase;
        const isDone = !failed && currentIdx > idx;
        const isFailedHere = failed && job.failedPhase === s.phase;

        const Icon = isFailedHere ? XCircle : isDone ? CheckCircle2 : isActive ? Loader2 : Circle;
        const cls = isFailedHere
          ? "text-destructive"
          : isDone
            ? "text-success"
            : isActive
              ? "text-primary"
              : "text-muted-foreground/40";

        return (
          <li key={s.phase} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls} ${isActive ? "animate-spin" : ""}`} />
            <div className="min-w-0">
              <span className={isActive || isDone || isFailedHere ? "" : "text-muted-foreground"}>
                {s.label}
              </span>
              {isActive && (
                <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                  {humanMs(phaseMs)}
                  {s.phase === "restoring" && copyBytes !== null && (
                    <>
                      {" · "}
                      {fmtBytes(copyBytes)}
                      {liveBytes ? ` / ~${fmtBytes(liveBytes)}` : ""}
                    </>
                  )}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
