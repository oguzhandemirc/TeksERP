import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { allocationRepairService, type RepairableShipment } from "./service";
import { RepairPreviewDialog } from "./RepairPreviewDialog";
import { RepairCompareSheets } from "./RepairCompareSheets";
import { RepairSummary, RepairShipmentTable } from "./RepairTable";

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
 *
 * ⚠️ NUMARALAR TIKLANABİLİR (2026-09-07): buradaki satırlar zaten gözden
 * kaçmış işlerdir; "bu sevkiyat neydi, o sipariş neydi" sorusu onarımdan ÖNCE
 * sorulur. Sipariş soldan, sevkiyat sağdan açılır ve ikisi aynı anda durur.
 */
export function AllocationRepairPage() {
  const qc = useQueryClient();
  const [onizleme, setOnizleme] = useState<RepairableShipment | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);

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
      {/* p-6: PageBody varsayilan olarak dolgu TASIMAZ (bkz. PageShell basligi) —
          verilmeyince ozet kutulari basligin dibine yapisiyordu. */}
      <PageBody className="p-6">
        {liste.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <RepairSummary
              shipmentCount={satirlar.length}
              gap={toplamBosluk}
              repairableCount={onarilabilir.length}
              gain={toplamKazanc}
            />
            <RepairShipmentTable
              rows={satirlar}
              onSelect={setOnizleme}
              onOrder={setOrderId}
              onShipment={setShipmentId}
              busyId={mut.isPending ? (mut.variables as string | undefined) : undefined}
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

      <RepairCompareSheets
        orderId={orderId}
        shipmentId={shipmentId}
        onOrderClose={() => setOrderId(null)}
        onShipmentClose={() => setShipmentId(null)}
      />
    </PageShell>
  );
}
