import { useState } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { usePerfSnapshot, usePerfReset } from "./perfService";
import { LiveTable } from "./LiveTable";
import { SlowList } from "./SlowList";
import { TrendChart } from "./TrendChart";

/** Endpoint Performansı — Faz 2/3 gözlemlenebilirlik ekranı.
 *  Canlı tablo süreç belleğinden (restart'ta sıfırlanır); trend kalıcı günlük
 *  özetlerden gelir (docs/history/SAHA-DAYANIKLILIK-FAZ3.md §P1/§P4). */
export function PerfPage() {
  const snapshotQ = usePerfSnapshot();
  const resetPerf = usePerfReset();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [trendRoute, setTrendRoute] = useState<string | null>(null);

  const snap = snapshotQ.data;
  const persistUnhealthy = (snap?.persist.flushFailures ?? 0) > 0;

  const doReset = async () => {
    setResetting(true);
    try {
      await resetPerf();
      toast.success("Canlı sayaçlar sıfırlandı (günlük geçmiş korunur).");
      setConfirmOpen(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Endpoint Performansı"
        description={
          snap
            ? `${new Date(snap.sinceAt).toLocaleString("tr-TR")} tarihinden beri ${snap.totalCount.toLocaleString("tr-TR")} istek ölçüldü.`
            : "Route bazında gecikme istatistikleri ve yavaş istek defteri."
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Canlı Sayaçları Sıfırla
          </Button>
        }
      />

      <PageBody className="space-y-6 p-6">
        {snapshotQ.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>Canlı istatistik alınamadı — sunucuya ulaşılamıyor. 15 sn'de bir yeniden denenir.</span>
          </div>
        )}
        {persistUnhealthy && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Kalıcı özet yazımı {snap?.persist.flushFailures} kez başarısız oldu — son hata:{" "}
              <code className="text-xs">{snap?.persist.lastFlushError}</code>. Canlı sayaçlar
              etkilenmez; günlük trend eksik kalabilir.
            </span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Günlük Trend (kalıcı özetlerden)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart days={14} route={trendRoute} onRouteChange={setTrendRoute} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Canlı İstatistik — p95'e göre (en şüpheli üstte)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LiveTable routes={snap?.routes ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yavaş İstek Defteri (≥1 sn, son 50)</CardTitle>
          </CardHeader>
          <CardContent>
            <SlowList items={snap?.slowRequests ?? []} />
          </CardContent>
        </Card>
      </PageBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Canlı sayaçlar sıfırlansın mı?"
        description="Süreç belleğindeki route istatistikleri ve yavaş istek defteri temizlenir; kalıcı günlük özetler (trend) SİLİNMEZ. İşlem denetim günlüğüne yazılır."
        confirmLabel="Sıfırla"
        destructive
        onConfirm={doReset}
        isPending={resetting}
      />
    </PageShell>
  );
}
