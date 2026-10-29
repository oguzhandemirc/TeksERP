// H8 dönem sonu hizmet faturası — API (yollar TAM, `apiClient` tek geçit).
import apiClient from "@/services/apiClient";
import type { Currency } from "./service";

/** H8 dönem sonu hizmet faturası önizlemesi — sunucu tipinin aynası (`service-period-invoice.service.ts`). */
export interface ServicePeriodPreview {
  cariId: string;
  cariName: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  currency: Currency;
  shipmentCount: number;
  shipmentNos: string[];
  workCount: number;
  alreadyBilledWorkCount: number;
  totalMeters: string;
  lines: Array<{ itemId: string; description: string; qty: string; unit: string; unitPrice: string; amount: string }>;
  subtotal: string;
  periodClosed: string | null;
  warnings: string[];
}

/** `GET /api/finance/invoices/service-period-draft/preview` — yazmaz. */
export async function previewServicePeriodDraft(cariId: string, period: string): Promise<ServicePeriodPreview> {
  const res = await apiClient.get("/api/finance/invoices/service-period-draft/preview", { params: { cariId, period } });
  return (res.data as { data: ServicePeriodPreview }).data;
}

/** `POST /api/finance/invoices/service-period-draft` — token mantıksal deneme başına (aynı token → aynı taslak). */
export async function createServicePeriodDraft(body: { cariId: string; period: string; clientToken: string }) {
  const res = await apiClient.post("/api/finance/invoices/service-period-draft", body);
  return res.data as { data: { id: string; docNo: string }; message?: string };
}
