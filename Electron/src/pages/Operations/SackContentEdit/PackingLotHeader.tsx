import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Lock, MessageSquareText, MoreVertical, PackageOpen, Package, Truck, UserRound, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { PackingGroupEditDialog } from "./PackingGroupBar";
import { LotActionDialogs, type LotAction } from "./PackingLotActions";
import { KimlikKutusu } from "./SackIdentityStrip";
import { lotDeletable, lotSackLabel } from "./packingLotUi";
import { UNGROUPED_FILTER_VALUE, type PackingGroup } from "./types";

/** Seçili partinin DTO'su — `["packing-groups", …]` önekli: çuval değişince `invalidateSackHub` tazeler. */
export function useLotDetail(groupFilter: string) {
  const isUngrouped = groupFilter === UNGROUPED_FILTER_VALUE;
  const q = useQuery({
    queryKey: ["packing-groups", "detail", groupFilter],
    queryFn: () => sackHubService.getPackingGroup(groupFilter),
    enabled: !!groupFilter && !isUngrouped,
  });
  return { isUngrouped, lot: q.data?.data ?? null };
}

/**
 * Başlık yanı CARİ ROZETİ (2026-09-22 saha bulgusu: "hangi caride olduğumuzu
 * görmüyoruz") — parti listesi ve parti içi görünümün HER İKİSİNDE aynı okuma
 * (`packing-lot-summary` özet ucundan gelen ad, PackingLotListView'in tazelediği
 * sorgu KEY'iyle aynı — ikinci bir istek açmaz).
 */
export function CustomerNameBadge({ customerId }: { customerId: string }) {
  const summary = useQuery({
    queryKey: ["packing-lot-summary", customerId],
    queryFn: () => sackHubService.packingLotSummary(customerId),
  });
  const name = summary.data?.data.customer.name;
  if (!name) return null;
  return (
    <KimlikKutusu icon={UserRound} label="Cari">
      {name}
    </KimlikKutusu>
  );
}

/**
 * SAYFA BAŞLIĞI KUTULARI (parti içi): Parti · Çuval — sayfa adının yanında, çuval
 * editörüyle aynı kutu dili (saha 2026-09-22). Partisiz görünümde "Partisiz (havuz)".
 */
function PackingLotTitleBadge({ groupFilter }: { groupFilter: string }) {
  const qc = useQueryClient();
  const { isUngrouped, lot } = useLotDetail(groupFilter);
  // Parti kutusuna tıklayınca ad/not düzenlenir (saha 2026-09-22) — çuval editöründeki
  // Cari/Parti hücreleriyle aynı dil: değiştirmek istediğin şeye dokunursun.
  const [editing, setEditing] = useState<PackingGroup | null>(null);
  if (isUngrouped) {
    return (
      <KimlikKutusu icon={Boxes} label="Parti" muted>
        Partisiz (havuz)
      </KimlikKutusu>
    );
  }
  if (!lot) return null;
  const closed = lot.status === "CLOSED";
  return (
    <>
      <KimlikKutusu
        icon={closed ? Lock : Boxes}
        label={closed ? "Parti · sevk edildi" : "Parti"}
        muted={closed}
        title={closed ? (lot.note ?? undefined) : "Parti adını / notunu düzenle"}
        onClick={closed ? undefined : () => setEditing(lot)}
      >
        {lot.name}
      </KimlikKutusu>
      <PackingGroupEditDialog grup={editing} onOpenChange={(o) => !o && setEditing(null)} onDone={() => invalidateSackHub(qc)} lot />
      <KimlikKutusu icon={Package} label="Çuval" muted={lot.sackCount === 0 && lot.shippedSackCount === 0} compact>
        {lotSackLabel(lot)}
      </KimlikKutusu>
      {/* Parti notu — aynı düzenleme penceresi; notsuzken soluk "—" (kutu kaybolmaz). */}
      <KimlikKutusu
        icon={MessageSquareText}
        label="Parti notu"
        muted={!lot.note}
        title={closed ? undefined : "Parti notunu düzenle"}
        onClick={closed ? undefined : () => setEditing(lot)}
        wide
      >
        {lot.note ?? "—"}
      </KimlikKutusu>
    </>
  );
}

/**
 * Sayfa başlığının yanı — cari kutusu yalnız cari seçiliyken görünür; seçili değilken
 * görünmez bir yer tutucu aynı yüksekliği korur. Parti/çuval kutuları yalnız parti içindeyken.
 */
export function PackingLotTitleExtra({
  customerId,
  groupFilter,
}: {
  /** null = cari çalışma alanı değil (kapı ya da tüm cariler). */
  customerId: string | null;
  groupFilter: string | null;
}) {
  if (!customerId) {
    // Cari seçilmemişken kutu GÖRÜNMEZ ama yer tutar (`invisible`): başlık yüksekliği
    // cari seçilince zıplamasın (saha 2026-09-22).
    return (
      <span className="invisible" aria-hidden>
        <KimlikKutusu icon={UserRound} label="Cari">
          —
        </KimlikKutusu>
      </span>
    );
  }
  return (
    <>
      <CustomerNameBadge customerId={customerId} />
      {groupFilter && <PackingLotTitleBadge groupFilter={groupFilter} />}
    </>
  );
}

