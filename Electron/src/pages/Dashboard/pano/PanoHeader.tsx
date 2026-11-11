import type { ReactNode } from "react";
import { formatFactory } from "@/lib/factory-time";
import { useAuthStore } from "@/store/auth";
import { DonemSecici } from "./PanoYerlesim";
import type { PanoDonem } from "./types";

interface Props {
  donem: PanoDonem;
  onDonem: (d: PanoDonem) => void;
  /** Dönemli kutu yoksa (uç izni yok) seçici çizilmez. */
  donemGoster: boolean;
  eylem?: ReactNode;
}

/** Pano başlığı: ad + fabrika günü + selam; sağda TEK dönem seçici (bütün dönemli kutuları sürer). */
export function PanoHeader({ donem, onDonem, donemGoster, eylem }: Props) {
  const user = useAuthStore((s) => s.user);
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Anasayfa</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Hoş geldin{user?.username ? `, ${user.username}` : ""} · {formatFactory(new Date(), "d MMMM yyyy, EEEE")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {donemGoster && <DonemSecici donem={donem} onChange={onDonem} />}
        {eylem}
      </div>
    </header>
  );
}
