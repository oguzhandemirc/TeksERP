import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { itemService } from "@/pages/Items/service";
import type { Customer } from "@/pages/Customers/types";
import type { Item } from "@/pages/Items/types";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  useItemPriceSuggestion,
  priceKindForInvoiceType,
  describeSuggestion,
  shouldApplySuggestion,
  shouldClearSuggestion,
  computeDueDateSuggestion,
  isBlankText,
  type ItemPriceKind,
} from "@/hooks/useItemPriceSuggestion";
import {
  createInvoice, listCari, money, INVOICE_TYPE_LABEL, type Currency, type InvoiceType,
} from "./service";

/**
 * Bir kaynak belgeden (sevkiyat / mal kabul) ön-doldurulmuş taslak.
 *
 * ⚠️ Bağ ALAN olarak taşınır (`shipmentId`), satır metnine gömülmez: backend
 * "bir kaynak → tek aktif fatura" kuralını partial unique ile o alandan
 * uyguluyor. Yalnız açıklamaya yazılsaydı aynı sevkiyat ikinci kez
 * faturalanabilirdi ve kimse fark etmezdi.
 */
export interface InvoicePrefill {
  /** Fatura türü ön-seçimi. Verilmezse SALES. İade taslağı SALES_RETURN ile açar. */
  type?: InvoiceType;
  shipmentId?: string | null;
  /** Kaynak iade grubu (RollReturn.returnGroupId ?? id) — backend "bir iade
   *  grubu → tek aktif fatura" seddini bu ALANDAN uygular (partial unique). */
  returnGroupId?: string | null;
  customerId?: string | null;
  currency?: Currency;
  lines: Array<{
    description: string;
    qty: number;
    unit: string;
    unitPrice?: number;
    /** Kaynak belge kalemi biliyorsa taşır — fiyat önerisi de ondan çözülür. */
    itemId?: string | null;
  }>;
  /** Diyalog başlığının altında "Kaynak: SVK…" olarak gösterilir. */
  sourceLabel?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** Verilirse form bu değerlerle açılır (kullanıcı hepsini değiştirebilir). */
  prefill?: InvoicePrefill;
}

interface DraftLine {
  key: string;
  /** Katalog kalemi — OPSİYONEL. Kalemsiz serbest satır (nakliye vb.) meşrudur. */
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  withholdingRate: number;
}

/**
 * Boş satır — KDV oranı FİRMA PARAMETRESİNDEN gelir (finance.defaultVatRate;
 * flag henüz yüklenmemişse 20 = eski hardcode, sıfır fark). Backend'in mal
 * kabulden ürettiği alış taslağı da AYNI ayardan okur — oran iki yerde ayrı
 * sürüklenmez. Yalnız ön-dolum: kullanıcı satırda değiştirebilir.
 */
const emptyLine = (vatRate: number = 20): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: null,
  description: "",
  qty: 1,
  unit: "m",
  unitPrice: 0,
  discountRate: 0,
  vatRate,
  withholdingRate: 0,
});

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/** Yerel takvim günü (YYYY-MM-DD) — vade önerisinin tabanı. Form `issueDate`
 *  göndermez, backend "şimdi"yi yazar; öneri de aynı günü taban alır. */
function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

/**
 * Seçili tarafın CARİ vade günü (`CariAccount.paymentTermDays`).
 *
 * Cari hesap LAZY açılır (ilk fatura/tahsilat anında) — kartı OLMAYABİLİR ve bu
 * meşrudur: o durumda öneri yoktur, alan boş kalır. Cari ucu partiye id ile
 * bakmadığı için zincir iki adımdır: parti kartı → kod → cari listesinde TAM kod
 * eşleşmesi (contains araması ada da çarpabilir; kod benzersizdir, kimlik odur).
 */
