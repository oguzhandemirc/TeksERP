// "Siparişe dönüştür": önce kalem kontrolü — ürünü bağlı olmayan (yeni desen) kalem varsa liste + "Ürün bağla"
// (bağ YALNIZ siparişe yazılır; kabul edilmiş teklif değişmez). `order:write` yoksa düğme kapalı + açıklama.
// İdempotent: `clientToken` mantıksal deneme başına (belirsiz hatada yapışır); istek sürerken düğme kapalı → çift tık tek istek.
import { useState } from "react";
import { Link } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAttemptToken } from "@/lib/attemptToken";
import { cn } from "@/lib/utils";
import { missingItemLines } from "./quote-errors";
import { quoteService } from "./service";
import type { QuoteDetail } from "./quote-types";
import { useQuoteMutation } from "./useQuoteMutation";

type Bound = Record<number, { id: string; code: string; name: string }>;
interface Props { quote: QuoteDetail; open: boolean; onOpenChange: (o: boolean) => void }

export function ConvertDialog({ quote, open, onOpenChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const canOrder = hasPermission("order:write");
  const attempt = useAttemptToken();
  const [bound, setBound] = useState<Bound>({});
  const [picking, setPicking] = useState<number | null>(null);
  const [serverMissing, setServerMissing] = useState<number[]>([]);
  const [done, setDone] = useState<{ orderId: string; orderNumber: string | null } | null>(null);
  const unlinked = quote.lines.filter((l) => !l.itemId);
  const unbound = unlinked.filter((l) => !bound[l.lineNo]);
  const convert = useQuoteMutation({
    quoteId: quote.id,
    exclusive: true,
    fn: () => quoteService.convert(quote.id, attempt.token(), unlinked.flatMap((l) => { const b = bound[l.lineNo]; return b ? [{ lineNo: l.lineNo, itemId: b.id }] : []; })),
    onDone: (r) => {
      attempt.onSuccess();
      setDone({ orderId: r.orderId, orderNumber: r.orderNumber });
    },
    onFail: (e) => {
      attempt.onFailure(e);
      setServerMissing((missingItemLines(e) ?? []).map((l) => l.lineNo));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Siparişe dönüştür</DialogTitle>
          <DialogDescription>Teklifin kalemleri aynı fiyat ve dövizle yeni siparişe yazılır; teklif "Siparişe dönüştü" olur.</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="rounded-md border border-success/40 bg-success/5 p-3 text-sm" role="status">
            Sipariş oluşturuldu:{" "}
            <Link className="font-medium underline" to={`/operations/orders?focus=${done.orderId}`} data-testid="convert-order-link">{done.orderNumber ?? "siparişi aç"}</Link>
          </p>
        ) : (
          <>
            {unlinked.length > 0 && (
              <div className="space-y-2" data-testid="unlinked-lines">
                <p className="text-sm">Ürünü bağlı olmayan kalemler — siparişte hangi kumaş kartıyla açılacağını seçin (teklif kalemi değişmez):</p>
                {unlinked.map((l) => (
                  <div key={l.id} className={cn("flex items-center justify-between gap-2 rounded-md border p-2 text-sm", serverMissing.includes(l.lineNo) && !bound[l.lineNo] && "border-destructive")} data-testid={`unlinked-${l.lineNo}`}>
                    <span>{l.lineNo}. {l.description}</span>
                    <Button size="sm" variant="outline" onClick={() => setPicking(l.lineNo)}>
                      <PackageSearch className="mr-1 h-4 w-4" />{boundLabel(bound[l.lineNo])}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!canOrder && <p className="text-sm text-destructive" role="note">Sipariş oluşturma yetkiniz yok — dönüştürme için sipariş yazma izni de gerekir.</p>}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{done ? "Kapat" : "Vazgeç"}</Button>
          {!done && (
            <Button disabled={!canOrder || unbound.length > 0 || convert.isPending} onClick={() => convert.mutate()} data-testid="convert-confirm">
              {convert.isPending ? "Dönüştürülüyor…" : "Siparişi oluştur"}
            </Button>
          )}
        </DialogFooter>
        <ItemPickerModal
          open={picking !== null}
          onOpenChange={(o) => !o && setPicking(null)}
          allowedTypes={["FABRIC"]}
          onPick={(r) => {
            if (picking !== null) setBound((b) => ({ ...b, [picking]: { id: r.id, code: r.code, name: r.name } }));
            setPicking(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

const boundLabel = (b: { code: string; name: string } | undefined) => (b ? `${b.code} — ${b.name}` : "Ürün bağla");
