// =============================================================================
// ÇEK / SENET GİRİŞİ (alınan) veya ÇIKIŞI (verilen)
// =============================================================================
// ⚠️ DEFTER ANI kilitli bir karardır ve kullanıcıya AÇIKÇA söylenir: alınan çek
// ALINDIĞI AN carinin borcunu azaltır (Logo "Çek Giriş Bordrosu" davranışı).
// Kullanıcı bunu "tahsil edilince işlenir" sanırsa ekstreyi yanlış okur ve
// mutabakatta iki taraf iki gerçekle oturur.
//
// ⚠️ KEŞİDECİ ile CARİ AYNI ŞEY DEĞİLDİR ve alan bu yüzden ayrı: sektörde
// üçüncü şahıs çeki olağandır (müşteri kendi müşterisinin çekini ciro eder).
// Tek alana indirmek, karşılıksız çıktığında kimin çeki olduğunu kaybettirirdi.
//
// ⚠️ İKİ TARİH, İKİ AYRI SORU (SINIF 1, 2026-08-14 — SAP Belegdatum ↔
// Buchungsdatum ayrımı): "İşlem tarihi" BİZİM defterimizin çıpasıdır — belge
// no, kur, cari defter satırı ve dönem kilidi ONDAN çözülür; "Keşide tarihi"
// KÂĞIDIN üzerindeki tarihtir (hukuki veri, TTK 796 ibraz süresi) ve deftere
// ETKİSİ YOKTUR. Kasım keşideli çek Aralık'ta gelirse işlem tarihi Aralık'tır;
// eski tek-tarih modeli bu kaydı ya sessizce Kasım'a düşürüyor ya da kapalı
// dönemde operatörü keşideyi YALAN yazmaya zorluyordu. İşlem tarihi ZORUNLU
// DEĞİL: boş bırakılırsa hiç gönderilmez ve backend BUGÜNÜ kullanır ("çek
// bugün işleniyor" doğru varsayılandır — geçiş diyaloglarındaki "boşsa onay
// kapalı" kuralı burada uygulanmaz, çünkü orada varsayılan YOKTUR).
//
// ⚠️ VADE ZORUNLU ve ÖN DOLDURULMAZ: vade kâğıdın üzerindeki gündür, sistemin
// tahmin edeceği bir şey değil. "Bugün" diye ön doldurmak, acele eden bir
// kullanıcının yanlış vadeyle kayıt açmasının en kolay yolu olurdu.
//
// ⚠️ VADESİ GEÇMİŞ ÇEK GİRİLEBİLİR (backend `dueDate >= issueDate` DAYATMAZ):
// gecikmiş müşteri elindeki eski çeki verir. Burada da engellemiyoruz.
//
// ⚠️ `clientToken` DİYALOG OTURUMU BAŞINA BİR KEZ üretilir, `mutate()` başına
// DEĞİL. Sebep proje kuralı ve iki kez sahada ısırdı (2026-07-27 Tambur kesimi,
// 2026-08-03 KK1 ham girişi): zaman aşımı "yazılmadı" DEMEK DEĞİLDİR — sunucu
// commit etmiş, yanıt kaybolmuş olabilir. Her basışta yeni token üretmek, o
// durumda İKİNCİ bir çek ve İKİNCİ bir cari defter satırı doğurur; carinin
// bakiyesi çek tutarı kadar yanlışlanır ve hata/log çıkmaz. Aynı token ise
// backend'in `@unique` tuzağına takılır ve ilk kaydı geri döner
// (`ManualEntryDialog` emsali: açılışta + başarıda yenilenir).
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { money } from "../service";
import type { Currency } from "../service";
import { createCheque, type ChequeDocType, type ChequeKind } from "./service";
import { dayStartIso, ymd } from "./dates";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