function usePartyTermDays(party: "CUSTOMER" | "SUBCONTRACTOR", partyId: string | null) {
  // Bu diyalog yalnız finance rejiminde açılır; kapı yine de burada da durur —
  // `/api/finance/cari` rejim kapılıdır, bayraksız kurulumda istek 403 üretirdi.
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;

  const partyQ = useQuery({
    queryKey: ["invoice-party-card", party, partyId],
    queryFn: async () =>
      party === "CUSTOMER"
        ? (await customerService.getById(partyId as string)).data
        : (await subcontractorService.getById(partyId as string)).data,
    enabled: financeEnabled && Boolean(partyId),
    staleTime: 60_000,
  });
  const code = partyQ.data?.code ?? null;

  const cariQ = useQuery({
    queryKey: ["invoice-party-cari-terms", party, code],
    queryFn: () => listCari({ page: 1, pageSize: 50, search: code as string, kind: party }),
    enabled: financeEnabled && Boolean(code),
    staleTime: 60_000,
  });
  const row = code
    ? cariQ.data?.data.find((r) => r.kind === party && r.code === code)
    : undefined;

  return {
    termDays: row?.paymentTermDays ?? null,
    // Sorgu HATASI "vade yok" demek değildir — settled olmadan alana dokunulmaz
    // (bayat öneriyi hata anında temizlemek, yanlış anda veri silmek olurdu).
    settled: Boolean(partyId) && partyQ.isSuccess && cariQ.isSuccess,
  };
}

/**
 * Tek fatura satırı. Ayrı bileşen, süs değil: kalem başına iki kanca çalışır
 * (fiyat önerisi + açıklama ön-dolumu) ve kancalar `map` içinde çağrılamaz.
 *
 * Yazma kuralı üç alan için de AYNI saf yüklemdir (`shouldApplySuggestion`):
 * boşken doldur · kullanıcının yazdığını ASLA ezme · kaynak değişince yalnız
 * bizim yazdığımız değeri tazele.
 */
