import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Loader2, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { sackHubService } from "./service";

const fmtM = (n: number) => `${Math.round(Number(n))}m`;

/** ReferenceSelect ile aynı gecikme — iki picker aynı ritimde yazılsın. */
const DEBOUNCE_MS = 200;

interface Props {
  customerId: string;
  branchId: string | null;
  selectedIds: Set<string>;
  onToggle: (orderId: string) => void;
}

/**
 * Sevkiyata sayılacak açık siparişleri seç (çoklu). Boş bırakılırsa siparişsiz sevk.
 *
 * ⚠️ ARAMA SUNUCUDA (2026-09-04 saha isteği: *"sevkiyat kur modalında filtreleme
 * yok, bir müşterinin siparişini ararken zorlanıyoruz"*). `GET /open-orders`
 * `take: 300` ile keser; elde kalan diziyi istemcide süzmek, 300'ü aşan bir
 * cariye ait siparişi ararken "sonuç yok" YALANI üretir ve operatörü sipariş
 * gerçekten dururken siparişsiz sevke iter (2026-08-12 top listesi dersi).
 */
export function ShipmentOrderSelect({ customerId, branchId, selectedIds, onToggle }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Müşteri değişince arama SIFIRLANIR: eski cariye yazılmış terim yeni carinin
  // listesini boş gösterir ve operatör "bu müşterinin siparişi yok" sanır.
  useEffect(() => {
    setSearchInput("");
    setDebouncedSearch("");
  }, [customerId, branchId]);

  const q = useQuery({
    // ⚠️ `debouncedSearch` ANAHTARA girer — girmezse iki farklı terimin sonucu
    // aynı cache satırını paylaşır ve liste "bazen aramalı, bazen değil" olur.
    queryKey: ["packing", "open-orders", customerId, branchId ?? null, debouncedSearch],
    queryFn: () =>
      sackHubService.listOpenOrders({
        customerId,
        branchId: branchId ?? undefined,
        search: debouncedSearch || undefined,
      }),
    staleTime: 15_000,
  });
  const orders = useMemo(() => q.data?.data ?? [], [q.data]);

  // ⚠️ SEÇİM ARAMADAN BAĞIMSIZ YAŞAR. Süzgeç listeyi daraltır, seçimi DEĞİL —
  // ve seçili bir sipariş süzgecin dışında kalırsa ekranda hiçbir izi kalmazdı:
  // operatör "seçmedim" sanıp sevkiyatı yanlış siparişe yazardı. Bu yüzden
  // gizlenen seçim SAYIYLA ve temizleme yoluyla söylenir.
  const visibleIds = useMemo(() => new Set(orders.map((o) => o.order.id)), [orders]);
  const hiddenSelected = useMemo(
    () => [...selectedIds].filter((id) => !visibleIds.has(id)),
    [selectedIds, visibleIds],
  );

  const searchBox = (
    <div className="relative mb-2">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Sipariş no, kumaş veya renk ara…"
        className="h-8 pl-8 pr-8 text-sm"
      />
      {searchInput && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2"
          aria-label="Aramayı temizle"
          onClick={() => setSearchInput("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  /** Gizli seçim şeridi — arama sonucu ne olursa olsun görünür. */
  const hiddenNote = hiddenSelected.length > 0 && (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      {hiddenSelected.length} seçili sipariş aramanın dışında kaldı — seçim duruyor ve
      sevkiyata yazılacak.
    </p>
  );

  return (
    <div>
      {searchBox}

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Açık siparişler yükleniyor…
        </div>
      ) : orders.length === 0 ? (
        // "Aramada yok" ile "hiç yok" AYRI cümleler: ikisini tek metne
        // toplamak operatöre olmayan bir gerçeği ("siparişi yok") söyler.
        <p className="py-3 text-center text-xs text-muted-foreground">
          {debouncedSearch
            ? `"${debouncedSearch}" ile eşleşen açık sipariş yok — aramayı temizleyin.`
            : "Bu müşterinin açık siparişi yok — siparişsiz devam edin."}
        </p>
      ) : (
        <ul className="max-h-52 space-y-1 overflow-auto">
          {orders.map((o) => {
            const checked = selectedIds.has(o.order.id);
            const openSum = o.lines.reduce((s, l) => s + Math.max(0, Number(l.openQty)), 0);
            return (
              <li key={o.order.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                    checked ? "border-primary/60 bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(o.order.id)} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono font-medium">{o.order.orderNumber}</span>
                      <span className="text-xs text-muted-foreground">{o.lines.length} kalem · {fmtM(openSum)} açık</span>
                      {o.order.deadline && (
                        <span className="text-xs text-muted-foreground">termin {safeFormat(o.order.deadline, "dd.MM.yyyy")}</span>
                      )}
                    </div>
                    {/* Bizdeki ad — sevk kurma akışının geri kalanı (çuval/top listeleri)
                        bizdeki adı bastığından müşteri override'ı burada kullanılmaz. */}
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {o.lines
                        .slice(0, 2)
                        .map((l) => `${l.item.name}${l.color ? ` · ${l.color.name}` : ""}`)
                        .join(" · ")}
                      {o.lines.length > 2 ? ` +${o.lines.length - 2}` : ""}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenNote}
    </div>
  );
}
