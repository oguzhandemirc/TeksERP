import { SEARCH_TARGETS } from "@/lib/search/search-targets";

// Audit tablo adı → komut paletinin kayıt hedefi. Hedef haritası TEK kaynaktır
// (search-targets); burada yalnız audit adı ↔ palet varlığı eşlemesi durur.
const AUDIT_TABLE_ENTITY: Record<string, string> = {
  ORDER: "order",
  WORK_ORDER: "workOrder",
  SHIPMENT: "shipment",
  SACK: "sack",
  ROLL: "roll",
  CUSTOMER: "customer",
  ITEM: "item",
  COLOR: "color",
  SUBCONTRACTOR: "subcontractor",
  BATCH: "batch",
  SWATCH: "swatch",
};

export interface AuditRecordTarget {
  to: string;
  state?: Record<string, unknown>;
  permissions: string[];
}

/** Kaydın açılacağı sayfa; eşlenmemiş tabloda null (cümlede düz metin kalır). */
export function auditRecordTarget(table: string, id: string, label: string): AuditRecordTarget | null {
  const entity = AUDIT_TABLE_ENTITY[table];
  const target = entity ? SEARCH_TARGETS[entity] : undefined;
  if (!target) return null;
  const { to, state } = target.to({ id, title: label, subtitle: null, code: label });
  return { to, state, permissions: target.permissions };
}
