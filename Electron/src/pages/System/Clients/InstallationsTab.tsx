// Kurulumlar sekmesi — süreç belleğindeki istemci defteri (sunucu yeniden başlarsa boşalır).
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { InfoPopover } from "@/components/ui/info-popover";
import { useListSearch } from "@/hooks/useListSearch";
import { useConnectedClients } from "./hooks";
import { activeWindowLabel } from "./clients-utils";
import { clientStamp as stamp, useClientsTable } from "./clientsColumns";
import type { ConnectedClient } from "./service";

const NO_CLIENTS: ConnectedClient[] = [];

/** "Bu liste ne ölçüyor?" — kart içinde kutu değil, araç satırında ⓘ balonu. */
function MeasureInfo({ esik, serverStartedAt }: { esik: string; serverStartedAt: string }) {
  return (
    <InfoPopover
      label="Bu liste ne ölçüyor?"
      desc={
        <>
          Her istemci isteklerine kendi künyesini ekler; sunucu bunu <strong>belleğinde</strong> tutar.{" "}
          <strong>“Aktif”</strong> rozeti “şu an bağlı” değil, <strong>“son {esik} içinde istek gönderdi”</strong> demektir —
          açık ama boşta duran bir panel bir süre sonra listede pasif görünür. <strong>“Son kullanıcı”</strong> o makinede en son
          görülen kişidir; vardiya değişiminde önceki kullanıcı, yeni istek gelene kadar yazılı kalır. Sunucu {stamp(serverStartedAt)}{" "}
          tarihinde başladı — <strong>yeniden başlatıldığında liste boşalır</strong> ve istemciler ilk istekleriyle geri döner. Kimin
          hangi cihazda oturumu açık, <strong>“Açık oturumlar”</strong> sekmesinde.
        </>
      }
    />
  );
}

/**
 * ⚠️ "Aktif" rozeti CANLI BAĞLANTI demek DEĞİLDİR — ölçülen tek şey, o kurulumdan son N dakika
 * içinde istek gelmesidir; eşik sunucudan gelir (`activeWindowMs`). Otomatik yoklama YOK
 * (kullanıcı kararı) — liste bir envanterdir, canlı gösterge değil.
 */
export function InstallationsTab() {
  const { search, setSearch, term } = useListSearch();
  const q = useConnectedClients(term);
  const snap = q.data;
  const clients = snap?.clients ?? NO_CLIENTS;
  const table = useClientsTable(clients, snap?.now ?? "");

  return (
    <>
      <ListToolbar className="flex-row items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Tür, sürüm, cihaz adı ya da son kullanıcı ara" />
        {snap && <MeasureInfo esik={activeWindowLabel(snap.activeWindowMs)} serverStartedAt={snap.serverStartedAt} />}
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bağlı istemciler" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        exportName="Bağlı istemciler"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Sunucuya ulaşılamıyor — liste alınamadı."
        onRetry={() => void q.refetch()}
        emptyText={term ? "Aramaya uyan istemci yok." : "Henüz künye bildiren istemci yok"}
        emptyDescription={term ? undefined : "Sunucu yeni başlamış olabilir ya da sahadaki paneller/tabletler künye gönderen sürüme henüz güncellenmemiş olabilir."}
      />
      <ListFooter loaded={clients.length} />
    </>
  );
}
