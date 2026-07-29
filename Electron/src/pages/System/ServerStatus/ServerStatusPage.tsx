import { Cpu, MemoryStick, Server, Activity, HardDrive, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricCard } from "./MetricCard";
import { Sparkline } from "./Sparkline";
import { BackupButton } from "./BackupButton";
import {
  useServerHealth,
  evaluateAlerts,
  levelOf,
  fmtBytes,
  fmtUptime,
  fmtPct,
  fmtBackupAge,
  type Alert,
} from "./serverHealth";

function InfoRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", danger && "text-destructive")}>{value}</span>
    </div>
  );
}

function AlertBanner({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  const hasCrit = alerts.some((a) => a.level === "crit");
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        hasCrit
          ? "border-destructive/40 bg-destructive/10"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className={cn("h-4 w-4", hasCrit ? "text-destructive" : "text-amber-600")} />
        Dikkat gerekiyor
      </div>
      <ul className="space-y-1 text-sm">
        {alerts.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                a.level === "crit" ? "bg-destructive" : "bg-amber-500",
              )}
            />
            {a.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ServerStatusPage() {
  const { data, isError, dataUpdatedAt, history } = useServerHealth();
  const online = !isError && !!data;
  const alerts = evaluateAlerts(data);

  const procMemPct =
    data && data.sysTotalMemBytes ? (data.procRssBytes / data.sysTotalMemBytes) * 100 : null;
  const sysMemPct =
    data && data.sysTotalMemBytes ? (data.sysUsedMemBytes / data.sysTotalMemBytes) * 100 : null;

  return (
    <PageShell>
      <PageHeader
        title="Sunucu Durumu"
        actions={
          <div className="flex items-center gap-3">
            {data && <BackupButton />}
            <div
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
                online
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  online ? "animate-pulse bg-emerald-500" : "bg-destructive",
                )}
              />
              {online ? "Çevrimiçi" : "Ulaşılamıyor"}
            </div>
          </div>
        }
      />

      <PageBody className="space-y-8 p-6">
        <AlertBanner alerts={alerts} />

        {/* Backend prosesinin kendi kullanımı */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Backend Sunucusu (kendi kullanımı)
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard
              icon={MemoryStick}
              label="RAM (RSS)"
              value={data ? fmtBytes(data.procRssBytes) : "—"}
              sub={
                data
                  ? `Heap ${fmtBytes(data.procHeapUsedBytes)} / ${fmtBytes(data.procHeapTotalBytes)}`
                  : undefined
              }
              pct={procMemPct}
              level={levelOf(procMemPct, 50, 75)}
              chart={<Sparkline data={history} dataKey="procMemPct" color="#6366f1" />}
            />
            <MetricCard
              icon={Cpu}
              label="CPU"
              value={data ? fmtPct(data.procCpuPct) : "—"}
              sub={data ? `${data.cpuCores} çekirdek` : undefined}
              pct={data?.procCpuPct ?? null}
              level={levelOf(data?.procCpuPct, 80, 95)}
              chart={<Sparkline data={history} dataKey="procCpu" color="#0ea5e9" />}
            />
          </div>
        </section>

        {/* Makinenin geneli */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Makine Geneli (tüm programlar dahil)
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              icon={Server}
              label="RAM"
              value={data ? fmtBytes(data.sysUsedMemBytes) : "—"}
              sub={data ? `/ ${fmtBytes(data.sysTotalMemBytes)}` : undefined}
              pct={sysMemPct}
              level={levelOf(sysMemPct, 85, 95)}
              chart={<Sparkline data={history} dataKey="sysMemPct" color="#8b5cf6" />}
            />
            <MetricCard
              icon={Activity}
              label="CPU"
              value={data ? fmtPct(data.sysCpuPct) : "—"}
              pct={data?.sysCpuPct ?? null}
              level={levelOf(data?.sysCpuPct, 80, 95)}
              chart={<Sparkline data={history} dataKey="sysCpu" color="#06b6d4" />}
            />
            <MetricCard
              icon={HardDrive}
              label="Disk"
              value={data ? fmtPct(data.diskUsedPct) : "—"}
              sub={data && data.diskFreeBytes != null ? `${fmtBytes(data.diskFreeBytes)} boş` : undefined}
              pct={data?.diskUsedPct ?? null}
              level={levelOf(data?.diskUsedPct, 80, 90)}
            />
          </div>
        </section>

        {/* İkincil bilgiler */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Sunucu Bilgileri
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <InfoRow label="Çalışma süresi" value={data ? fmtUptime(data.uptimeSec) : "—"} />
                <InfoRow label="Sürüm" value={data?.version ?? "—"} />
                <InfoRow
                  label="Yanıt gecikmesi (event loop)"
                  value={data ? `${data.eventLoopLagMs} ms` : "—"}
                  danger={levelOf(data?.eventLoopLagMs, 100, 500) === "crit"}
                />
                <InfoRow label="Online kullanıcı" value={data ? String(data.activeUsers) : "—"} />
                <InfoRow label="Bağlı cihaz" value={data ? String(data.activeDevices) : "—"} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <InfoRow
                  label="Veritabanı"
                  value={data?.db === "UP" ? "Bağlı" : "Bağlantı yok"}
                  danger={data?.db === "DOWN"}
                />
                <InfoRow label="Veritabanı boyutu" value={data ? fmtBytes(data.dbSizeBytes) : "—"} />
                <InfoRow
                  label="Aktif bağlantı"
                  value={data?.dbConnections != null ? String(data.dbConnections) : "—"}
                />
                <InfoRow
                  label="Kilit bekleyen sorgu"
                  value={data?.dbBlockedCount != null ? String(data.dbBlockedCount) : "—"}
                  danger={!!data?.dbBlockedCount && data.dbBlockedCount > 0}
                />
                <InfoRow label="Önbellek isabeti" value={fmtPct(data?.cacheHitPct)} />
                <InfoRow label="Son yedek" value={data ? fmtBackupAge(data.lastBackup) : "—"} />
              </CardContent>
            </Card>
          </div>
          {dataUpdatedAt > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Son güncelleme: {new Date(dataUpdatedAt).toLocaleTimeString("tr-TR")}
            </p>
          )}
        </section>
      </PageBody>
    </PageShell>
  );
}
