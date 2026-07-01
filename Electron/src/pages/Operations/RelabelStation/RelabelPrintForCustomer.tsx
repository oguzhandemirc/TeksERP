import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { labelService } from "@/services/labelService";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import type { RelabelContext } from "./types";

/**
 * "B müşterisi için yeniden bas" — etiket A için basılmış ama mal B'ye gidecek.
 * Müşteri seçilince önizleme `customerId` ile yeniden render olur (master alias
 * cascade), Bas → audit `lastLabelSnapshot`'a B yazar. Spec'e DOKUNMAZ.
 * `key={ctx.id}` ile remount → seçim taze top'ta sıfırlanır.
 */
export function RelabelPrintForCustomer({
  ctx,
  onPrinted,
}: {
  ctx: RelabelContext;
  /** Basımdan sonra üst bağlamı tazele — "Son baskı (A)" afişi B'yi göstersin. */
  onPrinted?: () => void;
}) {
  const { hasPermission } = useRoleAccess();
  const canPrint = hasPermission("label:print");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Bu PC'ye yapılandırılmış seri/COM Argox varsa diyalogsuz baskı; yoksa iframe.print().
  const { directEnabled, printRoll } = useLabelPrinter();
  const [sending, setSending] = useState(false);

  // Üç durum: müşteri seçili → o müşteri; stock=true → ZORLA stok (müşterisiz);
  // ikisi de değilse → topun mevcut etiketi. AÇILIŞ: son basılan seçim (lastLabelSnapshot)
  // ön-seçili gelir (en son hangi müşteri/stok seçildiyse). key={ctx.id} → taze topta yeniden seed.
  const lastSnap = ctx.lastLabelSnapshot;
  const [customerId, setCustomerId] = useState<string | null>(
    lastSnap && !lastSnap.stock ? (lastSnap.customerId ?? null) : null,
  );
  const [orderLineId, setOrderLineId] = useState<string | null>(
    lastSnap && !lastSnap.stock ? (lastSnap.orderLineId ?? null) : null,
  );
  const [stock, setStock] = useState<boolean>(lastSnap?.stock ?? false);

  // stock seçiliyse backend'e ZORLA {stock:true} (snapshot müşterisine DÜŞMESİN);
  // aksi halde {customerId, orderLineId} (açılışta ikisi de null → mevcut etiket).
  const ctxOpts = stock ? { stock: true } : { customerId, orderLineId };

  // WYSIWYG önizleme — AKTİF DİLDE (native → görsel SVG, baskıyla birebir).
  const previewQuery = useQuery({
    queryKey: ["relabel-preview", ctx.id, customerId, orderLineId, stock],
    queryFn: () => labelService.getRollPreview(ctx.id, ctxOpts),
    staleTime: 0,
  });
  const preview = previewQuery.data;

  const printMut = useMutation({
    mutationFn: () => labelService.printRollLabel(ctx.id, ctxOpts),
    onSuccess: () => {
      toast.success("Etiket basıldı (audit kaydı oluşturuldu).");
      onPrinted?.(); // backend lastLabelSnapshot=B yazdı → bağlamı tazele
    },
  });

  const handlePrint = async () => {
    if (directEnabled) {
      if (sending) return; // çift-tık koruması — seri/BT gönderim ~1sn sürebilir.
      setSending(true);
      try {
        // Diyalogsuz: native PPLA → seri/COM. Hata olursa diyaloğa DÜŞME (görünür hata).
        const r = await printRoll(ctx.id, ctxOpts);
        if (r.ok) {
          printMut.mutate(); // audit + "Etiket basıldı" toast'ı printMut.onSuccess'ten.
        } else {
          toast.error(r.error ?? "Yazıcıya gönderilemedi");
        }
      } finally {
        setSending(false);
      }
      return;
    }
    // Yapılandırılmış seri yazıcı yok → eski OS yazdırma diyaloğu yedeği.
    iframeRef.current?.contentWindow?.print();
    printMut.mutate();
  };

  const hasBarcode = Boolean(ctx.barcode);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Müşteri İçin Yeniden Bas</h3>
      <p className="text-xs text-muted-foreground">
        Müşteri seç → <strong>Bas</strong>: o müşteri için yeni etiket basılır. Topun verisini
        değiştirmez (onun için yukarıdaki <strong>Veri Düzelt</strong>).
      </p>

      {/* "B" önerileri — topu üreten WO'nun bağlı siparişlerinden */}
      {ctx.candidateCustomers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ctx.candidateCustomers.map((c) => {
            const active = customerId === c.customerId && orderLineId === c.orderLineId;
            return (
              <button
                key={c.customerId}
                type="button"
                onClick={() => {
                  setCustomerId(c.customerId);
                  setOrderLineId(c.orderLineId);
                  setStock(false);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  active
                    ? "border-transparent bg-emerald-600 font-medium text-white"
                    : "border-input hover:bg-accent"
                }`}
                title={`${c.orderNumber} · ${c.customerCode}`}
              >
                {c.customerName}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem] flex-1">
          <EntityPickerModal<Customer>
            value={customerId}
            onChange={(id) => {
              setCustomerId(id);
              setOrderLineId(null); // serbest müşteri → sipariş yok; master alias cascade
              setStock(false);
            }}
            service={customerService}
            queryKey="customers"
            getLabel={(c) => `${c.code} — ${c.name}`}
            nullable
          />
        </div>
        {/* Stok = "müşteri yok" — kendi rengi (amber). Seçiliyken dolu, değilken amber-tint
            (beyaz değil → müşteri seçiliyken de belli). Emerald=müşteri seçimi, primary=Bas. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setStock(true);
            setCustomerId(null);
            setOrderLineId(null);
          }}
          className={cn(
            "gap-1 border-amber-400",
            stock
              ? "bg-amber-500 text-white hover:bg-amber-500/90"
              : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
          )}
        >
          <Package className="h-3.5 w-3.5" /> Stok (müşterisiz)
        </Button>
      </div>

      {/* Canlı önizleme — seçilen müşteriyle, AKTİF DİLDE (baskıyla birebir) */}
      {preview && (
        <div className="text-[11px] text-muted-foreground">
          Aktif dil: <strong>{preview.language}</strong> ·{" "}
          {preview.mode === "text" ? "ham komut (görsel yok)" : "önizleme = baskı"}
        </div>
      )}
      {previewQuery.isLoading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : previewQuery.isError ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
          Etiket alınamadı: {(previewQuery.error as Error).message}
        </div>
      ) : preview?.mode === "text" ? (
        <pre className="h-[520px] w-full overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
          {preview.content}
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          title="Yeniden etiket önizleme"
          srcDoc={preview?.content ?? ""}
          sandbox="allow-same-origin allow-modals"
          className="h-[520px] w-full rounded border bg-white"
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {customerId
            ? "Seçili müşteri için basılacak"
            : stock
              ? "Müşterisiz (stok) basılacak"
              : "Topun mevcut etiketi basılacak"}
        </div>
        {canPrint ? (
          <Button
            type="button"
            size="sm"
            disabled={!hasBarcode || previewQuery.isLoading || printMut.isPending || sending}
            onClick={handlePrint}
            className="gap-1"
          >
            <Printer className="h-3.5 w-3.5" />
            {printMut.isPending ? "Basılıyor..." : "Bas"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Basım yetkiniz yok</span>
        )}
      </div>
      {!hasBarcode && (
        <p className="text-[11px] text-amber-700">
          Bu topun barkodu yok (açık kumaş) — etiket basılamaz; önce Tambur'da kesilmeli.
        </p>
      )}
    </div>
  );
}
