// Cari kayıt sayfası — "Belgeler" sekmesinin veri katmanı (`GET /api/customers/:id/documents`).
// Görünür türleri sunucu söyler (izin ∧ modül); istemci süzmez, saymaz. Etiket tek kaynak `DOC_DEFS`.
import { infiniteQueryOptions } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { DOC_DEFS, DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import type { PrintedDocType } from "@/services/printedDocumentService";
import { NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT } from "@/pages/Operations/GelenBelgeler/noteStatus";
import type { NoteStatus } from "@/pages/Operations/GelenBelgeler/types";
import type { BadgeProps } from "@/components/ui/badge";

export const INCOMING_DELIVERY_NOTE = "INCOMING_DELIVERY_NOTE";
export type CariDocType = PrintedDocType | typeof INCOMING_DELIVERY_NOTE;

export interface CariDocumentRow {
  kind: "printed" | "incoming";
  docType: CariDocType;
  id: string;
  sourceId: string;
  documentNo: string;
  date: string;
  status: string;
  version: number | null;
  target: { type: string; id: string };
}

export interface CariDocumentsPage {
  data: CariDocumentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  types: CariDocType[];
}

const PAGE_SIZE = 25;

export async function fetchCariDocuments(customerId: string, page: number): Promise<CariDocumentsPage> {
  const res = await apiClient.get<CariDocumentsPage>(`/api/customers/${customerId}/documents`, { params: { page, pageSize: PAGE_SIZE } });
  return res.data;
}

/** Sekme yoklaması ve sekme içeriği AYNI anahtarı okur (ikinci istek yok). */
export const cariDocumentsQuery = (customerId: string) =>
  infiniteQueryOptions({
    queryKey: ["customers", customerId, "documents"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchCariDocuments(customerId, pageParam),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    staleTime: 30_000,
  });

/** Sekme görünürlüğü: görünen tür yoksa ya da satır yoksa 0 (sekme çizilmez). */
export function cariDocumentsCount(first: CariDocumentsPage | undefined): number | undefined {
  if (!first) return undefined;
  return first.types.length === 0 ? 0 : first.pagination.total;
}

export function cariDocLabel(docType: CariDocType): string {
  if (docType === INCOMING_DELIVERY_NOTE) return "Gelen belge";
  const key = DOC_TYPE_TO_KEY[docType];
  return DOC_DEFS.find((d) => d.key === key)?.label ?? docType;
}

type Variant = NonNullable<BadgeProps["variant"]>;
const PRINTED_STATUS: Record<string, { label: string; variant: Variant }> = {
  ACTIVE: { label: "Geçerli", variant: "success" },
  VOIDED: { label: "İptal", variant: "danger" },
};

export function cariDocStatus(row: Pick<CariDocumentRow, "kind" | "status">): { label: string; variant: Variant } {
  if (row.kind === "incoming") {
    const s = row.status as NoteStatus;
    return { label: NOTE_STATUS_LABEL[s] ?? row.status, variant: NOTE_STATUS_VARIANT[s] ?? "outline" };
  }
  return PRINTED_STATUS[row.status] ?? { label: row.status, variant: "outline" };
}

/** Satırın açılışı: basılı belge mevcut görüntüleyicide, gelen belge kendi kayıt sayfasında. */
export const incomingNotePath = (id: string) => `/operations/gelen-belgeler/${id}`;
