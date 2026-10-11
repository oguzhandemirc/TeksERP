// "TV kipi" düğmesi: küçük menü — bu pencerede (onaylı) ya da AYRI pencerede (Electron; birden
// çok ekran varsa her ekran ayrı satır, ikinci ekran önerilir). Son seçim işaretlenir (`tv-prefs`).
import { useState } from "react";
import { ChevronDown, Monitor, MonitorUp, Tv } from "lucide-react";
import { toast } from "sonner";
import type { TvDisplayInfo } from "@shared/tv-window";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openTezgahTvWindow } from "./tv-entry";
import { readTvPref, tvWindowApi, windowChoicesOf } from "./tv-prefs";

interface Props {
  onOpenHere: () => void;
  tvUrl: string | null;
}

export function TvLaunchMenu({ onOpenHere, tvUrl }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [displays, setDisplays] = useState<TvDisplayInfo[] | null>(null);
  const api = tvWindowApi();
  const pref = readTvPref();
  const where = tvUrl ? ` Salon TV'sinin tarayıcısında bu adresi açın: ${tvUrl}` : "";
  const loadDisplays = (open: boolean) => {
    if (open && api) void api.displays().then(setDisplays, () => setDisplays([]));
  };
  const openWindow = async (displayId: number | null) => {
    const res = await openTezgahTvWindow(displayId);
    if (!res.ok) toast.error(`TV penceresi açılamadı: ${res.reason}`);
    else if (res.reused) toast.info("TV penceresi zaten açık — öne getirildi.");
  };
  const lastWindow = (id: number | null) => pref.kip === "ayri" && (id === null || pref.ekranId === id);
  return (
    <>
      <DropdownMenu onOpenChange={loadDisplays}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Tv className="mr-1.5 h-4 w-4" />
            TV kipi
            <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[17rem]">
          <DropdownMenuLabel>Salon TV'si</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setConfirm(true)}>
            <Monitor className="mr-2 h-4 w-4" />
            Bu pencerede TV kipi
            {pref.kip === "ayni" && <span className="ml-auto pl-3 text-xs text-muted-foreground">son seçim</span>}
          </DropdownMenuItem>
          {api && <DropdownMenuSeparator />}
          {api &&
            windowChoicesOf(displays ?? []).map((c) => (
              <DropdownMenuItem key={c.displayId ?? "auto"} onSelect={() => void openWindow(c.displayId)}>
                <MonitorUp className="mr-2 h-4 w-4" />
                <span className="min-w-0 flex-1">{c.label}</span>
                {c.suggested && <span className="pl-3 text-xs font-semibold text-primary">önerilen</span>}
                {lastWindow(c.displayId) && <span className="pl-3 text-xs text-muted-foreground">son seçim</span>}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Bu pencere TV kipine geçsin mi?"
        description={`TV kipinde menü ve düğme yoktur; ekran kendini tazeler. Çıkmak için Esc'ye basın ya da fareyi oynatınca köşede beliren "TV kipinden çık" düğmesine tıklayın.${api ? " Bu pencerede çalışmaya devam etmek istiyorsanız menüden ayrı pencereyi seçin." : ""}${where}`}
        confirmLabel="TV kipine geç"
        onConfirm={() => {
          setConfirm(false);
          onOpenHere();
        }}
      />
    </>
  );
}
