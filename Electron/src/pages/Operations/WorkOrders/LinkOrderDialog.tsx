import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { safeFormat } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { PermissionGate } from "@/components/PermissionGate";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { orderService } from "@/pages/Operations/Orders/service";
import type { Order } from "@/pages/Operations/Orders/types";
import { workOrderService } from "./service";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { showServerWarnings } from "@/lib/serverNotes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  workOrderNumber: string;
  /** Hızlı sipariş için — kumaş/renk/en iş emrinden gelir ve KİLİTLİDİR. */
  targetItemId: string | null;
  targetItemName: string | null;
  targetColorId: string | null;
  targetColorName: string | null;
  targetWidth: number | null;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

/**
 * "Sipariş Bağla" — üretim başlamış (hatta boyahanedeki) bir iş emrine sonradan
 * sipariş bağlama yolu (2026-08-17, madde 8).
 *
 * Neden "Düzenle" ekranı DEĞİL: orası iş emrinin her şeyini açıyor ve saha
 * personeli sipariş bağlarken yanlışlıkla rotayı/hedefi bozabiliyordu. Bu
 * diyalog yalnız bağ kurar.
 *
 * ⚠️ Liste zaten kumaş+renk uyumuna göre SUNUCUDA süzülür — burada ikinci bir
 * süzgeç kurma; uyuşmazlık kararı tek yerde (backend) yaşamalı, yoksa ekran
 * "bağlanabilir" dediği satırda 400 alır.
 */
