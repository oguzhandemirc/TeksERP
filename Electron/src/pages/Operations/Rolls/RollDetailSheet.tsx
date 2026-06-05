import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Tag, Undo2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedProgress } from "@/components/motion";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import { rollStatusLabels, rollEntrySourceLabels, rollOperationTypeLabels } from "@/types/enums";
import { rollService } from "./service";
import type { Roll } from "./types";

// "Son Basılan Etiket" kartı yalnız müşteri etiketi taşıyabilen bitmiş toplarda
// gösterilir: depo (WAREHOUSE), A1 (A1_STOCK), sevk edilmiş (SHIPPED). Ham stok,
// üretimde, fasonda, tüketilmiş ve fire/iptal toplarda gizli (etiket basılmaz).
const LABELED_STATUSES = ["WAREHOUSE", "A1_STOCK", "SHIPPED"];

interface Props {
  roll: Roll | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RollDetailSheet({ roll, open, onOpenChange }: Props) {
  const [labelRollId, setLabelRollId] = useState<string | null>(null);

  // Liste cevabı `operations` taşımıyor — detay endpoint'i (`/api/rolls/:id`)
  // operation log'unu select ile döndürüyor. Sheet açıldığında lazy fetch.
  const detailQuery = useQuery({
    queryKey: ["roll-detail", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: open && !!roll?.id,
    staleTime: 30_000,
  });
  // lastLabelSnapshot (topun üstündeki son basılan etiket) yalnız detay endpoint'inden gelir.
  const detail = detailQuery.data?.data;
  const snapshot = detail?.lastLabelSnapshot ?? null;
  // En güncel iade kaydı (varsa) — müşteriden dönen top notu/nedeni; Tambur kesimden önce görülür.
  const latestReturn = detail?.returns?.[0] ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{roll?.barcode}</span>
            {roll && (
              <StatusBadge
                status={roll.status}
                labels={rollStatusLabels}
                tones={rollStatusTones}
              />
            )}
          </SheetTitle>
          <SheetDescription>{roll?.item?.name}</SheetDescription>
        </SheetHeader>

        {roll && (
          <div className="mt-3">
            <PermissionGate permission="label:read">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setLabelRollId(roll.id)}
              >
                <Tag className="h-3.5 w-3.5" /> Etiket
              </Button>
            </PermissionGate>
          </div>
        )}

        <RollLabelDialog
          rollId={labelRollId}
          onOpenChange={(open) => !open && setLabelRollId(null)}
        />

        {roll && (
          <div className="mt-4 space-y-4">
            {roll.barcode ? (
              <Card>
                <CardContent className="flex items-center gap-4 p-3">
                  <div className="rounded bg-white p-2">
                    <QRCodeSVG value={roll.barcode} size={112} level="M" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Top Barkodu
                    </div>
                    <div className="mt-1 break-all font-mono text-sm font-semibold">
                      {roll.barcode}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-3 text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-2 text-[10px]">
                    Açık Kumaş
                  </Badge>
                  Bu rulonun fiziksel barkodu yok — boyahane dönüşü açık kumaş, Kurşun/KK2'de işlenirken üretiliyor.
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Metre</div>
                  <div className="mt-0.5">
                    <span className="text-2xl font-semibold tabular-nums">
                      {roll.currentQty.toLocaleString("tr-TR")}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">m</span>
                  </div>
                  {roll.currentQty !== roll.initialQty && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Başlangıç: {roll.initialQty.toLocaleString("tr-TR")} m
                    </div>
                  )}
                  {roll.initialQty > 0 && (
                    <AnimatedProgress
                      value={(roll.currentQty / roll.initialQty) * 100}
                      className="mt-2 h-1"
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">En</div>
                  <div className="mt-0.5 font-medium tabular-nums">
                    {roll.width != null ? `${roll.width} cm` : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Kalite</div>
                  <div className="mt-0.5 font-medium">{roll.qualityGrade}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-xs text-muted-foreground">Ürün</div>
                  <div>
                    <span className="font-mono text-xs">{roll.item?.code}</span> · {roll.item?.name}
                  </div>
                  <div className="text-xs text-muted-foreground">Giriş Kaynağı</div>
                  <div>
                    <Badge variant="muted" className="text-[10px]">
                      {rollEntrySourceLabels[
                        roll.entrySource as keyof typeof rollEntrySourceLabels
                      ] ?? roll.entrySource}
                    </Badge>
                  </div>
                  {roll.weightKg != null && (
                    <>
                      <div className="text-xs text-muted-foreground">Ağırlık</div>
                      <div>{roll.weightKg.toLocaleString("tr-TR")} kg</div>
                    </>
                  )}
                  {roll.color && (
                    <>
                      <div className="text-xs text-muted-foreground">Renk</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {roll.color.hex && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: roll.color.hex }}
                          />
                        )}
                        {roll.color.name}
                      </div>
                    </>
                  )}
                  {roll.properties && roll.properties.length > 0 && (
                    <>
                      <div className="text-xs text-muted-foreground">Özellikler</div>
                      <div className="flex flex-wrap gap-1">
                        {roll.properties.map((p) => (
                          <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                            {p.property.name}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Son basılan etiket — yalnız müşteri etiketi taşıyabilen bitmiş toplarda
                (depo/A1/sevk); ham, üretimde, fason, tüketilmiş → gizli. */}
            {LABELED_STATUSES.includes(roll.status) && (
            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" /> Son Basılan Etiket
                  <span className="ml-auto text-[10px] normal-case text-muted-foreground">
                    değişebilir
                  </span>
                </div>
                {detailQuery.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : snapshot?.customerName ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="text-xs text-muted-foreground">Müşteri</div>
                    <div className="font-medium">{snapshot.customerName}</div>
                    {snapshot.orderNumber && (
                      <>
                        <div className="text-xs text-muted-foreground">Sipariş</div>
                        <div className="font-mono text-xs">{snapshot.orderNumber}</div>
                      </>
                    )}
                    {snapshot.itemName && (
                      <>
                        <div className="text-xs text-muted-foreground">Etiketteki Ürün</div>
                        <div>{snapshot.itemName}</div>
                      </>
                    )}
                    {snapshot.colorName && (
                      <>
                        <div className="text-xs text-muted-foreground">Etiketteki Renk</div>
                        <div>{snapshot.colorName}</div>
                      </>
                    )}
                    <div className="text-xs text-muted-foreground">Basıldı</div>
                    <div className="text-xs">
                      {safeFormat(snapshot.printedAt, "dd.MM.yyyy HH:mm")}
                      {snapshot.operatorName ? ` · ${snapshot.operatorName}` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-2 text-[10px]">
                      Stok etiketli
                    </Badge>
                    Bu top müşteri etiketiyle basılmamış (depoda serbest stok). Müşteri sevkte belli olur.
                  </div>
                )}
              </CardContent>
            </Card>
            )}

            {/* İade bilgisi — müşteriden dönmüş top. Not + neden burada; Tambur kesimden önce görür. */}
            {latestReturn && (
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
                      {latestReturn.qty.toLocaleString("tr-TR")} m
                    </div>
                    <div className="text-xs text-muted-foreground">Teslim Alan</div>
                    <div className="text-xs">{latestReturn.receivedBy?.fullName ?? "—"}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {(roll.packageId || roll.netWeightKg != null) && (
              <Card>
                <CardContent className="space-y-1 p-3 text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Paketleme
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {roll.packageId && (
                      <>
                        <div className="text-xs text-muted-foreground">Paket ID</div>
                        <div className="font-mono text-xs">{roll.packageId}</div>
                      </>
                    )}
                    {roll.grossWeightKg != null && (
                      <>
                        <div className="text-xs text-muted-foreground">Brüt Ağırlık</div>
                        <div>{roll.grossWeightKg.toLocaleString("tr-TR")} kg</div>
                      </>
                    )}
                    {roll.netWeightKg != null && (
                      <>
                        <div className="text-xs text-muted-foreground">Net Ağırlık</div>
                        <div>{roll.netWeightKg.toLocaleString("tr-TR")} kg</div>
                      </>
                    )}
                    {roll.packagingDate && (
                      <>
                        <div className="text-xs text-muted-foreground">Paketleme Tarihi</div>
                        <div>{safeFormat(roll.packagingDate, "dd.MM.yyyy HH:mm")}</div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> İşlem Geçmişi
                </div>
                {detailQuery.isLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : (detailQuery.data?.data.operations?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">Henüz işlem kaydı yok.</p>
                ) : (
                  <ol className="relative ml-1 space-y-3 border-l border-border pl-4">
                    {(detailQuery.data?.data.operations ?? []).map((op) => (
                      <li key={op.id} className="relative">
                        <span
                          className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
                          aria-hidden
                        />
                        <div className="text-sm font-medium leading-tight">
                          {rollOperationTypeLabels[op.operationType] ?? op.operationType}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {op.operator?.fullName ?? "—"} ·{" "}
                          {safeFormat(op.createdAt, "dd.MM.yyyy HH:mm")}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <div className="text-[11px] text-muted-foreground">
              Oluşturma: {safeFormat(roll.createdAt, "dd.MM.yyyy HH:mm")} ·
              Son güncelleme: {safeFormat(roll.updatedAt, "dd.MM.yyyy HH:mm")}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
