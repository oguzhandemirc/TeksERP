import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, PackageOpen, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { BulkDistributePreview, BulkDistributeResult } from "./types";
import type { ApiResponse } from "@/types/api";

/**
 * Sonuç toast'ı — kısmi başarı SESSİZ geçmez: hangi çuval neden atlandı, adıyla
 * söylenir. (Bileşenden ayrı: boyut tavanı YENİ kodda zorunlu.)
 */
function sonucToast(res: ApiResponse<BulkDistributeResult>): void {
  const atlanan = res.data?.atlanan ?? [];
  if (atlanan.length === 0) {
    toast.success(res.message ?? "Çuvallar dağıtıldı");
    return;
  }
  toast.warning(res.message ?? "Bazı çuvallar atlandı", {
    description: atlanan.map((a) => `${a.sackNo}: ${a.sebep}`).join(" · "),
  });
}

/**
 * TOPLU ÇUVAL DAĞITMA — listeden seçilen çuvalların İÇERİĞİNİ depoya çıkarır.
 *
 * ⚠️ "SİLME" DEĞİL DAĞITMA: çuval kaydı kalır, yalnız içi boşalır ve toplar
 * serbest depoya döner (geri okutulabilir). Başlık ve gövde bunu açıkça söyler —
 * kullanıcının kafasındaki "sil" fiili ile sistemin yaptığı iş aynı değil.
 *
 * ⚠️ ÖNİZLEME ZORUNLU: kök CLAUDE.md "yıkıcı işlemde arayüz etkilenen HER kaydı
 * listeler; soyut sayı yetmez" diyor. Bu yüzden diyalog açılır açılmaz önizleme
 * ucu çağrılır (YAZMAZ) ve her çuvalın topları satır satır açılabilir.
 *
 * ⚠️ ENGELLİ ÇUVAL ATLANIR, GİZLENMEZ: sevkiyata atanmış çuval dağıtılamaz.
 * Onu listeden düşürmek yerine sebebiyle gösteririz — kullanıcı neyin
 * yapılmayacağını ONAYDAN ÖNCE görür.
 */
/**
 * Toplu işin gövdesi (bileşenden ayrı: boyut tavanı YENİ kodda zorunlu).
 *
 * SİLME YOLU: toplu dağıtma ucu çuvalı SİLMEZ; silme tek-çuval ucundan
 * (`removeSack(id, withContents)`) geçer ve o uç zaten "boşalt + sil" yapar.
 * Sıralı koşulur — tek tx'e sokmak için yeni bir toplu uç yazmak gerekirdi ve
 * bu ekranın hacmi (≤200 çuval) onu hak etmiyor.
 */
async function topluCalistir(
  silme: boolean,
  uygun: { sackId: string }[],
  engelli: { sackNo: string; engel?: string | null }[],
): Promise<ApiResponse<BulkDistributeResult>> {
  if (!silme) return sackHubService.distributeSacksBulk(uygun.map((s) => s.sackId));
  for (const c of uygun) await sackHubService.removeSack(c.sackId, true);
  return {
    success: true,
    message: `${uygun.length} çuval boşaltıldı ve silindi`,
    data: { atlanan: engelli.map((e) => ({ sackNo: e.sackNo, sebep: e.engel ?? "engel" })) },
  } as ApiResponse<BulkDistributeResult>;
}

/** Başlık — "sil" ile "dağıt" AYRI fiillerdir ve kullanıcı ikisini karıştırıyordu. */
function Baslik({ silme }: { silme: boolean }) {
  return (
    <>
      {silme ? <Trash2 className="h-5 w-5" /> : <PackageOpen className="h-5 w-5" />}{" "}
      {silme ? "Seçili çuvalları boşalt ve sil" : "Seçili çuvalları dağıt"}
    </>
  );
}

/** Ne olacağını açıkça söyler: silmede de toplar KAYBOLMAZ, depoya döner. */
function Aciklama({ silme }: { silme: boolean }) {
  if (silme) {
    return (
      <>
        Çuvalların <strong>içindeki toplar önce serbest depoya çıkar</strong>, sonra çuval kaydı{" "}
        <strong>silinir</strong>. Toplar kaybolmaz, geri okutulabilir.
      </>
    );
  }
  return (
    <>
      Çuvalların <strong>içindeki toplar serbest depoya</strong> çıkar. Çuval kaydı silinmez,
      toplar geri okutulabilir.
    </>
  );
}

