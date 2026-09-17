// =============================================================================
// ALIŞ SİPARİŞİ — AÇ / DÜZENLE
// =============================================================================
// ⚠️ DURUM SEÇİCİSİ YOK ve olmayacak. `OPEN`/`PARTIAL`/`CLOSED` mal kabulünden
// TÜRETİLİR; elle işaretlenirse ilk senkronda geri döner. Kullanıcıya sonuçsuz
// bir kutu göstermek, sistemin yalan söylemesidir.
//
// ⚠️ DÜZENLEME YALNIZ `OPEN` SİPARİŞTE. Sebep backend'in gerekçesiyle aynı: mal
// kabul başladıktan sonra kalem eklemek/çıkarmak karşılanmanın FIFO dağıtımını
// GERİYE DÖNÜK değiştirir — dün "tamamlandı" yazan kalem bugün "eksik" olur ve
// kimse sebebini söyleyemez. Sektör pratiği de aynı: mal görmüş sipariş revize
// edilmez, yenisi açılır. Diyalog bunu kapalı bir düğmeyle değil, AÇIK BİR
// CÜMLEYLE söyler.
//
// ⚠️ `clientToken` DİYALOG OTURUMU BAŞINA BİR KEZ üretilir, `mutate()` başına
// DEĞİL (proje kuralı; iki kez sahada ısırdı). Zaman aşımı "yazılmadı" DEMEK
// DEĞİLDİR: sunucu commit etmiş, yanıt kaybolmuş olabilir. Her basışta yeni
// token üretmek İKİNCİ bir sipariş ve İKİNCİ bir belge numarası doğurur; satın
// almacı aynı malı iki kez ısmarladığını sanar.
//
// ⚠️ KALEMLER YALNIZ DEĞİŞTİYSE GÖNDERİLİR. Backend'de `lines` verilmesi kalem
// kümesini SİLİP YENİDEN yazar (`deleteMany` + `create`) ve karşılanma senkronunu
// tetikler. Değişmemiş bir formu kaydetmek bunu boşa yaptırırdı; sözleşme
// "verilmezse kalemlere DOKUNULMAZ" diyor ve tam olarak bunun için var.
//
// ⚠️ HATA TOAST'I YAZILMAZ — apiClient interceptor'ı backend'in yol gösterici
// cümlesini zaten basıyor ("… artık düzenlenemez (durum: PARTIAL). Mal görmüş
// sipariş revize edilmez; yeni sipariş açın."). İkinci bir toast, aynı şeyi iki
// kez ve daha kötü kelimelerle söylemek olurdu. Diyalog AÇIK KALIR ki kullanıcı
// düzeltip AYNI token'la tekrar denesin.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SupplierSelect } from "@/components/forms/SupplierSelect";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import {
  sameSupplierParty, supplierOptionLabel, supplierPartyOf, supplierPartyPayload, supplierRefOf,
  type SupplierParty,
} from "@/components/forms/supplierParty";
import {
  createPurchaseOrder, getPurchaseOrder, toNum, updatePurchaseOrder, type PoCurrency,
} from "./service";
import { PO_CURRENCIES } from "./labels";
import { dayStartIso, ymd } from "./dates";
import {
  PurchaseOrderLineRows, emptyPoLine, poTotals, toLineInputs, type PoDraftLine,
} from "./PurchaseOrderLineRows";

interface Props {
  open: boolean;
  /** Verilirse DÜZENLEME, verilmezse YENİ sipariş. */
  orderId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
}

/** Kalem kümesinin karşılaştırma anahtarı — sıra dahil (lineNo FIFO'yu belirler). */
function linesKey(lines: PoDraftLine[]): string {
  return JSON.stringify(toLineInputs(lines));
}

