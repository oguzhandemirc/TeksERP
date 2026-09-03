import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FilePlus2, FileText, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReturnsBadge } from "@/components/operations/ReturnsBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat, formatNumber } from "@/lib/format";
import {
  canDraftInvoice,
  canMarkInvoiceTrace,
  internalInvoiceOf,
  invoiceLinkLabel,
  invoiceTraceModeNote,
} from "./invoiceDraftVisibility";
import type { ShippingInvoiceMode } from "@/lib/shipping-flags";
import type { DispatchListItem } from "./types";

export function buildDispatchColumns(
  onReceipt: (row: DispatchListItem) => void,
  onInvoice: (row: DispatchListItem) => void,
  /** İÇ fatura taslağı açar. Görünürlük `canDraftInvoice` ile çözülür. */
  onDraftInvoice: (row: DispatchListItem) => void,
  /** Ticaret rejimi — `finance.enabled`. */
  financeEnabled: boolean,
  /** Mevcut İÇ faturayı açar (taslak ya da onaylı). */
  onOpenInvoice: (invoiceId: string) => void,
  /** `shipping.invoiceMode` — elle iz yolunun rejimi. */
  invoiceMode: ShippingInvoiceMode,
): ColumnDef<DispatchListItem>[] {
  return [
    {
      accessorKey: "shipmentNo",
      header: () => <SortableHeader field="shipmentNo" label="Sevkiyat No" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono">{row.original.shipmentNo}</span>
          {row.original.kind === "DIRECT" && (
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Müşteri",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.customer.name}</div>
          {row.original.branch && (
            <div className="truncate text-xs text-muted-foreground">
              {row.original.branch.name}
              {row.original.branch.code && (
                <span className="ml-1 font-mono text-[10px] text-foreground/70">· {row.original.branch.code}</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "dispatchedAt",
      // Liste VARSAYILAN olarak bu kolona göre sıralanır (yeniden eskiye).
      // Eskiden kolon "Sevk Tarihi" basıp sıralama `createdAt`'ten geliyordu → pazartesi
      // kurulup cuma sevk edilen sevkiyat yanlış yere düşüyordu (2026-08-02 denetimi).
      header: () => <SortableHeader field="dispatchedAt" label="Sevk Tarihi" />,
      cell: ({ row }) =>
        row.original.dispatchedAt ? safeFormat(row.original.dispatchedAt, "dd.MM.yyyy HH:mm") : "—",
    },
    {
      id: "counts",
      header: "İçerik",
      cell: ({ row }) => {
        const c = row.original._count;
        // Doğrudan sevkte çuval yok — top (+ karşılanan sipariş) gösterilir.
        return (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            {row.original.kind === "DIRECT"
              ? `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`
              : row.original.manualSackCount != null
                ? // Beyan varsa ÖNCE fiziksel adet, parantezde sistemin saydığı.
                  // İkisi biri diğerinin yerine geçmez: 10 çuval tek kayda
                  // yazıldığında fark meşrudur ve fark bilginin kendisidir.
                  `${row.original.manualSackCount} çuval (${c.sacks} kayıt) · ${c.rolls} top`
                : `${c.sacks} çuval · ${c.rolls} top`}
            <ReturnsBadge count={c.returns} />
          </span>
        );
      },
    },
    {
      id: "totals",
      // Faturalanacak MİKTAR — muhasebecinin listede görmesi gereken tek sayı.
      // BRÜT'tür: iade düşülmez, fiş/irsaliye ile birebir (iade rozeti farkı söyler).
      header: "Metraj / Kg",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {formatNumber(row.original.totalMeters, 0)} m
          {row.original.totalKg > 0 && (
            <span className="text-muted-foreground"> · {formatNumber(row.original.totalKg, 1)} kg</span>
          )}
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Fatura",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-1.5">
            {r.invoiceNo ? (
              <span className="whitespace-nowrap text-xs">
                <span className="font-mono">{r.invoiceNo}</span>
                {r.invoicedAt && (
                  <span className="text-muted-foreground"> · {safeFormat(r.invoicedAt, "dd.MM.yyyy")}</span>
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
            {/* ⚠️ REJİME BAĞLI: `ic` modunda elle iz YAZILAMAZ (uç 400 verir) —
                düğme yalnız MEVCUT bir izi kaldırmak için çizilir. Gri buton
                yerine hiç çizmemek tercih edilir (olmayan yolu vaat etme). */}
            {canMarkInvoiceTrace(r, invoiceMode) && (
              <PermissionGate permission="shipping:invoice">
                {/* `ghost` DEĞİL `outline`: ghost varyantının kenarlığı ve zemini yok,
                    kolonun içinde düz metin gibi okunuyordu — tıklanabilir olduğu
                    belli olmuyordu. Kenarlıklı varyant onu düğmeye benzetir. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  title={
                    invoiceTraceModeNote(r, invoiceMode) ??
                    (r.invoiceNo
                      ? "Fatura bilgisini düzenle / işareti kaldır"
                      : "Faturalandı olarak işaretle")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onInvoice(r);
                  }}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {r.invoiceNo ? "Düzenle" : "İşaretle"}
                  {invoiceTraceModeNote(r, invoiceMode) && (
                    <span className="text-amber-600 dark:text-amber-500">•</span>
                  )}
                </Button>
              </PermissionGate>
            )}
            {/* ⚠️ İKİ AYRI İŞ, İKİ AYRI İZİN — karıştırma:
                • "İşaretle" (`shipping:invoice`) = DIŞ muhasebe programında
                  kesilmiş belgenin numarasını buraya İZ olarak yazar.
                • "Faturala" (`finance:write`) = bu sistemde İÇ fatura taslağı
                  doğurur ve onaylanınca cari deftere işler.
                Muhasebeciye ikisini tek izinle vermek, yalnız iz düşmesi
                gereken kişiye defter yazma yetkisi vermek olurdu.
                Zaten faturalanmışsa düğme ÇIKMAZ: backend "bir sevkiyat → tek
                aktif fatura" diyor, gri buton olmayan bir yolu vaat ederdi. */}
            {canDraftInvoice(r, financeEnabled) && (
              <PermissionGate permission="finance:write">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  title="Bu sevkiyattan iç satış faturası taslağı oluştur"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDraftInvoice(r);
                  }}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Faturala
                </Button>
              </PermissionGate>
            )}
            {/* ⭐ İÇ FATURA VARSA DÜĞMENİN YERİNE BAĞ: eskiden yüklem dış ize
                (`invoiceNo`) baktığı için taslağı olan sevkiyatta yine "Faturala"
                çıkıyor ve kullanıcı formu doldurup 409 yiyordu. Şimdi doğrudan o
                taslağa/faturaya gidiliyor — sevkten OTOMATİK doğan taslakların
                bu listedeki tek görünür izi de budur. İzin `finance:read`:
                belgeyi GÖRMEK yazma yetkisi istemez. */}
            {(() => {
              const label = invoiceLinkLabel(r, financeEnabled);
              const inv = internalInvoiceOf(r);
              if (!label || !inv) return null;
              return (
                <PermissionGate permission="finance:read">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px]"
                    title={`${inv.docNo} — bu sevkiyatın iç faturası`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInvoice(inv.id);
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                </PermissionGate>
              );
            })()}
          </div>
        );
      },
    },
    {
      id: "receipt",
      header: "",
      size: 110,
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onReceipt(row.original);
          }}
        >
          <FileText className="h-3.5 w-3.5" /> Fiş
        </Button>
      ),
    },
  ];
}
