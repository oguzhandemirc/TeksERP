import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { PackingGroup, SackSearchRow } from "./types";

const MAX_NOTE = 500;

/**
 * "Parti Ata" — seçili çuvalları bir paketleme grubuna bağlar.
 *
 * İki yol: YENİ grup (numarayı sunucu üretir; ad elle de yazılabilir) ya da
 * AÇIK bir gruba ekleme. Grup bir REZERVASYON DEĞİLDİR — stok düşmez, çuvalı
 * kilitlemez, sevk akışına yeni bir kural eklemez; yalnız "bunlar bir arada
 * dursun" der.
 *
 * ⚠️ TEK CARİ ŞARTI EKRANDA SÖYLENİR: gruplar cariye özeldir. Seçimde birden
 * çok cari varsa buton çalışmaz — sunucu zaten reddederdi (`claimSacksIntoGroupTx`
 * WHERE'inde `customerId` var), ama operatörün sebebini 409'dan öğrenmesi kötü
 * bir öğretmendir.
 */
/**
 * Diyaloğun durumu ve mutasyonu — ana bileşen 80 satır sınırının altında kalsın
 * diye ayrıldı (lint tavanı). Kural gövdesi burada, çizim orada.
 */
function useAssignGroup(sacks: SackSearchRow[] | null, onOpenChange: (o: boolean) => void, onDone: () => void) {
  const qc = useQueryClient();
  const open = !!sacks && sacks.length > 0;
  const rows = useMemo(() => sacks ?? [], [sacks]);

  // Seçimdeki cariler — tek olmalı (gruplar cariye özel).
  const customerIds = useMemo(
    () => [...new Set(rows.map((r) => r.customer?.id).filter((v): v is string => !!v))],
    [rows],
  );
  const tekCari = customerIds.length === 1 ? (customerIds[0] ?? null) : null;
  const cariSiz = rows.some((r) => !r.customer);

  const [hedef, setHedef] = useState<"yeni" | string>("yeni");
  const [ad, setAd] = useState("");
  const [not, setNot] = useState("");
  /** İdempotency — pencere her açılışta BİR token üretir (mantıksal deneme). */
  const [token, setToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setHedef("yeni");
    setAd("");
    setNot("");
    setToken(crypto.randomUUID());
  }, [open]);

  const gruplar = useQuery({
    queryKey: ["packing-groups", tekCari],
    queryFn: () => sackHubService.listPackingGroups(tekCari!),
    enabled: open && !!tekCari,
  });
  const openGroups: PackingGroup[] = gruplar.data?.data ?? [];

  const mut = useMutation({
    mutationFn: () =>
      hedef === "yeni"
        ? sackHubService.createPackingGroup({
            customerId: tekCari!,
            sackIds: rows.map((r) => r.id),
            ...(ad.trim() ? { name: ad.trim() } : {}),
            ...(not.trim() ? { note: not.trim() } : {}),
            clientToken: token,
          })
        : sackHubService.addSacksToPackingGroup(hedef, rows.map((r) => r.id)),
    onSuccess: (res) => {
      toast.success(`${rows.length} çuval "${res.data.name}" grubuna alındı.`);
      invalidateSackHub(qc);
      void qc.invalidateQueries({ queryKey: ["packing-groups"] });
      onDone();
      onOpenChange(false);
    },
  });

  const engel = cariSiz
    ? "Seçimde müşterisiz çuval var — grup cariye özeldir."
    : !tekCari
      ? "Seçimde birden çok cari var — grup cariye özeldir, tek cari seçin."
      : null;

  return { open, rows, hedef, setHedef, ad, setAd, not, setNot, openGroups, mut, engel };
}

export function AssignPackingGroupDialog({
  sacks,
  onOpenChange,
  onDone,
}: {
  /** null = kapalı. Seçili DEPO çuvalları. */
  sacks: SackSearchRow[] | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { open, rows, hedef, setHedef, ad, setAd, not, setNot, openGroups, mut, engel } =
    useAssignGroup(sacks, onOpenChange, onDone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-4 w-4" /> Parti Ata
          </DialogTitle>
          <DialogDescription>
            {rows.length} çuval bir hazırlık grubuna alınacak. Grup bir rezervasyon
            değildir: stok düşmez, çuval kilitlenmez, sevk akışı değişmez.
          </DialogDescription>
        </DialogHeader>

        {engel ? (
          <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">{engel}</p>
        ) : (
          <TargetForm
            hedef={hedef}
            setHedef={setHedef}
            openGroups={openGroups}
            ad={ad}
            setAd={setAd}
            not={not}
            setNot={setNot}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!!engel || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Atanıyor…" : "Ata"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Diyaloğun gövdesi — hedef seçimi + (yeni grupta) ad/not. Ayrı bileşen: ana
 *  fonksiyon 80 satır sınırının altında kalsın (lint tavanı). */
function TargetForm({
  hedef,
  setHedef,
  openGroups,
  ad,
  setAd,
  not,
  setNot,
}: {
  hedef: string;
  setHedef: (v: string) => void;
  openGroups: PackingGroup[];
  ad: string;
  setAd: (v: string) => void;
  not: string;
  setNot: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Hedef</Label>
        <select
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={hedef}
          onChange={(e) => setHedef(e.target.value)}
        >
          <option value="yeni">Yeni grup (numarayı sistem verir)</option>
          {openGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} — {g.sackCount} çuval
            </option>
          ))}
        </select>
      </div>

      {hedef === "yeni" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="pg-ad">Ad (boş bırakılırsa sıradaki numara)</Label>
            <Input
              id="pg-ad"
              value={ad}
              maxLength={64}
              placeholder="örn. Cuma tırı"
              onChange={(e) => setAd(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-not">Grup notu (opsiyonel)</Label>
            <Textarea
              id="pg-not"
              value={not}
              maxLength={MAX_NOTE}
              rows={2}
              placeholder="örn. cuma sabahı kapıdan alınacak"
              onChange={(e) => setNot(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}
