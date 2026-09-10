import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { MoreVertical, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { SackTagsBulkMenu } from "./SackTagsBulkMenu";
import { fromDumpRows } from "./sackDump";
import { UNGROUPED_FILTER_VALUE, type PackingGroup } from "./types";

const fmtQty = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

/**
 * PAKETLEME GRUBU ŞERİDİ — çuval listesinin üstünde "P1 · P2 · Gruplanmamış" çipleri.
 *
 * ⚠️ NEDEN ŞERİT, NEDEN İÇ İÇE BLOK BAŞLIĞI DEĞİL: liste cursor'lu sayfalıdır.
 * Grupları listenin İÇİNDE blok başlığı olarak çizmek, ikinci sayfada grubun
 * yarısını bırakır ve "liste + cursor + özet şeridi TEK where'den doğar"
 * kuralını bozar. Çip listeyi SUNUCUDA süzer (`filter[packingGroupId]`), yani
 * seçilen grubun TAMAMI gelir — sayfalama da doğru çalışır.
 *
 * ⚠️ YALNIZ TEK CARİ SEÇİLİYKEN ÇİZİLİR: gruplar cariye özeldir, her carinin
 * kendi "P1"i vardır. Çok carili listede şerit iki farklı P1'i yan yana koyar
 * ve numara benzersizmiş yanılgısı üretirdi.
 */
export function PackingGroupBar({ customerId }: { customerId: string | null }) {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [duzenle, setDuzenle] = useState<PackingGroup | null>(null);
  const [izGrup, setIzGrup] = useState<PackingGroup | null>(null);

  const q = useQuery({
    queryKey: ["packing-groups", customerId],
    queryFn: () => sackHubService.listPackingGroups(customerId!),
    enabled: !!customerId,
  });
  const gruplar: PackingGroup[] = q.data?.data ?? [];

  const secili = searchParams.get("filter[packingGroupId]") ?? "";
  const sec = (deger: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (deger) next.set("filter[packingGroupId]", deger);
        else next.delete("filter[packingGroupId]");
        // Sayfa imleci ESKİ süzgece aitti — bırakılırsa yeni süzgeç yanlış
        // sayfadan devam eder (liste boş görünür).
        next.delete("cursor");
        return next;
      },
      { replace: true },
    );

  if (!customerId || gruplar.length === 0) return null;

  return (
    <>
      <div className="mx-4 mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Tags className="h-3.5 w-3.5" /> Gruplar:
        </span>

        <Button size="sm" variant={secili === "" ? "default" : "outline"} className="h-7" onClick={() => sec("")}>
          Tümü
        </Button>

        {gruplar.map((g) => (
          <GrupCipi
            key={g.id}
            grup={g}
            secili={secili === g.id}
            onSec={() => sec(g.id)}
            onDuzenle={() => setDuzenle(g)}
            onIz={() => setIzGrup(g)}
          />
        ))}

        <Button
          size="sm"
          variant={secili === UNGROUPED_FILTER_VALUE ? "default" : "outline"}
          className="h-7"
          onClick={() => sec(UNGROUPED_FILTER_VALUE)}
        >
          Gruplanmamış
        </Button>

        {/* GRUP DÖKÜMÜ — kapsamı SUNUCU çözer (`packingGroupId`), ekrandaki
            sayfa grubun tamamı olmayabilir. Yalnız bir grup seçiliyken anlamlı. */}
        {secili && secili !== UNGROUPED_FILTER_VALUE && (
          <SackContentDumpMenu
            label="Grup Dökümü"
            align="end"
            // Kâğıt kendini TARİHLER ve hangi gruba ait olduğunu YAZAR — grup
            // numarası boşalınca yeniden kullanıldığı için tek ayırt edici bu.
            scopeLabel={gruplar.find((g) => g.id === secili)?.name}
            load={async () => fromDumpRows((await sackHubService.contentDump([], secili)).data)}
            hasNotes
          />
        )}
      </div>

      {/* GRUBA İZ — kapsamı SUNUCU çözer (`packingGroupId`); ekrandaki sayfa
          grubun tamamı olmayabilir, yarım gruba iz bırakmak sessiz yanlış olurdu.
          Popover açık kalsın diye grup seçiliyken çizilir. */}
      {izGrup && (
        <div className="mx-4 mb-2">
          <SackTagsBulkMenu
            rows={[]}
            packingGroupId={izGrup.id}
            triggerLabel={`${izGrup.name} grubuna iz`}
            onDone={() => {
              setIzGrup(null);
              void qc.invalidateQueries({ queryKey: ["packing-groups"] });
            }}
          />
        </div>
      )}

      <GrupDuzenleDialog
        grup={duzenle}
        onOpenChange={(o) => !o && setDuzenle(null)}
        onDone={() => {
          invalidateSackHub(qc);
          void qc.invalidateQueries({ queryKey: ["packing-groups"] });
        }}
      />
    </>
  );
}

