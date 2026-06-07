import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, PackageOpen, DoorOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { sackStoreService } from "./service";
import { SackStoreCard } from "./SackStoreCard";
import { sackStoreStatusLabels, type SackStoreShipment } from "./types";

const QUERY_KEY = "sack-store";

type PendingAction = {
  kind: "move-to-door" | "pull-back" | "dispatch";
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
  dispatch: {
    title: (s) => `${s.shipmentNo} sevk edilsin mi?`,
    description: "Sevk çıkışı yapılır ve stok düşülür. Bu işlem geri alınamaz.",
    confirmLabel: "Sevk Et",
    success: "Sevk edildi",
  },
};

export function SackStorePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => sackStoreService.list(),
    staleTime: 30_000,
  });
  const shipments = query.data?.data ?? [];

  const mutation = useMutation({
    mutationFn: (action: PendingAction) => {
      if (action.kind === "move-to-door") return sackStoreService.moveToDoor(action.shipment.id);
      if (action.kind === "pull-back") return sackStoreService.pullBack(action.shipment.id);
      return sackStoreService.dispatch(action.shipment.id);
    },
    onSuccess: (_data, action) => {
      toast.success(ACTION_COPY[action.kind].success);
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      setPending(null);
    },
    // onError yok — apiClient interceptor backend mesajını toast'lar.
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return shipments;
    return shipments.filter((s) => {
      if (s.shipmentNo.toLowerCase().includes(term)) return true;
      if (s.customer.name.toLowerCase().includes(term)) return true;
      return s.sacks.some((sack) => sack.manualCode?.toLowerCase().includes(term));
    });
  }, [shipments, search]);

  const ready = filtered.filter((s) => s.status === "READY");
  const atDoor = filtered.filter((s) => s.status === "AT_DOOR");
  const busyId = mutation.isPending ? mutation.variables?.shipment.id : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Çuval Depo"
        description="Firma içinde bekleyen (Çuval Depo) ve kapı önündeki (Kapı Önü) paketli sevkler — hangi çuvalda hangi kumaş, çuval kodu ve kg."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="border-b px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Çuval kodu, sevk no veya müşteri ara..."
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <PackageOpen className="h-8 w-8 opacity-50" />
            <p className="text-sm">
              {search ? "Aramayla eşleşen sevk yok." : "Çuval depoda bekleyen sevk yok."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <Section
              icon={<PackageOpen className="h-4 w-4 text-purple-500" />}
              label={sackStoreStatusLabels.READY}
              count={ready.length}
              shipments={ready}
              busyId={busyId}
              onAction={setPending}
            />
            <Section
              icon={<DoorOpen className="h-4 w-4 text-warning" />}
              label={sackStoreStatusLabels.AT_DOOR}
              count={atDoor.length}
              shipments={atDoor}
              busyId={busyId}
              onAction={setPending}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !mutation.isPending && setPending(null)}
        title={pending ? ACTION_COPY[pending.kind].title(pending.shipment) : ""}
        description={pending ? ACTION_COPY[pending.kind].description : undefined}
        confirmLabel={pending ? ACTION_COPY[pending.kind].confirmLabel : "Onayla"}
        destructive={pending?.kind === "dispatch"}
        isPending={mutation.isPending}
        onConfirm={() => pending && mutation.mutate(pending)}
      />
    </div>
  );
}

function Section({
  icon,
  label,
  count,
  shipments,
  busyId,
  onAction,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  shipments: SackStoreShipment[];
  busyId: string | undefined;
  onAction: (a: PendingAction) => void;
}) {
  if (count === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {label}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {shipments.map((s) => (
          <SackStoreCard
            key={s.id}
            shipment={s}
            busy={busyId === s.id}
            onMoveToDoor={(sh) => onAction({ kind: "move-to-door", shipment: sh })}
            onPullBack={(sh) => onAction({ kind: "pull-back", shipment: sh })}
            onDispatch={(sh) => onAction({ kind: "dispatch", shipment: sh })}
          />
        ))}
      </div>
    </section>
  );
}
