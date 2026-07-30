import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { formatNumber } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import type { CheckStatus, VerificationReport } from "./types";

const ICON: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-success" },
  warn: { Icon: AlertTriangle, cls: "text-warning" },
  fail: { Icon: XCircle, cls: "text-destructive" },
  skipped: { Icon: AlertTriangle, cls: "text-muted-foreground" },
};

export function VerificationReportView({ report }: { report: VerificationReport }) {
  const fails = report.checks.filter((c) => c.status === "fail");
  const warns = report.checks.filter((c) => c.status === "warn");
  const shown = [...fails, ...warns];
  const okCount = report.checks.filter((c) => c.status === "ok").length;

  return (
    <div className="space-y-3">
      {fails.length > 0 ? (
        <Callout tone="danger" title="Doğrulama başarısız — bu kopyaya GEÇMEYİN">
          {fails.length} kontrol başarısız. Takas komutu üretilmeyecek.
        </Callout>
      ) : (
        <Callout tone="success" title="Kopya doğrulandı">
          {okCount} kontrol geçti{warns.length > 0 ? `, ${warns.length} uyarı var` : ""}.
          {report.needsMigrateDeploy && (
            <>
              {" "}
              Yedek koddan eski — takas komutu <code>prisma migrate deploy</code> adımını
              içerecek.
            </>
          )}
        </Callout>
      )}

      {shown.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {shown.map((c) => {
            const { Icon, cls } = ICON[c.status];
            return (
              <li key={c.key} className="flex items-start gap-2 px-3 py-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
                <div className="min-w-0">
                  <div className="font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                  {(c.expected || c.actual) && (
                    <div className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                      {c.expected && <div>canlı : {c.expected}</div>}
                      {c.actual && <div>kopya : {c.actual}</div>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tablo sayıları ve boyut
        </summary>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Yedek daha eski olduğu için kopyada <b>az kayıt olması normaldir</b>. Kritik olan,
          kayıt sayısının sıfır olmaması.
        </p>
        <ul className="mt-1.5 divide-y">
          {report.tables.map((t) => (
            <li key={t.table} className="flex items-baseline justify-between gap-3 py-1 text-xs">
              <span className="font-mono">{t.table}</span>
              <span className="tabular-nums text-muted-foreground">
                {t.copyCount === null ? "ölçülemedi" : formatNumber(t.copyCount)}
                {t.liveCount !== null && ` / ${formatNumber(t.liveCount)} canlı`}
              </span>
            </li>
          ))}
        </ul>
        {report.sizeBytes !== null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Boyut: {fmtBytes(report.sizeBytes)}
            {report.liveSizeBytes !== null && ` (canlı: ${fmtBytes(report.liveSizeBytes)})`}
          </p>
        )}
      </details>
    </div>
  );
}
