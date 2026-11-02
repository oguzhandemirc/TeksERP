// =============================================================================
// SİSTEM → MENÜ DÜZENİ (K19) — ekran başına menüde göster/gizle, hazır set (önizlemeli), Gelişmiş grubu.
// Gizleme yalnız MENÜDEN kaldırır (hub karosu · arama · tablet karosu); bağlantı/bildirimle ekran yine açılır.
// Yazım `updateMenuLayout` (admin:settings + ayar şifresi); gizlenemez ekranlar kilitli ve açıklamalı.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { screenCatalogService } from "@/services/screenCatalogService";
import { updateMenuLayout, type MenuLayoutView } from "@/services/menuLayoutService";
import { MENU_LAYOUT_QUERY_KEY, useMenuLayoutQuery } from "@/hooks/useMenuLayout";
import { groupScreens, presetPreview, sameKeySet } from "./menu-layout-tree";

type Preset = MenuLayoutView["presets"][number];

export function MenuLayoutPage() {
  const qc = useQueryClient();
  const layoutQ = useMenuLayoutQuery();
  const catalogQ = useQuery({ queryKey: ["admin-screens"], queryFn: () => screenCatalogService.list(), staleTime: 5 * 60 * 1000 });
  const server = layoutQ.data;

  // Taslak: sunucu değeri yüklenince başlar; "Kaydet"e kadar yazılmaz.
  const [draftHidden, setDraftHidden] = useState<Set<string> | null>(null);
  const [draftAdvanced, setDraftAdvanced] = useState<boolean | null>(null);
  const [pendingPreset, setPendingPreset] = useState<Preset | null>(null);
  const hidden = draftHidden ?? new Set(server?.hiddenScreens ?? []);
  const advanced = draftAdvanced ?? server?.advancedGroup ?? false;
  const unhideable = useMemo(() => new Map((server?.unhideable ?? []).map((u) => [u.key, u.reason])), [server]);
  const advancedSet = useMemo(() => new Set(server?.advancedScreens ?? []), [server]);
  const groups = useMemo(() => groupScreens(catalogQ.data?.data?.screens ?? []), [catalogQ.data]);

  const dirty = !!server && (!sameKeySet(hidden, server.hiddenScreens) || advanced !== server.advancedGroup);

  const mut = useMutation({
    mutationFn: () =>
      updateMenuLayout({
        ...(server && !sameKeySet(hidden, server.hiddenScreens) ? { hiddenScreens: [...hidden] } : {}),
        ...(server && advanced !== server.advancedGroup ? { advancedGroup: advanced } : {}),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(MENU_LAYOUT_QUERY_KEY, saved);
      setDraftHidden(null);
      setDraftAdvanced(null);
      toast.success("Menü düzeni kaydedildi.");
    },
    onError: (e) => toast.error(apiErrorText(e, "Menü düzeni kaydedilemedi.")),
  });

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraftHidden(next);
  };

  const preview = pendingPreset ? presetPreview(pendingPreset, hidden, new Set(unhideable.keys())) : [];
  const applyPreset = () => {
    const next = new Set(hidden);
    for (const s of preview) next.add(s.key);
    setDraftHidden(next);
    setPendingPreset(null);
  };

  if (layoutQ.isLoading || catalogQ.isLoading) return <Skeleton className="m-6 h-64" />;
  if (layoutQ.isError) return <div className="p-6 text-sm text-destructive">Menü düzeni okunamadı: {apiErrorText(layoutQ.error, "bilinmeyen hata")}</div>;
  if (catalogQ.isError) return <div className="p-6 text-sm text-destructive">Ekran listesi okunamadı: {apiErrorText(catalogQ.error, "bilinmeyen hata")}</div>;

  return (
    <PageShell>
      <PageHeader title="Menü Düzeni" />
      <PageBody className="space-y-6 p-6" data-testid="menu-layout-page">
        <Callout tone="info" title="Gizlemek kapatmak değildir">
          Gizlenen ekran menüden, aramadan ve tablet ana ekranından kalkar; bildirim ya da bağlantıyla yine açılır. Kimin
          neyi açabildiğini yetkiler belirler (Yetkilendirme).
        </Callout>

        <section className="flex flex-wrap items-center gap-3">
          {(server?.presets ?? []).map((p) => (
            <Button key={p.id} variant="outline" onClick={() => setPendingPreset(p)} data-testid={`menu-preset-${p.id}`}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Hazır set uygula: {p.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setDraftHidden(new Set())} disabled={hidden.size === 0} data-testid="menu-show-all">
            <Eye className="mr-1.5 h-4 w-4" /> Tümünü göster
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm" htmlFor="menu-advanced-group">
            <Switch id="menu-advanced-group" data-testid="menu-advanced-group" checked={advanced} onCheckedChange={setDraftAdvanced} />
            Teknik ekranları Gelişmiş grubunda topla
          </label>
        </section>

        <p className="text-sm text-muted-foreground" data-testid="menu-hidden-count">
          {hidden.size === 0 ? "Hiçbir ekran gizli değil (varsayılan)." : `${hidden.size} ekran menüden gizli.`}
        </p>

        {groups.map((g) => (
          <section key={g.id} data-testid={`menu-group-${g.id}`}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h2>
            <ul className="divide-y rounded-lg border">
              {g.screens.map((s) => {
                const lockReason = unhideable.get(s.key);
                const isHidden = hidden.has(s.key);
                return (
                  <li key={`${s.app}:${s.key}`} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`menu-row-${s.key}`}>
                    <span className={isHidden ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{s.title}</span>
                    {advanced && advancedSet.has(s.key) && <span className="text-xs text-muted-foreground">Gelişmiş grubunda</span>}
                    {lockReason ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground" title={lockReason}>
                        <Lock className="h-3.5 w-3.5" /> Gizlenemez — {lockReason}
                      </span>
                    ) : (
                      <Button size="sm" variant={isHidden ? "outline" : "ghost"} onClick={() => toggle(s.key)} aria-pressed={isHidden} data-testid={`menu-toggle-${s.key}`}>
                        {isHidden ? <><EyeOff className="mr-1 h-3.5 w-3.5" /> Gizli</> : <><Eye className="mr-1 h-3.5 w-3.5" /> Görünür</>}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3">
          <Button variant="ghost" disabled={!dirty || mut.isPending} onClick={() => { setDraftHidden(null); setDraftAdvanced(null); }}>
            Vazgeç
          </Button>
          <Button disabled={!dirty || mut.isPending} onClick={() => mut.mutate()} data-testid="menu-save">
            Kaydet
          </Button>
        </div>
      </PageBody>

      <Dialog open={pendingPreset !== null} onOpenChange={(o) => !o && setPendingPreset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>“{pendingPreset?.label}” seti uygulansın mı?</DialogTitle>
            <DialogDescription>
              Aşağıdaki ekranlar menüden gizlenecek (mevcut gizlenenler korunur). Veri silinmez, yetki değişmez; Kaydet'e
              basana kadar hiçbir şey yazılmaz.
            </DialogDescription>
          </DialogHeader>
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="menu-preset-empty">Bu setteki ekranların hepsi zaten gizli.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-auto text-sm" data-testid="menu-preset-preview">
              {preview.map((s) => (
                <li key={s.key} className="rounded border px-2 py-1">
                  <span className="font-medium">{s.title}</span>
                  <span className="ml-1 text-xs text-muted-foreground">({s.app === "mobile" ? "tablet" : "panel"})</span>
                  <div className="text-xs text-muted-foreground">{s.reason}</div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingPreset(null)}>Vazgeç</Button>
            <Button onClick={applyPreset} disabled={preview.length === 0} data-testid="menu-preset-confirm">
              Onayla ({preview.length} ekran)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
