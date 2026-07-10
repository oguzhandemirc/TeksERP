import { useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, PackageOpen, ChevronDown, CheckCircle2, XCircle, Eraser } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { ScanField } from "@/components/scanner/ScanField";
import { useContinuousScan } from "@/hooks/useContinuousScan";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useScanSeed } from "@/hooks/useScanSeed";
import { cn } from "@/lib/utils";
import { sackStoreService } from "./service";
import { SackStoreCard } from "./SackStoreCard";
import { ShipmentContentsSheet } from "./ShipmentContentsSheet";
import { DispatchConfirmDialog } from "./DispatchConfirmDialog";
import {
  sackStoreStatusLabels,
  destinationLabels,
  type SackStoreShipment,
  type SackStoreStatus,
  type ShipmentDestination,
} from "./types";

const QUERY_KEY = "sack-store";
const PAGE_SIZE = 30;

type StatusFilter = "ALL" | SackStoreStatus;
type DestFilter = "ALL" | ShipmentDestination;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Tümü" },
  { key: "READY", label: sackStoreStatusLabels.READY },
  { key: "AT_DOOR", label: sackStoreStatusLabels.AT_DOOR },
];

const DEST_TABS: { key: DestFilter; label: string }[] = [
  { key: "ALL", label: "Tümü" },
  { key: "DOMESTIC", label: destinationLabels.DOMESTIC },
  { key: "EXPORT", label: destinationLabels.EXPORT },
];

// Sevk (dispatch) burada YOK — yıkıcı onay çuval dökümünü canlı listeleyen
// ortak DispatchConfirmDialog'dan geçer; bu üçlü kısa/verisiz geçişlerdir.
type PendingAction = {
  kind: "move-to-door" | "pull-back" | "unready";
  shipment: SackStoreShipment;
};

const ACTION_COPY: Record<
  PendingAction["kind"],
  { title: (s: SackStoreShipment) => string; description: string; confirmLabel: string; success: string }
> = {
  "move-to-door": {
    title: (s) => `${s.shipmentNo} kapı önüne konsun mu?`,
    description: "Sevk kapı önüne (Kapı Önü) taşınır, sevke hazır hale gelir.",
    confirmLabel: "Kapı Önüne Koy",
    success: "Kapı önüne kondu",
  },
  "pull-back": {
    title: (s) => `${s.shipmentNo} çuval depoya geri çekilsin mi?`,
    description: "Sevk kapı önünden çuval depoya (Çuval Depo) geri alınır.",
    confirmLabel: "Geri Çek",
    success: "Çuval depoya geri çekildi",
  },
  unready: {
    title: (s) => `${s.shipmentNo} hazırlığa geri alınsın mı?`,
    description:
      "Karşılanma geri alınır (sipariş tekrar 'bekliyor' sayılır), çuval/top içeriği düzenlenebilir olur. Sevk bu listeden çıkar; Paketleme'den düzenlenip tekrar çuval depoya kaldırılabilir.",
    confirmLabel: "Hazırlığa Geri Al",
    success: "Hazırlığa geri alındı — düzenlenebilir",
  },
};

/** Kapıda okutulmuş çuvalların sevkiyat-bazlı grubu (eski Okutarak Sevk akışı). */
interface ScannedGroup {
  shipment: SackStoreShipment;
  codes: string[];
}

export function SackStorePage() {
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [destination, setDestination] = useState<DestFilter>("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<SackStoreShipment | null>(null);
  const [openShipment, setOpenShipment] = useState<SackStoreShipment | null>(null);

  // ---- Kapı okutması (eski Okutarak Sevk buraya gömüldü) --------------------
  const [scanValue, setScanValue] = useState("");
  const [scanned, setScanned] = useState<Record<string, ScannedGroup>>({});
  const [lastOk, setLastOk] = useState<{ code: string; shipmentNo: string } | null>(null);

  // Çuval kodunu (sackNo/manualCode) sevke-hazır sevkiyatına eşle; birden çok
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
    queryKey: [QUERY_KEY, status, destination, debouncedSearch],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sackStoreService.list({
        status: status === "ALL" ? undefined : status,
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

  const mutation = useMutation({
    mutationFn: (action: PendingAction) => {
      if (action.kind === "move-to-door") return sackStoreService.moveToDoor(action.shipment.id);
      if (action.kind === "pull-back") return sackStoreService.pullBack(action.shipment.id);
      return sackStoreService.unready(action.shipment.id);
    },
    onSuccess: (_data, action) => {
      toast.success(ACTION_COPY[action.kind].success);
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      // O1 fix: bu geçişler sevkiyatın kendisini de değiştirir — unready
      // commit'i GERİ SARIP sipariş durumunu yeniden hesaplar. Açık
      // Sevkiyat/Sipariş sekmeleri bayat kalmasın. (Dispatch tazelemeleri
      // ortak DispatchConfirmDialog'un içinde.)
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail", action.shipment.id] });
      if (action.kind === "unready") {
        void qc.invalidateQueries({ queryKey: ["orders"] });
      }
      // Okutulmuş sevkiyat panodan taşındıysa yerel durum senkron kalsın:
      // kapı geçişlerinde durum güncellenir, hazırlığa dönen kapıdan çıkar.
      const id = action.shipment.id;
      setScanned((prev) => {
        if (!prev[id]) return prev;
        if (action.kind === "unready") {
          const rest = { ...prev };
          delete rest[id];
          return rest;
        }
        const nextStatus = action.kind === "move-to-door" ? "AT_DOOR" : "READY";
        return { ...prev, [id]: { ...prev[id], shipment: { ...prev[id].shipment, status: nextStatus } } };
      });
      setPending(null);
      scanRef.current?.focus(); // odak disiplini
    },
    // Toast apiClient interceptor'dan gelir; L: 409'da (atomik claim — başka
    // operatör aynı sevkiyatı değiştirdi) liste tazelensin ki bayat kartla
    // aynı hata tekrarlanmasın.
    onError: () => {
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setPending(null);
    },
  });

  const busyId = mutation.isPending ? mutation.variables?.shipment.id : undefined;

  const scannedCount = Object.keys(scanned).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevk Kapısı"
        description="Kapıda çuval okut → sevkiyat kartı öne gelir → kapıya taşı / sevk et / irsaliye bas. Çuval depo + kapı önü panosu; karta tıkla → çuval ve top dökümü."
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
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                status === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
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
              {debouncedSearch ? "Aramayla eşleşen sevk yok." : "Çuval depoda bekleyen sevk yok."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {shipments.map((s) => (
                <SackStoreCard
                  key={s.id}
                  shipment={s}
                  busy={busyId === s.id}
                  scannedCount={scanned[s.id]?.codes.length}
                  onOpen={setOpenShipment}
                  onMoveToDoor={(sh) => setPending({ kind: "move-to-door", shipment: sh })}
                  onPullBack={(sh) => setPending({ kind: "pull-back", shipment: sh })}
                  onUnready={(sh) => setPending({ kind: "unready", shipment: sh })}
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

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !mutation.isPending && setPending(null)}
        title={pending ? ACTION_COPY[pending.kind].title(pending.shipment) : ""}
        description={pending ? ACTION_COPY[pending.kind].description : undefined}
        confirmLabel={pending ? ACTION_COPY[pending.kind].confirmLabel : "Onayla"}
        isPending={mutation.isPending}
        onConfirm={() => {
          if (pending) mutation.mutate(pending);
        }}
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
