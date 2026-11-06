// =============================================================================
// HİZMET FİYAT TABLOSU (Tanımlar + Ön Muhasebe) — 2026-11-06
// =============================================================================
// Solda hizmetler, sağda seçili hizmetin kademe tablosu. Uygulanan fiyat ve rozeti backend'den gelir (fatura
// çözücüsüyle aynı sıra — panel sırayı YENİDEN HESAPLAMAZ). Yürürlük tarihi seçiliyken her kayıt ileri tarihlidir.
// =============================================================================
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { type Currency } from "./service";
import { ServiceList } from "./ServiceList";
import { ServicePricesToolbar } from "./ServicePricesToolbar";
import { TablePane } from "./TablePane";
import { PriceHistorySheet } from "./PriceHistorySheet";
import { GramFillDialog } from "./GramFillDialog";
import { useServicePriceMutations } from "./useServicePriceMutations";
import { useServicePricesData } from "./useServicePricesData";
import { useServicePricesAccess } from "./useServicePricesAccess";

export function ServicePricesPage() {
  const access = useServicePricesAccess();
  // Hizmetler listesindeki "Fiyat tablosu" bağlantısı `?item=<id>` ile gelir (yalnız ilk seçim).
  const [itemId, setItemId] = useState<string | null>(useSearchParams()[0].get("item"));
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [validFromDay, setValidFromDay] = useState<string | null>(null);
  const [history, setHistory] = useState<{ valueId: string | null; label: string } | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const mutations = useServicePriceMutations();

  const { servicesQ, tableQ } = useServicePricesData(access.open, itemId, currency, customerId);
  const table = tableQ.data;

  return (
    <PageShell>
      <PageHeader
        title="Hizmet Fiyat Tablosu"
        description="Hizmetin kademe (çeşit) fiyatları: genel ve müşteriye özel, ileri tarihli fiyat dahil. Uygulanan fiyat faturadaki sırayla hesaplanır: müşteri kademe → müşteri gram → genel kademe → istasyon gram → kalem fiyatı."
      />
      {access.isLoading ? (
        <div className="p-6">
          <Skeleton className="h-40" />
        </div>
      ) : access.blocked ? (
        <div className="p-6">
          <Callout tone="muted" title={access.blocked.title}>
            {access.blocked.body}
          </Callout>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ServiceList
            rows={servicesQ.data}
            isLoading={servicesQ.isLoading}
            isError={servicesQ.isError}
            onRetry={() => void servicesQ.refetch()}
            selectedId={itemId}
            onSelect={setItemId}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ServicePricesToolbar
              currency={currency}
              onCurrency={setCurrency}
              customerId={customerId}
              onCustomer={setCustomerId}
              validFromDay={validFromDay}
              onValidFromDay={setValidFromDay}
              onGramFill={access.canWrite && table ? () => setFillOpen(true) : null}
            />
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <TablePane
                itemId={itemId}
                tableQ={tableQ}
                canWrite={access.canWrite}
                validFromDay={validFromDay}
                mutations={mutations}
                onHistory={(valueId, label) => setHistory({ valueId, label })}
              />
            </div>
          </div>
        </div>
      )}
      {history && itemId && (
        <PriceHistorySheet
          itemId={itemId}
          currency={currency}
          valueId={history.valueId}
          label={history.label}
          onClose={() => setHistory(null)}
        />
      )}
      {fillOpen && table && (
        <GramFillDialog
          table={table}
          validFromDay={validFromDay}
          mutations={mutations}
          onClose={() => setFillOpen(false)}
        />
      )}
    </PageShell>
  );
}
