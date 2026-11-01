// Liste sayfasına dosya bırakma: sürüklerken sayfa vurgulanır; bırakılan dosyalardan en az biri destekli türdeyse
// yükleme modalı o dosyalarla açılır (reddedilenlerin tek uyarısı modalda), hiçbiri değilse tek uyarı (toast).
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { dragHasFiles } from "./UploadDropZone";
import { splitAcceptedFiles } from "./uploadPrep";

export function usePageFileDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const active = (e: DragEvent) => enabled && dragHasFiles(e);
  const handlers = {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      if (!active(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!active(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      depth.current = 0;
      setOver(false);
      if (!active(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files ?? []);
      if (!files.length) return;
      const { accepted, notice } = splitAcceptedFiles(files);
      if (!accepted.length) {
        toast.warning(notice ?? "Desteklenmeyen dosya türü.");
        return;
      }
      onFiles(files);
    },
  };
  return { over, handlers };
}
