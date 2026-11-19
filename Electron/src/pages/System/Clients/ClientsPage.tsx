import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { RefreshButton } from "@/components/RefreshButton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { InstallationsTab } from "./InstallationsTab";
import { OPEN_SESSIONS_KEY, OpenSessionsTab } from "./OpenSessionsTab";

const TAB_PANE = "mt-0 flex min-h-0 flex-1 flex-col";

/**
 * Bağlı İstemciler — iki görünüm:
 * · Kurulumlar: hangi kurulum, hangi sürüm, en son ne zaman istek gönderdi (süreç belleği).
 * · Açık oturumlar: kim, hangi cihazda, hangi uygulama sürümüyle oturum açık (DB); `admin:users`
 *   sahibi oturumu sonlandırabilir.
 * Sayfa açılışında bir kez çeker, sonrası "Yenile" — otomatik yoklama YOK (kullanıcı kararı).
 */
export function ClientsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Bağlı İstemciler"
        description="Sunucuya bağlanan panel/tablet/tarayıcıların sürümü, son görülme zamanı ve açık oturumları."
        actions={
          <RefreshButton
            queryKey={["connected-clients"]}
            extraKeys={[[OPEN_SESSIONS_KEY]]}
            successMessage="İstemci listesi yenilendi"
          />
        }
      />
      <Tabs defaultValue="installations" className="flex min-h-0 flex-1 flex-col">
        <PageTabsList>
          <PageTabsTrigger value="installations">Kurulumlar</PageTabsTrigger>
          <PageTabsTrigger value="sessions">Açık oturumlar</PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="installations" className={TAB_PANE}><InstallationsTab /></TabsContent>
        <TabsContent value="sessions" className={TAB_PANE}><OpenSessionsTab /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
