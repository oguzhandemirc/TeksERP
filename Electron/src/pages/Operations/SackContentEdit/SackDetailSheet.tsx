import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, Truck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";
import { PartyCard } from "@/components/operations/PartyCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { sackHubService } from "./service";
import { SackNoteDialog } from "./SackNoteDialog";
import { SackContentsReadonlyTable } from "./SackContentsReadonlyTable";
import {
  sackStatusLabels,
  sackStatusOf,
  sackStatusTones,
  shipmentStatusLabels,
  type SackSearchRow,
} from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

interface Props {
  /** Görüntülenecek (sevkteki) çuval; null → kapalı. Depo çuvalları editöre gider. */
  sack: SackSearchRow | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sevk edilmiş/sevkteki çuvalın SALT-OKUNUR detay paneli (slide-over).
 * Sipariş detay paneliyle (`OrderDetailSheet`) aynı iskelet: kimlik kartı
 * (`PartyCard`) → metrik kartları → not → aranabilir içerik listesi.
 *
 * Depo çuvalları buraya DÜŞMEZ (onlar editöre gider) — bu yüzden içerik
 * düzenleme aksiyonu yok; yalnız not düzenlenebilir (annotation).
 */
export function SackDetailSheet({ sack, onOpenChange }: Props) {
  const open = sack !== null;
  const [noteOpen, setNoteOpen] = useState(false);
  const contents = useQuery({
    queryKey: ["sack-contents", sack?.id],
    queryFn: () => sackHubService.contents(sack!.id),
    enabled: open,
    staleTime: 30_000,
  });
  const rolls = contents.data?.data.rolls ?? [];
  const swatches = contents.data?.data.swatches ?? [];
  const notes = contents.data?.data.notes ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{sack?.sackNo ?? "Çuval"}</span>
            {sack && (
              <StatusBadge
                status={sackStatusOf(sack)}
                labels={sackStatusLabels}
                tones={sackStatusTones}
              />
            )}
          </SheetTitle>
          {/* Görsel kimlik PartyCard'da; burası ekran okuyucu özeti (Radix zorunlu). */}
          <SheetDescription className="sr-only">
            {sack?.customer?.name ?? "Müşterisiz"}
            {sack?.branch ? ` — Şube: ${sack.branch.name}` : ""}
          </SheetDescription>
        </SheetHeader>

        {sack && (
          <div className="mt-4 space-y-4">
            <PartyCard
              customer={sack.customer}
              branch={sack.branch}
              emptyLabel="Müşterisiz (genel stok)"
            />

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Top Adedi</div>
                  <div className="font-medium tabular-nums">
                    {sack.rollCount}
                    {sack.swatchCount > 0 && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        +{sack.swatchCount} kartela
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Metraj</div>
                  <div className="font-medium tabular-nums">{fmtQty(sack.totalQty)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Brüt Tartı</div>
                  <div className="font-medium tabular-nums">
                    {sack.weightKg != null ? (
                      `${sack.weightKg.toLocaleString("tr-TR")} kg`
                    ) : (
                      <span className="text-xs font-normal text-muted-foreground">tartılmadı</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sevkiyat bağı — bu panele yalnız sevkteki çuval düştüğü için hep dolu. */}
            {sack.shipment && (
              <Card>
                <CardContent className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Sevkiyat
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <span className="font-mono text-xs">{sack.shipment.shipmentNo}</span>
                    <Badge variant="muted" className="text-[10px]">
                      {shipmentStatusLabels[sack.shipment.status]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {safeFormat(sack.createdAt, "dd.MM.yyyy")}
                    </span>
                  </span>
                </CardContent>
              </Card>
            )}

            {/* Not — VARSA doğrudan görünür; yoksa yalnız buton (boş input yer kaplamaz). */}
            {notes ? (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                title="Notu düzenle"
                className="flex w-full items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200 dark:hover:bg-amber-950/40"
              >
                <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-pre-wrap break-words italic">{notes}</span>
              </button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setNoteOpen(true)}>
                <MessageSquareText className="mr-1 h-3.5 w-3.5" /> Not Ekle
              </Button>
            )}

            {/* İçerik — editördeki tabloyla AYNI kolonlar (sackContentsColumns),
                salt-okunur + arama. Kart listesi yerine DataTable: sütunlar
                hizalı, tarama kolay. */}
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Çuval İçeriği ({rolls.length})
              </div>
              <SackContentsReadonlyTable
                rolls={rolls}
                isLoading={contents.isLoading}
                emptyText={swatches.length > 0 ? "Çuvalda top yok (yalnız kartela)." : "Boş çuval."}
              />
              {/* Kartelalar tabloda YOK (barkodsuz olabilir) → adet ayrı satır. */}
              {swatches.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">{swatches.length} kartela</p>
              )}
            </div>
          </div>
        )}
      </SheetContent>

      <SackNoteDialog
        sack={noteOpen && sack ? { id: sack.id, sackNo: sack.sackNo, notes } : null}
        onOpenChange={setNoteOpen}
      />
    </Sheet>
  );
}
