import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { AppearanceControls } from "@/components/layout/AppearanceControls";
import { findCommandEntry } from "@/components/layout/command-entries";
import { useFavorites } from "@/hooks/useFavorites";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  SETTINGS_ADMIN_PERMISSION,
  WORKSTATION_PERMISSION,
} from "@/pages/GeneralSettings/settings-config";
import { usePreferences } from "@/providers/PreferencesProvider";

export function SettingsPage() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useFavorites();
  const { prefs, resetPreferences } = usePreferences();
  const { hasAnyPermission } = useRoleAccess();
  const [resetOpen, setResetOpen] = useState(false);

  // "Bu Bilgisayar" (yerel donanım) ayarları Genel Ayarlar sayfasında yaşar ama
  // oraya götüren tek yol Sistem hub'ıydı ve o hub `admin:settings` ister →
  // `settings:workstation` taşıyan personelin ekrana ULAŞACAK bir kapısı olmazdı.
  // Herkesin topbar'dan girebildiği bu sayfa o kapı. (İzni verip yolu vermemek,
  // izni hiç vermemekle aynı şeydir.)
  const canOpenWorkstation = hasAnyPermission([
    SETTINGS_ADMIN_PERMISSION,
    WORKSTATION_PERMISSION,
  ]);

  const savedViewCount = Object.values(prefs.savedViews ?? {}).reduce((n, v) => n + v.length, 0);

  return (
    <PageShell>
      <PageHeader title="Ayarlar" />

      <PageBody className="grid gap-6 p-6 lg:grid-cols-2">
        <Card className="border-t-2 border-t-primary/50">
          <CardHeader>
            <CardTitle className="text-base">Görünüm</CardTitle>
            <CardDescription>Tema, vurgu rengi ve yoğunluk. Anında uygulanır, hesabına kaydedilir.</CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceControls />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Favoriler</CardTitle>
            <CardDescription>Sidebar'da sabitlenen sayfalar ({favorites.length}).</CardDescription>
          </CardHeader>
          <CardContent>
            {favorites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Henüz favori yok. Bir sayfanın başlığındaki ⭐ ile ekleyebilirsin.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {favorites.map((to) => {
                  const entry = findCommandEntry(to);
                  const Icon = entry?.icon;
                  return (
                    <li
                      key={to}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(to)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      >
                        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{entry?.label ?? to}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => toggleFavorite(to)}
                        title="Favorilerden çıkar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {canOpenWorkstation && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                Bu Bilgisayar
              </CardTitle>
              <CardDescription>
                Etiket yazıcısı, kantar, barkod tabancası ve sunucu adresi. Yalnız bu
                bilgisayarı etkiler — diğer kullanıcıların ekranları değişmez.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate("/system/settings?tab=system")}
              >
                <Monitor className="h-4 w-4" />
                Donanım Ayarlarını Aç
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tercihleri Yönet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {savedViewCount} kayıtlı tablo görünümü. Görünümleri ilgili tablonun “Görünümler” menüsünden
              yönetebilirsin.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Tüm tercihleri sıfırla</p>
                <p className="text-xs text-muted-foreground">
                  Tema, vurgu rengi, yoğunluk, favoriler, sütun/menü düzeni ve kayıtlı görünümler
                  varsayılana döner.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw className="h-4 w-4" />
                Sıfırla
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Tüm tercihleri sıfırla"
        description="Tema, vurgu rengi, yoğunluk, favoriler, sütun/menü düzeni ve kayıtlı görünümler varsayılana döndürülecek. Devam edilsin mi?"
        confirmLabel="Sıfırla"
        destructive
        onConfirm={async () => {
          resetPreferences();
          setResetOpen(false);
        }}
      />
    </PageShell>
  );
}
