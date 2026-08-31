// =============================================================================
// FİYAT YAZ / DÜZELT
// =============================================================================
// NEDEN BU KADAR ÇOK KİLİT: bu formun yazdığı satırın KİMLİĞİ dört alandır
// (kalem + müşteri + yön + para birimi). Düzenleme sırasında bunlardan birini
// değiştirmek "bu satırı düzeltmek" DEĞİL, "başka bir satır açmak"tır — backend
// `upsert` olduğu için işlem hata da vermez: eski satır yerinde kalır, yenisi
// doğar ve kullanıcı fiyatı "değiştirdiğini" sanır. Bu yüzden düzenlemede o
// dört alan SALT OKUNUR gösterilir ve sebebi ekranda yazılıdır.
//
// ⚠️ FİYAT ALANI STRING TUTULUR, number DEĞİL. Sebep bu ekranın tüm meselesi:
// boş ("fiyat girilmemiş") ile 0 ("bedava/numune") AYRI ŞEYLERDİR. `useState(0)`
// ile tutulsaydı ikisi aynı değere çökerdi ve boş formda "0,00" görünürdü —
// kullanıcı farkında olmadan sıfır fiyat kaydeder, `InvoiceService.confirm`'in
// sıfır-fiyat seddi anlamsız bir hataya dönüşürdü ("fiyat girin" der ama fiyat
// GİRİLMİŞ görünür).
//
// ⚠️ SIFIR MEŞRUDUR, NEGATİF DEĞİL — backend Zod'u ve DB CHECK'i de aynısını
// söyler. Sıfırı burada engellemek, gerçekten bedava verilen numunenin fiyatını
// "bilinmiyor" gibi göstermeye zorlardı; ama sıfır yazan kullanıcıya ne
// yaptığını SÖYLERİZ (aşağıdaki uyarı).
//
// ⚠️ HATA TOAST'I YAZILMAZ: apiClient interceptor'ı backend'in yol gösterici
// cümlesini zaten basıyor ("«X» pasif durumda — fiyat tanımlanamaz." gibi).
// İkinci bir toast aynı şeyi iki kez, üstelik daha kötü bir cümleyle söylerdi.
// Diyalog açık kalır ki kullanıcı düzeltip tekrar denesin.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import {
  CURRENCIES,
  PRICE_KINDS,
  PRICE_KIND_HINT,
  PRICE_KIND_LABEL,
  priceText,
  toNum,
  upsertItemPrice,
  type Currency,
  type ItemPriceRow,
  type PriceKind,
} from "./service";
import { customerLabelOf, findExisting } from "./prices";

export type PriceScope = "DEFAULT" | "CUSTOMER";

export interface ItemPriceFormInitial {
  scope: PriceScope;
  kind: PriceKind;
  currency: Currency;
  customerId?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  /** "STK-000123 — Poplin" gibi; başlıkta ve uyarı metinlerinde geçer. */
  itemLabel: string;
  /** Kalemin TÜM fiyat satırları — "zaten var / üzerine yazılır" uyarısı için. */
  rows: ItemPriceRow[];
  /** Düzenleme hedefi. Yeni kayıtta `null`. */
  row?: ItemPriceRow | null;
  /** Yeni kayıt için ön-doldurma (boş hücredeki "Tanımla" düğmesinden). */
  initial?: ItemPriceFormInitial;
  onSaved: () => void;
}