/**
 * SAYFA BAŞLIĞI ⋮ menüsü (parti içi): adlandır · havuza çıkar · depoya çek · sil — hepsi
 * partinin tamamına. Silme yalnız hiç çuvalı olmamış partide (sunucu 409); dolu parti
 * önce "Çuvalları havuza çıkar" ile boşaltılır. Silinince parti listesine dönülür.
 */
export function PackingLotHeaderMenu({ groupFilter, onDeleted }: { groupFilter: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<LotAction | null>(null);
  const { isUngrouped, lot } = useLotDetail(groupFilter);
  if (isUngrouped || !lot) return null;
  const refresh = () => invalidateSackHub(qc);
  return (
    <>
      {/* Sevk düğmesi alt şeritte ("Hepsini Sevk Et") — menüde tekrar yok. */}
      <LotRowMenu lot={lot} onDone={refresh} onDeleted={onDeleted} onAction={setAction} showShip={false} />
      <LotActionDialogs action={action} onClose={() => setAction(null)} onDone={refresh} />
    </>
  );
}

/**
 * ALT ŞERİT parti eylemi (parti içi): "Hepsini Sevk Et" (partinin TÜM depodaki
 * çuvalları — kapsam sunucudan `fetchAll` ile, ekrandaki sayfa değil). ⋮ menüsü sayfa
 * başlığındadır (`PackingLotHeaderMenu`). Parti dökümü alt şeritteki tek "İçerik Dökümü"
 * düğmesindedir (seçim yoksa parti).
 */
export function PackingLotBarActions({ groupFilter, onShipAll, shipping }: { groupFilter: string; onShipAll: () => void; shipping: boolean }) {
  const { isUngrouped, lot } = useLotDetail(groupFilter);
  if (isUngrouped || !lot || lot.status !== "OPEN" || lot.sackCount === 0) return null;
  return (
    <Button size="sm" className="gap-1.5 font-semibold" disabled={shipping} title={`${lot.name} partisindeki depodaki tüm çuvalları sevk et`} onClick={onShipAll}>
      <Truck className="h-4 w-4" /> {shipping ? "Hazırlanıyor…" : `Hepsini Sevk Et (${lot.sackCount})`}
    </Button>
  );
}

/**
 * Parti satır/şerit menüsü: sevk et · adlandır · çuvalları havuza çıkar · topları
 * depoya çek · sil. Durum ELLE DEĞİŞMEZ (kapat/aç yok — parti son çuvalı sevk edilince
 * kendiliğinden "sevk edildi" olur). Toplu eylemler `onAction` ile ÜST bileşene
 * iletilir (diyaloglar liste düzeyinde tek kez durur) ve yalnız açık + çuvallı partide
 * görünür. Sil `shipping:packing-lot` ister (belgeye basılan kimlik) — yetkisiz
 * kullanıcıda madde kapalı, sunucu ayrıca 403 verir. `onEdit` verilmezse kendi
 * düzenleme penceresini açar.
 */
export function LotRowMenu({
  lot,
  onDone,
  onDeleted,
  onEdit,
  onAction,
  showShip = true,
}: {
  lot: PackingGroup;
  onDone: () => void;
  /** Parti silindikten sonra (parti içindeysen listeye dönmek için). */
  onDeleted?: () => void;
  onEdit?: () => void;
  onAction?: (a: LotAction) => void;
  /** Sevk düğmesi şeritte ayrıca varsa menüde tekrar edilmez. */
  showShip?: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PackingGroup | null>(null);
  const canManage = useRoleAccess().hasPermission("shipping:packing-lot");
  const bulk = !!onAction && lot.status === "OPEN" && lot.sackCount > 0;
  const removeMut = useMutation({
    mutationFn: () => sackHubService.deletePackingGroup(lot.id),
    onSuccess: (res) => {
      toast.success(res.message ?? `${lot.name} silindi`);
      // Önce parti içinden ÇIK, sonra tazele: silinen partinin detay sorgusu önbellekten
      // düşürülmezse invalidation onu yeniden çeker ve 404 "Grup bulunamadı" toast'ı basar.
      onDeleted?.();
      qc.removeQueries({ queryKey: ["packing-groups", "detail", lot.id] });
      onDone();
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="px-2" aria-label="Parti menüsü">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {bulk && showShip && (
            <DropdownMenuItem onSelect={() => onAction?.({ kind: "ship", lot })}>
              <Truck className="mr-2 h-4 w-4" /> Sevk Et ({lot.sackCount} çuval)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => (onEdit ? onEdit() : setEditing(lot))}>Adı / notu düzenle</DropdownMenuItem>
          {bulk && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction?.({ kind: "release", lot })}>
                <PackageOpen className="mr-2 h-4 w-4" /> Çuvalları havuza çıkar…
              </DropdownMenuItem>
              {/* Toplar depoya, çuval kayıtları silinir — önizlemeli, teyitli. */}
              <DropdownMenuItem onSelect={() => onAction?.({ kind: "distribute", lot })}>
                <Warehouse className="mr-2 h-4 w-4" /> Topları depoya çek…
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {/* Sil yalnız HİÇ çuvalı olmamış partide — sunucu da 409 ile korur. */}
          <DropdownMenuItem
            disabled={!canManage || !lotDeletable(lot) || removeMut.isPending}
            className="text-destructive"
            onSelect={() => removeMut.mutate()}
          >
            Sil (yalnız boş parti)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!onEdit && <PackingGroupEditDialog grup={editing} onOpenChange={(o) => !o && setEditing(null)} onDone={onDone} lot />}
    </>
  );
}
