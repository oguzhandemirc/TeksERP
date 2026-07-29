import type { ReactNode } from "react";
import { safeFormat } from "@/lib/format";
import { workOrderTypeLabels } from "@/types/enums";
import type { WorkOrder } from "../types";

/**
 * v3 iş emri künyesi — tam genişlik 4-sütun grid (hedef kumaş/renk/en/kat/tip/
 * oluşturma/rota/refakat kartı) + ayraç + üretim özellikleri tag'leri.
 */
export function KunyeCard({ wo }: { wo: WorkOrder }) {
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
        <Field label="Kat Tipi">{wo.foldType ?? "—"}</Field>
        <Field label="Tip">{workOrderTypeLabels[wo.type]}</Field>
        <Field label="Oluşturma">
          <span className="num">{safeFormat(wo.createdAt, "dd.MM.yyyy · HH:mm")}</span>
        </Field>
        <Field label="Rota">{wo.routeTemplate?.name ?? "Özel rota"}</Field>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="k">{label}</div>
      <div className="v">{children}</div>
    </div>
  );
}
