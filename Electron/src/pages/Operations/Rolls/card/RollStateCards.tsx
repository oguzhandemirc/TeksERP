// Top kartının DURUMA BAĞLI kartları — sevkiyat rezervasyonu, fason, kartela fasonu, iade, paketleme.
// Her kart yalnız ilgili durum/veri varken çizilir (RollDetailSheet'ten taşındı, 2026-11-10 top kartı).
import { PackageOpen, Palette, Send, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatQty, safeFormat } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { type Roll, shipmentScopeLabels, categoryOfDispatch } from "../types";

interface Props {
  r: Roll;
  detail: Roll | undefined;
  roll: Roll;
  detailLoading: boolean;
}

function ReservationCard({ detail, roll }: Props) {
  const reservedShipment = detail?.shipment ?? roll.shipment ?? null;
  const reservedSack = detail?.sack ?? roll.sack ?? null;
  if (!reservedShipment) return null;
  return (
    <Card className="border-amber-300 bg-amber-50/50">
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-700">
          <PackageOpen className="h-3.5 w-3.5" /> Sevkiyat Rezervasyonu
          <Badge
            variant="outline"
            className="ml-auto border-amber-500 text-[10px] text-amber-600"
          >
            {shipmentScopeLabels[reservedShipment.status] ?? reservedShipment.status}
          </Badge>
        </div>
        <p className="text-[11px] text-amber-700/80">
          Bu top bir çuvalın içinde ve bir sevkiyata bağlı — serbest depoda
          değildir, başka işe (sevk/kartela/{TERIM.terbiyeIsEmri.tekilKucuk}) ayrılamaz.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="text-xs text-muted-foreground">Sevkiyat</div>
          <div className="font-mono text-xs">{reservedShipment.shipmentNo}</div>
          {reservedSack && (
            <>
              <div className="text-xs text-muted-foreground">Çuval</div>
              <div className="font-mono text-xs">
                {reservedSack.sackNo}
                <span className="ml-1 text-muted-foreground">
                  (Çuval {reservedSack.seq})
                </span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FasonCard({ r, detail, roll, detailLoading }: Props) {
  const activeDispatch = detail?.dispatchItems?.[0]?.dispatch ?? roll.dispatchItems?.[0]?.dispatch ?? null;
  if (r.status !== "AT_SUBCONTRACTOR") return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Send className="h-3.5 w-3.5" /> Fason Bilgisi
        </div>
        {detailLoading && !activeDispatch ? (
          <Skeleton className="h-10 w-full" />
        ) : activeDispatch ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-xs text-muted-foreground">Firma</div>
            <div className="font-medium">
              {activeDispatch.subcontractor.name}
              {activeDispatch.subcontractor.code
                ? ` (${activeDispatch.subcontractor.code})`
                : ""}
            </div>
            {categoryOfDispatch(activeDispatch) && (
              <>
                <div className="text-xs text-muted-foreground">İşlem</div>
                <div className="text-xs">
                  {categoryOfDispatch(activeDispatch)?.name}
                </div>
              </>
            )}
            <div className="text-xs text-muted-foreground">Sevk No</div>
            <div className="font-mono text-xs">{activeDispatch.dispatchNo}</div>
            <div className="text-xs text-muted-foreground">Gönderim</div>
            <div className="text-xs">
              {safeFormat(activeDispatch.dispatchedAt, "dd.MM.yyyy HH:mm")}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Aktif fason sevki bulunamadı.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KartelaCard({ r, detail, detailLoading }: Props) {
  const kartelaDispatch = detail?.kartelaDispatchItems?.[0]?.dispatch ?? null;
  if (r.status !== "AT_KARTELA") return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Palette className="h-3.5 w-3.5" /> Kartela Fasonu
        </div>
        {detailLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : kartelaDispatch ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-xs text-muted-foreground">Firma</div>
            <div className="font-medium">
              {kartelaDispatch.subcontractor.name}
              {kartelaDispatch.subcontractor.code
                ? ` (${kartelaDispatch.subcontractor.code})`
                : ""}
            </div>
            <div className="text-xs text-muted-foreground">Sevk No</div>
            <div className="font-mono text-xs">{kartelaDispatch.dispatchNo}</div>
            <div className="text-xs text-muted-foreground">Gönderim</div>
            <div className="text-xs">
              {safeFormat(kartelaDispatch.dispatchedAt, "dd.MM.yyyy HH:mm")}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Aktif kartela sevki bulunamadı.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReturnCard({ detail }: Props) {
  const latestReturn = detail?.returns?.[0] ?? null;
  if (!latestReturn) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Undo2 className="h-3.5 w-3.5" /> İade Bilgisi
          <span className="ml-auto text-[10px] normal-case text-muted-foreground">
            {safeFormat(latestReturn.createdAt, "dd.MM.yyyy HH:mm")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="text-xs text-muted-foreground">Neden</div>
          <div>
            {latestReturn.reason ? (
              <Badge
                variant="secondary"
                style={
                  latestReturn.reason.color
                    ? {
                        backgroundColor: `${latestReturn.reason.color}22`,
                        color: latestReturn.reason.color,
                      }
                    : undefined
                }
              >
                {latestReturn.reason.name}
              </Badge>
            ) : latestReturn.reasonText ? (
              <span>{latestReturn.reasonText}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          {latestReturn.reason && latestReturn.reasonText && (
            <>
              <div className="text-xs text-muted-foreground">Açıklama</div>
              <div className="text-xs">{latestReturn.reasonText}</div>
            </>
          )}
          {latestReturn.note && (
            <>
              <div className="text-xs text-muted-foreground">Not</div>
              <div className="text-xs">{latestReturn.note}</div>
            </>
          )}
          <div className="text-xs text-muted-foreground">İade Metrajı</div>
          <div className="tabular-nums">
            {formatQty(latestReturn.qty)} m
          </div>
          <div className="text-xs text-muted-foreground">Teslim Alan</div>
          <div className="text-xs">{latestReturn.receivedBy?.fullName ?? "—"}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PackagingCard({ r }: Props) {
  if (!(r.packageId || r.netWeightKg != null)) return null;
  return (
    <Card>
      <CardContent className="space-y-1 p-3 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Paketleme
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {r.packageId && (
            <>
              <div className="text-xs text-muted-foreground">Paket ID</div>
              <div className="font-mono text-xs">{r.packageId}</div>
            </>
          )}
          {r.grossWeightKg != null && (
            <>
              <div className="text-xs text-muted-foreground">Brüt Ağırlık</div>
              <div>{formatQty(r.grossWeightKg)} kg</div>
            </>
          )}
          {r.netWeightKg != null && (
            <>
              <div className="text-xs text-muted-foreground">Net Ağırlık</div>
              <div>{formatQty(r.netWeightKg)} kg</div>
            </>
          )}
          {r.packagingDate && (
            <>
              <div className="text-xs text-muted-foreground">Paketleme Tarihi</div>
              <div>{safeFormat(r.packagingDate, "dd.MM.yyyy HH:mm")}</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function RollStateCards(props: Props) {
  return (
    <>
      <ReservationCard {...props} />
      <FasonCard {...props} />
      <KartelaCard {...props} />
      <ReturnCard {...props} />
      <PackagingCard {...props} />
    </>
  );
}
