import { useState } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { usePerfSnapshot, usePerfReset, type PerfRoute, type SlowRequest } from "./perfService";
import { LiveTable } from "./LiveTable";
import { SlowList } from "./SlowList";
import { TrendChart } from "./TrendChart";

const trStamp = (ms: number): string => new Date(ms).toLocaleString("tr-TR");

// Uç bazında canlı istatistik. TOPLANABİLİR yalnız SAYAÇLAR (istek/hata adedi);
// p50/p95/max birer YÜZDELİK — toplanmaları anlamsızdır (ölçüm ≠ miktar), o yüzden
// summable DEĞİL: dosyanın TOPLAM satırında boş kalırlar.
const PERF_ROUTE_EXPORT_COLUMNS: ExportColumn<PerfRoute>[] = [
  { label: "Uç (endpoint)", value: (r) => r.route },
  { label: "İstek", value: (r) => r.count, summable: true },
  { label: "Hata (5xx)", value: (r) => r.errCount, summable: true },
  { label: "p50 (ms)", value: (r) => r.p50Ms },
  { label: "p95 (ms)", value: (r) => r.p95Ms },
  { label: "En yavaş / max (ms)", value: (r) => r.maxMs },
  { label: "Son görülme", value: (r) => trStamp(r.lastAt) },
];

// Yavaş istek defteri — tek tek istekler. Süre toplamı bilgi taşımadığı için
// (50 ayrı isteğin ms toplamı bir "iş yükü" değildir) summable kolon YOK.
const PERF_SLOW_EXPORT_COLUMNS: ExportColumn<SlowRequest>[] = [
  { label: "Zaman", value: (s) => trStamp(s.at) },
  { label: "Yöntem", value: (s) => s.method },
  { label: "Uç (endpoint)", value: (s) => s.route },
  { label: "Durum", value: (s) => (s.status === 499 ? "499 (istemci vazgeçti)" : s.status) },
  { label: "Süre (ms)", value: (s) => s.ms },
];

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
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Canlı İstatistik — p95'e göre (en şüpheli üstte)
            </CardTitle>
            <ListExportMenu
              name="Endpoint Performansı"
              rows={snap?.routes ?? []}
              columns={PERF_ROUTE_EXPORT_COLUMNS}
              notes={[
                snap
                  ? `Canlı sayaçlar: ${trStamp(snap.sinceAt)} tarihinden beri ${snap.totalCount.toLocaleString("tr-TR")} istek (${(snap.routes ?? []).length} uç).`
                  : "Canlı sayaçlar.",
                "Ölçüm süreç belleğindedir — sunucu yeniden başlarsa veya sayaçlar sıfırlanırsa sıfırdan başlar; kalıcı günlük trend ayrıdır.",
                "p50 / p95 / max birer gecikme ölçüsüdür — toplanmaz; TOPLAM satırı yalnız istek ve hata adedini toplar.",
              ]}
            />
          </CardHeader>
          <CardContent>
            <LiveTable routes={snap?.routes ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Yavaş İstek Defteri (≥1 sn, son 50)</CardTitle>
            <ListExportMenu
              name="Yavaş İstek Defteri"
              rows={snap?.slowRequests ?? []}
              columns={PERF_SLOW_EXPORT_COLUMNS}
              notes={[
                "Yalnız ≥1 sn süren son 50 istek (en yenisi başta) — tüm istekler değil.",
                "Defter süreç belleğindedir; sunucu yeniden başlarsa veya sayaçlar sıfırlanırsa boşalır.",
                "Durum 499 = istemci yanıtı beklemekten vazgeçti (zaman aşımı / pencere kapandı).",
              ]}
            />
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