export function ItemPriceFormDialog({
  open,
  onOpenChange,
  itemId,
  itemLabel,
  rows,
  row = null,
  initial,
  onSaved,
}: Props) {
  const isEdit = Boolean(row);

  // ⚠️ Ön-doldurma YALNIZ başlangıç değeridir; çağıran diyaloğu KOŞULLU mount
  // eder (her açılış taze bileşen). Prop'u render fazında senkronlamak,
  // kullanıcının değiştirdiği alanı geri alırdı (`ChequeFormDialog` emsali).
  const [scope, setScope] = useState<PriceScope>(
    row ? (row.customerId ? "CUSTOMER" : "DEFAULT") : (initial?.scope ?? "DEFAULT"),
  );
  const [customerId, setCustomerId] = useState<string | null>(
    row?.customerId ?? initial?.customerId ?? null,
  );
  const [kind, setKind] = useState<PriceKind>(row?.kind ?? initial?.kind ?? "SALE");
  const [currency, setCurrency] = useState<Currency>(row?.currency ?? initial?.currency ?? "TRY");
  // Düzenlemede mevcut değer; yeni kayıtta BOŞ (sıfır değil — dosya başlığı).
  const [price, setPrice] = useState<string>(row ? String(toNum(row.price)) : "");

  const trimmed = price.trim();
  const priceNum = Number(trimmed.replace(",", "."));
  const priceEntered = trimmed !== "";
  const priceValid = priceEntered && Number.isFinite(priceNum) && priceNum >= 0;
  const negative = priceEntered && Number.isFinite(priceNum) && priceNum < 0;

  const effectiveCustomerId = scope === "CUSTOMER" ? customerId : null;
  const partyChosen = scope === "DEFAULT" || Boolean(customerId);

  /** Aynı kutuda zaten satır var mı → "üzerine yazılacak" uyarısı. */
  const existing = useMemo(
    () =>
      isEdit
        ? null
        : (findExisting(rows, { customerId: effectiveCustomerId, kind, currency }) ?? null),
    [isEdit, rows, effectiveCustomerId, kind, currency],
  );

  /** İstisna, kart varsayılanıyla aynı mı → gereksiz istisna uyarısı. */
  const defaultRow = useMemo(
    () => findExisting(rows, { customerId: null, kind, currency }) ?? null,
    [rows, kind, currency],
  );
  const sameAsDefault =
    scope === "CUSTOMER" && priceValid && defaultRow != null && toNum(defaultRow.price) === priceNum;

  const saveM = useMutation({
    mutationFn: (v: { price: number }) =>
      upsertItemPrice({
        itemId,
        // ⚠️ `null` = KART VARSAYILANI. Bu boşluk ANLAM taşır; "zorunlu alan
        // boş kalmış" sanıp uydurma bir değerle doldurma.
        customerId: effectiveCustomerId,
        kind,
        currency,
        price: v.price,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Fiyat kaydedildi.");
      onSaved();
      onOpenChange(false);
    },
  });

  /**
   * ⚠️ DEVRE DIŞI DÜĞME SEBEBİNİ SÖYLEMEK ZORUNDA. Önceki hâlde `canSubmit`
   * üç koşuldan sessizce türüyordu ve en sık takılan dal — «İstisna ekle»ye
   * basıp müşteri seçmemek — ekranda HİÇBİR iz bırakmıyordu: eldivenli
   * operatör Kaydet'e basar, hiçbir şey olmaz, sebebini arar. Projede yazılı
   * olan şey de bu: engel varsa sebebi engelin YANINDA yazar.
   *
   * Tek kaynak: `canSubmit` artık bu sebepten TÜRETİLİR — ikisi ayrı yazılsaydı
   * biri değişip diğeri kalır ve düğme "sebepsiz" ya da "yanlış sebeple" kapanırdı.
   */
  const blockReason = !partyChosen
    ? "Müşteri seçin — istisna kimin için tanımlanıyor?"
    : !priceEntered
      ? "Birim fiyatı yazın."
      : negative
        ? "Fiyat negatif olamaz."
        : !priceValid
          ? "Birim fiyat geçerli bir sayı olmalı (ondalık ayırıcı olarak nokta kullanın)."
          : null;

  const canSubmit = blockReason === null && !saveM.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Fiyatı Düzelt" : "Fiyat Tanımla"}</DialogTitle>
          <DialogDescription>
            {itemLabel} —{" "}
            {scope === "DEFAULT"
              ? "kart varsayılanı: müşteri istisnası olmayan HERKESE uygulanır."
              : "müşteri istisnası: yalnız seçilen müşteriye uygulanır, kart varsayılanının önüne geçer."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isEdit && row && (
            <Callout tone="muted" title="Bu satırın kimliği değiştirilemez">
              Yön, para birimi ve müşteri bir fiyat satırının KİMLİĞİDİR. Burada değiştirmek bu satırı
              düzeltmez, <strong>ayrı bir fiyat satırı</strong> açar ve eskisi yerinde kalır. Başka bir
              kombinasyon için yeni fiyat tanımlayın.
            </Callout>
          )}

          {/* ── Kapsam: varsayılan mı, istisna mı ─────────────────────────── */}
          <div>
            <Label>Kapsam</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
              value={scope}
              disabled={isEdit}
              onChange={(e) => {
                const next = e.target.value as PriceScope;
                setScope(next);
                // Varsayılana dönüldüğünde müşteri seçimi TEMİZLENİR: ekranda
                // görünmeyen bir seçimin gövdeye sızması, kullanıcının
                // "varsayılan yazdım" sandığı yerde istisna doğururdu.
                if (next === "DEFAULT") setCustomerId(null);
              }}
            >
              <option value="DEFAULT">Kart varsayılanı (herkese)</option>
              <option value="CUSTOMER">Müşteri istisnası (yalnız bir müşteriye)</option>
            </select>
          </div>

          {scope === "CUSTOMER" && (
            <div>
              <Label>Müşteri</Label>
              <div className="mt-1">
                {isEdit && row ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    {customerLabelOf(row)}
                  </div>
                ) : (
                  <ReferenceSelect<Customer>
                    value={customerId}
                    onChange={setCustomerId}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    placeholder="Müşteri ara…"
                  />
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Yön</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                value={kind}
                disabled={isEdit}
                onChange={(e) => setKind(e.target.value as PriceKind)}
              >
                {PRICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PRICE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Para birimi</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                value={currency}
                disabled={isEdit}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{PRICE_KIND_HINT[kind]}</p>

          <div>
            <Label>Birim fiyat</Label>
            {/* ⚠️ ÖRNEK NOKTALI. Alan `type="number"` ve tarayıcı geçersiz girişte
                `value`yu BOŞ döndürür; virgüllü bir örnek göstermek, sistem
                yerelinde virgül kabul edilmediğinde operatörü "yazdım ama Kaydet
                açılmıyor" çıkmazına sokardı. (Virgül yine de gelirse aşağıdaki
                `price` okuması onu noktaya çevirir — iki katman.) */}
            <Input
              type="number"
              min={0}
              step="0.0001"
              inputMode="decimal"
              className="mt-1"
              placeholder="Örn. 42.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              En fazla 4 ondalık basamak saklanır; fazlası yuvarlanır. Boş bırakılamaz —{" "}
              <strong>fiyat girmek istemiyorsanız satırı hiç tanımlamayın</strong>, çünkü boş ile 0 aynı
              şey değildir.
            </p>
          </div>

          {negative && (
            <Callout tone="danger" title="Fiyat negatif olamaz">
              İade/iskonto negatif fiyatla değil, kendi belgesiyle (iade faturası) kaydedilir.
            </Callout>
          )}

          {priceValid && priceNum === 0 && (
            <Callout tone="warning" title="0 fiyat “bedava” demektir">
              Promosyon/numune için doğrudur. Fiyat henüz <strong>bilinmiyorsa</strong> 0 yazmayın —
              satırı hiç tanımlamayın (ya da mevcut satırı kaldırın); o zaman fatura satırında fiyat boş
              gelir ve elle yazılır.
            </Callout>
          )}

          {existing && (
            <Callout tone="warning" title="Bu kutuda zaten bir fiyat var">
              {scope === "DEFAULT" ? "Kart varsayılanı" : `«${customerLabelOf(existing)}» istisnası`} —{" "}
              {PRICE_KIND_LABEL[existing.kind]} / {existing.currency}:{" "}
              <strong>{priceText(existing.price, existing.currency)}</strong>. Kaydederseniz{" "}
              <strong>üzerine yazılır</strong> (ikinci bir satır oluşmaz).
            </Callout>
          )}

          {sameAsDefault && defaultRow && (
            <Callout tone="muted" title="İstisna, kart varsayılanıyla aynı">
              Bu tutar zaten varsayılan ({priceText(defaultRow.price, defaultRow.currency)}). İstisna
              tanımlamak yerine boş bırakmak daha sadedir: varsayılan değişince bu müşteri de otomatik
              takip eder, istisna ise takip etmez.
            </Callout>
          )}
        </div>

        <DialogFooter className="items-center">
          {/* Engel varsa sebebi düğmenin YANINDA yazar (tooltip DEĞİL — eldivenli
              operatör fareyi düğmenin üstünde bekletmez). */}
          {blockReason && (
            <span className="mr-auto text-xs text-muted-foreground">{blockReason}</span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => priceValid && saveM.mutate({ price: priceNum })}
          >
            {saveM.isPending
              ? "Kaydediliyor…"
              : priceValid
                ? `Kaydet (${priceText(priceNum, currency)})`
                : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
