// "Devereci elindeki gövdelerimiz" (devere D3) — `GET /api/beam-bodies/at-warpers`. Gruplama ve sayılar sunucudan;
// burada yalnız istek ve metin biçimi.
import apiClient from "@/services/apiClient";

export interface WarperBody {
  id: string;
  bodyNo: string;
  owner: { kind: "OURS" | "WARPER" | "CUSTOMER" | "OTHER"; label: string; customer: { id: string; code: string; name: string } | null };
  sentWith: { dispatchId: string; dispatchNo: string; warpingOrderId: string | null; orderNo: string | null; at: string } | null;
  statusSince: string;
  statusAgeDays: number;
}

export interface WarperBodyGroup {
  subcontractor: { id: string; name: string };
  count: number;
  bodies: WarperBody[];
}

export interface BodiesAtWarpers {
  data: WarperBodyGroup[];
  summary: { bodyCount: number; warperCount: number };
  truncated: boolean;
}

export async function getBodiesAtWarpers(p: { search?: string; subcontractorId?: string }): Promise<BodiesAtWarpers> {
  const sp = new URLSearchParams();
  if (p.search) sp.set("search", p.search);
  if (p.subcontractorId) sp.set("filter[subcontractorId]", p.subcontractorId);
  const qs = sp.toString();
  const r = await apiClient.get<{ success: boolean } & BodiesAtWarpers>(`/api/beam-bodies/at-warpers${qs ? `?${qs}` : ""}`);
  return { data: r.data.data, summary: r.data.summary, truncated: r.data.truncated };
}

/** Gövdenin deverecide nasıl bulunduğu: iplik sevkiyle gittiyse sevk + sipariş no; değilse elle/yerinde kayıt. */
export function atWarperSourceText(b: WarperBody): string {
  if (!b.sentWith) return "Elle gönderildi ya da deverecide kaydedildi";
  return b.sentWith.orderNo ? `${b.sentWith.orderNo} siparişiyle gönderildi (${b.sentWith.dispatchNo})` : `${b.sentWith.dispatchNo} sevkiyle gönderildi`;
}
