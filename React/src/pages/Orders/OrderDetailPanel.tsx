import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, FileText, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { orderService } from "@/services/orderService";
import { orderStatusLabels, itemTypeLabels } from "@/types/enums";
import type { OrderStatus, ItemType } from "@/types/enums";
import { SlideOverPanel, SlideOverContentLoader } from "@/components/ui/SlideOverPanel";

interface OrderDetailPanelProps {
  orderId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const statusColorMap: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  PARTIAL_SHIPPED: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function OrderDetailPanel({ orderId, isOpen, onClose }: OrderDetailPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(orderId);

  useEffect(() => {
    if (orderId) setActiveId(orderId);
  }, [orderId]);

  const effectiveId = orderId || activeId;

  const { data, isLoading } = useQuery({
    queryKey: ["order-detail", effectiveId],
    queryFn: () => orderService.getById(effectiveId!),
    enabled: !!effectiveId,
  });

  const order = data?.data;

  return (
    <SlideOverPanel
      title={order ? `#${order.orderNumber}` : "Sipariş Detayı"}
      isOpen={isOpen}
      onClose={onClose}
      widthClass="max-w-lg"
    >
      {isLoading ? (
        <SlideOverContentLoader />
      ) : !order ? (
        <div className="text-center text-muted-foreground p-6">Sipariş bulunamadı</div>
      ) : (
        <div className="space-y-6">
          {/* Başlık */}
          <div className="flex items-center gap-3">
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
            <span className="text-lg font-semibold">{order.orderNumber}</span>
            <Badge
              className={statusColorMap[order.status] ?? ""}
              variant="secondary"
            >
              {orderStatusLabels[order.status as OrderStatus] ?? order.status}
            </Badge>
          </div>

          {/* Genel Bilgiler */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Sipariş Bilgileri
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Müşteri:</span>
              <span className="font-medium">
                {order.customer
                  ? `${order.customer.code} - ${order.customer.name}`
                  : "—"}
              </span>
              <span className="text-muted-foreground">Para Birimi:</span>
              <span>{order.currency}</span>
              {order.totalAmount != null && (
                <>
                  <span className="text-muted-foreground">Toplam Tutar:</span>
                  <span className="font-medium">
                    {Number(order.totalAmount).toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    {order.currency}
                  </span>
                </>
              )}
              <span className="text-muted-foreground">Sipariş Tarihi:</span>
              <span>
                {new Date(order.orderDate).toLocaleDateString("tr-TR")}
              </span>
              {order.deadline && (
                <>
                  <span className="text-muted-foreground">Termin:</span>
                  <span>
                    {new Date(order.deadline).toLocaleDateString("tr-TR")}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Sipariş Kalemleri */}
          {order.lines && order.lines.length > 0 && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4 text-muted-foreground" />
                Sipariş Kalemleri ({order.lines.length})
              </div>
              <div className="space-y-2">
                {order.lines.map((line) => (
                  <div
                    key={line.id}
                    className="rounded border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {line.item?.code ?? "—"}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {line.item?.name}
                        </span>
                        {line.variant && (
                          <Badge 
                            variant="outline" 
                            className="bg-primary/5 text-primary border-primary/20 text-[10px] px-1.5 h-5 flex items-center gap-1"
                            title={line.variant.name}
                          >
                            <span className="font-bold">{line.variant.code}</span>
                            <span className="opacity-70 border-l pl-1 ml-1">{line.variant.name}</span>
                          </Badge>
                        )}
                        {line.width != null && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 h-5 bg-blue-50 text-blue-700 border-blue-100 font-semibold">
                            En: {line.width} cm
                          </Badge>
                        )}
                      </div>
                      {line.item?.itemType && (
                        <Badge variant="outline" className="text-xs">
                          {itemTypeLabels[line.item.itemType as ItemType] ??
                            line.item.itemType}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-sm">
                      <span className="text-muted-foreground">Miktar:</span>
                      <span className="font-medium">{line.quantity} mt</span>
                      {line.unitPrice != null && (
                        <>
                          <span className="text-muted-foreground">
                            Birim Fiyat:
                          </span>
                          <span>
                            {Number(line.unitPrice).toLocaleString("tr-TR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </>
                      )}
                    </div>
                    {line.allocations && line.allocations.length > 0 && (
                      <div className="mt-1 pt-1 border-t">
                        <span className="text-xs text-muted-foreground">
                          Tahsisler ({line.allocations.length}):
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {line.allocations.map((a) => (
                            <Badge
                              key={a.id}
                              variant="secondary"
                              className="text-xs"
                            >
                              {a.allocatedQty} mt
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tarihler */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Oluşturulma:{" "}
              {new Date(order.createdAt).toLocaleString("tr-TR")}
            </div>
            <div>
              Son Güncelleme:{" "}
              {new Date(order.updatedAt).toLocaleString("tr-TR")}
            </div>
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
