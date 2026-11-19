// Kurulumlar sekmesi — süreç belleğindeki istemci defteri (sunucu yeniden başlarsa boşalır).
import { MonitorSmartphone, AlertTriangle } from "lucide-react";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { useListSearch } from "@/hooks/useListSearch";
import { useConnectedClients } from "./hooks";
import { activeWindowLabel } from "./clients-utils";
import { clientStamp as stamp, useClientsTable } from "./clientsColumns";
import type { ConnectedClient } from "./service";

const NO_CLIENTS: ConnectedClient[] = [];

/**
 * ⚠️ "Aktif" rozeti CANLI BAĞLANTI demek DEĞİLDİR — ölçülen tek şey, o kurulumdan son N dakika
 * içinde istek gelmesidir; eşik sunucudan gelir (`activeWindowMs`). Otomatik yoklama YOK
 * (kullanıcı kararı) — liste bir envanterdir, canlı gösterge değil.
 */
export function InstallationsTab() {
  const { search, setSearch, term } = useListSearch();
  const q = useConnectedClients(term);
  const snap = q.data;
  const esik = snap ? activeWindowLabel(snap.activeWindowMs) : null;
  const clients = snap?.clients ?? NO_CLIENTS;
  const table = useClientsTable(clients, snap?.now ?? "");

  return (
    <>
      <ListToolbar className="flex-row items-center">
        <div className="ml-auto flex items-center gap-1.5">
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Tür, sürüm, cihaz adı ya da son kullanıcı ara" />
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
            döner. Kimin hangi cihazda oturumu açık, <strong>“Açık oturumlar”</strong> sekmesinde.
          </Callout>
        )}

        {snap && snap.clients.length === 0 && term && (
          <p className="py-6 text-center text-sm text-muted-foreground">Aramaya uyan istemci yok.</p>
        )}
        {snap && snap.clients.length === 0 && !term && (
          <EmptyState
            icon={MonitorSmartphone}
            title="Henüz künye bildiren istemci yok"
            description="Sunucu yeni başlamış olabilir ya da sahadaki paneller/tabletler künye gönderen sürüme henüz güncellenmemiş olabilir."
          />
        )}
      </ListMessage>
      {clients.length > 0 ? <DataTable table={table} exportName="Bağlı istemciler" /> : <ListBody />}
      <ListFooter loaded={snap?.clients.length ?? 0} />
    </>
  );
}
