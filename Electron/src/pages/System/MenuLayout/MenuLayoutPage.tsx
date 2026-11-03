// =============================================================================
// SİSTEM → MENÜ DÜZENİ (K19) — ekran başına menüde göster/gizle, hazır set (önizlemeli), Gelişmiş grubu.
// Gizleme yalnız MENÜDEN kaldırır (hub karosu · arama · tablet karosu); bağlantı/bildirimle ekran yine açılır.
// Yazım `updateMenuLayout` (admin:settings + ayar şifresi); gizlenemez ekranlar kilitli ve açıklamalı.
// =============================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { apiErrorText } from "@/lib/api-error";
import { screenCatalogService } from "@/services/screenCatalogService";
import { useMenuLayoutQuery } from "@/hooks/useMenuLayout";
import { groupScreens } from "./menu-layout-tree";
import { useMenuLayoutDraft } from "./useMenuLayoutDraft";
import { MenuGroupSection, PresetPreviewDialog } from "./menu-layout-parts";

export function MenuLayoutPage() {
  const layoutQ = useMenuLayoutQuery();
  const catalogQ = useQuery({ queryKey: ["admin-screens"], queryFn: () => screenCatalogService.list(), staleTime: 5 * 60 * 1000 });
  const server = layoutQ.data;
  const d = useMenuLayoutDraft(server);
  const groups = useMemo(() => groupScreens(catalogQ.data?.data?.screens ?? []), [catalogQ.data]);

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
            <Button key={p.id} variant="outline" onClick={() => d.setPendingPreset(p)} data-testid={`menu-preset-${p.id}`}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Hazır set uygula: {p.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={d.showAll} disabled={d.hidden.size === 0} data-testid="menu-show-all">
            <Eye className="mr-1.5 h-4 w-4" /> Tümünü göster
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm" htmlFor="menu-advanced-group">
            <Switch id="menu-advanced-group" data-testid="menu-advanced-group" checked={d.advanced} onCheckedChange={d.setAdvanced} />
            Teknik ekranları Gelişmiş grubunda topla
          </label>
        </section>

        <p className="text-sm text-muted-foreground" data-testid="menu-hidden-count">
          {d.hidden.size === 0 ? "Hiçbir ekran gizli değil (varsayılan)." : `${d.hidden.size} ekran menüden gizli.`}
        </p>

        {groups.map((g) => (
          <MenuGroupSection key={g.id} group={g} hidden={d.hidden} unhideable={d.unhideable} advancedOn={d.advanced} advancedSet={d.advancedSet} onToggle={d.toggle} />
        ))}

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3">
          <Button variant="ghost" disabled={!d.dirty || d.save.isPending} onClick={d.reset}>Vazgeç</Button>
          <Button disabled={!d.dirty || d.save.isPending} onClick={() => d.save.mutate()} data-testid="menu-save">Kaydet</Button>
        </div>
      </PageBody>

      <PresetPreviewDialog preset={d.pendingPreset} preview={d.preview} onCancel={() => d.setPendingPreset(null)} onConfirm={d.applyPreset} />
    </PageShell>
  );
}
