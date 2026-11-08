import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { safeFormat } from "@/lib/format";
import { fetchProcessSummary, processSummaryKey, useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import { SCAN_ROUTE_NAME } from "../oie/nav";
import { materialProviderLabels, workOrderTypeLabels } from "@/types/enums";
import { useFoldLabel } from "@/hooks/useFoldValues";
import type { WorkOrder } from "../types";

/**
 * v3 iş emri künyesi — tam genişlik 4-sütun grid (hedef kumaş/renk/en/kat/tip/
 * oluşturma/rota/refakat kartı) + ayraç + üretim özellikleri tag'leri.
 */
export function KunyeCard({ wo }: { wo: WorkOrder }) {
  const foldLabel = useFoldLabel();
  const { catalog } = useKursunGramajCatalog();
  return (
    <div className="card info">
      <div className="info-grid">
        <Field label="Hedef Kumaş">{wo.targetItem?.name ?? "—"}</Field>
        <Field label="Renk">
          {wo.targetColor ? (
            <span className="swatch">
              {wo.targetColor.hex && <i style={{ background: wo.targetColor.hex }} />}
              {wo.targetColor.name}
            </span>
          ) : (
            "Ham / renksiz"
          )}
        </Field>
        <Field label="En">{wo.width != null ? `${wo.width} cm` : "—"}</Field>
        {catalog.propertyId && (
          <Field label="Gramaj">
            <KunyeGramaj workOrderId={wo.id} />
          </Field>
        )}
        <Field label="Kat Tipi">{wo.foldType ? foldLabel(wo.foldType) : "—"}</Field>
        <Field label="Tip">{workOrderTypeLabels[wo.type]}</Field>
        <Field label="Ana Hammadde">{wo.materialProvidedBy ? materialProviderLabels[wo.materialProvidedBy] : "Bilinmiyor"}</Field>
        <Field label="Oluşturma">
          <span className="num">{safeFormat(wo.createdAt, "dd.MM.yyyy · HH:mm")}</span>
        </Field>
        <Field label="Rota">{kunyeRouteLabel(wo)}</Field>
        <Field label="Refakat Kartı">
          <span className="mono" style={{ fontSize: "13px" }}>
            {wo.workOrderNumber}
          </span>
        </Field>
      </div>
      <div className="divider" />
      <div className="field">
        <div className="k">Üretim Özellikleri</div>
        <div className="props">
          {wo.targetProperties && wo.targetProperties.length > 0 ? (
            wo.targetProperties.map((p) => (
              <span key={p.propertyId} className="tag">
                {p.property.name}
              </span>
            ))
          ) : (
            <span className="tag empty">Atanmış özellik yok</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rotasız (K29) İE tablet/form ile AYNI adı taşır; "Özel rota" yalnız şablonsuz elle tasarlanmış rotadır (prova 11-06). */
export function kunyeRouteLabel(wo: Pick<WorkOrder, "routeTemplate" | "scanRouted">): string {
  if (wo.routeTemplate?.name) return wo.routeTemplate.name;
  return wo.scanRouted ? SCAN_ROUTE_NAME : "Özel rota";
}

/** Hedef kurşun gramajı — "Kurşun Gramajı" kartıyla aynı sorgu anahtarı (önbellek paylaşılır, ek istek yok). */
function KunyeGramaj({ workOrderId }: { workOrderId: string }) {
  const scope = { workOrderId };
  const q = useQuery({ queryKey: processSummaryKey(scope), queryFn: () => fetchProcessSummary(scope) });
  if (q.isLoading) return <>…</>;
  return <>{q.data?.kursun.target?.valueName ?? "—"}</>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="k">{label}</div>
      <div className="v">{children}</div>
    </div>
  );
}
