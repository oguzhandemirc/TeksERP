// Yükleme modalının bırakma alanı: dosya sürüklenince vurgulanır, bırakılan dosyalar `onFiles`a gider
// (tür süzgeci `useUploadForm.pick`te — seçiciyle aynı yol). İçindeki "Dosya seç" düğmesi seçiciyi açar.
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sürüklenen veri dosya mı (metin/bağlantı sürüklemesi alanı vurgulamaz). */
export const dragHasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");

interface Props {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

export function UploadDropZone({ disabled, onFiles, children }: Props) {
  const [over, setOver] = useState(false);
  // dragenter/leave alt öğelerde de ateşlenir; sayaç sıfıra inince vurgu kalkar (titreme yok).
  const depth = useRef(0);
  const reset = () => {
    depth.current = 0;
    setOver(false);
  };
  return (
    <div
      data-testid="upload-drop-zone"
      data-active={over ? "true" : "false"}
      className={cn(
        "flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-3 py-5 text-center text-sm text-muted-foreground transition-colors",
        over ? "border-primary bg-primary/10 text-foreground" : "border-muted-foreground/30",
      )}
      onDragEnter={(e) => {
        if (disabled || !dragHasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        reset();
        if (disabled) return;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onFiles(files);
      }}
    >
      <p>{over ? "Bırakın — dosyalar listeye eklenir" : "Dosyaları buraya sürükleyip bırakın ya da"}</p>
      {children}
      <p className="text-xs">JPEG · PNG · HEIC (iPhone) · PDF</p>
    </div>
  );
}
