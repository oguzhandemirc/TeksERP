// =============================================================================
// KALEM FİYATLARI — SAYFA (Tanımlar)
// =============================================================================
// NEDEN VAR: fiyat bölümünün asıl yeri ürün kartıdır, ama "hangi kalemlerde
// fiyat tanımlı" ve "şu kalemin fiyatını hızlıca düzelt" soruları kart kart
// gezerek cevaplanamaz. Bu sayfa o iki soruya bir kapı açar; gösterdiği şey
// aynı bileşendir (`ItemPricesPanel`) — ikinci bir yüzey yazılmadı.
//
// ⚠️ KALEM SEÇİLMEDEN LİSTE GÖSTERİLİR ve o liste FİYAT SATIRLARINDAN türer,
// kalem kataloğundan DEĞİL: soru "hangi kalemde fiyat var" olduğu için kaynağın
// fiyat tablosu olması gerekir. Bu yüzden liste, fiyatı olmayan kalemleri
// göstermez — ve bunu ekranda SÖYLER, yoksa kullanıcı kalemin silindiğini sanır.
//
// ⚠️ ARAMA SUNUCUDA. Liste sayfalıdır; istemcide süzmek yalnız o anki sayfayı
// süzer ve kullanıcı "kayıt yok" sanar — oysa kayıt sonraki sayfadadır.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, Tag } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { listItemPrices, type ItemPriceRow } from "./service";
import { isDefaultRow } from "./prices";
import { ItemPricesPanel } from "./ItemPricesPanel";
import { useItemPricesAccess } from "./useItemPricesAccess";

const FINDER_PAGE_SIZE = 100;

interface ItemBucket {
  itemId: string;
  label: string;
  defaults: number;
  exceptions: number;
}

/**
 * Fiyat satırlarını kaleme göre kovalar.
 *
 * ⚠️ SAYILAR ÇEKİLEN SAYFAYA AİTTİR, kalemin tamamına değil — sayfa sınırı
 * aşıldığında ekran bunu ayrıca yazar. Sayıyı "kalemin toplamı" gibi sunmak,
 * eksik bir rakamı kesin bilgi diye göstermek olurdu.
 */
function bucketByItem(rows: ItemPriceRow[]): ItemBucket[] {
  const map = new Map<string, ItemBucket>();
  for (const r of rows) {
    const label = r.item ? `${r.item.code} — ${r.item.name}` : "Kalem (kaydı okunamadı)";
    const b = map.get(r.itemId) ?? { itemId: r.itemId, label, defaults: 0, exceptions: 0 };
    if (isDefaultRow(r)) b.defaults += 1;
    else b.exceptions += 1;
    map.set(r.itemId, b);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export function ItemPricesPage() {
  const access = useItemPricesAccess();
  const [itemId, setItemId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  // Seçilen kalemin kimliği (kod/ad/birim) — panel başlığı ve "1 MT fiyatı"
  // cümlesi için. ReferenceSelect yalnız id döndürür.
  const itemQ = useQuery({
    queryKey: ["items", "detail", itemId],
    queryFn: () => itemService.getById(itemId as string),
    enabled: Boolean(itemId) && access.visible,
  });
  const item = itemQ.data?.data ?? null;
  const itemLabel = item ? `${item.code} — ${item.name}` : "Seçilen kalem";

  const finderQ = useQuery({
    queryKey: ["item-prices", "finder", debouncedSearch],
    queryFn: () => listItemPrices({ search: debouncedSearch || undefined, pageSize: FINDER_PAGE_SIZE }),
    enabled: access.visible && !itemId,
  });

  const buckets = useMemo(() => bucketByItem(finderQ.data?.data ?? []), [finderQ.data?.data]);
  const finderRows = finderQ.data?.data.length ?? 0;
  const finderTotal = finderQ.data?.pagination.total ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Kalem Fiyatları"
        description="Kalemin alış/satış fiyatı: kart varsayılanı herkese, müşteri istisnası yalnız o müşteriye uygulanır. Fatura satırında fiyat bu sıraya göre çözülür."
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
        <span className="text-xs text-muted-foreground">Kalem</span>
        <div className="w-96">
          <ReferenceSelect<Item>
            value={itemId}
            onChange={setItemId}
            service={itemService}
            queryKey="items"
            getLabel={(i) => `${i.code} — ${i.name}`}
            placeholder="Kalem ara (kod veya ad)…"
            nullable
            noneLabel="— Kalem seçilmedi"
          />
        </div>
        {itemId && (
          <Button variant="ghost" size="sm" onClick={() => setItemId(null)}>
            Başka kalem seç
          </Button>
        )}
      </div>

      <PageBody className="p-6">
        {access.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !access.ticaretEnabled ? (
          <Callout tone="muted" title="Fiyat tanımları bu kurulumda kapalı">
            Kalem fiyatı TİCARET modülünün bir parçasıdır (ön muhasebeden bağımsız). Sistem →
            Modüller ekranından açılabilir.
          </Callout>
        ) : !access.canRead ? (
          <Callout tone="warning" title="Bu ekranı görme yetkiniz yok">
            Kalem fiyatlarını görmek için <strong>item:read</strong> yetkisi gerekir.
          </Callout>
        ) : itemId ? (
          <ItemPricesPanel itemId={itemId} itemLabel={itemLabel} unit={item?.unit ?? null} />
        ) : (
          <div className="space-y-4">
            <div className="relative w-96">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Fiyat tanımlı kalemlerde ara (kod / ad)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {finderQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Yükleniyor…</p>
            ) : finderQ.isError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
                <p className="font-medium text-destructive">Fiyat listesi yüklenemedi.</p>
                <p className="mt-1 text-muted-foreground">
                  Bu bir “fiyat tanımlı değil” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da
                  reddedildi.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void finderQ.refetch()}>
                  Tekrar dene
                </Button>
              </div>
            ) : buckets.length === 0 ? (
              <EmptyState
                icon={Tag}
                title={debouncedSearch ? "Bu aramayla fiyat tanımlı kalem yok." : "Henüz fiyat tanımlı kalem yok."}
                description="Bu liste yalnız FİYATI OLAN kalemleri gösterir. Fiyat tanımlamak için yukarıdan kalemi seçin."
              />
            ) : (
              <div className="space-y-2">
                {buckets.map((b) => (
                  <button
                    key={b.itemId}
                    type="button"
                    onClick={() => setItemId(b.itemId)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate font-medium">{b.label}</span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span>{b.defaults} varsayılan</span>
                      <span>{b.exceptions} istisna</span>
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </button>
                ))}
                {finderTotal > finderRows && (
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    {finderTotal} fiyat satırının ilk {finderRows} tanesi tarandı; aşağıdaki sayılar bu
                    kesite aittir. Aradığınız kalemi bulmak için arama kutusunu kullanın.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
