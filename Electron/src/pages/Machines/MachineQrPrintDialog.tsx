import { useRef, useState } from "react";
import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { printDocumentArea } from "@/lib/print";
import type { Machine } from "./types";

/**
 * Makine QR etiketi — yazdırılıp makinenin üzerine yapıştırılır. Operatör
 * rotasyonda bu QR'ı okutarak makineye ÇALIŞMA OTURUMU açar (mobil yer onayı:
 * tek okutma = istasyon + makine + ekran). İçerik ham `machine.code` (MAK-...,
 * @unique) — yeni barkod prefix'i/formatı gerekmez; yalnız mobil KAMERA
 * akışında okutulur (Electron el-tarayıcı bu akışta kullanılmaz).
 */
export function MachineQrPrintDialog({
  machine,
  onOpenChange,
}: {
  machine: Machine | null;
  onOpenChange: (open: boolean) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={!!machine} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Makine QR Etiketi</DialogTitle>
          <DialogDescription>
            Yazdırıp makinenin üzerine yapıştırın. Operatör başka makineye geçerken
            bu QR'ı okutur — istasyon + makine + ekran tek okutmayla çözülür.
          </DialogDescription>
        </DialogHeader>
        <div
          ref={areaRef}
          className="print-area mx-auto flex w-full max-w-[280px] flex-col items-center gap-2 rounded-md border bg-white p-6 text-center text-black"
        >
          <QRCodeSVG value={machine?.code ?? ""} size={180} level="M" />
          <div className="text-lg font-bold leading-tight">{machine?.name}</div>
          {machine?.station?.name && <div className="text-sm">{machine.station.name}</div>}
          <div className="font-mono text-xs">{machine?.code}</div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" onClick={() => printDocumentArea(areaRef.current)}>
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tablo hücresi / satır aksiyonu — kendi dialog state'ini yönetir. */
export function MachineQrCell({ machine }: { machine: Machine }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
        title="Makine QR etiketi (oturum açma)"
      >
        <QrCode className="h-3.5 w-3.5" /> QR
      </Button>
      <MachineQrPrintDialog machine={open ? machine : null} onOpenChange={(o) => setOpen(o)} />
    </>
  );
}
