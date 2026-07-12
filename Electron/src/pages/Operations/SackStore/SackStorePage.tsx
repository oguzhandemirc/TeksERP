import { useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, PackageOpen, ChevronDown, CheckCircle2, XCircle, Eraser, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { ScanField } from "@/components/scanner/ScanField";
import { useContinuousScan } from "@/hooks/useContinuousScan";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { cn } from "@/lib/utils";
import { sackStoreService } from "./service";
import { SackStoreCard } from "./SackStoreCard";
import { ShipmentContentsSheet } from "./ShipmentContentsSheet";
import { DispatchConfirmDialog } from "./DispatchConfirmDialog";
import { destinationLabels, type SackStoreShipment, type ShipmentDestination } from "./types";

const QUERY_KEY = "sack-store";
const PAGE_SIZE = 30;

type DestFilter = "ALL" | ShipmentDestination;

const DEST_TABS: { key: DestFilter; label: string }[] = [
  { key: "ALL", label: "Tümü" },
  { key: "DOMESTIC", label: destinationLabels.DOMESTIC },
  { key: "EXPORT", label: destinationLabels.EXPORT },
];

/** Kapıda okutulmuş çuvalların sevkiyat-bazlı grubu (eski Okutarak Sevk akışı). */
interface ScannedGroup {
  shipment: SackStoreShipment;
  codes: string[];
}

export function SackStorePage() {
  const scanRef = useRef<HTMLInputElement>(null);
  const [destination, setDestination] = useState<DestFilter>("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [dispatchTarget, setDispatchTarget] = useState<SackStoreShipment | null>(null);
  const [openShipment, setOpenShipment] = useState<SackStoreShipment | null>(null);
  // Sevk onayı KAPALIYKEN (varsayılan) sevkler doğrudan çıkar → board boş kalır;
  // bu ekran yalnız ayar AÇIKKEN anlamlı. Kullanıcıya bunu bir ipucuyla açıkla.
  const confirmationEnabled = useShipmentConfirmationEnabled();

  // ---- Kapı okutması (eski Okutarak Sevk buraya gömüldü) --------------------
  const [scanValue, setScanValue] = useState("");
  const [scanned, setScanned] = useState<Record<string, ScannedGroup>>({});
  const [lastOk, setLastOk] = useState<{ code: string; shipmentNo: string } | null>(null);

  // Çuval kodunu (sackNo) çıkış bekleyen sevkiyatına eşle; birden çok
  // DİSTİNKT sevkiyat eşleşirse tahmin etme — karttan elle seçilir.
  const resolveSack = async (code: string): Promise<SackStoreShipment | null> => {
    const { data } = await sackStoreService.list({ search: code, limit: 5 });
    const distinct = new Map(data.map((s) => [s.id, s]));
    if (distinct.size > 1) {
      toast.warning(`"${code}" birden fazla sevkiyatla eşleşti — karttan elle seçin.`);
      return null;
    }
    return data[0] ?? null;
  };

  const { push, resolving, lastError } = useContinuousScan<SackStoreShipment>({
    resolve: resolveSack,
    onResolved: (shipment, code) => {
      setScanned((prev) => {
        const g = prev[shipment.id];
        return {
          ...prev,
          [shipment.id]: {
            shipment, // taze sayaç/durum
            codes: g && g.codes.includes(code) ? g.codes : [...(g?.codes ?? []), code],
          },
        };
      });
      setLastOk({ code, shipmentNo: shipment.shipmentNo });
    },
    alreadyInList: (code) => Object.values(scanned).some((g) => g.codes.includes(code)),
  });

  const clearScanned = () => {
    setScanned({});
    setLastOk(null);
    scanRef.current?.focus();
  };

  // "Her yerde okut" → çuval kodu aramaya uygulanır (ilgili sevkiyatı bulur).
  useScanSeed("scanCode", (code) => setSearch(code));

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, destination, debouncedSearch],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sackStoreService.list({
        destination: destination === "ALL" ? undefined : destination,
        search: debouncedSearch || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    staleTime: 30_000,
  });

  // Board listesi + okutulan sevkiyatlar: okutulanlar EN ÜSTTE (kapıdaki iş
  // öncelikli); filtre/sayfa dışında kalan okutulmuş sevkiyat da listeye
  // eklenir (resolve'dan gelen taze board satırıyla) — kart kaybolmaz.
  const shipments = useMemo(() => {
    const list = query.data?.pages.flatMap((p) => p.data) ?? [];
    const listIds = new Set(list.map((s) => s.id));
    const extras = Object.values(scanned)
      .filter((g) => !listIds.has(g.shipment.id))
      .map((g) => g.shipment);
    const rank = (s: SackStoreShipment) => (scanned[s.id] ? 0 : 1);
    return [...extras, ...list].sort((a, b) => rank(a) - rank(b));
  }, [query.data, scanned]);

  const scannedCount = Object.keys(scanned).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevk Kapısı"
        description="Kapıda çuval okut → sevkiyat kartı öne gelir → sevk et / irsaliye bas. Planlı (çıkış bekleyen) sevkler; karta tıkla → çuval ve top dökümü."
        actions={
          <div className="flex items-center gap-2">
            {scannedCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearScanned}>
                <Eraser className="mr-1 h-4 w-4" /> Okutulanları Temizle
              </Button>
            )}
            <RefreshButton queryKey={QUERY_KEY} />
          </div>
        }
      />

      {!confirmationEnabled && (
        <div className="flex items-start gap-2 border-b bg-sky-500/10 px-6 py-2 text-xs text-sky-800 dark:text-sky-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Sevk onayı kapalı — çuvallar seçilir seçilmez doğrudan sevk edilir. Bu ekran yalnızca Genel
            Ayarlar'da <strong>“Sevk onayı adımı”</strong> açıkken planlı sevkleri listeler.
          </span>
        </div>
      )}

      {/* Kapı okutması — çuval kodu okut, sevkiyatı bul ve kartını öne getir. */}
      <PermissionGate permission="shipping:write">
        <ScanField
          className="border-b px-6 py-3"
          value={scanValue}
          onChange={setScanValue}
          onScan={(code) => {
            push(code);
            setScanValue("");
          }}
          placeholder="Çuval kodu okut (CV-… veya elle yazılan) → sevkiyatı bul"
          autoFocus
          inputRef={scanRef}
          expectPrefix="SACK"
          submitLabel="Ekle"
        />
        {lastError ? (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-6 py-2.5 text-sm font-semibold text-destructive">
            <XCircle className="h-5 w-5 shrink-0" />
            {lastError}
          </div>
        ) : lastOk ? (
          <div className="flex items-center gap-2 border-b bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-mono">{lastOk.code}</span>
            <span aria-hidden>→</span>
            <span className="font-mono">{lastOk.shipmentNo}</span>
          </div>
        ) : null}
        {resolving.length > 0 && (
          <div className="border-b px-6 py-1.5 text-xs text-muted-foreground">
            Çözümleniyor: {resolving.join(", ")}
          </div>
        )}
      </PermissionGate>

      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Çuval kodu, sevk no veya müşteri ara..."
            className="pl-8"
          />
        </div>
        {/* Saha #22: yurtiçi/yurtdışı filtresi */}
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {DEST_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setDestination(t.key)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                destination === t.key ? "bg-sky-600 text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : shipments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <PackageOpen className="h-8 w-8 opacity-50" />
            <p className="text-sm">
              {debouncedSearch ? "Aramayla eşleşen sevk yok." : "Sevk kapısında bekleyen sevk yok."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {shipments.map((s) => (
                <SackStoreCard
                  key={s.id}
                  shipment={s}
                  scannedCount={scanned[s.id]?.codes.length}
                  onOpen={setOpenShipment}
                  onDispatch={setDispatchTarget}
                />
              ))}
            </div>
            <div className="flex justify-center p-6">
              <Button
                variant="outline"
                size="sm"
                disabled={!query.hasNextPage || query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
                className="gap-2"
              >
                {query.isFetchingNextPage ? (
                  "Yükleniyor..."
                ) : query.hasNextPage ? (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Daha Fazla Yükle
                  </>
                ) : (
                  "Liste sonu"
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      <ShipmentContentsSheet
        shipment={openShipment}
        open={openShipment !== null}
        onOpenChange={(o) => !o && setOpenShipment(null)}
      />

      <DispatchConfirmDialog
        shipment={
          dispatchTarget
            ? {
                id: dispatchTarget.id,
                shipmentNo: dispatchTarget.shipmentNo,
                customerName: dispatchTarget.customer.name,
                branchName: dispatchTarget.branch?.name ?? null,
              }
            : null
        }
        scannedCodes={dispatchTarget ? scanned[dispatchTarget.id]?.codes : undefined}
        returnFocusRef={scanRef}
        onOpenChange={(o) => !o && setDispatchTarget(null)}
        onDispatched={(id) => {
          // Dialog açık kalır (İrsaliyeyi Bas paneli) — yalnız yerel liste temizliği.
          setScanned((prev) => {
            const rest = { ...prev };
            delete rest[id];
            return rest;
          });
          setLastOk(null);
        }}
      />
    </div>
  );
}