export function BulkDistributeSacksDialog({
  sackIds,
  onOpenChange,
  onDone,
  mod = "dagit",
}: {
  sackIds: string[] | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
  /**
   * `dagit` = içerik depoya çıkar, ÇUVAL KAYDI KALIR.
   * `sil`   = önce dağıtır, SONRA çuval kaydını siler (2026-09-07 saha isteği:
   *           "dağıt tuşu olsa bile sil tuşu aktif olsun, önce dağıttırıp sonra
   *           sildiririz, bunu yaparken de teyit ettir").
   * Önizleme ve engel listesi İKİSİNDE DE aynı uçtan gelir — sevkiyata atanmış
   * çuval ikisinde de yapılamaz ve sebebiyle gösterilir.
   */
  mod?: "dagit" | "sil";
}) {
  const silme = mod === "sil";
  const qc = useQueryClient();
  const open = !!sackIds && sackIds.length > 0;
  const [acik, setAcik] = useState<Set<string>>(new Set());

  const onizleme = useQuery({
    queryKey: ["sack-bulk-distribute-preview", sackIds],
    queryFn: () => sackHubService.previewDistributeSacks(sackIds ?? []),
    enabled: open,
    staleTime: 0,
  });
  const veri = onizleme.data?.data;
  const uygun = useMemo(() => (veri?.sacks ?? []).filter((s) => !s.engel), [veri]);
  const engelli = useMemo(() => (veri?.sacks ?? []).filter((s) => s.engel), [veri]);

  const mut = useMutation({
    // SİLME YOLU: toplu dağıtma ucu çuvalı SİLMEZ; silme tek-çuval ucundan
    // (`removeSack(id, withContents)`) geçer ve o uç zaten "boşalt + sil"
    // yapar. Sıralı koşulur — tek tx'e sokmak için yeni bir toplu uç yazmak
    // gerekirdi ve bu ekranın hacmi (≤200 çuval) onu hak etmiyor.
    mutationFn: () => topluCalistir(silme, uygun, engelli),
    onSuccess: (res) => {
      sonucToast(res);
      invalidateSackHub(qc);
      onOpenChange(false);
      onDone?.();
    },
  });

  const yukleniyor = onizleme.isLoading;
  const toggle = (id: string) =>
    setAcik((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Baslik silme={silme} />
          </DialogTitle>
          <DialogDescription>
            <Aciklama silme={silme} />
          </DialogDescription>
        </DialogHeader>

        {yukleniyor ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <OnizlemeGovdesi veri={veri} uygun={uygun} engelli={engelli} acik={acik} toggle={toggle} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || yukleniyor || uygun.length === 0}
            className="gap-1.5"
            variant={silme ? "destructive" : "default"}
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {uygun.length} çuvalı {silme ? "boşalt ve sil" : "dağıt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Önizleme gövdesi — özet şeridi, açılabilir çuval satırları, engelli kutusu. */
function OnizlemeGovdesi({
  veri,
  uygun,
  engelli,
  acik,
  toggle,
}: {
  veri: BulkDistributePreview | undefined;
  uygun: BulkDistributePreview["sacks"];
  engelli: BulkDistributePreview["sacks"];
  acik: Set<string>;
  toggle: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <strong>{veri?.ozet.dagitilacak ?? 0}</strong> çuval dağıtılacak —{" "}
        <strong>{veri?.ozet.toplamTop ?? 0}</strong> top /{" "}
        <strong>{Math.round(veri?.ozet.toplamMetraj ?? 0)}</strong> m depoya çıkacak.
      </div>

      <div className="max-h-72 overflow-auto rounded-md border">
        {uygun.map((s) => (
          <div key={s.sackId} className="border-b last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
              onClick={() => toggle(s.sackId)}
            >
              {acik.has(s.sackId) ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <span className="font-medium">{s.sackNo}</span>
              <span className="text-muted-foreground">
                {s.customer?.name ? `· ${s.customer.name} ` : ""}· {s.rollCount} top ·{" "}
                {Math.round(s.totalMeters)} m
              </span>
            </button>
            {acik.has(s.sackId) && (
              <ul className="bg-muted/20 px-9 pb-2 text-xs text-muted-foreground">
                {s.rolls.map((r) => (
                  <li key={r.id} className="py-0.5">
                    {r.barcode ?? "—"}
                    {r.item ? ` · ${r.item}` : ""}
                    {r.color ? ` · ${r.color}` : ""} · {Math.round(r.meters)} m
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {uygun.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground">Dağıtılabilecek çuval yok.</div>
        )}
      </div>

      {engelli.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" /> {engelli.length} çuval dağıtılamaz
          </div>
          <ul className="space-y-0.5 text-xs">
            {engelli.map((s) => (
              <li key={s.sackId}>
                <strong>{s.sackNo}</strong> — {s.engel}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
