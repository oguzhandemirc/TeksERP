import { useState } from "react";
import { screenTitle } from "@/components/layout/screen-title";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Database, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/card";
import { InfoPopover } from "@/components/ui/info-popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { systemLogService } from "@/services/systemLogService";
import { factoryLocaleDateString, factoryLocaleString } from "@/lib/factory-time";
import { formatDisplay, formatQty } from "@/lib/format";

const STATS_KEY = "system-log-stats";

export function ActivityArchivePage() {
  const qc = useQueryClient();
  const [monthsToKeep, setMonthsToKeep] = useState(6);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<{ batches: number; archived: number } | null>(null);

  const statsQuery = useQuery({
    queryKey: [STATS_KEY],
    queryFn: () => systemLogService.stats().then((r) => r.data),
    staleTime: 30_000,
  });

  const archiveMutation = useMutation({
    mutationFn: async (months: number) => {
      let batches = 0;
      let total = 0;
      setProgress({ batches: 0, archived: 0 });
      // Batch döngüsü: backend tek seferde ARCHIVE_BATCH_SIZE kadar taşır.
      // archived=0 dönene kadar tekrar çağırıyoruz; safety cap 50 batch.
      for (let i = 0; i < 50; i++) {
        const res = await systemLogService.archive(months);
        batches += 1;
        total += res.data.archived;
        setProgress({ batches, archived: total });
        if (res.data.archived === 0) break;
      }
      return { batches, archived: total };
    },
    onSuccess: (res) => {
      toast.success(
        res.archived === 0
          ? "Arşivlenecek eski kayıt yok"
          : `${formatQty(res.archived)} kayıt arşivlendi`,
      );
      void qc.invalidateQueries({ queryKey: [STATS_KEY] });
      // L: arsivleme satirlari TASIR — aktif Aktivite listesi ve Arsiv aramasi da tazelensin.
      void qc.invalidateQueries({ queryKey: ["system-logs"] });
      void qc.invalidateQueries({ queryKey: ["system-logs-archive"] });
      setProgress(null);
    },
    onError: () => {
      setProgress(null);
    },
  });

  const stats = statsQuery.data;
  const oldestLogDate = stats?.oldestLog
    ? factoryLocaleDateString(stats.oldestLog, "tr-TR")
    : "—";

  return (
    <PageShell>
      <PageHeader
        title={screenTitle("/system/archive")}
      />

      <PageBody>
      <div className="grid grid-cols-1 gap-3 p-6 md:grid-cols-3">
        <StatCard
          icon={Database}
          label="Aktif Kayıt"
          value={formatCount(stats?.activeCount)}
          hint="Etkinlik ekranında listelenen kayıtlar"
        />
        <StatCard
          icon={Archive}
          label="Arşivdeki Kayıt"
          value={formatCount(stats?.archiveCount)}
          hint="Yasal saklama için; Arşiv Tarama ekranından aranır"
        />
        <StatCard
          icon={Clock}
          label="En Eski Aktif Kayıt"
          value={oldestLogDate}
          hint="Bu tarihten önceki kayıtlar arşivlenebilir"
        />
      </div>

      <div className="px-6 pb-6">
        <Card className="p-5">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">Arşivleme Çalıştır</h3>
            <InfoPopover
              label="Arşivleme — açıklama"
              desc="Belirtilen aydan eski kayıtlar arşive taşınır ve etkinlik listesinden çıkar. İşlem parça parça çalışır; uygun kayıtlar bitene kadar kendiliğinden sürer."
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Sunucu her 30 günde bir 6 aydan eski kayıtları kendisi arşivler. Son otomatik çalışma:{" "}
            <span className="font-medium text-foreground">
              {stats?.lastAutoArchiveAt
                ? factoryLocaleString(stats.lastAutoArchiveAt, "tr-TR")
                : "henüz çalışmadı"}
            </span>
            .
          </p>

          <div className="mt-4 flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="monthsToKeep" className="text-xs">
                Saklanacak ay sayısı
              </Label>
              <Input
                id="monthsToKeep"
                type="number"
                min={1}
                max={120}
                className="h-9 w-32"
                value={monthsToKeep}
                onChange={(e) => setMonthsToKeep(Math.max(1, Number(e.target.value) || 6))}
                disabled={archiveMutation.isPending}
              />
            </div>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={archiveMutation.isPending}
              className="gap-2"
            >
              <Archive className="h-4 w-4" />
              {archiveMutation.isPending ? "Arşivleniyor..." : "Arşivle"}
            </Button>
          </div>

          {progress && (
            <p className="mt-3 text-xs text-muted-foreground">
              {progress.batches}. parti — şu ana kadar{" "}
              <span className="font-medium text-foreground">
                {formatQty(progress.archived)}
              </span>{" "}
              kayıt taşındı.
            </p>
          )}
        </Card>
      </div>
      </PageBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Arşivlemeyi başlat"
        description={`${monthsToKeep} aydan eski bütün etkinlik kayıtları (en eskisi ${oldestLogDate}) arşive taşınacak. Geri alınamaz: kayıtlar arşivde kalır ama etkinlik listesinden çıkar.`}
        confirmLabel="Arşivle"
        onConfirm={() => {
          setConfirmOpen(false);
          archiveMutation.mutate(monthsToKeep);
        }}
        isPending={archiveMutation.isPending}
      />
    </PageShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  );
}

function formatCount(n: number | undefined): string {
  return formatDisplay(n, 0);
}
