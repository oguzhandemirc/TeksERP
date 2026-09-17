// =============================================================================
// ÇEK GEÇİŞ DİYALOĞU — TEK DİYALOG, TÜM GEÇİŞLER VE STORNOLAR
// =============================================================================
// ⚠️ NEDEN TEK DOSYA: geçişlerin ortak iskeleti aynıdır (ne olacağını söyle ·
// gereken tek ek bilgiyi sor · onayla). Ayrı diyaloglar yazmak, ayrı ayrı
// yerde "para birimi uyuşmazlığı" ya da "tarih sözleşmesi" hatası yapma imkânı
// demekti; farklılık zaten `transitions.ts`'te VERİ olarak duruyor.
//
// ⚠️ HESAP LİSTESİ ÇEKİN PARA BİRİMİNE SÜZÜLÜR. Backend uyuşmazlıkta yol
// gösteren bir 400 veriyor ("… USD hesabıdır — TRY çek/senet bu hesaba
// işlenemez"), ama kullanıcıya SONRADAN reddedilecek bir kombinasyon kurdurmak
// gereksiz sürtünmedir (`PaymentFormDialog`'un "para birimi hesaptan gelir"
// kararının aynası). Süzgeç listeyi boşaltırsa sebebi YAZILIR — boş liste
// "bozuk" değil "tanım yok" demektir.
//
// ⚠️ FATURAYA KAPAMA ENGELİ düğmeyi GİZLEMEZ, açıklar: kaldırılabilir bir ön
// koşuldur. Cümle backend'in söylediğiyle aynı işi yapar ("önce kapamayı
// kaldırın") ve onay düğmesi o cümle ekrandayken kapalıdır — kullanıcıyı
// kesin bir 409'a göndermenin kimseye faydası yok.
//
// ⚠️ İPTAL ve STORNOLARIN gövdesi FARKLIDIR: uçlar yalnız `reason` kabul eder
// (`.strict()`), `eventDate`/`notes` göndermek 400'dür. Bu yüzden o dallarda
// tarih/not alanı ÇİZİLMEZ — çizilse kullanıcı doldurur ve değeri sessizce
// kaybolurdu. Stornoda hesap/cari da SORULMAZ: backend onları terslenen ileri
// olaydan çözer (seçtirmek yanlış hesaba ters kayıt imkânı açardı); diyalog
// aynı olayı onay metninde GÖSTERİR (`ChequeReversalSummary`).
//
// ⚠️ İŞLEM TARİHİ BOŞSA ONAY KAPALIDIR, "bugün" VARSAYILMAZ. Tarih kutusu
// temizlenebiliyor ve bu olay hem `ChequeEvent.eventDate`'e hem cari defter
// satırının `txnDate`'ine yazılıyor; sessiz bir varsayım, dönem kapanışı ve
// ekstre sıralamasını yanlış aya taşırdı (eski hâli boş değeri **1 Ocak
// 1900**'e çeviriyordu — bkz. dates.ts).
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChequeReversalSummary } from "./ChequeReversalSummary";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import { listBankAccounts, listCashBoxes, money } from "../service";
import type { Currency } from "../service";
import {
  chequeBounce, chequeCancel, chequeCollect, chequeDeposit, chequeEndorse,
  chequePay, chequeReturn, chequeReverse, toNum, type ChequeRow,
} from "./service";
import { DOCTYPE_LABEL, cariName } from "./labels";
import { dayStartIso, fmtDate, ymd } from "./dates";
import { allocationBlockReason, type ChequeActionDef } from "./transitions";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

interface Props {
  row: ChequeRow;
  def: ChequeActionDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function ChequeActionDialog({ row, def, open, onOpenChange, onDone }: Props) {
  const [accountId, setAccountId] = useState("");
  const [eventDate, setEventDate] = useState(() => ymd(new Date()));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [party, setParty] = useState<"CUSTOMER" | "SUBCONTRACTOR">("SUBCONTRACTOR");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);

  const needsAccount = def.needs === "bank" || def.needs === "account";
  const isReversal = def.reverses !== undefined;

