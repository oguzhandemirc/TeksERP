import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, PackageSearch } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { packingService } from "./service";
import { useCustomerPool } from "./useCustomerPool";
import { ScanInBar } from "./ScanInBar";
import { PoolSackCard } from "./PoolSackCard";
import { OrderRequirements } from "./OrderRequirements";
import type { PoolSack } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

export interface PackingTarget {
  customerId: string;
  customerName: string;
  branchId?: string | null;
  branchName?: string | null;
}

/**
 * Müşteri-bazlı paketleme workspace'i (Çuval Havuzu). Açık çuvala top okut, tart+kod,
 * mühürle → çuval depo havuzuna girer. Sevkiyat AYRI kurulur (Çuval & Top Arama).
 */
export function PackingWorkspace({ target, onExit }: { target: PackingTarget; onExit: () => void }) {
  const nav = useNavigate();
  const poolQ = useCustomerPool(target.customerId);
  const sacks: PoolSack[] = useMemo(() => poolQ.data?.data.sacks ?? [], [poolQ.data]);
  const openSacks = useMemo(() => sacks.filter((s) => !s.sealed), [sacks]);
  const sealedSacks = useMemo(() => sacks.filter((s) => s.sealed), [sacks]);
  const [activeSackId, setActiveSackId] = useState<string | null>(null);

  // Aktif çuval geçerliliğini koru — son açık çuvalı aktif tut (okutma hep hedefe gider).
  useEffect(() => {
    const ids = openSacks.map((s) => s.id);
    setActiveSackId((prev) => (prev && ids.includes(prev) ? prev : (ids[ids.length - 1] ?? null)));
  }, [openSacks]);

  // Rehber: müşterinin açık siparişleri (ne isteniyor).
  const ordersQ = useQuery({
    queryKey: ["packing", "open-orders", target.customerId, target.branchId ?? null],
    queryFn: () => packingService.listOpenOrders({ customerId: target.customerId, branchId: target.branchId ?? undefined }),
    staleTime: 15_000,
  });
  const guideOrders = ordersQ.data?.data ?? [];

  const totalMeters = sacks.reduce((a, s) => a + s.totalQty, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" /> Başka Müşteri
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{target.customerName}</span>
              {target.branchName && <Badge variant="secondary" className="text-[10px]">{target.branchName}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {sealedSacks.length} mühürlü · {openSacks.length} açık çuval · {fmtM(totalMeters)} m
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => nav("/operations/sack-search")}>
          <PackageSearch className="mr-1 h-4 w-4" /> Havuzdan Sevkiyat Kur
        </Button>
      </div>

      <ScanInBar
        customerId={target.customerId}
        branchId={target.branchId ?? null}
        openSacks={openSacks}
        activeSackId={activeSackId}
        onSetActiveSack={setActiveSackId}
      />

      {guideOrders.length > 0 && (
        <div className="border-b bg-muted/20 px-6 py-3">
          <OrderRequirements orders={guideOrders} />
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {poolQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : sacks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Bu müşteri için henüz çuval yok. Yukarıdan top okutarak ilk çuvalı açın.
          </p>
        ) : (
          <div className="space-y-3">
            {openSacks.length > 0 && (
              <>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Açık çuvallar</h3>
                {openSacks.map((s) => (
                  <PoolSackCard
                    key={s.id}
                    sack={s}
                    customerId={target.customerId}
                    active={s.id === activeSackId}
                    onSetActive={() => setActiveSackId(s.id)}
                    otherOpenSacks={openSacks.filter((o) => o.id !== s.id)}
                  />
                ))}
              </>
            )}
            {sealedSacks.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">
                  Havuzda (mühürlü) — sevkiyata hazır
                </h3>
                {sealedSacks.map((s) => (
                  <PoolSackCard key={s.id} sack={s} customerId={target.customerId} otherOpenSacks={[]} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
