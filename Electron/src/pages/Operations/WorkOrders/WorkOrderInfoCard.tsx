import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import type { WorkOrder } from "./types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/**
 * İş emri genel bilgi kartı — hedef ürün/renk/en/kat tipi, planlama tarihleri,
 * boyahane notu ve üretim özellikleri. Hem slide-over hem tam sayfada kullanılır.
 */
export function WorkOrderInfoCard({ wo }: { wo: WorkOrder }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Hedef Ürün">
            {wo.targetItem ? (
              <span className="font-medium">
                <span className="mr-1 font-mono text-xs text-muted-foreground">{wo.targetItem.code}</span>
                {wo.targetItem.name}
              </span>
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

        {wo.dyehouseNote && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-warning">
              Boyahane Notu
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-sm">{wo.dyehouseNote}</div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Üretim Özellikleri
          </div>
          {wo.targetProperties && wo.targetProperties.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {wo.targetProperties.map((p) => (
                <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                  {p.property.name}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="mt-0.5 text-xs italic text-muted-foreground">Atanmış özellik yok.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