/**
 * Grup adı + notu. ⚠️ Adı ELLE değiştirmek sunucuda `seq`i DÜŞÜRÜR — numara
 * artık o grubu tarif etmiyor ve sayacı da ileri taşımamalı. Pencere bunu
 * cümleyle söyler, kullanıcı sürprizle karşılaşmasın.
 */
function GrupDuzenleDialog({
  grup,
  onOpenChange,
  onDone,
}: {
  grup: PackingGroup | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const open = grup !== null;
  const [ad, setAd] = useState("");
  const [not, setNot] = useState("");
  const [ilk, setIlk] = useState<string | null>(null);

  // Pencere her AÇILIŞTA o grubun güncel değerleriyle başlar.
  if (open && ilk !== grup.id) {
    setIlk(grup.id);
    setAd(grup.name);
    setNot(grup.note ?? "");
  }

  const mut = useMutation({
    mutationFn: () =>
      sackHubService.updatePackingGroup(grup!.id, {
        ...(ad.trim() && ad.trim() !== grup!.name ? { name: ad.trim() } : {}),
        note: not.trim() || null,
      }),
    onSuccess: (res) => {
      toast.success(`"${res.data.name}" güncellendi.`);
      onDone();
      onOpenChange(false);
    },
  });

  const adDegisti = !!grup && ad.trim() !== grup.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grubu düzenle</DialogTitle>
          <DialogDescription>
            Grup adı ve notu yalnız EKRANDA görünür — çuval etiketine ve irsaliyeye basılmaz.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pgd-ad">Ad</Label>
            <Input id="pgd-ad" value={ad} maxLength={64} onChange={(e) => setAd(e.target.value)} />
            {adDegisti && grup?.seq != null && (
              <p className="text-[11px] text-muted-foreground">
                Adı elle değiştirdiğinizde bu grup sıra numarasını bırakır ({grup.name}); sıradaki
                yeni grup o numarayı KULLANMAZ, sayaç bulunduğu yerden devam eder.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pgd-not">Not</Label>
            <Textarea
              id="pgd-not"
              value={not}
              maxLength={500}
              rows={3}
              placeholder="örn. cuma sabahı kapıdan alınacak"
              onChange={(e) => setNot(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tek grup çipi + menüsü. Ayrı bileşen: şerit fonksiyonu 80 satır sınırının
 *  altında kalsın (lint tavanı). */
function GrupCipi({
  grup,
  secili,
  onSec,
  onDuzenle,
  onIz,
}: {
  grup: PackingGroup;
  secili: boolean;
  onSec: () => void;
  onDuzenle: () => void;
  onIz: () => void;
}) {
  return (
    <div className="inline-flex items-center">
      <Button
        size="sm"
        variant={secili ? "default" : "outline"}
        className={cn("h-7 rounded-r-none", grup.note && "italic")}
        title={grup.note ?? undefined}
        onClick={onSec}
      >
        {grup.name}
        <span className="ml-1.5 text-[11px] opacity-70">
          {grup.sackCount} çuval · {fmtQty(grup.totalQty)} m
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 rounded-l-none border-l-0 px-1.5">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onDuzenle}>Adı / notu düzenle</DropdownMenuItem>
          <DropdownMenuItem onSelect={onIz}>Gruba iz bırak…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