export function PurchaseOrderFormDialog({ open, orderId, onOpenChange, onSaved }: Props) {
  const qc = useQueryClient();
  const editing = Boolean(orderId);

  // C4 — tedarikçi cari kart YA DA fason firma olabilir; taraf {kind, id}
  // taşınır ve gövdedeki XOR'u `supplierPartyPayload` kurar.
  const [supplier, setSupplier] = useState<SupplierParty | null>(null);
  const [currency, setCurrency] = useState<PoCurrency>("TRY");
  const [orderDate, setOrderDate] = useState(() => ymd(new Date()));
  // ⚠️ Beklenen tarih ÖN DOLDURULMAZ: termin tedarikçiyle konuşulan gündür,
  // sistemin tahmin edeceği bir şey değil. "Bugün" diye doldurmak, acele eden
  // bir kullanıcının her siparişi gecikmiş göstermesinin en kolay yoluydu.
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PoDraftLine[]>([emptyPoLine()]);
  const [initialLinesKey, setInitialLinesKey] = useState<string | null>(null);
  // Diyalog açılışı = bir form oturumu (çağıran koşullu mount ediyor).
  const [clientToken] = useState(() => crypto.randomUUID());

  const detailQ = useQuery({
    queryKey: ["purchase-order", orderId],
    queryFn: () => getPurchaseOrder(orderId as string),
    enabled: open && Boolean(orderId),
  });

  const detail = detailQ.data;

  // Düzenlemede formu MEVCUT kayıttan kur — KAYIT BAŞINA BİR KEZ.
  //
  // ⚠️ `seededFor` süs değil: etkinin bağımlılığı `detail` NESNESİDİR ve bir
  // yeniden çekim (invalidate / manuel refetch) veriyi değiştirmişse yeni bir
  // referans döner. Bekçisiz bırakılırsa kullanıcı kalemleri yazarken form
  // sessizce sunucudaki hâline geri döner ve yazdıkları kaybolur — hata yok, log
  // yok. Kimliğe bağlamak, "ön-doldurma yalnız BAŞLANGIÇ değeridir" kuralının
  // (diyalogların koşullu mount edilme gerekçesiyle aynı) uygulanışıdır.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!detail) return;
    if (seededFor.current === detail.id) return;
    seededFor.current = detail.id;
    setSupplier(supplierPartyOf(detail));
    setCurrency(detail.currency);
    setOrderDate(detail.orderDate ? ymd(new Date(detail.orderDate)) : ymd(new Date()));
    setExpectedDate(detail.expectedDate ? ymd(new Date(detail.expectedDate)) : "");
    setNotes(detail.notes ?? "");
    const next: PoDraftLine[] = detail.lines.map((l) => ({
      key: crypto.randomUUID(),
      itemId: l.itemId,
      qty: toNum(l.qty),
      unitPrice: l.unitPrice != null ? toNum(l.unitPrice) : null,
      notes: l.notes ?? "",
    }));
    const seeded = next.length > 0 ? next : [emptyPoLine()];
    setLines(seeded);
    setInitialLinesKey(linesKey(seeded));
  }, [detail]);

  // Düzenlemede seçili tedarikçinin etiketi ZATEN elimizde (detay yanıtı) —
  // id ile ikinci bir istek atmak kutuyu bir an "Yükleniyor…" gösterirdi.
  // ⚠️ Karşılaştırma TARAF ile yapılır (kind + id): kullanıcı aynı id'li başka
  // bir bacağa geçemez ama kural yine de tek yerden gelsin.
  const detailParty = supplierPartyOf(detail);
  const detailRef = supplierRefOf(detail);
  const detailLabel =
    detailRef && sameSupplierParty(supplier, detailParty) ? supplierOptionLabel(detailRef) : null;

  const totals = useMemo(() => poTotals(lines), [lines]);
  const orderIso = dayStartIso(orderDate);
  // Boş/temizlenmiş tarih `undefined` döner (bkz. dates.ts) — `null` göndererek
  // termin AÇIKÇA kaldırılır; `undefined` gönderilse alan hiç değişmezdi.
  const expectedIso = expectedDate ? dayStartIso(expectedDate) : null;

  // Mal görmüş sipariş düzenlenemez — sebep ekranda YAZILI, düğme sessizce
  // kapalı değil.
  const editBlocked = editing && Boolean(detail) && detail?.status !== "OPEN";
  // ⚠️ TEDARİKÇİ ZORUNLU (backend: "Tedarikçi zorunlu — müşteri-tipli cari ya da
  // fason firma seçin."): sipariş bir TAAHHÜTTÜR, kime verildiği belirsiz olamaz.
  const valid = Boolean(supplier) && totals.lineCount > 0 && Boolean(orderIso) && !editBlocked;
  // ④ Ürünsüz satırda kaydet / fiyat-miktar alanına odak → o satırın ürün seçicisine amber halka + "Önce ürün seçin", 3 s.
  const [warnOn, fireWarn] = useTransientFlag(3000);
  const [warnLineKey, setWarnLineKey] = useState<string | null>(null);
  const warnLine = (key: string) => {
    setWarnLineKey(key);
    fireWarn();
  };
  const canTrySave = Boolean(supplier) && Boolean(orderIso) && !editBlocked;
  const trySave = () => {
    const missing = lines.find((l) => !l.itemId);
    if (missing || !valid) {
      warnLine((missing ?? lines[0])?.key ?? "");
      return;
    }
    saveM.mutate();
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const payloadLines = toLineInputs(lines);
      if (editing && orderId) {
        const changed = initialLinesKey === null || linesKey(lines) !== initialLinesKey;
        return updatePurchaseOrder(orderId, {
          // Taraf BÜTÜN gider — yalnız seçilen bacağı yazmak eskisini kayıtta
          // bırakır (iki tedarikçili sipariş).
          ...supplierPartyPayload(supplier),
          currency,
          orderDate: orderIso,
          expectedDate: expectedIso,
          notes: notes.trim() || null,
          // Değişmediyse HİÇ gönderilmez → kalemler silinip yeniden yazılmaz.
          ...(changed ? { lines: payloadLines } : {}),
        });
      }
      return createPurchaseOrder({
        ...supplierPartyPayload(supplier),
        currency,
        orderDate: orderIso,
        expectedDate: expectedIso,
        notes: notes.trim() || null,
        clientToken,
        lines: payloadLines,
      });
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      void qc.invalidateQueries({ queryKey: ["purchase-order"] });
      void qc.invalidateQueries({ queryKey: ["purchase-order-open-lines"] });
      onSaved(res.data?.id ?? orderId ?? "");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ① Boy SABİT (h-[88vh] max-w-6xl — 01'in sipariş formu deseni): üst alanlar ve düğmeler sabit, kalem listesi kaydırır. */}
      <DialogContent className="flex h-[88vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? "Alış Siparişini Düzenle" : "Yeni Alış Siparişi"}</DialogTitle>
          <DialogDescription>
            Sipariş bir TAAHHÜTTÜR — stoğa hiçbir şey yazmaz. Mal geldikçe mal kabul fişi bu siparişe
            bağlanır ve “ne kaldı” kendiliğinden hesaplanır.
          </DialogDescription>
        </DialogHeader>

        {editing && detailQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Sipariş yükleniyor…</p>
        ) : editing && detailQ.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Sipariş yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “sipariş yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
              Kaydınız yerinde duruyor.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void detailQ.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {editBlocked && (
              <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <b>{detail?.orderNo}</b> artık düzenlenemez — bu siparişe mal kabul yapılmış. Mal görmüş
                  sipariş revize edilmez (kalan miktarlar geriye dönük değişirdi); eksik kalan için yeni bir
                  sipariş açın.
                </span>
              </p>
            )}

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label>Tedarikçi</Label>
                {/* C4 — cari kartlar VE fason firmalar tek kutuda. Düzenlemede
                    etiket detaydan gelir: kayıt zaten elimizdeyken id ile ikinci
                    bir istek atmak, kutunun bir an "Yükleniyor…" görünmesi
                    demekti. */}
                <SupplierSelect
                  className="mt-1"
                  value={supplier}
                  onChange={setSupplier}
                  selectedLabel={detailLabel}
                  disabled={editBlocked}
                  modalPicker
                />
              </div>
              <div>
                <Label>Para birimi</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={currency}
                  disabled={editBlocked}
                  onChange={(e) => setCurrency(e.target.value as PoCurrency)}
                >
                  {PO_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Sipariş tarihi</Label>
                {/* ③ Takvim bileşeni (`DatePickerInput`, "YYYY-MM-DD"|""); `ymd`/`dayStartIso` çevrimi aynen. */}
                <DatePickerInput className="mt-1" value={orderDate} disabled={editBlocked} onChange={setOrderDate} />
              </div>

              <div>
                <Label>Beklenen tarih (opsiyonel)</Label>
                <DatePickerInput className="mt-1" value={expectedDate} disabled={editBlocked} onChange={setExpectedDate} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Boş bırakılırsa sipariş “gecikmiş” sayılmaz.
                </p>
              </div>
              <div className="col-span-3">
                <Label>Not (opsiyonel)</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  maxLength={500}
                  value={notes}
                  disabled={editBlocked}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Kalem satırları da kapanır: diğer alanlar kapalıyken burayı açık
                bırakmak, kaydedilemeyecek bir işi davet etmekti. */}
            {/* supplierId+currency: PURCHASE fiyat önerisinin bağlamı (F2 dikişi
                2026-08-14) — tedarikçi/birim seçilmeden öneri isteği atılmaz. */}
            <PurchaseOrderLineRows
              lines={lines}
              onChange={setLines}
              disabled={editBlocked}
              supplier={supplier}
              currency={currency}
              warnLineKey={warnOn ? warnLineKey : null}
              onWarnLine={warnLine}
            />

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={editBlocked}
                onClick={() => setLines((ls) => [...ls, emptyPoLine()])}
              >
                <Plus className="mr-1 h-4 w-4" />
                Kalem ekle
              </Button>
              <p className="text-sm text-muted-foreground">
                <b className="text-foreground">{totals.lineCount}</b> kalem
                {totals.amount > 0 && (
                  <>
                    {" · "}
                    <b className="text-foreground">
                      {totals.amount.toLocaleString("tr-TR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </b>{" "}
                    {currency}
                    {/* Fiyat OPSİYONEL — eksik fiyatlı kalem varken tutarı tek
                        başına basmak "sipariş bedeli bu" demek olurdu. */}
                    {totals.priced < totals.lineCount && (
                      <span className="ml-1 text-xs">
                        ({totals.lineCount - totals.priced} kalemde fiyat girilmedi)
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canTrySave || saveM.isPending} onClick={trySave}>
            {saveM.isPending
              ? "Kaydediliyor…"
              : editing
                ? "Değişiklikleri kaydet"
                : `Siparişi aç (${totals.lineCount} kalem)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
