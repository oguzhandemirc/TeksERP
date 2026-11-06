// Sağ bölme: seçim yok · yükleniyor · hata (yeniden dene) · kademesiz bilgi · tablo + gram fiyatı dipnotu.
import type { UseQueryResult } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServicePriceTable } from "./service";
import { ServicePriceGrid } from "./ServicePriceGrid";
import type { useServicePriceMutations } from "./useServicePriceMutations";

interface Props {
  itemId: string | null;
  tableQ: UseQueryResult<ServicePriceTable>;
  canWrite: boolean;
  validFromDay: string | null;
  mutations: ReturnType<typeof useServicePriceMutations>;
  onHistory: (valueId: string | null, label: string) => void;
}

export function TablePane({ itemId, tableQ, canWrite, validFromDay, mutations, onHistory }: Props) {
  const table = tableQ.data;
  return (
    <>
      {!itemId ? (
        <EmptyState
          icon={Table2}
          title="Soldan bir hizmet seçin"
          description="Kademe fiyatlarını görmek ve düzenlemek için hizmeti seçin. Hücreye tıklayın ya da rakam yazın; Enter kaydeder ve alt satıra geçer, Esc vazgeçer."
        />
      ) : tableQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : tableQ.isError || !table ? (
        <div className="space-y-2 text-sm">
          <p className="text-destructive">Fiyat tablosu yüklenemedi. Bu “fiyat yok” demek değildir.</p>
          <Button size="sm" variant="outline" onClick={() => void tableQ.refetch()}>
            Tekrar dene
          </Button>
        </div>
      ) : (
        <>
          {table.tiers.length === 0 && (
            <Callout tone="info" title="Bu hizmete bağlı kademe yok" className="mb-3">
              Kademe fiyatı girmek için Kumaş Özellikleri ekranında özelliği (ya da değeri) bu hizmete
              eşleyin. Kalem fiyatı aşağıdan girilebilir.
            </Callout>
          )}
          <ServicePriceGrid
            table={table}
            canWrite={canWrite}
            validFromDay={validFromDay}
            mutations={mutations}
            onHistory={onHistory}
          />
          {table.gram.stations.length + (table.gram.customer ? 1 : 0) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Gram fiyatı: {table.gram.customer ? `müşteri ${table.gram.customer} · ` : ""}
              {table.gram.stations.map((s) => `${s.name} ${s.price}`).join(" · ")} {table.currency}/gr
            </p>
          )}
        </>
      )}
    </>
  );
}
