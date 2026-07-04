import { Plus, Pencil, QrCode, PowerOff, Power, Trash2, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Machine } from "@/pages/Machines/types";

interface Props {
  machines: Machine[];
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (m: Machine) => void;
  onQr: (m: Machine) => void;
  onDeactivate: (m: Machine) => void;
  onReactivate: (m: Machine) => void;
  onDelete: (m: Machine) => void;
}

// İstasyon kartı içindeki makine tablosunun "İşlemler" sütununda kullanılan
// küçük ikon-buton. Tıklama alanı 28px — chip'lerdeki minik ikonlardan büyük.
function IconAction({
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

/**
 * Bir istasyonun makinelerini tablo olarak gösterir (Makine · Durum · İşlemler).
 * Tüm mutation/dialog state'i üst sayfada; bu bileşen yalnız görünüm + callback.
 */
export function StationMachineTable({
  machines,
  canWrite,
  onAdd,
  onEdit,
  onQr,
  onDeactivate,
  onReactivate,
  onDelete,
}: Props) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b border-sky-200/70 bg-sky-50 px-3 py-2 dark:border-sky-900/40 dark:bg-sky-950/30">
        <span className="flex items-center gap-1.5 text-sm font-bold text-sky-900 dark:text-sky-200">
          <HardDrive className="h-4 w-4" /> Makineler
        </span>
        {canWrite && (
          <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" /> Makine ekle
          </Button>
        )}
      </div>

      {machines.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground">Bu istasyonda makine yok.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">Makine</TableHead>
              <TableHead className="h-8 w-28">Durum</TableHead>
              <TableHead className="h-8 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {machines.map((m) => {
              const active = m.isActive !== false;
              return (
                <TableRow key={m.id} className={active ? undefined : "opacity-60"}>
                  <TableCell className="py-1.5">
                    <button
                      type="button"
                      disabled={!canWrite}
                      className="text-left font-medium hover:underline disabled:cursor-default disabled:no-underline"
                      onClick={() => canWrite && onEdit(m)}
                      title={canWrite ? "Düzenle" : undefined}
                    >
                      {m.name}
                    </button>
                  </TableCell>
                  <TableCell className="py-1.5">
                    {active ? (
                      <Badge variant="secondary" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Aktif
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                        Pasif
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center justify-end gap-0.5">
                      {canWrite && (
                        <IconAction title="Düzenle" onClick={() => onEdit(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconAction>
                      )}
                      {active && (
                        <IconAction title="Makine QR etiketi (oturum açma)" onClick={() => onQr(m)}>
                          <QrCode className="h-3.5 w-3.5" />
                        </IconAction>
                      )}
                      {canWrite && active && (
                        <IconAction
                          title="Pasife al (geri alınabilir)"
                          className="hover:bg-amber-500/10 hover:text-amber-600"
                          onClick={() => onDeactivate(m)}
                        >
                          <PowerOff className="h-3.5 w-3.5" />
                        </IconAction>
                      )}
                      {canWrite && !active && (
                        <IconAction
                          title="Aktifleştir"
                          className="text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                          onClick={() => onReactivate(m)}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </IconAction>
                      )}
                      {canWrite && (
                        <IconAction
                          title="Kalıcı sil"
                          className="hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(m)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconAction>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
