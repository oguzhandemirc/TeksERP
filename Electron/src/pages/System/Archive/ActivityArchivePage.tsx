import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Database, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { systemLogService } from "@/services/systemLogService";

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
          : `${res.archived.toLocaleString("tr-TR", { useGrouping: false })} kayıt arşivlendi (${res.batches} batch)`,
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
    ? new Date(stats.oldestLog).toLocaleDateString("tr-TR")
    : "—";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Aktivite Arşivi"
        description="Eski sistem loglarını arşiv tablosuna taşıyarak aktif tabloyu küçük tut."
      />

      <div className="grid grid-cols-1 gap-3 p-6 md:grid-cols-3">
        <StatCard
          icon={Database}
          label="Aktif Kayıt"
          value={formatCount(stats?.activeCount)}
          hint="Filtreli ve sıralı listede sorgulanan tablo"
        />
        <StatCard
          icon={Archive}
          label="Arşivdeki Kayıt"
          value={formatCount(stats?.archiveCount)}
          hint="Sadece yasal/uyum amaçlı, UI'dan sorgulanmaz"
        />
        <StatCard
          icon={Clock}
          label="En Eski Aktif Kayıt"
          value={oldestLogDate}
          hint="Bu tarihten önceki tüm log'lar arşivlenmeye uygun"
        />
      </div>

      <div className="px-6 pb-6">
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Arşivleme Çalıştır</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Belirtilen aydan eski kayıtlar arşiv tablosuna taşınır ve aktif tablodan silinir.
            İşlem batch'li çalışır; tüm uygun kayıtlar bitene kadar otomatik tekrar eder.
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium">Otomatik çalışma:</span> Backend her 30 günde bir 6 aydan
            eski log'ları kendisi arşivler. Son otomatik çalışma:{" "}
            <span className="font-medium text-foreground">
              {stats?.lastAutoArchiveAt
                ? new Date(stats.lastAutoArchiveAt).toLocaleString("tr-TR")
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
              Batch {progress.batches} — Şu ana kadar{" "}
              <span className="font-medium text-foreground">
                {progress.archived.toLocaleString("tr-TR", { useGrouping: false })}
              </span>{" "}
              kayıt taşındı.
            </p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Arşivlemeyi başlat"
        description={`Son ${monthsToKeep} aydan eski tüm sistem log'ları arşiv tablosuna taşınacak. Bu işlem geri alınamaz (kayıtlar arşivde kalır ama aktif tablodan silinir).`}
        confirmLabel="Arşivle"
        onConfirm={() => {
          setConfirmOpen(false);
          archiveMutation.mutate(monthsToKeep);
        }}
        isPending={archiveMutation.isPending}
      />
    </div>
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
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  );
}

function formatCount(n: number | undefined): string {
  if (n === undefined) return "—";
  return n.toLocaleString("tr-TR", { useGrouping: false });
}
