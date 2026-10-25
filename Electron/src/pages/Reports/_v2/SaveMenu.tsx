import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onlyDateKeys, presetApi, presetParamsFromSearch, searchFromPreset, useReportPresets } from "./preset-api";

interface Props {
  reportKey: string;
}

/**
 * Kaydet menüsü: ön ayar = bugünkü seçimler (tarih, kırılım, dönem kıyası, süzgeçler). Ön ayarı uygulamak
 * raporu CANLI yeniden çalıştırır ("yeni hâlini al"); anlık görüntü sistem raporunda yok.
 */
export function SaveMenu({ reportKey }: Props) {
  const [search, setSearch] = useSearchParams();
  const { definitionId, definitionLoading, presets } = useReportPresets(reportKey);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Varsayılan ön ayar yalnız sayfa "boş" açıldığında (URL'de tarihten başka seçim yok) ve bir kez uygulanır;
  // paylaşılan bağlantının seçimini ezmesin.
  const appliedDefault = useRef(false);
  const preferred = presets.find((p) => p.varsayilan && p.benim) ?? null;
  useEffect(() => {
    if (appliedDefault.current || !preferred) return;
    appliedDefault.current = true;
    if (onlyDateKeys(search)) setSearch(searchFromPreset(preferred.parametreler, search), { replace: true });
  }, [preferred, search, setSearch]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={definitionLoading} aria-label="Kaydet">
            <Bookmark className="h-4 w-4" /> <span className="hidden lg:inline">Kaydet</span> <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuItem disabled={!definitionId} onSelect={() => setDialogOpen(true)}>
            Ön ayar olarak kaydet…
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
            <span>Kopyasını özel rapor yap</span>
            <span className="text-xs text-muted-foreground">Rapor oluşturucu bu raporu kopyalamayı henüz desteklemiyor.</span>
          </DropdownMenuItem>
          {!definitionId && !definitionLoading ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Bu rapor için ön ayar kaydı açılmamış.</p>
          ) : null}
          {presets.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Ön ayarlar — seçince güncel veriyle açılır</DropdownMenuLabel>
              {presets.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setSearch(searchFromPreset(p.parametreler, search), { replace: false })} className="flex justify-between gap-2">
                  <span className="truncate">{p.ad}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[p.varsayilan ? "varsayılan" : null, p.paylasimli ? (p.benim ? "paylaşımlı" : p.sahip) : null].filter(Boolean).join(" · ")}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {definitionId && dialogOpen ? (
        <SavePresetDialog definitionId={definitionId} params={presetParamsFromSearch(search)} onClose={() => setDialogOpen(false)} />
      ) : null}
    </>
  );
}

function SavePresetDialog({ definitionId, params, onClose }: { definitionId: string; params: Record<string, string>; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await presetApi.create(definitionId, { ad: name.trim(), parametreler: params, paylasimli: shared, varsayilan: isDefault });
      await qc.invalidateQueries({ queryKey: ["report-presets", definitionId] });
      toast.success("Ön ayar kaydedildi.");
      onClose();
    } catch {
      // Hata metni genel istemci toast'ında (Türkçe sunucu mesajı); diyalog açık kalır, yeniden denenebilir.
    } finally {
      setBusy(false);
    }
  };
  const count = Object.keys(params).length;
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ön ayar olarak kaydet</DialogTitle>
          <DialogDescription>Bugünkü seçimler ({count} ayar) kaydedilir; veri kaydedilmez, ön ayar her açılışta güncel veriyle çalışır.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-name">Ad</Label>
            <Input id="preset-name" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Kaya Tekstil — son 6 ay" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} /> Herkesle paylaş
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} /> Bu raporu açınca varsayılan olsun
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="button" disabled={busy || name.trim().length === 0} onClick={() => void save()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
