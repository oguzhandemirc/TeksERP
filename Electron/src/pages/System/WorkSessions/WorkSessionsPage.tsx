import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <div className="border-b px-6 pt-3">
          <TabsList>
            <TabsTrigger value="active">Canlı</TabsTrigger>
            <TabsTrigger value="history">Geçmiş</TabsTrigger>
          </TabsList>
        </div>
        <PageBody className="p-6">
          <TabsContent value="active" className="mt-0">
            <ActiveSessionsPanel />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <HistoryTable />
          </TabsContent>
        </PageBody>
      </Tabs>
    </PageShell>
  );
}
