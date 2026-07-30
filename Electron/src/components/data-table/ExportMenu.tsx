import { useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText, ChevronDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * "İndir ▾" → format seçimi (PDF / Excel, opsiyonel Yazdır). Seçilen aksiyonun
 * callback'ini çağırır; İKİSİNİ BİRDEN indirmez (kullanıcı her seferinde seçer).
 * Callback async olabilir; çalışırken buton "İndiriliyor…" ve pasif olur.
 */
export function ExportMenu({
  label = "İndir",
  onPrint,
  onPdf,
  onExcel,
  disabled,
  size = "sm",
  variant = "outline",
  align = "end",
  busyLabel,
  icon,
  title,
  footer,
}: {
  label?: string;
  /** Verilirse listenin BAŞINA "Yazdır" maddesi eklenir (kağıt çıktı). */
  onPrint?: () => unknown;
  onPdf: () => unknown;
  onExcel: () => unknown;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  align?: "start" | "end";
  /** Çalışırken "İndiriliyor…" yerine gösterilecek metin (ör. "12.500 / ~30.000").
   *  Büyük "tümünü indir"de ilerleme için — çağıran reaktif olarak günceller. */
  busyLabel?: string;
  /** Tetikleyici ikonu (varsayılan indirme oku) — aynı çubuktaki başka bir export
   *  menüsünden görsel olarak ayrışmak için. */
  icon?: ReactNode;
  /** Tetikleyici tooltip'i — iki export menüsü yan yanaysa hangisinin ne indirdiğini
   *  söyler (etiketler kısa olmak zorunda). */
  title?: string;
  /** Aksiyonların ALTINA ayraçla eklenen ek maddeler (ör. opt-in onay kutusu). */
  footer?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          className="gap-1.5"
          disabled={disabled || busy}
          title={title}
        >
          {icon ?? <Download className="h-4 w-4" />} {busy ? busyLabel ?? "İndiriliyor…" : label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {onPrint && (
          <DropdownMenuItem onSelect={() => void run(onPrint)} className="gap-2">
            <Printer className="h-4 w-4" /> Yazdır
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void run(onPdf)} className="gap-2">
          <FileText className="h-4 w-4 text-destructive" /> PDF{onPrint ? " indir" : ""}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run(onExcel)} className="gap-2">
          <FileSpreadsheet className="h-4 w-4 text-success" /> Excel{onPrint ? " indir" : ""}
        </DropdownMenuItem>
        {footer && (
          <>
            <DropdownMenuSeparator />
            {footer}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