export function LinkOrderDialog({
  open,
  onOpenChange,
  workOrderId,
  workOrderNumber,
  targetItemId,
  targetItemName,
  targetColorId,
  targetColorName,
  targetWidth,
}: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Hızlı sipariş formu açık mı (2026-08-17, madde 8). */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickCustomerId, setQuickCustomerId] = useState<string | null>(null);
  const [quickQty, setQuickQty] = useState("");
  const [quickDeadline, setQuickDeadline] = useState("");

  const q = useQuery({
    queryKey: ["work-order-linkable-lines", workOrderId],
    queryFn: () => workOrderService.getLinkableOrderLines(workOrderId),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (ids: string[]) => workOrderService.linkOrderLines(workOrderId, ids),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş bağlandı");
      // Uyarılar ayrı basılır: bağ KURULDU ama planlamacının bilmesi gereken
      // bir fark var (bugün: en). Başarı toast'ına gömmek onu görünmez yapardı.
      showServerWarnings({ warnings: res.data.warnings });
      // ⚠️ Anahtarlar EKRANLARIN kullandığıyla birebir olmalı. İlk yazımda
      // `["work-order", id]` invalidate ediliyordu — böyle bir sorgu YOK:
      // liste tazeleniyor, yan panel ve detay sayfası ESKİ rengi göstermeye
      // devam ediyordu (2026-08-17 saha bildirimi, ekran görüntülü).
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      setSelected(new Set());
      onOpenChange(false);
    },
  });

  /**
   * "Uyumlu sipariş yok" çıkmazını sayfa değiştirmeden aşar (2026-08-17 talebi).
   * Kumaş/renk/en İŞ EMRİNDEN gelir ve sorulmaz — zaten uyumlu olmak zorunda,
   * sorulsaydı planlamacı yanlış girip kendi bağını reddettirebilirdi.
   * Sipariş oluşur oluşmaz bağlanır: iki adım tek dokunuş.
   */
  const quickMutation = useMutation({
    mutationFn: async () => {
      if (!targetItemId) throw new Error("İş emrinin hedef kumaşı yok — önce kumaş seçin.");
      if (!quickCustomerId) throw new Error("Müşteri seçin.");
      const qty = Number(quickQty);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Metraj girin.");
      const created = await orderService.create({
        customerId: quickCustomerId,
        ...(quickDeadline ? { deadline: quickDeadline } : {}),
        lines: [
          {
            itemId: targetItemId,
            colorId: targetColorId,
            width: targetWidth,
            quantity: qty,
          },
        ],
      } as unknown as Partial<Order>);
      const lineId = (created.data as unknown as { lines?: { id: string }[] })?.lines?.[0]?.id;
      if (!lineId) throw new Error("Sipariş oluştu ama kalem okunamadı — listeden bağlayın.");
      const linked = await workOrderService.linkOrderLines(workOrderId, [lineId]);
      // Bağlama adımının ALAN uyarıları (bugün: en farkı) zarfta değil `data`da — açıkça basılır;
      // iki isteğin zarf uyarılarını apiClient interceptor'ı zaten bastı.
      showServerWarnings({ warnings: linked.data?.warnings ?? [] });
      return created;
    },
    onSuccess: () => {
      toast.success("Sipariş oluşturuldu ve bağlandı");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lines = q.data?.data ?? [];
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Sipariş Bağla — {workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            Yalnız bu iş emrinin ürettiği kumaş ve renkle uyumlu sipariş satırları
            listelenir. Bağlamak iş emrinin hedefini <strong>değiştirmez</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-auto rounded-md border">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : lines.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Uyumlu açık sipariş yok.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="w-9 p-2" />
                  <th className="p-2 text-left font-medium">Sipariş / Müşteri</th>
                  <th className="p-2 text-left font-medium">Kumaş / Renk</th>
                  <th className="p-2 text-right font-medium">Açık</th>
                  <th className="p-2 text-left font-medium">Termin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.id}
                    className="cursor-pointer border-t transition-colors hover:bg-accent/40"
                    onClick={() => toggle(l.id)}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                    </td>
                    <td className="p-2">
                      <div className="font-mono text-xs">{l.orderNumber}</div>
                      <div className="text-xs text-muted-foreground">{l.customerName}</div>
                    </td>
                    <td className="p-2">
                      <div>{l.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.colorName ?? "renksiz"}
                        {l.width != null ? ` · ${l.width} cm` : ""}
                      </div>
                      {l.warnings.map((w) => (
                        <div
                          key={w}
                          className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                        </div>
                      ))}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      <div className="font-medium">
                        {l.openQty === null ? "ölçülmüyor" : `${fmt(l.openQty)} m`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(l.quantity)} istendi
                      </div>
                    </td>
                    <td className="p-2 text-xs">
                      {l.deadline ? safeFormat(l.deadline, "dd.MM.yyyy") : <Badge variant="muted">—</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {quickOpen ? (
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">
              Yeni sipariş —{" "}
              <span className="text-muted-foreground">
                {targetItemName ?? "kumaş yok"}
                {targetColorName ? ` · ${targetColorName}` : ""}
                {targetWidth != null ? ` · ${targetWidth} cm` : ""}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ReferenceSelect<Customer>
                value={quickCustomerId}
                onChange={setQuickCustomerId}
                service={customerService}
                queryKey="customers"
                getLabel={(c) => c.name}
                placeholder="Müşteri"
                nullable
              />
              <Input
                type="number"
                min={1}
                value={quickQty}
                onChange={(e) => setQuickQty(e.target.value)}
                placeholder="Metraj"
              />
              <DatePickerInput aria-label="Termin" placeholder="Termin" value={quickDeadline} onChange={setQuickDeadline} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuickOpen(false)}>
                Vazgeç
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={quickMutation.isPending}
                onClick={() => quickMutation.mutate()}
              >
                {quickMutation.isPending ? "Oluşturuluyor…" : "Oluştur ve Bağla"}
              </Button>
            </div>
          </div>
        ) : (
          <PermissionGate permission="order:write">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start gap-1"
              onClick={() => setQuickOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Yeni Sipariş Oluştur
            </Button>
          </PermissionGate>
        )}

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() => mutation.mutate([...selected])}
          >
            {mutation.isPending ? "Bağlanıyor…" : `Bağla (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
