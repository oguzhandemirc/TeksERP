import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { HistoryTable } from "./HistoryTable";

/**
 * Çalışma Oturumları — sahanın ayak izi: KİM hangi MAKİNEDE/İSTASYONDA hangi
 * CİHAZLA ne zaman çalıştı. "Canlı" sekmesi açık oturumları 10 sn'de bir tazeler
 * (+ zorla kapatma); "Geçmiş" filtreli kalıcı kayıttır. Üretim atfı
 * (RollOperation.machineId vb.) bu oturumlardan damgalanır.
 */
export function WorkSessionsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Çalışma Oturumları"
        actions={<RefreshButton queryKey={["work-sessions"]} successMessage="Oturumlar yenilendi" />}
      />
      <Tabs defaultValue="active" className="flex min-h-0 flex-1 flex-col">
        <PageTabsList>
            <PageTabsTrigger value="active">Canlı</PageTabsTrigger>
            <PageTabsTrigger value="history">Geçmiş</PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="active" className="mt-0 min-h-0 flex-1">
          <PageBody className="h-full p-6">
            <ActiveSessionsPanel />
          </PageBody>
        </TabsContent>
        {/* Geçmiş liste standardında: sabit süzgeç bandı → kenardan kenara tablo → alt şerit. */}
        <TabsContent value="history" className="mt-0 flex min-h-0 flex-1 flex-col">
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
