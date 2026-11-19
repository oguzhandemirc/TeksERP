// =============================================================================
// Sevk Edilenler satırı — Fatura bilgisi · Belgeler · ⋯ menüsü — SAF YÜKLEM
// =============================================================================
// Bekçi: `dispatchRowActions.test.ts`. Hücrede dağınık `&&` zinciri yerine tek
// yerde: hangi bilgi basılır, tıklayınca ne açılır, "Fatura kes" hangi akışı
// başlatır, Fatura belge düğmesi neden devre dışı, menüde ne var. Görünürlük
// kuralları (rejim, iç/dış iz) `invoiceDraftVisibility`den gelir; burada yalnız
// izinle birleştirilir.
// =============================================================================

import type { ShippingInvoiceMode } from "@/lib/shipping-flags";
import type { DispatchListItem } from "./types";
import {
  canDraftInvoice,
  canMarkInvoiceTrace,
  internalInvoiceOf,
  invoiceLinkLabel,
  invoiceTraceModeNote,
} from "./invoiceDraftVisibility";

export interface DispatchActionCtx {
  financeEnabled: boolean;
  invoiceMode: ShippingInvoiceMode;
  can: (perm: string) => boolean;
}

export type DispatchMenuKey = "openInvoice" | "editTrace" | "markTrace" | "draft" | "irsaliye";

export interface DispatchRowView {
  /** Fatura sütununda basılan bilgi; null → faturasız. */
  info: { no: string; date: string | null; draft: boolean } | null;
  /** Bilgiye tıklayınca: iç fatura detayı ya da dış iz formu; null → düz metin. */
  infoOpen: { kind: "detail"; invoiceId: string } | { kind: "trace" } | null;
  /** Faturasız satırda "Fatura kes" düğmesinin akışı; null → düğme yok. */
  create: "draft" | "trace" | null;
  /** Fatura belgesi (iç, onaylı) — null ise düğme devre dışı, neden `docReason`. */
  doc: { invoiceId: string; docNo: string } | null;
  docReason: string | null;
  /** Satır sonu ⋯ menüsü, sırasıyla. */
  menu: Array<{ key: DispatchMenuKey; label: string; note?: string }>;
}

export const NO_INVOICE_REASON = "Henüz fatura kesilmedi";

export function dispatchRowView(row: DispatchListItem, ctx: DispatchActionCtx): DispatchRowView {
  const { financeEnabled, invoiceMode, can } = ctx;
  // İç fatura yalnız ticaret rejiminde hesaba katılır (`invoiceLinkLabel` ile aynı kapı).
  const inv = financeEnabled ? internalInvoiceOf(row) : null;
  const canTrace = canMarkInvoiceTrace(row, invoiceMode) && can("shipping:invoice");
  const canDraft = canDraftInvoice(row, financeEnabled) && can("finance:write");
  const canReadInv = can("finance:read");
  const traceNote = invoiceTraceModeNote(row, invoiceMode) ?? undefined;

  const info = row.invoiceNo
    ? { no: row.invoiceNo, date: row.invoicedAt, draft: false }
    : inv
      ? { no: inv.docNo, date: null, draft: inv.status === "DRAFT" }
      : null;

  const infoOpen: DispatchRowView["infoOpen"] =
    inv && canReadInv
      ? { kind: "detail", invoiceId: inv.id }
      : row.invoiceNo && canTrace
        ? { kind: "trace" }
        : null;

  // İç akış önce: ticaret rejiminde "fatura kes" deftere işleyen taslaktır; dış iz menüde kalır.
  const create: DispatchRowView["create"] = info ? null : canDraft ? "draft" : canTrace ? "trace" : null;

  let doc: DispatchRowView["doc"] = null;
  let docReason: string | null = null;
  if (inv && inv.status !== "DRAFT") {
    if (canReadInv) doc = { invoiceId: inv.id, docNo: inv.docNo };
    else docReason = "Fatura belgesini görme yetkiniz yok";
  } else if (inv) {
    docReason = "Fatura taslakta — belge onaylanınca oluşur";
  } else if (row.invoiceNo) {
    docReason = "Fatura dış muhasebe programında kesildi — belgesi bu sistemde yok";
  } else {
    docReason = NO_INVOICE_REASON;
  }

  const menu: DispatchRowView["menu"] = [];
  const linkLabel = invoiceLinkLabel(row, financeEnabled);
  if (inv && canReadInv && linkLabel) menu.push({ key: "openInvoice", label: linkLabel });
  if (row.invoiceNo && canTrace) menu.push({ key: "editTrace", label: "Fatura bilgisini düzenle", note: traceNote });
  if (!row.invoiceNo && canTrace && create !== "trace") {
    menu.push({ key: "markTrace", label: "Faturalandı olarak işaretle", note: traceNote });
  }
  if (canDraft && create !== "draft") menu.push({ key: "draft", label: "İç fatura taslağı oluştur" });
  menu.push({ key: "irsaliye", label: "İrsaliyeyi aç" });

  return { info, infoOpen, create, doc, docReason, menu };
}
