import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Tag, Undo2, Palette, PackageOpen, Pencil, Wrench, AlertTriangle, Send } from "lucide-react";
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
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import { RollEditDialog } from "./RollEditDialog";
import { RescueStuckDialog } from "./RescueStuckDialog";
import { rollStatusLabels, rollEntrySourceLabels, rollOperationTypeLabels } from "@/types/enums";
import { rollService } from "./service";
import { type Roll, shipmentScopeLabels, categoryOfDispatch } from "./types";

interface Props {
  roll: Roll | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RollDetailSheet({ roll, open, onOpenChange }: Props) {
  const [labelRollId, setLabelRollId] = useState<string | null>(null);
  const [editRollId, setEditRollId] = useState<string | null>(null);
  const [rescueRollId, setRescueRollId] = useState<string | null>(null);
  const { hasPermission } = useRoleAccess();
  const canManualAdjust = hasPermission("roll:manual-adjust");
  // "Düzelt": hurda/iptal dışı her top. Yetki/sebep kararı diyaloğun içinde —
  // serbest depoda roll:write|label:edit yeter, üretimdeki topta roll:manual-adjust
  // aranır (backend de aynı guard'ı uygular).
  const canEditAttributes =
    !!roll && roll.status !== "SCRAP" && roll.status !== "CANCELLED";
  // "İstasyondan Kurtar" yalnız makinede/istasyonda takılı (IN_PRODUCTION) top için.
  const canRescue = !!roll && roll.status === "IN_PRODUCTION";

  // Liste cevabı `operations` taşımıyor — detay endpoint'i (`/api/rolls/:id`)
  // operation log'unu select ile döndürüyor. Sheet açıldığında lazy fetch.
  const detailQuery = useQuery({
    queryKey: ["roll-detail", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: open && !!roll?.id,
    staleTime: 30_000,
  });
  // Detay endpoint'i liste cevabında olmayan alanları (operation log, iade, kartela,
  // sevk/çuval) taşır; sheet açıldığında lazy fetch edilir.
  const detail = detailQuery.data?.data;
  // En güncel iade kaydı (varsa) — müşteriden dönen top notu/nedeni; Tambur kesimden önce görülür.
  const latestReturn = detail?.returns?.[0] ?? null;
  // AT_KARTELA top: hangi kartela firmasında olduğunu detay panelinde göster.
  const kartelaDispatch = detail?.kartelaDispatchItems?.[0]?.dispatch ?? null;
  // AT_SUBCONTRACTOR top: hangi fason firmasında/işlemde — kartela kartı emsali.
  // Liste cevabı da dispatchItems taşır (fallback) → panel açılır açılmaz dolu görünür.
  const activeDispatch =
    detail?.dispatchItems?.[0]?.dispatch ?? roll?.dispatchItems?.[0]?.dispatch ?? null;
  // Sevkiyat rezervasyonu: top bir çuvala/sevkiyata bağlıysa "serbest depo" değildir.
  // Detay endpoint'i shipment+sack döner; liste cevabı da taşıyabilir (fallback).
  const reservedShipment = detail?.shipment ?? roll?.shipment ?? null;
  const reservedSack = detail?.sack ?? roll?.sack ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle>Top Detayı</SheetTitle>
          <SheetDescription className="sr-only">
            Top {roll?.barcode ?? ""} · {roll?.item?.name ?? ""} detayı
          </SheetDescription>
        </SheetHeader>

        {roll && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PermissionGate permission="label:read">
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={() => setLabelRollId(roll.id)}
              >
                <Tag className="h-3.5 w-3.5" /> Etiket
              </Button>
            </PermissionGate>
            {/* TEK "Düzelt": renk/metraj/kalite/en/özellik. Üretimdeki topta sebep +
                roll:manual-adjust ister (diyalog kendi içinde yönetir). Eskiden bu iş
                "Yeniden Etiketle/Düzenle" + "Manuel Düzelt" diye iki butondaydı ve
                ikisi de aynı backend motorunu çağırıyordu. */}
            {canEditAttributes && (
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={() => setEditRollId(roll.id)}
              >
                <Pencil className="h-3.5 w-3.5" /> Düzelt
              </Button>
            )}
            {canManualAdjust && canRescue && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setRescueRollId(roll.id)}
              >
                <Wrench className="h-3.5 w-3.5" /> İstasyondan Kurtar
              </Button>
            )}
          </div>
        )}

        <RollLabelDialog
          rollId={labelRollId}
          onOpenChange={(open) => !open && setLabelRollId(null)}
        />
        <RollEditDialog
          rollId={editRollId}
          onOpenChange={(open) => !open && setEditRollId(null)}
          onSaved={() => void detailQuery.refetch()}
        />
        <RescueStuckDialog
          rollId={rescueRollId}
          onOpenChange={(open) => !open && setRescueRollId(null)}
          onRescued={() => void detailQuery.refetch()}
        />

        {roll && (
          <div className="mt-4 space-y-4">
            {roll.barcode ? (
              <Card>
                <CardContent className="flex items-center gap-4 p-3">
                  <div className="rounded bg-white p-2">
                    <QRCodeSVG value={roll.barcode} size={112} level="M" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Top Barkodu
                      </div>
                      <div className="mt-1 break-all font-mono text-sm font-semibold">
                        {roll.barcode}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-1">
                      <StatusBadge status={roll.status} labels={rollStatusLabels} tones={rollStatusTones} />
                      {roll.markedForKartela && (
                        <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300">
                          Kartelalık
                        </Badge>
                      )}
                      {roll.labelDirty && (
                        <Badge
                          className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
                          title="Veri/metraj düzeltildi; topun üstündeki fiziksel etiket eski — yeniden basılmalı."
                        >
                          <AlertTriangle className="h-3 w-3" /> Etiket güncel değil
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="space-y-2 p-3 text-xs text-muted-foreground">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={roll.status} labels={rollStatusLabels} tones={rollStatusTones} />
                    {roll.markedForKartela && (
                      <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300">
                        Kartelalık
                      </Badge>
                    )}
                  </div>
                  <div>
                    <Badge variant="outline" className="mr-2 text-[10px]">
                      Açık Kumaş
                    </Badge>
                    Bu rulonun fiziksel barkodu yok — boyahane dönüşü açık kumaş, Kurşun/KK2'de işlenirken üretiliyor.
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Metre</div>
                  <div className="mt-0.5">
                    <span className="text-2xl font-semibold tabular-nums">
                      {roll.currentQty.toLocaleString("tr-TR", { useGrouping: false })}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">m</span>
                  </div>
                  {roll.currentQty !== roll.initialQty && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Başlangıç: {roll.initialQty.toLocaleString("tr-TR", { useGrouping: false })} m
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
                  <div className="mt-0.5 font-medium">
                    {roll.qualityGrade ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-xs text-muted-foreground">Kumaş</div>
                  <div>{roll.item?.name}</div>
                  <div className="text-xs text-muted-foreground">Biçim</div>
                  <div>
                    <Badge variant="muted" className="text-[10px]">
                      {roll.form === "ACIK" ? "Açık Kumaş" : "Top"}
                    </Badge>
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
                      <div>{roll.weightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
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

            {/* Sevkiyat rezervasyonu — top bir çuvalın içinde, serbest stok DEĞİL.
                WAREHOUSE statüsüyle görünse de başka işe ayrılamaz (planlı sevkiyat). */}
            {reservedShipment && (
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
                    değildir, başka işe (sevk/kartela/iş emri) ayrılamaz.
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
            )}

            {/* Fason bilgisi — top fason firmasında işlemde (AT_SUBCONTRACTOR). */}
            {roll.status === "AT_SUBCONTRACTOR" && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Send className="h-3.5 w-3.5" /> Fason Bilgisi
                  </div>
                  {detailQuery.isLoading && !activeDispatch ? (
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
            )}

            {/* Kartela fasonu — top kartela firmasında işlemde (AT_KARTELA). */}
            {roll.status === "AT_KARTELA" && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Palette className="h-3.5 w-3.5" /> Kartela Fasonu
                  </div>
                  {detailQuery.isLoading ? (
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
                      {latestReturn.qty.toLocaleString("tr-TR", { useGrouping: false })} m
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
                        <div>{roll.grossWeightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
                      </>
                    )}
                    {roll.netWeightKg != null && (
                      <>
                        <div className="text-xs text-muted-foreground">Net Ağırlık</div>
                        <div>{roll.netWeightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</div>
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
