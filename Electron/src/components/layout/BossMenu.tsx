import { useState } from "react";
import { Home, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { buildBossMenu } from "@/lib/boss-menu";
import { BOSS_PATH } from "@/lib/boss-path";

/**
 * ÖZET GÖRÜNÜMÜNÜN MENÜSÜ — Operasyonlar + Raporlar, başka hiçbir şey.
 *
 * ⚠️ ÇEKMECE, SIDEBAR DEĞİL. `AppShell`in sabit sidebar'ı + sekme şeridi
 * telefonda ekranın üçte birini yer (BossShell'in var oluş sebebi tam olarak
 * bu). Menü bir dokunuşla açılıp seçimden sonra KAPANIR; kalıcı yer kaplamaz.
 *
 * ⚠️ LİSTE BURADA YAZILMAZ. `buildBossMenu` karo kataloglarından türetir —
 * yarın eklenen bir operasyon karosu bu ekranda kendiliğinden belirir. Elle
 * yazılmış bir menü ilk yeni ekranda bayatlardı ve kimse fark etmezdi.
 */
export function BossMenu({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const { hasPermission, hasAnyPermission, isAdmin } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const sections = buildBossMenu({ hasPermission, hasAnyPermission, isAdmin, ctx });

  const go = (to: string): void => {
    setOpen(false);
    onNavigate(to);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Menü"
      >
        <Menu className="h-4 w-4" />
      </Button>
      <SheetContent side="left" className="flex w-[85vw] flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-left">
          <SheetTitle className="text-sm">Menü</SheetTitle>
        </SheetHeader>
        {/* ⚠️ Liste KAYAR, başlık sabit: fabrika karo ekledikçe alt satırlar
            ekran dışına taşar ve kırpılan taraf hep EN ALT olur (2026-08-26
            sebep adımı dersi — orada "Kaydet" düğmesi görünmez olmuştu). */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <button
            type="button"
            onClick={() => go(BOSS_PATH)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-accent"
          >
            <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">Fabrika Özeti</span>
          </button>

          {sections.map((section) => (
            <div key={section.key} className="mt-3">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </p>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => go(item.to)}
                  className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-accent"
                >
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}

          {sections.length === 0 && (
            // Boş liste bir YALAN olmasın: yetkisiz kullanıcı "menü bozuk" değil
            // sebebi yazan bir cümle görür (BossPage'in `denied` deseni).
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Görüntüleyebileceğiniz operasyon veya rapor ekranı yok.
            </p>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
