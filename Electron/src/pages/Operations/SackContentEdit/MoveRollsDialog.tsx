import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft, Loader2, Search, UserRound } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { SackSearchRow } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  sackId: string;
  /** null = kapalı; dolu = bu topları taşı. */
  rollIds: string[] | null;
  /** Kaynak çuvalın müşterisi — hedefte farklıysa uyarı + onay istenir. */
  sourceCustomerId: string | null;
  sourceCustomerName: string | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/**
 * Seçili topları başka DEPO çuvalına aktar — aramalı hedef seçici.
 *
 * Hedefler `sack-search` (scope=POOL) ile çekilir; müşteri havuzuyla DEĞİL. Sebep:
 * havuz ucu `customerId` zorunlu olduğu için müşterisiz (genel stok) çuvalda sorgu
 * hiç koşmuyordu → hedef listesi boş → buton "Aktarılacak başka çuval yok" diyerek
 * kilitleniyordu. Backend `moveRollsToSack` müşteri eşleşmesi ARAMAZ, yalnız iki
 * çuvalın da depoda olmasını ister — seçici artık o kuralla birebir örtüşür.
 *
 * Farklı müşterinin çuvalı ENGELLENMEZ ama tek dokunuşla da taşınmaz: uyarı satırı +
 * ayrı bir onay adımı gelir (sessiz yanlış aktarma olmasın).
 */
export function MoveRollsDialog({
  sackId,
  rollIds,
  sourceCustomerId,
  sourceCustomerName,
  onOpenChange,
  onDone,
}: Props) {
  const qc = useQueryClient();
  const open = !!rollIds && rollIds.length > 0;
  const count = rollIds?.length ?? 0;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  // Farklı müşteriye taşıma onayı bekleyen hedef (null = liste görünümü).
  const [confirmTarget, setConfirmTarget] = useState<SackSearchRow | null>(null);

  // Dialog her açılışta temiz başlar (bayat arama/onay kalmasın).
  useEffect(() => {
    if (open) {
      setSearch("");
      setConfirmTarget(null);
    }
  }, [open]);

  const targetsQ = useQuery({
    queryKey: ["sack-search", "move-targets", debouncedSearch],
    queryFn: () =>
      sackHubService.listSacks({
        cursor: null,
        limit: 20,
        filters: { scope: "POOL" }, // sevkiyata atanmış çuval hedef olamaz (backend 409)
        search: debouncedSearch || undefined,
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
    enabled: open,
    staleTime: 5_000,
  });

  const targets = (targetsQ.data?.data ?? []).filter((s) => s.id !== sackId);

  const mut = useMutation({
    mutationFn: (targetSackId: string) => sackHubService.moveRollsToSack(sackId, rollIds!, targetSackId),
    onSuccess: (res) => {
      toast.success(res.message ?? `${count} top taşındı`);
      invalidateSackHub(qc);
      onOpenChange(false);
      onDone?.();
    },
  });

  const pickTarget = (t: SackSearchRow) => {
    if ((t.customer?.id ?? null) === sourceCustomerId) {
      mut.mutate(t.id); // aynı müşteri (ya da ikisi de müşterisiz) → doğrudan taşı
      return;
    }
    setConfirmTarget(t);
  };

  const nameOf = (c: { name: string } | null) => c?.name ?? "Müşterisiz (genel stok)";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        {confirmTarget ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4" /> Farklı müşteri
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    Kaynak çuval <strong>{sourceCustomerName ?? "Müşterisiz (genel stok)"}</strong>, hedef çuval{" "}
                    <strong>{nameOf(confirmTarget.customer)}</strong> müşterisine ait.
                  </p>
                  <p>
                    {count} top <span className="font-mono">{confirmTarget.sackNo}</span> çuvalına taşınacak.
                    Aktarma engellenmiyor — mal fiziksel olarak yer değiştirir; emin misiniz?
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={mut.isPending} onClick={() => setConfirmTarget(null)}>
                Vazgeç
              </Button>
              <Button disabled={mut.isPending} onClick={() => mut.mutate(confirmTarget.id)}>
                {mut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Yine de Aktar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4" /> {count} top hangi çuvala aktarılsın?
              </DialogTitle>
              <DialogDescription>
                Depodaki (sevk edilmemiş) çuvallar listelenir. Farklı müşterinin çuvalı da seçilebilir —
                onay istenir.
              </DialogDescription>
            </DialogHeader>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Çuval kodu / müşteri ara…"
                className="pl-8"
              />
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto">
              {targetsQ.isLoading ? (
                <div className="space-y-1">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ) : (
                <>
                  {targets.map((t) => {
                    const mismatch = (t.customer?.id ?? null) !== sourceCustomerId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={mut.isPending}
                        onClick={() => pickTarget(t)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-mono font-medium">{t.sackNo}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {t.customer ? (
                                <span className="inline-flex items-center gap-1">
                                  <UserRound className="h-3 w-3 shrink-0" />
                                  {t.customer.name}
                                </span>
                              ) : (
                                "Müşterisiz"
                              )}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                            {t.rollCount} top · {fmtM(Number(t.totalQty))} m
                            {t.swatchCount > 0 ? ` · ${t.swatchCount} kartela` : ""}
                          </span>
                          {mismatch && (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              Farklı müşteri — yine de aktarılabilir
                            </span>
                          )}
                        </span>
                        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                  {targets.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {debouncedSearch
                        ? "Aramayla eşleşen depo çuvalı yok."
                        : "Depoda başka çuval yok — önce yeni çuval açın."}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
