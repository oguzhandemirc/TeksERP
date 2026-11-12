import { MonitorSmartphone, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { useConnectedClients } from "./hooks";
import { activeWindowLabel } from "./clients-utils";
import { clientStamp as stamp, useClientsTable } from "./clientsColumns";
import type { ConnectedClient } from "./service";

const NO_CLIENTS: ConnectedClient[] = [];

/**
 * Bağlı İstemciler — hangi kurulum, hangi sürüm, en son ne zaman istek
 * gönderdi ve o sırada kim oturumdaydı.
 *
 * ⚠️ EKRANIN İDDİASI DAR VE YAZILI: "Aktif" rozeti CANLI BAĞLANTI demek
 * DEĞİLDİR — ölçülen tek şey, o kurulumdan son N dakika içinde bir istek
 * gelmiş olmasıdır. Eşik sunucudan gelir (`activeWindowMs`), ekran kendi
 * sayısını yazmaz.
 *
 * ⚠️ Sayfa açılışında BİR KEZ çeker, sonrası "Yenile". Otomatik yoklama YOK
 * (kullanıcı kararı) — liste bir envanterdir, canlı gösterge değil.
 */
export function ClientsPage() {
  const q = useConnectedClients();
  const snap = q.data;
  const esik = snap ? activeWindowLabel(snap.activeWindowMs) : null;
  const clients = snap?.clients ?? NO_CLIENTS;
  const table = useClientsTable(clients, snap?.now ?? "");

  return (
    <PageShell>
      <PageHeader
        title="Bağlı İstemciler"
        description={
          esik
            ? `Son ${esik} içinde sunucuya istek gönderen kurulumlar "Aktif" sayılır.`
            : "Sunucuya bağlanan panel/tablet/tarayıcıların sürümü ve son görülme zamanı."
        }
        actions={
          <RefreshButton
            queryKey={["connected-clients"]}
            successMessage="İstemci listesi yenilendi"
          />
        }
      />

      <ListToolbar className="flex-row items-center">
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bağlı istemciler" />
        </div>
      </ListToolbar>
      <ListMessage className="shrink-0 space-y-4 empty:hidden">
        {q.isError && (
          <Callout tone="danger" icon={AlertTriangle} title="Liste alınamadı">
            Sunucuya ulaşılamıyor. "Yenile" ile tekrar deneyin.
          </Callout>
        )}

        {snap && (
          <Callout tone="muted" title="Bu liste ne ölçüyor?">
            Her istemci isteklerine kendi künyesini ekler; sunucu bunu{" "}
            <strong>belleğinde</strong> tutar. <strong>“Aktif”</strong> rozeti “şu an
            bağlı” değil, <strong>“son {esik} içinde istek gönderdi”</strong> demektir —
            açık ama boşta duran bir panel bir süre sonra listede pasif görünür.{" "}
            <strong>“Son kullanıcı”</strong> o makinede en son görülen kişidir; vardiya
            değişiminde önceki kullanıcı, yeni istek gelene kadar yazılı kalır. Sunucu{" "}
            {stamp(snap.serverStartedAt)} tarihinde başladı — <strong>yeniden
            başlatıldığında liste boşalır</strong> ve istemciler ilk istekleriyle geri
            döner.
          </Callout>
        )}

        {snap && snap.clients.length === 0 && (
          <EmptyState
            icon={MonitorSmartphone}
            title="Henüz künye bildiren istemci yok"
            description="Sunucu yeni başlamış olabilir ya da sahadaki paneller/tabletler künye gönderen sürüme henüz güncellenmemiş olabilir."
          />
        )}
      </ListMessage>
      {clients.length > 0 ? <DataTable table={table} exportName="Bağlı istemciler" /> : <ListBody />}
      <ListFooter loaded={snap?.clients.length ?? 0} />
    </PageShell>
  );
}