interface Props {
  open: boolean;
  /** Açılış yönü — hangi düğmeye basıldıysa. Kullanıcı içeride değiştirebilir. */
  initialKind: ChequeKind;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function ChequeFormDialog({ open, initialKind, onOpenChange, onCreated }: Props) {
  // ⚠️ Ön-doldurma YALNIZ başlangıç değeridir; çağıran diyaloğu koşullu mount
  // eder (her açılış taze bileşen). Prop'u render fazında senkronlamak,
  // kullanıcının değiştirdiği yönü geri alırdı.
  const [kind, setKind] = useState<ChequeKind>(initialKind);
  const [docType, setDocType] = useState<ChequeDocType>("CHEQUE");
  const [party, setParty] = useState<"CUSTOMER" | "SUBCONTRACTOR">(
    initialKind === "RECEIVED" ? "CUSTOMER" : "SUBCONTRACTOR",
  );
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [amount, setAmount] = useState(0);
  const [rate, setRate] = useState(0);
  const [issueDate, setIssueDate] = useState(() => ymd(new Date()));
  // İşlem tarihi bugünle ÖN DOLDURULUR (vade doldurulmaz — o kâğıdın verisidir,
  // bu bizim defterimizin günüdür ve olağan durum "çek bugün işleniyor"dur).
  const [postingDate, setPostingDate] = useState(() => ymd(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [drawerName, setDrawerName] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [notes, setNotes] = useState("");
  // Diyalog açılışı = bir form oturumu (çağıran koşullu mount ediyor, yani her
  // açılış yeni token). Dosya başlığındaki gerekçeye bak.
  const [clientToken] = useState(() => crypto.randomUUID());

  // Boş/bozuk tarih `undefined` döner (bkz. dates.ts) — vade zorunlu olduğu için
  // düğmeyi kapatır; keşide ve işlem tarihi ise hiç gönderilmez ve backend
  // keşide için "şimdi"yi, işlem için BUGÜNÜ yazar (route sözleşmesi).
  const issueIso = dayStartIso(issueDate);
  const postingIso = dayStartIso(postingDate);
  const dueIso = dayStartIso(dueDate);

  const valid =
    amount > 0 &&
    Boolean(dueIso) &&
    (party === "CUSTOMER" ? Boolean(customerId) : Boolean(subcontractorId));

  const createM = useMutation({
    // Vade `mutate()` argümanı olarak geçer: `valid` onu zaten kapıyor ama tipi
    // de kapatmak, ileride guard gevşerse boş tarihin sessizce gitmesini önler.
    mutationFn: (v: { dueDate: string }) =>
      createCheque({
        kind,
        docType,
        customerId: party === "CUSTOMER" ? customerId : null,
        subcontractorId: party === "SUBCONTRACTOR" ? subcontractorId : null,
        currency,
        // Kur boş bırakılırsa backend kur tablosundan çözer; bulamazsa
        // "Kurlar ekranından girin veya elle belirtin" diye yol gösterir.
        exchangeRate: currency !== "TRY" && rate > 0 ? rate : null,
        amount,
        issueDate: issueIso,
        postingDate: postingIso,
        dueDate: v.dueDate,
        serialNo: serialNo.trim() || null,
        drawerName: drawerName.trim() || null,
        bankName: bankName.trim() || null,
        branchName: branchName.trim() || null,
        notes: notes.trim() || null,
        clientToken,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kaydedildi.");
      onCreated();
      onOpenChange(false);
    },
    // Hata toast'ı YOK — interceptor backend'in cümlesini zaten basıyor
    // (proje kuralı, `ManualEntryDialog` emsali). Diyalog açık kalır ki
    // kullanıcı düzeltip AYNI token'la tekrar denesin.
  });

  const received = kind === "RECEIVED";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{received ? "Çek / Senet Girişi" : "Çek / Senet Çıkışı"}</DialogTitle>
          <DialogDescription>
            {received
              ? "Müşteriden alınan çek/senet. Kaydedildiği AN carinin size olan borcunu azaltır — tahsil edilmesi beklenmez."
              : "Karşı tarafa verdiğimiz kendi çekimiz/senedimiz. Kaydedildiği AN sizin borcunuzu azaltır; ödeme banka/kasadan sonra işlenir."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Yön</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as ChequeKind)}
            >
              <option value="RECEIVED">Aldığımız (giriş)</option>
              <option value="ISSUED">Verdiğimiz (çıkış)</option>
            </select>
          </div>
          <div>
            <Label>Belge türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={docType}
              onChange={(e) => setDocType(e.target.value as ChequeDocType)}
            >
              <option value="CHEQUE">Çek</option>
              <option value="PROMISSORY_NOTE">Senet</option>
            </select>
          </div>

          <div>
            <Label>Cari türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={party}
              onChange={(e) => setParty(e.target.value as "CUSTOMER" | "SUBCONTRACTOR")}
            >
              <option value="CUSTOMER">Müşteri</option>
              <option value="SUBCONTRACTOR">Fason firma</option>
            </select>
          </div>
          <div>
            <Label>{party === "CUSTOMER" ? "Müşteri" : "Fason firma"}</Label>
            {/* Pasif kart da seçilebilir — gerekçe `PaymentFormDialog`'daki
                notla aynı (uç `CariAccount.isActive`'e bakar, karta değil). */}
            <div className="mt-1">
              {party === "CUSTOMER" ? (
                <ReferenceSelect<Customer>
                  value={customerId}
                  onChange={setCustomerId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Müşteri ara..."
                  includeInactive
                />
              ) : (
                <ReferenceSelect
                  value={subcontractorId}
                  onChange={setSubcontractorId}
                  service={subcontractorService}
                  queryKey="subcontractors"
                  getLabel={(s: { code: string; name: string }) => `${s.code} — ${s.name}`}
                  placeholder="Fason firma ara..."
                  includeInactive
                />
              )}
            </div>
          </div>

          <div>
            <Label>Tutar</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              className="mt-1"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Para birimi</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {currency !== "TRY" && (
            <div className="col-span-2">
              <Label>Kur (opsiyonel)</Label>
              <Input
                type="number"
                min={0}
                step="0.0001"
                className="mt-1"
                value={rate || ""}
                onChange={(e) => setRate(Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Boş bırakılırsa işlem tarihinin kuru Kurlar tablosundan alınır (keşide tarihinin DEĞİL). O
                tarihe kur girilmemişse kayıt reddedilir ve size söylenir.
              </p>
            </div>
          )}

          <div className="col-span-2">
            <Label>İşlem tarihi</Label>
            <Input
              type="date"
              className="mt-1"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
            {/* Geçiş diyaloglarındaki dil: bu tarihin NEREYE yazıldığı ekranda
                söylenir — kullanıcı "keşideyle aynı şey" sanmasın. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Çekin deftere işlendiği gün: belge numarası, kur, cari defter satırı ve dönem kilidi bu
              tarihten çözülür. Boş bırakılırsa bugün kabul edilir.
            </p>
          </div>

          <div>
            <Label>Keşide tarihi</Label>
            <Input
              type="date"
              className="mt-1"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
            {/* Eski yardım metni kuru keşideye bağlıyordu — YANLIŞTI; kur işlem
                tarihinden çözülür. Keşide artık yalnız kâğıdın bilgisidir. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Kâğıdın üzerindeki tarih (ileri keşide olağandır). Deftere, kura ve belge numarasına etkisi
              yoktur.
            </p>
          </div>
          <div>
            <Label>Vade</Label>
            <Input type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div>
            <Label>Çek/senet seri no (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={64}
              placeholder="Kâğıdın üzerindeki numara"
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
            />
          </div>
          <div>
            <Label>Keşideci (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={150}
              placeholder="Çeki yazan kişi/firma"
              value={drawerName}
              onChange={(e) => setDrawerName(e.target.value)}
            />
          </div>

          <div>
            <Label>Banka (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={100}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>
          <div>
            <Label>Şube (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={100}
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
          </div>

          <div className="col-span-2">
            <Label>Not (opsiyonel)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!valid || !dueIso || createM.isPending}
            onClick={() => dueIso && createM.mutate({ dueDate: dueIso })}
          >
            {createM.isPending ? "Kaydediliyor…" : `Kaydet (${money(amount, currency)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