  const cashQ = useQuery({
    queryKey: ["finance", "cash-boxes"],
    queryFn: listCashBoxes,
    enabled: needsAccount,
  });
  const bankQ = useQuery({
    queryKey: ["finance", "bank-accounts"],
    queryFn: listBankAccounts,
    enabled: needsAccount,
  });

  // Kasa ve banka tek listede birleşir ama kimliğinde türünü taşır: uç ikisini
  // AYRI alanlarla bekliyor ve "kasa XOR banka" seddi DB'de CHECK ile kilitli.
  const accounts = useMemo(() => {
    const bank = (bankQ.data?.data ?? [])
      .filter((a) => a.isActive && a.currency === row.currency)
      .map((a) => ({ ...a, kind: "BANK" as const }));
    if (def.needs === "bank") return bank;
    const cash = (cashQ.data?.data ?? [])
      .filter((a) => a.isActive && a.currency === row.currency)
      .map((a) => ({ ...a, kind: "CASH" as const }));
    return [...cash, ...bank];
  }, [cashQ.data, bankQ.data, def.needs, row.currency]);

  // ⚠️ "TANIM YOK" YALNIZ OKUMA BAŞARILIYKEN SÖYLENİR (PaymentFormDialog ikizi).
  // Buradaki cümle kullanıcıyı Kasa & Banka ekranına gönderir; liste hatası
  // "tanım yok" diye okunursa mükerrer kasa/banka açılır ve çek tahsilatı yanlış
  // hesaba yazılır. `needsAccount` false iken sorgular hiç koşmaz (isError false).
  const accountsError = cashQ.isError || bankQ.isError;
  const accountsResolved = !cashQ.isLoading && !bankQ.isLoading && !accountsError;
  const selected = accounts.find((a) => a.id === accountId);

  // Diyalog çağıran tarafından koşullu mount ediliyor; yine de kapanışta
  // sıfırlıyoruz ki aynı satırda ikinci bir işlem açılırsa eski not taşınmasın.
  useEffect(() => {
    if (!open) {
      setAccountId("");
      setNotes("");
      setReason("");
      setEventDate(ymd(new Date()));
    }
  }, [open]);

  const blockReason = allocationBlockReason(row, def);

  // Sebep dallarında (iptal · tahsil stornosu) tarih alanı hiç çizilmez
  // (uçlar kabul etmiyor) → orada aranmaz.
  const eventIso = dayStartIso(eventDate);
  const needsEventDate = def.needs !== "reason";

  const valid =
    !blockReason &&
    (!needsEventDate || Boolean(eventIso)) &&
    (!needsAccount || Boolean(selected)) &&
    (def.needs !== "cari" || (party === "CUSTOMER" ? Boolean(customerId) : Boolean(subcontractorId))) &&
    (def.needs !== "reason" || reason.trim().length > 0);

