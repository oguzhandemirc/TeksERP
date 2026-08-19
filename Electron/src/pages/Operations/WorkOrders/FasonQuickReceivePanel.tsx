import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorService } from "@/pages/Colors/service";
import { workOrderService } from "./service";
import { loadAllForPicker } from "@/lib/picker-loader";

type Mode = "MERGE" | "ONE_TO_ONE";

interface Props {
  workOrderId: string;
  /** Kabul bitince kapatma önizlemesi yeniden çekilsin. */
  onReceived: () => void;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/**
 * "Toplar fasonda" engelini KAPATMA EKRANINDAN çözer (2026-08-17 saha isteği).
 *
 * Eskiden burada yalnız bir uyarı vardı: "önce fason kabul/iade yapılmalı."
 * Doğruydu ama operatörü başka bir ekrana gönderiyordu ve orada kayboluyordu.
 * Artık iki düğme + tek gönderim.
 *
 * İKİ SEÇENEK, ikisi de gerçek saha davranışı:
 *   · Dikilerek geldi → 10 top = 1 top, metrajlar TOPLANIR (boyahanede yaygın)
 *   · Birebir         → giden top sayısı kadar top döner
 *
 * Metraj DÜZENLENEBİLİR: seçim bir başlangıç değeridir, ölçüm değil. Operatör
 * eldeki gerçeğe göre değiştirir.
 */
export function FasonQuickReceivePanel({ workOrderId, onReceived }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("MERGE");
  /** dispatchId → düzenlenmiş parça metrajları (string: input ham değeri). */
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  /**
   * Kabulde uygulanacak renk — YALNIZ iş emrinin hedef rengi yokken sorulur
   * ("ekru" vakası: iş emri bilinçli renksiz gidiyor). Hedef rengi olan iş
   * emrinde alan hiç çizilmez ve motor kendi kopyalamasını yapar.
   */
  const [colorId, setColorId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["fason-quick-receive", workOrderId],
    queryFn: () => workOrderService.getFasonQuickReceive(workOrderId),
    enabled: Boolean(workOrderId),
    staleTime: 0,
  });
  const groups = useMemo(() => q.data?.data.groups ?? [], [q.data]);
  const orphans = q.data?.data.orphanRolls ?? [];
  const needsColor = groups.some((g) => g.colorRequired);
  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      loadAllForPicker(colorService, {
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: needsColor,
    staleTime: 60_000,
  });

  /** Moddan türeyen varsayılan parçalar — kullanıcı düzenlemediyse bu gider. */
  const defaultPieces = (g: (typeof groups)[number]): number[] =>
    mode === "MERGE" ? [g.totalQty] : g.rolls.map((r) => r.qty);

  const piecesOf = (g: (typeof groups)[number]): string[] =>
    edits[g.dispatchId] ?? defaultPieces(g).map((n) => String(n));

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.applyFasonQuickReceive(workOrderId, {
        mode,
        ...(needsColor ? { appliedColorId: colorId } : {}),
        overrides: groups.map((g) => ({
          dispatchId: g.dispatchId,
          pieces: piecesOf(g)
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n) && n > 0),
        })),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fason kabulü yapıldı");
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onReceived();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return null;
  if (groups.length === 0 && orphans.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PackageCheck className="h-4 w-4" />
        Fasondaki topları içeri al
      </div>

      {groups.length > 0 && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant={mode === "MERGE" ? "default" : "outline"}
              className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => {
                setMode("MERGE");
                setEdits({});
              }}
            >
              <div>
                <div className="font-medium">Dikilerek geldi</div>
                <div className="text-xs opacity-80">Hepsi tek top, metrajlar toplanır</div>
              </div>
            </Button>
            <Button
              type="button"
              variant={mode === "ONE_TO_ONE" ? "default" : "outline"}
              className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => {
                setMode("ONE_TO_ONE");
                setEdits({});
              }}
            >
              <div>
                <div className="font-medium">Birebir</div>
                <div className="text-xs opacity-80">Giden top sayısı kadar</div>
              </div>
            </Button>
          </div>

          <div className="space-y-2">
            {groups.map((g) => {
              const pieces = piecesOf(g);
              return (
                <div key={g.dispatchId} className="rounded border bg-background/60 p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono">{g.dispatchNo}</span>
                    <span className="text-muted-foreground">
                      {g.subcontractorName} · {g.rolls.length} top · {fmt(g.totalQty)} m
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {pieces.map((p, i) => (
                      <Input
                        key={i}
                        value={p}
                        onChange={(e) => {
                          const next = [...pieces];
                          next[i] = e.target.value;
                          setEdits((prev) => ({ ...prev, [g.dispatchId]: next }));
                        }}
                        className="h-7 w-20 text-xs"
                        inputMode="decimal"
                      />
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setEdits((prev) => ({ ...prev, [g.dispatchId]: [...pieces, "0"] }))
                      }
                    >
                      + parça
                    </Button>
                    {pieces.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setEdits((prev) => ({ ...prev, [g.dispatchId]: pieces.slice(0, -1) }))
                        }
                      >
                        − parça
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {needsColor && (
            <div className="space-y-1">
              <div className="text-xs font-medium">
                Gelen malın rengi <span className="text-destructive">*</span>
              </div>
              <select
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={colorId ?? ""}
                onChange={(e) => setColorId(e.target.value || null)}
              >
                <option value="">Renk seç…</option>
                {(colorsQ.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-muted-foreground">
                Bu iş emrinin hedef rengi yok — kabulde beyan edilir.
              </div>
            </div>
          )}

          <Button
            type="button"
            size="sm"
            disabled={mut.isPending || (needsColor && !colorId)}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Kabul ediliyor…" : "Kabul Et ve Devam"}
          </Button>
        </>
      )}

      {orphans.length > 0 && (
        // Bunlar bir AÇIK SEVKE bağlanamıyor (kalıntı / elle düzeltilmiş kayıt).
        // Kaynağı belirsiz mal için makbuz üretmek izlenebilirliği uydurmak
        // olurdu — dürüst yol: göster, ama buradan kabul etme.
        <div className="rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
          {orphans.length} top fasonda görünüyor ama açık bir sevke bağlı değil —
          bunlar buradan kabul edilemez (Konumu Düzelt ile çözülür).
        </div>
      )}
    </div>
  );
}
