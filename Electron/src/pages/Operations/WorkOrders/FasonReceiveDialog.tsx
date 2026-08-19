import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { colorService } from "@/pages/Colors/service";
import { reasonPresetService, type ReasonPreset } from "@/pages/ReasonPresets/service";
import { workOrderService } from "./service";
import type { FasonQuickPreview } from "./types";

type Group = FasonQuickPreview["groups"][number];

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const parseQty = (raw: string): number | null => {
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * "Fason Kabul" — iş emri detayından İNCE AYARLI kabul (2026-08-19, kısmi teslimat).
 *
 * Hızlı kabul panelinden (WorkOrderCompleteDialog içindeki FasonQuickReceivePanel)
 * farkı: top BAZINDA kontrol — hangi toplar geldi (checkbox), her toptan KAÇ METRE
 * geldi (kısmi kabul: gelen < kalan → top fasonda BEKLEMEDE kalır, kalan ikinci
 * teslimatta aynı iş emrinden kabul edilir ve YENİ parti numarası alır), dönen
 * parçalar (dikili tek parça / adet adet), irsaliye no ve kabul notu.
 *
 * "Kalan gelmeyecek" (🔥): fasondaki kalan FİRE kararıyla kapatılır — sebep
 * ZORUNLU (fire kataloğu, fabrika panelden düzenler), sapma defterine yazılır.
 *
 * Her sevk (dispatch) kendi kartında ve KENDİ butonuyla kabul edilir — bir sevkin
 * kabulü diğerini beklemez (mobil parti-başına-makbuz sözleşmesinin aynısı).
 */
export function FasonReceiveDialog({
  open,
  onOpenChange,
  workOrderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["fason-quick-receive", workOrderId],
    queryFn: () => workOrderService.getFasonQuickReceive(workOrderId),
    enabled: open && Boolean(workOrderId),
    staleTime: 0,
  });
  const groups = useMemo(() => q.data?.data.groups ?? [], [q.data]);
  const orphans = q.data?.data.orphanRolls ?? [];
  const needsColor = groups.some((g) => g.colorRequired);
  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open && needsColor,
    staleTime: 60_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["fason-quick-receive", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["rolls"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Fason Kabul
          </DialogTitle>
          <DialogDescription>
            Fasondaki topları içeri al — top bazında: gelen metrajı düşürürsen kabul
            KISMİ olur, kalan fasonda beklemede kalır (ikinci teslimat yeni makbuz +
            yeni parti). Gelmeyecek kalan 🔥 ile fire kapatılır.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Açık sevkler yükleniyor…
          </div>
        )}

        {!q.isLoading && groups.length === 0 && (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Bu iş emrinin fasonda bekleyen açık sevki yok.
            {orphans.length > 0 && (
              <div className="mt-2 text-amber-600">
                ⚠ {orphans.length} top fasonda görünüyor ama açık sevke bağlanamıyor —
                buradan kabul edilemez (Konumu Düzelt / kabul iptali gerekebilir).
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard
              key={g.dispatchId}
              workOrderId={workOrderId}
              group={g}
              colors={colorsQ.data?.data ?? []}
              onDone={invalidate}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tek sevkin kabul kartı — kendi satır/parça/renk state'i ve kendi submit'i. */
function GroupCard({
  workOrderId,
  group: g,
  colors,
  onDone,
}: {
  workOrderId: string;
  group: Group;
  colors: { id: string; name: string }[];
  onDone: () => void;
}) {
  /** rollId → {checked, gelen(ham metin)} — gelen varsayılanı KALAN metraj. */
  const [rows, setRows] = useState<Record<string, { checked: boolean; gelen: string }>>(
    () => Object.fromEntries(g.rolls.map((r) => [r.id, { checked: true, gelen: String(r.qty) }])),
  );
  /** Dönen parçalar (ham metin). Varsayılan: dikili TEK parça = işaretli gelen toplamı. */
  const [pieces, setPieces] = useState<string[] | null>(null); // null = otomatik (tek parça)
  const [manifestNo, setManifestNo] = useState("");
  const [notes, setNotes] = useState("");
  const [colorId, setColorId] = useState<string | null>(null);
  /** 🔥 kalan-kapama hedefi (rollId) — satır altında sebep seçimi açılır. */
  const [fireTarget, setFireTarget] = useState<string | null>(null);

  const rowOf = (id: string) => rows[id] ?? { checked: false, gelen: "" };
  const gelenOf = (rollId: string, kalan: number): number => {
    const n = parseQty(rowOf(rollId).gelen);
    return n == null ? kalan : n;
  };
  const checkedRolls = g.rolls.filter((r) => rowOf(r.id).checked);
  const gelenTotal = checkedRolls.reduce((s, r) => s + Math.min(gelenOf(r.id, r.qty), r.qty), 0);
  const partialRolls = checkedRolls.filter((r) => gelenOf(r.id, r.qty) < r.qty - 0.01);
  const partialRemainder = partialRolls.reduce((s, r) => s + (r.qty - gelenOf(r.id, r.qty)), 0);
  const effectivePieces: string[] = pieces ?? (checkedRolls.length > 0 ? [String(Math.round(gelenTotal * 100) / 100)] : []);
  const parsedPieces = effectivePieces.map(parseQty).filter((n): n is number => n != null);
  const piecesTotal = parsedPieces.reduce((s, n) => s + n, 0);
  const pieceMismatch = Math.abs(piecesTotal - gelenTotal) > 0.01;

  const canSubmit =
    checkedRolls.length > 0 && parsedPieces.length > 0 && (!g.colorRequired || Boolean(colorId));

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.receiveFason({
        workOrderId,
        stepId: g.stepId,
        subcontractorId: g.subcontractorId,
        ...(manifestNo.trim() ? { manifestNo: manifestNo.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(g.colorRequired && colorId ? { appliedColorId: colorId } : {}),
        returns: checkedRolls.map((r) => {
          const gelen = gelenOf(r.id, r.qty);
          return {
            rollId: r.id,
            // Kalanın altındaysa KISMİ kabul; eşit/üstünde alan gönderilmez (TAM).
            ...(gelen < r.qty - 0.01 ? { receivedQty: gelen } : {}),
          };
        }),
        newRolls: parsedPieces.map((qty) => ({ qty })),
        // İdempotency — retry aynı isteği tekrarlarsa ikinci makbuz doğmaz.
        clientToken: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fason kabul yapıldı");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="font-medium">
          {g.subcontractorName} · {g.stationName}
        </div>
        <div className="text-xs text-muted-foreground">
          {g.dispatchNo} · {g.rolls.length} top · {fmt(g.totalQty)} m sevk
        </div>
      </div>

      {/* ── Toplar: geldi mi + kaç metre geldi ── */}
      <div className="space-y-1">
        {g.rolls.map((r) => {
          const row = rowOf(r.id);
          const gelen = gelenOf(r.id, r.qty);
          const partial = row.checked && gelen < r.qty - 0.01;
          return (
            <div key={r.id} className="rounded border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={row.checked}
                  onCheckedChange={(v) =>
                    setRows((p) => ({ ...p, [r.id]: { ...row, checked: v === true } }))
                  }
                />
                <span className="w-36 shrink-0 font-mono text-xs">{r.barcode ?? "—"}</span>
                <span className="text-xs text-muted-foreground">kalan {fmt(r.qty)} m</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Gelen</span>
                  <Input
                    value={row.gelen}
                    onChange={(e) => setRows((p) => ({ ...p, [r.id]: { ...row, gelen: e.target.value } }))}
                    disabled={!row.checked}
                    className="h-7 w-24 text-right text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">m</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-amber-600"
                    title="Kalan gelmeyecek — fire olarak kapat"
                    onClick={() => setFireTarget(fireTarget === r.id ? null : r.id)}
                  >
                    <Flame className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {partial && (
                <div className="mt-1 pl-8 text-[11px] font-medium text-amber-700">
                  KISMİ: {fmt(r.qty - gelen)} m fasonda beklemede kalacak — kalan geldiğinde
                  buradan ikinci kabul yapılır (yeni parti numarası alır).
                </div>
              )}
              {fireTarget === r.id && (
                <CloseRemainderInline
                  stepId={g.stepId}
                  rollId={r.id}
                  barcode={r.barcode}
                  kalan={r.qty}
                  onClosed={() => {
                    setFireTarget(null);
                    onDone();
                  }}
                  onCancel={() => setFireTarget(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Dönen parçalar ── */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            Dönen parçalar (varsayılan: dikili tek parça = {fmt(gelenTotal)} m)
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                setPieces(checkedRolls.map((r) => String(Math.min(gelenOf(r.id, r.qty), r.qty))))
              }
            >
              Adet adet ({checkedRolls.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => setPieces([...effectivePieces, ""])}
            >
              <Plus className="h-3 w-3" /> Parça
            </Button>
          </div>
        </div>
        {effectivePieces.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Parça {i + 1}</span>
            <Input
              value={v}
              onChange={(e) => {
                const next = [...effectivePieces];
                next[i] = e.target.value;
                setPieces(next);
              }}
              className="h-7 w-28 text-right text-xs"
            />
            <span className="text-[11px] text-muted-foreground">m</span>
            {effectivePieces.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setPieces(effectivePieces.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {pieceMismatch && (
          <div className="text-[11px] font-medium text-amber-700">
            Parça toplamı ({fmt(piecesTotal)} m) beyan edilen gelenle ({fmt(gelenTotal)} m)
            uyuşmuyor — bilinçliyse devam edilebilir (ölçüm farkı).
          </div>
        )}
      </div>

      {g.colorRequired && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Uygulanan renk *</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={colorId ?? ""}
            onChange={(e) => setColorId(e.target.value || null)}
          >
            <option value="">— seç —</option>
            {colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={manifestNo}
          onChange={(e) => setManifestNo(e.target.value)}
          placeholder="İrsaliye no (opsiyonel)"
          className="h-8 text-xs"
        />
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Kabul notu (opsiyonel)"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex items-center justify-between">
        {partialRolls.length > 0 ? (
          <span className="text-[11px] font-medium text-sky-700">
            {partialRolls.length} top KISMİ — {fmt(partialRemainder)} m fasonda kalacak
          </span>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PackageCheck className="h-3.5 w-3.5" />
          )}
          Kabul Et ({checkedRolls.length} top → {parsedPieces.length} parça)
        </Button>
      </div>
    </div>
  );
}

/** 🔥 satır içi kalan-kapama: sebep ZORUNLU (fire kataloğu), tek tık onay. */
function CloseRemainderInline({
  stepId,
  rollId,
  barcode,
  kalan,
  onClosed,
  onCancel,
}: {
  stepId: string;
  rollId: string;
  barcode: string | null;
  kalan: number;
  onClosed: () => void;
  onCancel: () => void;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const presetsQ = useQuery({
    queryKey: ["reason-presets", "active"],
    queryFn: () => reasonPresetService.list(false),
    staleTime: 5 * 60_000,
  });
  const scrapPresets: ReasonPreset[] = (presetsQ.data ?? []).filter((p) => p.kind === "ROLL_SCRAP");
  const selected = scrapPresets.find((p) => p.code === reasonCode) ?? null;
  const canConfirm =
    Boolean(reasonCode) && (!selected?.requiresText || reasonText.trim().length >= 3);

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.closeFasonRemainder({
        stepId,
        rollId,
        reasonCode,
        reasonText: reasonText.trim() || null,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Kalan kapatıldı");
      onClosed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-2 space-y-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
        {barcode ?? "Top"} — fasondaki {fmt(kalan)} m &quot;gelmeyecek&quot; kararıyla
        kapatılacak ve FİRE olarak sapma defterine yazılacak. Kabul DEĞİLDİR, geri alınamaz.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className="h-7 rounded-md border bg-background px-2 text-xs"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          <option value="">— sebep seç (zorunlu) —</option>
          {scrapPresets.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <Input
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder={selected?.requiresText ? "Açıklama (zorunlu, ≥3 karakter)" : "Açıklama (opsiyonel)"}
          className="h-7 w-52 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7 px-2 text-[11px]"
          disabled={!canConfirm || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}
          Kalanı Kapat ({fmt(kalan)} m FİRE)
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
