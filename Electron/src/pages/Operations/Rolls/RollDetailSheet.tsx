import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { rollStatusLabels, RollOperationType } from "@/types/enums";
import { rollService } from "./service";
import type { Roll, RollOperationLogEntry } from "./types";

interface Props {
  roll: Roll | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function OperationStatus({
  label,
  op,
  loading,
}: {
  label: string;
  op: RollOperationLogEntry | undefined;
  loading: boolean;
}) {
  const operatorName = op?.operator?.fullName ?? op?.operator?.username ?? null;
  return (
    <div className="flex items-start gap-2 rounded border px-2.5 py-2">
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          op ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
        }`}
      >
        {op ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        {loading && !op ? (
          <div className="text-[11px] text-muted-foreground">Yükleniyor…</div>
        ) : op ? (
          <>
            <div className="text-[11px] text-muted-foreground">
              {safeFormat(op.createdAt, "dd.MM.yyyy HH:mm")}
            </div>
            {operatorName && (
              <div className="truncate text-[11px] text-muted-foreground">
                {operatorName}
              </div>
            )}
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">Yapılmadı</div>
        )}
      </div>
    </div>
  );
}

export function RollDetailSheet({ roll, open, onOpenChange }: Props) {
  // Liste cevabı `operations` taşımıyor — detay endpoint'i (`/api/rolls/:id`)
  // operation log'unu select ile döndürüyor. Sheet açıldığında lazy fetch.
  const detailQuery = useQuery({
    queryKey: ["roll-detail", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: open && !!roll?.id,
    staleTime: 30_000,
  });

  const operations = detailQuery.data?.data?.operations ?? roll?.operations ?? [];
  const kursun = operations.find((op) => op.operationType === RollOperationType.KURSUN_APPLIED);
  const qc2 = operations.find((op) => op.operationType === RollOperationType.QC2_COMPLETED);

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
          <div className="mt-4 space-y-4">
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
                  {roll.variant && (
                    <>
                      <div className="text-xs text-muted-foreground">Variant</div>
                      <div>{roll.variant.name}</div>
                    </>
                  )}
                  <div className="text-xs text-muted-foreground">Giriş Kaynağı</div>
                  <div>
                    <Badge variant="muted" className="text-[10px]">
                      {roll.entrySource}
                    </Badge>
                  </div>
                  {roll.weightKg != null && (
                    <>
                      <div className="text-xs text-muted-foreground">Ağırlık</div>
                      <div>{roll.weightKg.toLocaleString("tr-TR")} kg</div>
                    </>
                  )}
                  {roll.ownerCustomer && (
                    <>
                      <div className="text-xs text-muted-foreground">Müşteri Malı</div>
                      <div>{roll.ownerCustomer.name}</div>
                    </>
                  )}
                  {roll.customerDescription && (
                    <>
                      <div className="text-xs text-muted-foreground">Müşteri Açıklaması</div>
                      <div className="text-xs">{roll.customerDescription}</div>
                    </>
                  )}
                  {roll.item?.color && (
                    <>
                      <div className="text-xs text-muted-foreground">Renk</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {roll.item.color.hex && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: roll.item.color.hex }}
                          />
                        )}
                        {roll.item.color.name}
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

            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kurşun / KK2
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <OperationStatus
                    label="Kurşun"
                    op={kursun}
                    loading={detailQuery.isLoading}
                  />
                  <OperationStatus
                    label="KK2"
                    op={qc2}
                    loading={detailQuery.isLoading}
                  />
                </div>
              </CardContent>
            </Card>

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
