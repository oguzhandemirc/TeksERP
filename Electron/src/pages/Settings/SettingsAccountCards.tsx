import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { findCommandEntry } from "@/components/layout/command-entries";
import { useFavorites } from "@/hooks/useFavorites";
import { workstationEntryPath } from "@/pages/GeneralSettings/settings-config";
import { usePreferences } from "@/providers/PreferencesProvider";

const RESET_TEXT = "Tema, renk, yoğunluk, favoriler, sütun/menü düzeni ve kayıtlı görünümler varsayılana döner.";

export function FavoritesCard() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useFavorites();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Favoriler · {favorites.length}</CardTitle>
      </CardHeader>
      <CardContent>
        {favorites.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sayfa başlığındaki ⭐ ile ekle.</p>
        ) : (
          <ul className="space-y-0.5">
            {favorites.map((to) => {
              const entry = findCommandEntry(to);
              const Icon = entry?.icon;
              return (
                <li key={to} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
                  <button type="button" onClick={() => navigate(to)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
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
  );
}

/** "Bu Bilgisayar" kapısı — `settings:workstation` taşıyan personelin donanım ekranına tek yolu. */
export function WorkstationCard() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          Bu bilgisayar
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Yazıcı, kantar, barkod tabancası, sunucu adresi.</p>
        <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => navigate(workstationEntryPath())}>
          Aç
        </Button>
      </CardContent>
    </Card>
  );
}

export function ResetPreferencesCard() {
  const { prefs, resetPreferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const savedViewCount = Object.values(prefs.savedViews ?? {}).reduce((n, v) => n + v.length, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tercihleri yönet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" title="Görünümler ilgili tablonun “Görünümler” menüsünden yönetilir.">
          {savedViewCount} kayıtlı tablo görünümü
        </p>
        <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium" title={RESET_TEXT}>
            Tüm tercihleri sıfırla
          </p>
          <Button variant="destructive" size="sm" className="shrink-0 gap-2" onClick={() => setOpen(true)}>
            <RotateCcw className="h-4 w-4" />
            Sıfırla
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Tüm tercihleri sıfırla"
        description={`${RESET_TEXT} Devam edilsin mi?`}
        confirmLabel="Sıfırla"
        destructive
        onConfirm={async () => {
          resetPreferences();
          setOpen(false);
        }}
      />
    </Card>
  );
}
