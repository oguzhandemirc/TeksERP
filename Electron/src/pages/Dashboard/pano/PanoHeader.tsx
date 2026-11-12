import type { ReactNode } from "react";
import { Check, LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFactory } from "@/lib/factory-time";
import { useAuthStore } from "@/store/auth";
import { DonemSecici } from "./PanoYerlesim";
import type { PanoDonem } from "./types";

interface Props {
  donem: PanoDonem;
  onDonem: (d: PanoDonem) => void;
  /** Dönemli kutu yoksa seçici çizilmez. */
  donemGoster: boolean;
  eylem?: ReactNode;
  /** Düzenleme kipi denetimleri; verilmezse düzenleme düğmesi yok. */
  edit?: {
    editing: boolean;
    isDefault: boolean;
    onStart: () => void;
    onDone: () => void;
    onAdd: () => void;
    onReset: () => void;
  };
}

/** Pano başlığı: ad + fabrika günü + selam; sağda dönem seçici ve "Panoyu düzenle" (kipte: ekle · varsayılan · bitti). */
export function PanoHeader({ donem, onDonem, donemGoster, eylem, edit }: Props) {
  const user = useAuthStore((s) => s.user);
  const editing = edit?.editing ?? false;
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Anasayfa</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {editing ? "Kutuları sürükleyerek sırala, × ile çıkar, “Kutu ekle” ile yenisini ekle." : <>Hoş geldin{user?.username ? `, ${user.username}` : ""} · {formatFactory(new Date(), "d MMMM yyyy, EEEE")}</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {editing && edit ? (
          <>
            <Button variant="outline" size="sm" onClick={edit.onReset} disabled={edit.isDefault}><RotateCcw className="h-4 w-4" aria-hidden />Varsayılana dön</Button>
            <Button variant="outline" size="sm" onClick={edit.onAdd}><Plus className="h-4 w-4" aria-hidden />Kutu ekle</Button>
            <Button size="sm" onClick={edit.onDone}><Check className="h-4 w-4" aria-hidden />Bitti</Button>
          </>
        ) : (
          <>
            {donemGoster && <DonemSecici donem={donem} onChange={onDonem} />}
            {eylem}
            {edit && <Button variant="outline" size="sm" onClick={edit.onStart}><LayoutGrid className="h-4 w-4" aria-hidden />Panoyu düzenle</Button>}
          </>
        )}
      </div>
    </header>
  );
}
