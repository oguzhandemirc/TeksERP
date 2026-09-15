// =============================================================================
// Makine satırı İŞLEMLERİ — düzenle · QR · pasife al / aktifleştir · kalıcı sil (tek kaynak)
// =============================================================================
// Kart içindeki makine tablosu (`StationMachineTable`) ve liste görünümü (`StationListView`)
// aynı ikon-buton dizisini çizer; iki yerde yazılsaydı yeni aksiyon birinde unutulurdu.
// =============================================================================
import { Pencil, QrCode, PowerOff, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Machine } from "@/pages/Machines/types";

// "İşlemler" sütununda kullanılan küçük ikon-buton. Tıklama alanı 28px — chip'lerdeki
// minik ikonlardan büyük.
export function IconAction({
  title,
  onClick,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface MachineActionHandlers {
  onEdit: (m: Machine) => void;
  onQr: (m: Machine) => void;
  onDeactivate: (m: Machine) => void;
  onReactivate: (m: Machine) => void;
  onDelete: (m: Machine) => void;
}

export function MachineRowActions({ m, canWrite, h }: { m: Machine; canWrite: boolean; h: MachineActionHandlers }) {
  const active = m.isActive !== false;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {canWrite && (
        <IconAction title="Düzenle" onClick={() => h.onEdit(m)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconAction>
      )}
      {active && (
        <IconAction title="Makine QR etiketi (oturum açma)" onClick={() => h.onQr(m)}>
          <QrCode className="h-3.5 w-3.5" />
        </IconAction>
      )}
      {canWrite && active && (
        <IconAction
          title="Pasife al (geri alınabilir)"
          className="hover:bg-amber-500/10 hover:text-amber-600"
          onClick={() => h.onDeactivate(m)}
        >
          <PowerOff className="h-3.5 w-3.5" />
        </IconAction>
      )}
      {canWrite && !active && (
        <IconAction
          title="Aktifleştir"
          className="text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
          onClick={() => h.onReactivate(m)}
        >
          <Power className="h-3.5 w-3.5" />
        </IconAction>
      )}
      {canWrite && (
        <IconAction
          title="Kalıcı sil"
          className="hover:bg-destructive/10 hover:text-destructive"
          onClick={() => h.onDelete(m)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconAction>
      )}
    </div>
  );
}
