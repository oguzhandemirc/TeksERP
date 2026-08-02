import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Check, FileText, Maximize2, Search } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { CancelShipmentDialog } from "./CancelShipmentDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
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
}

export function ShipmentDetailSheet({ shipmentId, open, onOpenChange, matchItem, matchColor }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
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
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
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
          <p className="mt-4 text-sm text-muted-foreground">Sevkiyat bulunamadı.</p>
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
      </SheetContent>
    </Sheet>
  );
}
