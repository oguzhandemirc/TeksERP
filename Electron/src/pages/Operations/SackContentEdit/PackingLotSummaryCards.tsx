import { useQuery } from "@tanstack/react-query";
import { Boxes, ClipboardList, Scale, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import type { PackingGroup, PackingLotCustomerSummary } from "./types";

const fmtQty = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/**
 * CARİ ÖZETİ — dört kart, her biri tablonun TEKRARI DEĞİL bir karar rakamı (saha
 * 2026-09-22: "havuz kartları aşağıdaki satırda zaten var, daha anlamlı ne yazabiliriz"):
 *   Açık parti      — N · partilerdeki çuval · boş parti
 *   Bekleyen mal    — havuz + açık partiler TOPLAMI (tablo satır satır gösterir, toplamı yok)
 *   Tartılmamış     — sevk öncesi eksik iş; tıklanınca liste "Tartılmadı" süzgeciyle
 *   Açık sipariş    — müşterinin bizden beklediği (talep tarafı); tıklanınca Siparişler
 * Sayı büyük, etiket küçük; "0" soluk. Tıklanmayan kart `div`dir.
 */
export function PackingLotSummaryCards({
  s,
  openLots,
  onOpenUnweighed,
  onOpenOrders,
}: {
  s: PackingLotCustomerSummary | undefined;
  /** Açık partiler (liste sorgusundan). */
  openLots: PackingGroup[] | undefined;
  onOpenUnweighed: () => void;
  onOpenOrders: () => void;
}) {
  const u = s?.ungrouped;
  const customerId = s?.customer.id;
  // Açık siparişler — paketleme rehberi ucu (satır bazlı açık miktar + depo karşılaması).
  const orders = useQuery({
    queryKey: ["packing", "open-orders", customerId],
    queryFn: () => sackHubService.listOpenOrders({ customerId: customerId! }),
    enabled: !!customerId,
    staleTime: 30_000,
  });
  const siparisler = orders.data?.data ?? [];
  const openLines = siparisler.flatMap((o) => o.lines).filter((l) => l.openQty > 0);
  const openQty = openLines.reduce((a, l) => a + l.openQty, 0);
  const karsilanan = openLines.filter((l) => l.covered).length;

  const partideCuval = openLots?.reduce((a, l) => a + l.sackCount, 0) ?? 0;
  const bosParti = openLots?.filter((l) => l.sackCount === 0).length ?? 0;
  // Bekleyen mal = havuz + açık partiler (sevk edilmemiş her şey).
  const bekleyenCuval = (u?.sackCount ?? 0) + partideCuval;
  const bekleyenMetraj = (u?.totalQty ?? 0) + (openLots?.reduce((a, l) => a + l.totalQty, 0) ?? 0);
  const bekleyenKg = (u?.weightKg ?? 0) + (openLots?.reduce((a, l) => a + (l.weightKg ?? 0), 0) ?? 0);
  const tartisiz = s?.unweighedSackCount;

  const cards = [
    {
      key: "open",
      icon: Boxes,
      title: "Açık parti",
      value: s ? String(s.openLotCount) : "…",
      hint: openLots ? `${partideCuval} çuval partilerde${bosParti > 0 ? ` · ${bosParti} boş parti` : ""}` : "",
      tone: "text-primary",
      onClick: undefined as (() => void) | undefined,
      title2: undefined as string | undefined,
    },
    {
      key: "pending",
      icon: Warehouse,
      title: "Bekleyen mal",
      value: s && openLots ? `${fmtQty(bekleyenMetraj)} m` : "…",
      hint: s && openLots ? `${bekleyenCuval} çuval · ${bekleyenKg > 0 ? `${fmtQty(bekleyenKg)} kg` : "kg yok"} — havuz + açık partiler` : "",
      tone: bekleyenCuval > 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground",
      onClick: undefined,
      title2: undefined,
    },
    {
      key: "unweighed",
      icon: Scale,
      title: "Tartılmamış çuval",
      value: tartisiz == null ? "…" : String(tartisiz),
      hint: tartisiz == null ? "" : tartisiz > 0 ? "sevk öncesi tartılmalı — tıkla, listele" : "hepsi tartılı",
      tone: tartisiz ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
      onClick: tartisiz ? onOpenUnweighed : undefined,
      title2: "Tartılmamış çuvalları listele",
    },
    {
      key: "orders",
      icon: ClipboardList,
      title: "Açık sipariş",
      value: orders.isLoading ? "…" : `${fmtQty(openQty)} m`,
      hint: orders.isLoading
        ? ""
        : openLines.length === 0
          ? "açık sipariş satırı yok"
          : `${siparisler.length} sipariş · ${openLines.length} satır · ${karsilanan} satır depoda karşılanıyor`,
      tone: openLines.length > 0 ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground",
      onClick: onOpenOrders,
      title2: "Bu carinin siparişleri",
    },
  ];
  return (
    <div className="mb-3 mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        const body = (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className={cn("h-3.5 w-3.5", c.tone)} />
              <span>{c.title}</span>
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums leading-tight", c.tone)}>{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</div>
          </>
        );
        // Tıklanmayan kart `div` — hiçbir şey yapmayan buton, olmayan bir yolu vaat eder.
        return c.onClick ? (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            className="rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
            title={c.title2}
          >
            {body}
          </button>
        ) : (
          <div key={c.key} className="rounded-md border p-3">
            {body}
          </div>
        );
      })}
    </div>
  );
}
