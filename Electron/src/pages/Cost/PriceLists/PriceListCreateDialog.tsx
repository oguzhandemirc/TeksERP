// Yeni fiyat listesi: ad + (isteğe bağlı) müşteri + döviz + bilgi amaçlı geçerlilik. Müşteri/döviz sonradan değişmez.
// İdempotent: `clientToken` mantıksal deneme başına (belirsiz hatada yapışır); istek sürerken düğme kapalı.
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { useAttemptToken } from "@/lib/attemptToken";
import { CurrencySelect } from "../shared/CurrencySelect";
import { priceListErrorMessage } from "./pl-errors";
import { EMPTY_CREATE, priceListService, type PriceListCreateForm } from "./service";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }

export function PriceListCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const inFlight = useRef(false);
  const [f, setF] = useState<PriceListCreateForm>(EMPTY_CREATE);
  const set = (p: Partial<PriceListCreateForm>) => setF((x) => ({ ...x, ...p }));
  const create = useMutation({
    mutationFn: () => priceListService.create(f, attempt.token()),
    onSuccess: (r) => {
      attempt.onSuccess();
      if (r.message) toast.success(r.message);
      void qc.invalidateQueries({ queryKey: ["price-lists", "list"] });
      onCreated(r.data.id);
    },
    onError: (e) => {
      attempt.onFailure(e);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek `suppressErrorToast` taşır (service.ts OWN); cümle koda göre burada.
      toast.error(priceListErrorMessage(e));
    },
    onSettled: () => { inFlight.current = false; },
  });
  const submit = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni fiyat listesi</DialogTitle>
          <DialogDescription>Müşteri seçilmezse genel liste olur. Müşteri ve döviz sonradan değişmez; satırlar taslakta girilir.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">Liste adı *</span>
            <Input className="mt-1" maxLength={100} value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Liste adı" />
          </label>
          <div className="text-sm sm:col-span-2">
            <span className="text-muted-foreground">Müşteri (boş = genel liste)</span>
            <div className="mt-1"><CustomerPickerField value={f.customerId} onChange={(customerId) => set({ customerId })} clearable placeholder="Genel liste" /></div>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Döviz</span>
            <div className="mt-1"><CurrencySelect value={f.currency} onChange={(currency) => set({ currency })} /></div>
          </label>
          <div />
          <label className="block text-sm">
            <span className="text-muted-foreground">Geçerlilik başlangıcı</span>
            <DatePickerInput className="mt-1" value={f.validFromDate} onChange={(v) => set({ validFromDate: v })} aria-label="Geçerlilik başlangıcı" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Geçerlilik sonu</span>
            <DatePickerInput className="mt-1" value={f.validUntilDate} onChange={(v) => set({ validUntilDate: v })} aria-label="Geçerlilik sonu" />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">Tarihler bilgi amaçlıdır; fiyat önerisinde geçerli olan listenin "Yayında" olmasıdır.</p>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">Not</span>
            <Textarea className="mt-1" rows={2} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Not" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!f.name.trim() || create.isPending} onClick={submit} data-testid="pl-create-submit">{create.isPending ? "Oluşturuluyor…" : "Oluştur"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
