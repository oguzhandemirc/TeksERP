import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { allocationRepairService, type RepairableShipment } from "./service";
import { RepairPreviewDialog } from "./RepairPreviewDialog";

/**
 * SİPARİŞE YAZILAMAYAN SEVKİYATLAR — defter onarımı.
 *
 * NE İŞE YARAR: bir sevkiyat sevk edilirken çuvaldaki mal seçili sipariş
 * satırlarına yazılır. Bazen yazılamaz (sevk anında sipariş doluydu, sonradan
 * büyüdü, en/renk tutmadı) — mal çıkar, irsaliye basılır, ama sipariş defteri
 * o metrajı görmez ve sipariş "Açık" kalır. Planlamacı aynı malı yeniden
 * üretime verebilir. Bu ekran o sevkiyatları listeler ve TEK TEK onarır.
 *
 * ⚠️ ONARIM SESSİZ DEĞİLDİR: `setShipmentOrders` defteri yeniden kurar ve
 * irsaliyeyi v+1 olarak dondurur (eski sürüm tarihsel kayıt olarak kalır).
 * Bu yüzden ekran ayrı bir izin ister (`shipping:repair-allocation`) ve
 * onarımdan önce ne yazılacağını gösterir.
 *
 * ⚠️ "Onarılabilir" sütunu BUGÜNÜN verisiyle hesaplanır: 0 ise mal gerçekten
 * yazılamıyor demektir (sipariş dolu ya da spec tutmuyor) — düğme kapalıdır.
 */
export function AllocationRepairPage() {
  const qc = useQueryClient();
  const [onizleme, setOnizleme] = useState<RepairableShipment | null>(null);

  const liste = useQuery({
    queryKey: ["allocation-repair"],
    queryFn: () => allocationRepairService.list(),
    staleTime: 30_000,
  });
  const satirlar = useMemo(() => liste.data?.data ?? [], [liste.data]);
  const onarilabilir = useMemo(() => satirlar.filter((s) => s.onarilabilirMetraj > 0.001), [satirlar]);
  const toplamBosluk = useMemo(() => satirlar.reduce((a, s) => a + s.bosluk, 0), [satirlar]);
  const toplamKazanc = useMemo(
    () => onarilabilir.reduce((a, s) => a + s.onarilabilirMetraj, 0),
    [onarilabilir],
  );

  const mut = useMutation({
    mutationFn: (id: string) => allocationRepairService.repair(id),
    onSuccess: (res) => {
      const kazanc = res.data?.kazanc ?? 0;
      if (kazanc > 0.001) toast.success(res.message ?? "Defter onarıldı");
      else toast.warning(res.message ?? "Yazılabilecek yeni metraj bulunamadı");
      // Onarım defteri değiştirir → üç yüzey de tazelenir. `void`: tazeleme
      // best-effort, başarısızlığı onarımı geri almaz.
      void qc.invalidateQueries({ queryKey: ["allocation-repair"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      setOnizleme(null);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Siparişe yazılamayan sevkiyatlar"
        description="Mal çıkmış ama sipariş defterine işlenmemiş sevkiyatlar — tek tek onarılır."
        actions={<RefreshButton queryKey="allocation-repair" />}
      />
      <PageBody>
        {liste.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <OzetSerit
              sevkiyat={satirlar.length}
              bosluk={toplamBosluk}
              onarilabilirSevkiyat={onarilabilir.length}
              kazanc={toplamKazanc}
            />
            <SevkiyatTablosu
              satirlar={satirlar}
              onSec={setOnizleme}
              calisanId={mut.isPending ? (mut.variables as string | undefined) : undefined}
            />
          </div>
        )}
      </PageBody>

      <RepairPreviewDialog
        satir={onizleme}
        calisiyor={mut.isPending}
        onOpenChange={(o) => !o && setOnizleme(null)}
        onOnar={(id) => mut.mutate(id)}
      />
    </PageShell>
  );
}

/** Üstteki özet şeridi — "ne kadar mal defterde yok" tek bakışta. */
function OzetSerit({
  sevkiyat,
  bosluk,
  onarilabilirSevkiyat,
  kazanc,
}: {
  sevkiyat: number;
  bosluk: number;
  onarilabilirSevkiyat: number;
  kazanc: number;
}) {
  if (sevkiyat === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
        <CheckCircle2 className="h-5 w-5" />
        <span>Siparişe yazılamayan sevkiyat yok — defter temiz.</span>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Deftere işlenmemiş
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(bosluk).toLocaleString("tr-TR")} m</div>
        <div className="text-xs text-muted-foreground">{sevkiyat} sevkiyatta</div>
      </div>
      <div className="rounded-md border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Wrench className="h-4 w-4" /> Bugün onarılabilir
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(kazanc).toLocaleString("tr-TR")} m</div>
        <div className="text-xs text-muted-foreground">{onarilabilirSevkiyat} sevkiyatta</div>
      </div>
    </div>
  );
}

/** Sevkiyat listesi — onarılabilir olanlar üstte. */
function SevkiyatTablosu({
  satirlar,
  onSec,
  calisanId,
}: {
  satirlar: RepairableShipment[];
  onSec: (s: RepairableShipment) => void;
  calisanId?: string;
}) {
  const sirali = [...satirlar].sort((a, b) => b.onarilabilirMetraj - a.onarilabilirMetraj);
  if (sirali.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th>Sevkiyat</th>
            <th>Müşteri</th>
            <th>Sipariş</th>
            <th className="text-right">Çıkan</th>
            <th className="text-right">Yazılan</th>
            <th className="text-right">Eksik</th>
            <th className="text-right">Onarılabilir</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sirali.map((s) => {
            const onarilir = s.onarilabilirMetraj > 0.001;
            return (
              <tr key={s.shipmentId} className="border-t [&>td]:px-3 [&>td]:py-2">
                <td className="font-medium">
                  {s.shipmentNo}
                  <div className="text-xs text-muted-foreground">
                    {s.dispatchedAt ? new Date(s.dispatchedAt).toLocaleDateString("tr-TR") : "—"}
                  </div>
                </td>
                <td>{s.customer?.name ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{s.orderNumbers.join(", ") || "—"}</td>
                <td className="text-right">{Math.round(s.icerikMetraj)}</td>
                <td className="text-right">{Math.round(s.yazilanMetraj)}</td>
                <td className="text-right font-semibold text-amber-700 dark:text-amber-400">
                  {Math.round(s.bosluk)}
                </td>
                <td className="text-right font-semibold">
                  {onarilir ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {Math.round(s.onarilabilirMetraj)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant={onarilir ? "default" : "outline"}
                    disabled={!onarilir || calisanId === s.shipmentId}
                    onClick={() => onSec(s)}
                    title={
                      onarilir
                        ? "Ne yazılacağını göster"
                        : "Bugün de yazılamıyor — sipariş dolu ya da kumaş/renk/en tutmuyor"
                    }
                    className="gap-1.5"
                  >
                    {calisanId === s.shipmentId && <Loader2 className="h-4 w-4 animate-spin" />}
                    İncele
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