function InvoiceLineRow({
  line, cols, canDelete, currency, priceKind, priceCustomerId, onPatch, onRemove,
}: {
  line: DraftLine;
  cols: string;
  canDelete: boolean;
  currency: Currency;
  priceKind: ItemPriceKind;
  /** Fiyat çözümünde müşteri istisnası — yalnız CUSTOMER tarafında dolu; fason
   *  caride gönderilmez → kart varsayılanı aranır. */
  priceCustomerId: string | null;
  onPatch: (p: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;

  // Kalem seçilince AÇIKLAMA boşsa kalem adıyla ön-dolar.
  const itemQ = useQuery({
    queryKey: ["invoice-line-item", line.itemId],
    queryFn: () => itemService.getById(line.itemId as string),
    enabled: Boolean(line.itemId),
    staleTime: 5 * 60_000,
  });
  const itemName = line.itemId ? (itemQ.data?.data?.name ?? null) : null;
  const descRef = useRef(line.description);
  descRef.current = line.description;
  const lastDescRef = useRef<string | null>(null);
  useEffect(() => {
    if (!itemName) return;
    if (
      shouldApplySuggestion({
        current: descRef.current,
        lastApplied: lastDescRef.current,
        resolved: itemName,
        isBlank: isBlankText,
      })
    ) {
      patchRef.current({ description: itemName });
      lastDescRef.current = itemName;
    }
  }, [itemName]);

  const suggestion = useItemPriceSuggestion({
    itemId: line.itemId,
    kind: priceKind,
    currency,
    customerId: priceCustomerId,
    current: line.unitPrice,
    onApply: (p) => patchRef.current({ unitPrice: p ?? 0 }),
  });
  const priceHelper = describeSuggestion({
    price: suggestion.price,
    source: suggestion.source,
    message: suggestion.message,
    current: line.unitPrice,
  });

  return (
    <div className="space-y-1">
      <div className={`grid ${cols} items-center gap-2`}>
        <div className="min-w-0">
          <ReferenceSelect<Item>
            value={line.itemId}
            onChange={(v) => onPatch({ itemId: v })}
            service={itemService}
            queryKey="items"
            getLabel={(it) => `${it.code} — ${it.name}`}
            placeholder="Kalem (ops.)"
            nullable
            noneLabel="— (kalemsiz satır)"
          />
        </div>
        <Input
          placeholder="Ürün / hizmet açıklaması"
          value={line.description}
          onChange={(e) => onPatch({ description: e.target.value })}
        />
        <Input
          type="number" min={0} step="0.001"
          value={line.qty || ""}
          onChange={(e) => onPatch({ qty: Number(e.target.value) })}
        />
        <Input value={line.unit} onChange={(e) => onPatch({ unit: e.target.value })} />
        <Input
          type="number" min={0} step="0.01"
          value={line.unitPrice || ""}
          onChange={(e) => onPatch({ unitPrice: Number(e.target.value) })}
        />
        <Input
          type="number" min={0} max={100} step="0.01"
          value={line.discountRate || ""}
          onChange={(e) => onPatch({ discountRate: Number(e.target.value) })}
        />
        <Input
          type="number" min={0} max={100} step="0.01"
          value={line.vatRate}
          onChange={(e) => onPatch({ vatRate: Number(e.target.value) })}
        />
        <Input
          type="number" min={0} max={100} step="0.01"
          value={line.withholdingRate || ""}
          onChange={(e) => onPatch({ withholdingRate: Number(e.target.value) })}
        />
        <Button
          size="icon"
          title="Satırı sil"
          className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40"
          disabled={!canDelete}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {priceHelper && (
        <p className="pl-1 text-[11px] text-muted-foreground">{priceHelper}</p>
      )}
    </div>
  );
}

export function InvoiceFormDialog({ open, onOpenChange, onCreated, prefill }: Props) {
  // ⚠️ Ön-doldurma YALNIZ başlangıç değeridir; çağıran diyaloğu koşullu mount
  // eder (her açılış taze bileşen). Prop'u render fazında senkronlamak,
  // kullanıcının sildiği satırı geri getirirdi.
  // Varsayılan KDV — firma parametresi (finance.defaultVatRate). Diyalog her
  // açılışta taze mount edildiği ve flag'ler app açılışında cache'lendiği için
  // ilk render'da hazırdır; yüklenmemişse 20 (bugünkü davranış, sıfır fark).
  const defaultVatRate = useFeatureFlags().data?.data?.financeDefaultVatRate ?? 20;

  const [type, setType] = useState<InvoiceType>(prefill?.type ?? "SALES");
  const [party, setParty] = useState<"CUSTOMER" | "SUBCONTRACTOR">("CUSTOMER");
  const [customerId, setCustomerId] = useState<string | null>(prefill?.customerId ?? null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>(prefill?.currency ?? "TRY");
  const [externalNo, setExternalNo] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Vade alanına en son YAZDIĞIMIZ öneri — kullanıcı dokunduysa artık eşleşmez
  // ve alana bir daha dokunulmaz (fiyat önerisiyle aynı saf yüklem).
  const [appliedDueSuggestion, setAppliedDueSuggestion] = useState<string | null>(null);
  // Öneri tabanı diyalog oturumu boyunca sabit (gece yarısı geçişinde alan
  // kendi kendine oynamasın).
  const [issueYmd] = useState(() => todayYmd());
  const [lines, setLines] = useState<DraftLine[]>(() =>
    prefill?.lines.length
      ? prefill.lines.map((l) => ({
          ...emptyLine(defaultVatRate),
          ...l,
          unitPrice: l.unitPrice ?? 0,
          itemId: l.itemId ?? null,
        }))
      : [emptyLine(defaultVatRate)],
  );

  // Taraf iki AYRI karttan gelir: Müşteri/Tedarikçi (Customer — tedarikçi de
  // bu karttadır, CompanyType.SUPPLIER) ve Fason (Subcontractor). Alış faturası
  // her ikisine de kesilebilir: tedarikçiden mal, fasondan hizmet alınır.
  // Cari defterin YÖNÜ türden gelir (invoiceLedgerSide), taraftan değil.
  const isCustomerParty = party === "CUSTOMER";
  const partyId = isCustomerParty ? customerId : subcontractorId;

  // ── VADE ÖNERİSİ ──────────────────────────────────────────────────────────
  // Cari seçilince, alan BOŞKEN issueDate + `paymentTermDays`'ten türetilir
  // (formda, backend'de değil). Kullanıcının yazdığı tarih ASLA ezilmez; cari
  // değişince yalnız bizim yazdığımız öneri tazelenir/temizlenir. Vade günü
  // tanımsızsa alan boş kalır — UYDURMA VADE YOK (aging'in "vadesiz" kovası
  // dürüst kalmalı).
  const terms = usePartyTermDays(isCustomerParty ? "CUSTOMER" : "SUBCONTRACTOR", partyId);
  const dueDateRef = useRef(dueDate);
  dueDateRef.current = dueDate;
  useEffect(() => {
    if (!partyId || !terms.settled) return;
    const resolved = computeDueDateSuggestion(issueYmd, terms.termDays);
    if (resolved !== null) {
      if (
        shouldApplySuggestion({
          current: dueDateRef.current,
          lastApplied: appliedDueSuggestion,
          resolved,
          isBlank: isBlankText,
        })
      ) {
        setDueDate(resolved);
        setAppliedDueSuggestion(resolved);
      }
    } else if (
      shouldClearSuggestion({ current: dueDateRef.current, lastApplied: appliedDueSuggestion })
    ) {
      setDueDate("");
      setAppliedDueSuggestion(null);
    }
  }, [partyId, terms.settled, terms.termDays, appliedDueSuggestion, issueYmd]);

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
    (isCustomerParty ? Boolean(customerId) : Boolean(subcontractorId)) &&
    lines.some((l) => l.description.trim() && l.qty > 0);

  const createM = useMutation({
    mutationFn: () =>
      createInvoice({
        type,
        customerId: isCustomerParty ? customerId : null,
        subcontractorId: isCustomerParty ? null : subcontractorId,
        currency,
        externalNo: externalNo || null,
        dueDate: dueDate || null,
        // Kaynak bağı yalnız SATIŞ faturasında taşınır: sevkiyat bizim çıkışımız,
        // alış faturasının kaynağı mal kabul fişidir (A3 yolu). Kullanıcı türü
        // ALIŞ'a çevirdiyse bağ sessizce düşer — yanlış kaynağa bağlı fatura,
        // bağsız faturadan kötüdür.
        shipmentId: type === "SALES" ? (prefill?.shipmentId ?? null) : null,
        // İade bağı yalnız SATIŞ İADESİ türünde taşınır (üstteki kuralın aynası):
        // tür değiştirilirse bağ sessizce düşer — yanlış kaynağa bağlı fatura,
        // bağsız faturadan kötüdür. Sed backend'de partial unique.
        returnGroupId: type === "SALES_RETURN" ? (prefill?.returnGroupId ?? null) : null,
        clientToken: crypto.randomUUID(),
        lines: lines
          .filter((l) => l.description.trim() && l.qty > 0)
          .map((l) => ({
            itemId: l.itemId ?? null,
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
      setLines([emptyLine(defaultVatRate)]);
      setExternalNo("");
      setDueDate("");
      setAppliedDueSuggestion(null);
      onCreated();
      onOpenChange(false);
    },
  });

  const patch = (key: string, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const cols =
    "grid-cols-[minmax(0,190px)_minmax(0,1fr)_76px_56px_100px_64px_64px_64px_40px]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Yeni Fatura (Taslak)</DialogTitle>
          <DialogDescription>
            {prefill?.sourceLabel && (
              <span className="mr-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                Kaynak: {prefill.sourceLabel}
              </span>
            )}
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
          <div>
            <Label>Cari türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={party}
              onChange={(e) => setParty(e.target.value as "CUSTOMER" | "SUBCONTRACTOR")}
            >
              <option value="CUSTOMER">Müşteri / Tedarikçi</option>
              <option value="SUBCONTRACTOR">Fason firma</option>
            </select>
          </div>
          <div>
            <Label>{isCustomerParty ? "Müşteri / Tedarikçi" : "Fason firma"}</Label>
            <div className="mt-1">
              {isCustomerParty ? (
                <ReferenceSelect<Customer>
                  value={customerId}
                  onChange={setCustomerId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Kart ara..."
                />
              ) : (
                <ReferenceSelect
                  value={subcontractorId}
                  onChange={setSubcontractorId}
                  service={subcontractorService}
                  queryKey="subcontractors"
                  getLabel={(s: { code: string; name: string }) => `${s.code} — ${s.name}`}
                  placeholder="Fason firma ara..."
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

        <div className="flex flex-wrap items-start gap-3">
          <div>
            <Label>Vade tarihi (opsiyonel)</Label>
            <Input
              type="date"
              className="mt-1 w-44"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {terms.settled && terms.termDays !== null && dueDate !== "" &&
              dueDate === appliedDueSuggestion && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Cari vadesinden önerildi ({terms.termDays} gün) — değiştirebilirsiniz.
                </p>
              )}
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
        </div>

        <div className="rounded-md border">
          <div className={`grid ${cols} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`}>
            <span>Kalem</span>
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
              <InvoiceLineRow
                key={l.key}
                line={l}
                cols={cols}
                canDelete={lines.length > 1}
                currency={currency}
                priceKind={priceKindForInvoiceType(type)}
                priceCustomerId={isCustomerParty ? customerId : null}
                onPatch={(p) => patch(l.key, p)}
                onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              />
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between">
          <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine(defaultVatRate)])}>
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
