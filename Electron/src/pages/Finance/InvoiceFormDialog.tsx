import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import { createInvoice, money, INVOICE_TYPE_LABEL, type Currency, type InvoiceType } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface DraftLine {
  key: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  withholdingRate: number;
}

const emptyLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  description: "",
  qty: 1,
  unit: "m",
  unitPrice: 0,
  discountRate: 0,
  vatRate: 20,
  withholdingRate: 0,
});

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/**
 * Satır tutarı — backend `computeLineAmounts` ile AYNI kural.
 *
 * ⚠️ Bu bir ÖNİZLEMEDİR; gerçek tutar backend'de Decimal ile hesaplanır ve
 * belgeye o damgalanır. İki hesabın ayrışması kullanıcıyı yanıltır, bu yüzden
 * yuvarlama da aynı yerde (satır bazında, 2 hane) yapılır.
 */
function lineTotals(l: DraftLine) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const gross = r(l.qty * l.unitPrice);
  const discount = r((gross * l.discountRate) / 100);
  const net = r(gross - discount);
  const vat = r((net * l.vatRate) / 100);
  const withholding = r((vat * l.withholdingRate) / 100);
  return { net, vat, withholding };
}

export function InvoiceFormDialog({ open, onOpenChange, onCreated }: Props) {
  const [type, setType] = useState<InvoiceType>("SALES");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [externalNo, setExternalNo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  // ⚠️ SATIŞ faturası MÜŞTERİYE, ALIŞ faturası FASONA kesilir. Tek bir "cari"
  // seçici koyup ikisini karıştırmak, satış faturasını fason firmaya kesme
  // ihtimalini açardı — cari defterin yönü de o karara bağlı.
  const isPurchase = type === "PURCHASE" || type === "PURCHASE_RETURN";

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    let wh = 0;
    for (const l of lines) {
      if (!l.description.trim() || l.qty <= 0) continue;
      const t = lineTotals(l);
      net += t.net;
      vat += t.vat;
      wh += t.withholding;
    }
    return { net, vat, wh, grand: Math.round((net + vat - wh) * 100) / 100 };
  }, [lines]);

  const valid =
    (isPurchase ? Boolean(subcontractorId) : Boolean(customerId)) &&
    lines.some((l) => l.description.trim() && l.qty > 0);

  const createM = useMutation({
    mutationFn: () =>
      createInvoice({
        type,
        customerId: isPurchase ? null : customerId,
        subcontractorId: isPurchase ? subcontractorId : null,
        currency,
        externalNo: externalNo || null,
        clientToken: crypto.randomUUID(),
        lines: lines
          .filter((l) => l.description.trim() && l.qty > 0)
          .map((l) => ({
            description: l.description.trim(),
            qty: l.qty,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountRate: l.discountRate,
            vatRate: l.vatRate,
            withholdingRate: l.withholdingRate,
          })),
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Taslak oluşturuldu.");
      setLines([emptyLine()]);
      setExternalNo("");
      onCreated();
      onOpenChange(false);
    },
  });

  const patch = (key: string, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const cols = "grid-cols-[minmax(0,1fr)_80px_60px_100px_70px_70px_70px_44px]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Yeni Fatura (Taslak)</DialogTitle>
          <DialogDescription>
            Taslak deftere işlemez — serbestçe düzenleyip silebilirsiniz. Cari hesaba
            işlemesi için ayrıca <b>Onayla</b> demeniz gerekir.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label>Fatura türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as InvoiceType)}
            >
              {Object.entries(INVOICE_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label>{isPurchase ? "Fason firma" : "Müşteri"}</Label>
            <div className="mt-1">
              {isPurchase ? (
                <ReferenceSelect
                  value={subcontractorId}
                  onChange={setSubcontractorId}
                  service={subcontractorService}
                  queryKey="subcontractors"
                  getLabel={(s: { code: string; name: string }) => `${s.code} — ${s.name}`}
                  placeholder="Fason firma ara..."
                />
              ) : (
                <ReferenceSelect<Customer>
                  value={customerId}
                  onChange={setCustomerId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Müşteri ara..."
                />
              )}
            </div>
          </div>
          <div>
            <Label>Para birimi</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label>Dış fatura no (opsiyonel)</Label>
          <Input
            className="mt-1 w-64"
            placeholder="Muhasebe programındaki belge no"
            value={externalNo}
            onChange={(e) => setExternalNo(e.target.value)}
          />
        </div>

        <div className="rounded-md border">
          <div className={`grid ${cols} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`}>
            <span>Açıklama</span>
            <span>Miktar</span>
            <span>Birim</span>
            <span>Birim Fiyat</span>
            <span>İsk %</span>
            <span>KDV %</span>
            <span>Tevk. %</span>
            <span />
          </div>
          <div className="max-h-[34vh] space-y-2 overflow-auto p-3">
            {lines.map((l) => (
              <div key={l.key} className={`grid ${cols} items-center gap-2`}>
                <Input
                  placeholder="Ürün / hizmet açıklaması"
                  value={l.description}
                  onChange={(e) => patch(l.key, { description: e.target.value })}
                />
                <Input
                  type="number" min={0} step="0.001"
                  value={l.qty || ""}
                  onChange={(e) => patch(l.key, { qty: Number(e.target.value) })}
                />
                <Input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} />
                <Input
                  type="number" min={0} step="0.01"
                  value={l.unitPrice || ""}
                  onChange={(e) => patch(l.key, { unitPrice: Number(e.target.value) })}
                />
                <Input
                  type="number" min={0} max={100} step="0.01"
                  value={l.discountRate || ""}
                  onChange={(e) => patch(l.key, { discountRate: Number(e.target.value) })}
                />
                <Input
                  type="number" min={0} max={100} step="0.01"
                  value={l.vatRate}
                  onChange={(e) => patch(l.key, { vatRate: Number(e.target.value) })}
                />
                <Input
                  type="number" min={0} max={100} step="0.01"
                  value={l.withholdingRate || ""}
                  onChange={(e) => patch(l.key, { withholdingRate: Number(e.target.value) })}
                />
                <Button
                  size="icon"
                  title="Satırı sil"
                  className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between">
          <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="mr-1 h-4 w-4" />
            Satır ekle
          </Button>
          <div className="space-y-0.5 text-right text-sm">
            <div className="text-muted-foreground">
              Ara toplam: <b className="text-foreground">{money(totals.net, currency)}</b>
            </div>
            <div className="text-muted-foreground">
              KDV: <b className="text-foreground">{money(totals.vat, currency)}</b>
            </div>
            {totals.wh > 0 && (
              <div className="text-muted-foreground">
                {/* Tevkifat ödenecek tutardan DÜŞÜLÜR — alıcı o kısmı doğrudan
                    vergi dairesine öder. */}
                Tevkifat: <b className="text-foreground">−{money(totals.wh, currency)}</b>
              </div>
            )}
            <div className="text-base font-semibold">Genel toplam: {money(totals.grand, currency)}</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Kaydediliyor…" : "Taslağı Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
