import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Check, FileText, Maximize2, Search, Truck, Undo2 } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { CancelShipmentDialog } from "./CancelShipmentDialog";
import { UndoDispatchDialog } from "./UndoDispatchDialog";
import { DispatchConfirmDialog } from "@/pages/Operations/SackStore/DispatchConfirmDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { apiErrorText } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { shipmentService } from "./service";
import { shipmentStatusLabels, shipmentStatusTones } from "./types";
import { ShipmentDispatchNote } from "./ShipmentDispatchNote";
import { ShipmentSheetBody } from "./ShipmentSheetBody";
import { normalizeSearch, rollMatchesQuery, rollMatchesContext, csvIds } from "./roll-search";

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Liste kumaş/renk (içerik) filtresinden gelen bağlam (csv id) — eşleşen toplar
   *  vurgulanır + "yalnız eşleşenler" süzgeci; "Tam Sayfa"ya da taşınır. */
  matchItem?: string;
  matchColor?: string;
  /** İki panel aynı anda açıkken karartma çizilmez — bkz. `ui/sheet`. */
  hideOverlay?: boolean;
}

export function ShipmentDetailSheet({
  shipmentId,
  open,
  onOpenChange,
  matchItem,
  matchColor,
  hideOverlay,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyMatched, setOnlyMatched] = useState(false);
  const openTarget = useOpenTarget();
  const q = normalizeSearch(filter);

  const matchItemIds = useMemo(() => csvIds(matchItem), [matchItem]);
  const matchColorIds = useMemo(() => csvIds(matchColor), [matchColor]);
  const hasMatchContext = matchItemIds.length > 0 || matchColorIds.length > 0;

  // Lazy — yalnız açılınca detay çekilir. queryKey irsaliye ile paylaşılır (cache).
  const query = useQuery({
    queryKey: ["shipment-detail", shipmentId],
    queryFn: () => shipmentService.getDetail(shipmentId!),
    enabled: open && Boolean(shipmentId),
    staleTime: 30_000,
  });
  const d = query.data?.data;
  const matchCount = useMemo(
    () => (d ? d.rolls.filter((r) => rollMatchesQuery(r, q)).length : 0),
    [d, q],
  );
  // Liste içerik filtresine uyan top sayısı (aramadan bağımsız — bağlam vurgusu).
  const matchedTotal = useMemo(
    () =>
      d && hasMatchContext
        ? d.rolls.filter((r) => rollMatchesContext(r, matchItemIds, matchColorIds)).length
        : 0,
    [d, hasMatchContext, matchItemIds, matchColorIds],
  );
  // Bağlam yoksa "yalnız eşleşenler" anlamsız — kapalı tut.
  const effectiveOnlyMatched = hasMatchContext && onlyMatched;
  // Tam sayfaya bağlamı taşı (matchItem/matchColor query) — vurgu orada da açılsın.
  const fullPageHref = useMemo(() => {
    if (!shipmentId) return null;
    const qp = new URLSearchParams();
    if (matchItem) qp.set("matchItem", matchItem);
    if (matchColor) qp.set("matchColor", matchColor);
    const qs = qp.toString();
    return qs ? `/operations/shipments/${shipmentId}?${qs}` : `/operations/shipments/${shipmentId}`;
  }, [shipmentId, matchItem, matchColor]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideOverlay={hideOverlay} className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.shipmentNo ?? "Sevkiyat"}</span>
            {d && <StatusBadge status={d.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />}
          </SheetTitle>
          <SheetDescription>
            {d
              ? `${d.customer.name}${d.branch ? " · " + d.branch.name + (d.branch.code ? ` (${d.branch.code})` : "") : ""}`
              : "Yükleniyor…"}
          </SheetDescription>
        </SheetHeader>

        {query.isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : !d ? (
          /* ⚠️ "Sevkiyat bulunamadı." YAZILAMAZ (GoodsReceiptDetailSheet kalıbı):
             `getDetail` non-nullable döner, yani `!d` YALNIZCA hata demektir —
             yetki (403), ağ ya da 5xx. Sevkiyatın YOK olduğunu iddia etmek
             düpedüz yanlıştır ve bu çekmece 2026-08-15'ten beri FATURA
             detayından da açılıyor: `finance:read` taşıyıp `shipping:read`
             taşımayan "Kasa / Tahsilat" rolü, faturanın dayandığı sevk
             belgesine tıklayınca ekranda kalan tek cümle olarak onu okurdu
             (interceptor'ın 403 toast'ı saniyelerde kaybolur). */
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Sevkiyat detayı yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              {apiErrorText(
                query.error,
                "Bu, sevkiyatın silindiği anlamına GELMEZ — içerik sunucudan alınamadı. Yetkiniz yoksa sevkiyat ekranına erişim isteyin.",
              )}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
                onClick={(e) => {
                  onOpenChange(false);
                  if (fullPageHref) openTarget(fullPageHref, e);
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" /> Tam Sayfa
              </Button>
              {/* Ana aksiyon → mor primary (göze ilk çarpan). */}
              <Button type="button" size="sm" variant="default" className="gap-1" onClick={() => setNoteOpen(true)}>
                <FileText className="h-3.5 w-3.5" /> Sevk İrsaliyesi
              </Button>
              {/* Sevk Et: PLANNED sevkiyat BURADAN da çıkarılır (2026-08-22) — Sevk
                  Kapısı ekranı yalnız sevk onayı bayrağı açıkken menüde; bayrak
                  kapalıyken storno ile PLANNED'a dönmüş (ya da bayrak açıkken
                  kurulup sonra bayrağı kapatılmış) sevkiyatın çıkış yolu bu düğme.
                  Aynı ORTAK onay dialog'u (çuvallar canlı listelenir, irsaliye
                  başarı panelinden basılır). */}
              {d.status === "PLANNED" && (
                <PermissionGate permission="shipping:write">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="gap-1"
                    onClick={() => setDispatchOpen(true)}
                  >
                    <Truck className="h-3.5 w-3.5" /> Sevk Et
                  </Button>
                </PermissionGate>
              )}
              {/* İptal: DISPATCHED/CANCELLED dışında — cancel-preview'lı yıkıcı onay. */}
              {d.status !== "DISPATCHED" && d.status !== "CANCELLED" && (
                <PermissionGate permission="shipping:write">
                  {/* Yıkıcı aksiyon → kırmızı-tonlu (belirgin ama primary'yi ezmez). */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" /> İptal Et
                  </Button>
                </PermissionGate>
              )}
              {/* Storno: yalnız SEVK EDİLMİŞ sevkiyatta. Uygunluğun geri kalanı
                  (fatura/iade/aynı gün) backend'in tek kaynağından gelir ve
                  dialogda `blockReason` ile söylenir — burada kopyalanmaz. */}
              {d.status === "DISPATCHED" && (
                <PermissionGate permission="shipping:undo-dispatch">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setUndoOpen(true)}
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Sevki Geri Al
                  </Button>
                </PermissionGate>
              )}
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Top ara (barkod, kumaş, renk)..."
                  className="h-8 pl-8 text-sm"
                />
                {q && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground">
                    {matchCount} eşleşti
                  </span>
                )}
              </div>
              {/* Liste kumaş/renk filtresinden gelindiyse: eşleşme rozeti + yalnız-eşleşenler. */}
              {hasMatchContext && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-amber-500/50 bg-amber-500/10 text-amber-600"
                    title="Liste kumaş/renk filtresine uyan (eşleşen) top sayısı"
                  >
                    {matchedTotal} top eşleşti
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant={effectiveOnlyMatched ? "default" : "outline"}
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setOnlyMatched((v) => !v)}
                    title="Yalnız eşleşen topları ve onları içeren çuvalları göster"
                  >
                    <Check className={cn("h-3.5 w-3.5", effectiveOnlyMatched ? "opacity-100" : "opacity-40")} />
                    Yalnız eşleşenler
                  </Button>
                </div>
              )}
            </div>

            <ShipmentSheetBody
              d={d}
              q={q}
              matchItemIds={matchItemIds}
              matchColorIds={matchColorIds}
              onlyMatched={effectiveOnlyMatched}
            />
          </div>
        )}

        <ShipmentDispatchNote
          shipmentId={shipmentId}
          open={noteOpen}
          onOpenChange={setNoteOpen}
          returns={d ? { count: d.summary.returnedCount, meters: d.summary.returnedMeters } : undefined}
        />
        <CancelShipmentDialog shipmentId={cancelOpen ? shipmentId : null} onOpenChange={(o) => setCancelOpen(o)} />
        <UndoDispatchDialog shipmentId={undoOpen ? shipmentId : null} onOpenChange={(o) => setUndoOpen(o)} />
        <DispatchConfirmDialog
          shipment={
            dispatchOpen && d
              ? { id: d.id, shipmentNo: d.shipmentNo, customerName: d.customer.name, branchName: d.branch?.name ?? null }
              : null
          }
          onOpenChange={(o) => setDispatchOpen(o)}
        />
      </SheetContent>
    </Sheet>
  );
}
