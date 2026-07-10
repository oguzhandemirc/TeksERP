import { QRCodeSVG } from "qrcode.react";
import { safeFormat } from "@/lib/format";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useKartelaMeasurementEnabled } from "@/hooks/usePricingEnabled";
import type { Swatch } from "./swatchService";

interface Props {
  swatch: Swatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SwatchDetailSheet({ swatch, open, onOpenChange }: Props) {
  const showMeasure = useKartelaMeasurementEnabled();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">{swatch?.barcode}</SheetTitle>
          <SheetDescription>{swatch?.item?.name}</SheetDescription>
        </SheetHeader>

        {swatch && (
          <div className="mt-4 space-y-4">
            <Card>
              <CardContent className="flex items-center gap-4 p-3">
                <div className="rounded bg-white p-2">
                  <QRCodeSVG value={swatch.barcode} size={112} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Kartela Barkodu
                  </div>
                  <div className="mt-1 break-all font-mono text-sm font-semibold">
                    {swatch.barcode}
                  </div>
                </div>
              </CardContent>
            </Card>

            {showMeasure && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Boy</div>
                    <div className="mt-0.5">
                      <span className="text-2xl font-semibold tabular-nums">
                        {swatch.length != null
                          ? swatch.length.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 2 })
                          : "—"}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">cm</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">En</div>
                    <div className="mt-0.5 font-medium tabular-nums">
                      {swatch.width != null ? `${swatch.width} cm` : "—"}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kumaş Özellikleri
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-xs text-muted-foreground">Ürün</div>
                  <div>
                    <span className="font-mono text-xs">{swatch.item?.code}</span>{" "}
                    · {swatch.item?.name}
                  </div>

                  <div className="text-xs text-muted-foreground">Renk</div>
                  <div>
                    {swatch.color || swatch.parentRoll?.color ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        {(swatch.color?.hex ?? swatch.parentRoll?.color?.hex) && (
                          <span
                            className="h-3 w-3 rounded-full border border-black/10"
                            style={{
                              backgroundColor:
                                swatch.color?.hex ??
                                swatch.parentRoll?.color?.hex ??
                                undefined,
                            }}
                          />
                        )}
                        {swatch.color?.name ?? swatch.parentRoll?.color?.name}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </div>

                  {swatch.parentRoll?.qualityGrade && (
                    <>
                      <div className="text-xs text-muted-foreground">Kalite</div>
                      <div className="text-xs">
                        {swatch.parentRoll.qualityGrade}
                      </div>
                    </>
                  )}

                  <div className="text-xs text-muted-foreground">Özellikler</div>
                  <div>
                    {swatch.parentRoll?.properties &&
                    swatch.parentRoll.properties.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {swatch.parentRoll.properties.map((p) => (
                          <Badge
                            key={p.propertyId}
                            variant="muted"
                            className="text-[10px]"
                          >
                            {p.property.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="text-[11px] text-muted-foreground">
              Oluşturma: {safeFormat(swatch.createdAt, "dd.MM.yyyy HH:mm")}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