  const m = useMutation({
    mutationFn: () => {
      const base = { eventDate: eventIso, notes: notes.trim() || null };
      const acc = {
        cashBoxId: selected?.kind === "CASH" ? selected.id : null,
        bankAccountId: selected?.kind === "BANK" ? selected.id : null,
      };
      switch (def.action) {
        case "deposit":
          return chequeDeposit(row.id, { bankAccountId: selected?.id ?? "", ...base });
        case "collect":
          return chequeCollect(row.id, { ...acc, ...base });
        case "pay":
          return chequePay(row.id, { ...acc, ...base });
        case "endorse":
          return chequeEndorse(row.id, {
            toCustomerId: party === "CUSTOMER" ? customerId : null,
            toSubcontractorId: party === "SUBCONTRACTOR" ? subcontractorId : null,
            ...base,
          });
        case "bounce":
          return chequeBounce(row.id, base);
        case "return":
          return chequeReturn(row.id, base);
        case "cancel":
          // ⚠️ Yalnız `reason` — tarih/not bu uçta YOK (dosya başlığı).
          return chequeCancel(row.id, reason.trim());
        case "collect-cancel":
        case "endorse-cancel":
        case "bounce-cancel":
        case "return-cancel":
        case "pay-cancel":
        case "deposit-cancel":
          // ⚠️ Yalnız `reason` (zorunlu) — hesap/cari/tarih GÖNDERİLMEZ, backend
          // terslenen ileri olaydan çözer; ters satır BUGÜNE düşer.
          return chequeReverse(row.id, def.action, reason.trim());
        default:
          throw new Error("Tanımsız çek işlemi.");
      }
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "İşlem kaydedildi.");
      onDone();
      onOpenChange(false);
    },
  });

  const head = `${row.docNo} · ${DOCTYPE_LABEL[row.docType]} · ${cariName(row.cari)} · ${money(
    toNum(row.amount),
    row.currency as Currency,
  )} · vade ${fmtDate(row.dueDate)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{def.label}</DialogTitle>
          {/* Yıkıcı/geri alınamaz işlemde onay SOMUTTUR: hangi belge, hangi
              cari, hangi tutar, hangi vade — "emin misiniz?" tek başına yetmez. */}
          <DialogDescription className="whitespace-pre-line">
            {head}
            {"\n\n"}
            {def.effect}
          </DialogDescription>
        </DialogHeader>

        {blockReason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{blockReason}</span>
          </div>
        )}

        {def.reverses && <ChequeReversalSummary row={row} reverses={def.reverses} open={open} />}

        {needsAccount && (
          <div>
            <Label>{def.needs === "bank" ? "Banka hesabı" : "Kasa / Banka"}</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind === "CASH" ? "Kasa" : "Banka"} · {a.name} ({a.currency})
                </option>
              ))}
            </select>
            {accountsError && (
              <p className="mt-1 text-xs text-destructive">
                Hesap listesi okunamadı — bu “tanım yok” DEMEK DEĞİLDİR. Yeni hesap açmayın;
                diyaloğu kapatıp tekrar açın.
              </p>
            )}
            {accountsResolved && accounts.length === 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                {row.currency} para biriminde aktif {def.needs === "bank" ? "banka hesabı" : "kasa/banka"} tanımı
                yok. Önce Muhasebe → Kasa &amp; Banka ekranından ekleyin.
              </p>
            )}
          </div>
        )}

        {def.needs === "cari" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ciro edilen taraf</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={party}
                onChange={(e) => setParty(e.target.value as "CUSTOMER" | "SUBCONTRACTOR")}
              >
                <option value="SUBCONTRACTOR">Fason firma</option>
                <option value="CUSTOMER">Müşteri</option>
              </select>
            </div>
            <div>
              <Label>{party === "CUSTOMER" ? "Müşteri" : "Fason firma"}</Label>
              <div className="mt-1">
                {party === "CUSTOMER" ? (
                  <ReferenceSelect<Customer>
                    value={customerId}
                    onChange={setCustomerId}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    placeholder="Müşteri ara..."
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
            <p className="col-span-2 text-xs text-muted-foreground">
              Çeki VEREN cari ({cariName(row.cari)}) seçilemez — ona geri vermek ciro değil iadedir.
            </p>
          </div>
        )}

        {def.needs === "reason" ? (
          <div>
            <Label>{isReversal ? "Storno sebebi" : "İptal sebebi"}</Label>
            <Input
              className="mt-1"
              placeholder={isReversal ? "Örn: işlem yanlış çeke girildi" : "Örn: yanlış tutar girildi"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {isReversal
                ? "Sebep zorunludur ve olay defterine yazılır — asıl kayıt silinmez, bugüne ters kayıt düşer."
                : "Sebep cari deftere ve denetim kaydına yazılır; iptal edilen kayıt listede kalır."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>İşlem tarihi</Label>
              <DatePickerInput aria-label="İşlem tarihi" className="mt-1" value={eventDate} onChange={setEventDate} />
              {!eventIso && (
                // Kapalı onay düğmesinin sebebi EKRANDA yazar; sessizce kapalı
                // bir düğme kullanıcıyı "bozuk" sonucuna götürür.
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                  İşlem tarihi gerekli — bu tarih cari deftere ve olay geçmişine yazılır.
                </p>
              )}
            </div>
            <div>
              <Label>Açıklama (opsiyonel)</Label>
              <Textarea
                className="mt-1 min-h-9"
                rows={1}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant={def.destructive ? "destructive" : "default"}
            disabled={!valid || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? "Kaydediliyor…" : def.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
