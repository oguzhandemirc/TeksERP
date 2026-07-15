import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import type { WorkOrder } from "./types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/**
 * İş emri genel bilgi kartı — hedef ürün/renk/en/kat tipi, planlama tarihleri,
 * boyahane notu ve üretim özellikleri. Hem slide-over hem tam sayfada kullanılır.
 * className: çağıran yüzeye özel çerçeve/vurgu (slide-over kendi SectionBlock
 * bandını kullanır, dokunmaz — yalnız tam sayfa renkli çerçeve ekler).
 */
export function WorkOrderInfoCard({ wo, className }: { wo: WorkOrder; className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Hedef Ürün">
            {wo.targetItem ? (
              <span className="font-medium">{wo.targetItem.name}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Renk">
            {wo.targetColor ? (
              <span className="inline-flex items-center gap-1.5">
                {wo.targetColor.hex && (
                  <span
                    className="h-3.5 w-3.5 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: wo.targetColor.hex }}
                  />
                )}
                <span className="font-medium">{wo.targetColor.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Ham / renksiz</span>
            )}
          </Field>
          <Field label="En">
            {wo.width != null ? `${wo.width} cm` : <span className="text-muted-foreground">—</span>}
          </Field>
          {wo.foldType && <Field label="Kat Tipi">{wo.foldType}</Field>}
          <Field label="Planlanan Başlangıç">
            <span className="text-muted-foreground">{safeFormat(wo.plannedStartDate, "dd.MM.yyyy")}</span>
          </Field>
          <Field label="Oluşturma">
            <span className="text-muted-foreground">{safeFormat(wo.createdAt, "dd.MM.yyyy HH:mm")}</span>
          </Field>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Üretim Özellikleri
          </div>
          {/* Boşken de "1 satır varmış gibi" AYNI yükseklik: gerçek özellikle birebir
              aynı sarmalayıcı + Badge kullanılır (yalnız italik metinle ayırt edilir). */}
          <div className="mt-1 flex flex-wrap gap-1">
            {wo.targetProperties && wo.targetProperties.length > 0 ? (
              wo.targetProperties.map((p) => (
                <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                  {p.property.name}
                </Badge>
              ))
            ) : (
              <Badge variant="muted" className="text-[10px] italic text-muted-foreground">
                Atanmış özellik yok
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
