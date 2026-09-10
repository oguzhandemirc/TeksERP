import { MonitorSmartphone, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useConnectedClients } from "./hooks";
import {
  activeWindowLabel,
  agoLabel,
  clientTitle,
  isOutdated,
  kindLabel,
} from "./clients-utils";

const stamp = (iso: string): string => new Date(iso).toLocaleString("tr-TR");

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

      <PageBody className="space-y-4 p-6">
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

        {snap && snap.clients.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title="Henüz künye bildiren istemci yok"
            description="Sunucu yeni başlamış olabilir ya da sahadaki paneller/tabletler künye gönderen sürüme henüz güncellenmemiş olabilir."
          />
        ) : (
          snap && (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kurulum</TableHead>
                    <TableHead>Tür</TableHead>
                    <TableHead>Sürüm</TableHead>
                    <TableHead>Son kullanıcı</TableHead>
                    <TableHead>Son görülme</TableHead>
                    <TableHead className="text-right">Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snap.clients.map((c) => {
                    const eski = isOutdated(c.version, c.expectedVersion);
                    return (
                      <TableRow key={c.instanceId}>
                        <TableCell className="font-medium">
                          {clientTitle(c.deviceName, c.instanceId)}
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {c.instanceId.slice(0, 8)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{kindLabel(c.kind)}</TableCell>
                        <TableCell className="text-sm">
                          {c.version ? (
                            <span className={cn("tabular-nums", eski && "text-warning font-medium")}>
                              {c.version}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {eski && (
                            <div className="text-[11px] text-warning">
                              güncel değil (yayında {c.expectedVersion})
                            </div>
                          )}
                          {/* Çıkarılmış sürümü beyan edilmiş gibi göstermek okuyucuyu
                              yanıltır. Ayrıca kendi başına bulgu: künye başlıkları
                              2026-09-04'te geldi → beyan etmeyen kurulum zaten eski. */}
                          {!c.declared && (
                            <div className="text-[11px] text-muted-foreground">
                              sürümünü bildirmiyor — adres bilgisinden okundu
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.lastUser ? (
                            <>
                              {c.lastUser.fullName ?? c.lastUser.username}
                              <div className="text-[11px] text-muted-foreground">
                                {c.lastUser.username}
                                {c.lastUser.isSystemAccount && " · en yetkili hesap"}
                              </div>
                            </>
                          ) : (
                            /* null = kimliksiz istek (giriş ekranı). "Kimse yok" DEĞİL. */
                            <span className="text-muted-foreground">Bilinmiyor</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {agoLabel(c.lastSeenAt, snap.now)}
                          <div className="text-[11px] text-muted-foreground">
                            {stamp(c.lastSeenAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={c.active ? "default" : "muted"}>
                            {c.active ? "Aktif" : "Pasif"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </PageBody>
    </PageShell>
  );
}
