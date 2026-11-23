// Özel dokuma iş emri şablonu — backend `WeavingOrderTemplate` (`/api/weaving-order-templates`) istemci tipi.
import type { WeavingExecutionKind } from "../types";

export interface WeavingOrderTemplate {
  id: string;
  name: string;
  description: string | null;
  itemId: string | null;
  executionKind: WeavingExecutionKind | null;
  subcontractorId: string | null;
  /** Prisma Decimal JSON'da metin gelir. */
  plannedM: string | number | null;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
  item?: { id: string; code: string; name: string } | null;
  subcontractor?: { id: string; code: string; name: string } | null;
}
