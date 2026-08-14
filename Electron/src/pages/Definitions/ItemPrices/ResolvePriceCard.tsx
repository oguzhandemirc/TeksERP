// =============================================================================
// ⭐ GEÇERLİ FİYAT KONTROLÜ — "bu müşteriye hangi fiyat çıkar?"
// =============================================================================
// NEDEN VAR: iki listeyi (varsayılan + istisnalar) yan yana görmek "peki ŞU
// müşteriye ne uygulanır" sorusunu cevaplamaz — kullanıcı kafasında sırayı
// kendisi kurmak zorunda kalır ve tam da bu ekranın kapatmakla yükümlü olduğu
// karışıklık orada doğar. Bu kart sırayı GÖRÜNÜR yapar:
//
//     müşteri istisnası  →  kart varsayılanı  →  YOK
//
// ⚠️ SIRA İSTEMCİDE HESAPLANMAZ. Cevabı backend'in `/resolve` ucu verir —
// faturayı hazırlayan kodun kullandığı ucun ta kendisi. İstemcide ikinci bir
// uygulama, ileride kural değişince (ör. tarih aralıklı fiyat) "ekran başka,
// fatura başka" demekti; backend servisinin başlığı bunu açıkça yasaklıyor.
// Yani buradaki cevap bir TAHMİN değil, faturanın vereceği cevabın kendisidir.
//
// ⚠️ "YOK" SIFIR DEĞİLDİR ve bu ekranda en yüksek sesle söylenmesi gereken şey
// odur: sıfır fiyat "bedava", boş fiyat "girilmemiş" demektir. Sonuç kutusu
// hiçbir durumda "0,00" basmaz.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import {
  CURRENCIES,
  PRICE_KINDS,
  PRICE_KIND_LABEL,
  priceText,
  resolveItemPrice,
  type Currency,
  type PriceKind,
} from "./service";

interface Props {
  itemId: string;
  /** Ekranda "hangi kalem" sorusunu cevaplamak için. */
  itemLabel: string;
}

export function ResolvePriceCard({ itemId, itemLabel }: Props) {
  const [kind, setKind] = useState<PriceKind>("SALE");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [customerId, setCustomerId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["item-prices", "resolve", itemId, kind, currency, customerId],
    queryFn: () => resolveItemPrice({ itemId, kind, currency, customerId }),
  });

  const hit = q.data?.hit ?? null;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          Geçerli fiyat kontrolü
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Sıra: <strong>müşteri istisnası</strong> <ArrowRight className="inline h-3 w-3" />{" "}
          <strong>kart varsayılanı</strong> <ArrowRight className="inline h-3 w-3" /> yok. Cevabı fatura
          satırının kullandığı uç verir; burada gördüğünüz, faturada çıkacak fiyattır.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Yön</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
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
          <div>
            <Label>Müşteri (opsiyonel)</Label>
            <div className="mt-1">
              {/* Boş bırakmak MEŞRU bir seçimdir: "müşteri seçilmedi" =
                  yalnız kart varsayılanı sorulur. Bu yüzden `nullable`. */}
              <ReferenceSelect<Customer>
                value={customerId}
                onChange={setCustomerId}
                service={customerService}
                queryKey="customers"
                getLabel={(c) => `${c.code} — ${c.name}`}
                placeholder="Müşteri seçilmedi"
                nullable
                noneLabel="— Müşteri seçilmedi (yalnız varsayılan)"
              />
            </div>
          </div>
        </div>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Sorgulanıyor…</p>
        ) : q.isError ? (
          // "Hata" ile "fiyat yok" AYRI EKRANLARDIR: istek düşerse elimizde
          // boş bir cevap kalır ve onu "tanımlı fiyat yok" diye basmak DÜPEDÜZ
          // yalandır — kullanıcı olmayan bir fiyatı elle girmeye giderdi.
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Fiyat sorgulanamadı.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bu bir “fiyat yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Tanımlı
              fiyatlarınız yerinde duruyor.
            </p>
          </div>
        ) : hit ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Badge variant={hit.source === "CUSTOMER" ? "default" : "secondary"}>
              {hit.source === "CUSTOMER" ? "Müşteriye özel" : "Kart varsayılanı"}
            </Badge>
            <span className="text-lg font-semibold tabular-nums">
              {priceText(hit.price, currency)}
            </span>
            <span className="text-xs text-muted-foreground">
              {hit.source === "CUSTOMER"
                ? "Bu müşteride kart varsayılanı devreye girmez."
                : customerId
                  ? "Seçilen müşteride istisna yok — varsayılan uygulanır."
                  : "Müşteri istisnası olmayan herkese bu fiyat uygulanır."}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-warning/45 bg-warning/10 p-3 text-sm">
            <p className="font-medium">Tanımlı fiyat yok.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              «{itemLabel}» için {PRICE_KIND_LABEL[kind]} / {currency} fiyatı{" "}
              <strong>girilmemiş</strong> — bu <strong>sıfır demek değildir</strong>. Fatura/mal kabul
              satırında fiyat boş gelir ve elle yazılır.
            </p>
          </div>
        )}

        {/* Backend'in kendi cümlesi — ezmeden, olduğu gibi. */}
        {q.data?.message && <p className="text-xs text-muted-foreground">{q.data.message}</p>}
      </CardContent>
    </Card>
  );
}
