import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnnotateCanvas } from "./AnnotateCanvas";
import { AnnotateToolbar } from "./AnnotateToolbar";
import { exportPng } from "./render";
import { useAnnotator } from "./useAnnotator";

export interface AnnotatedImage {
  base64: string;
  width: number;
  height: number;
}

interface Props {
  /** Düzenlenecek görüntü (data URL). `null` iken diyalog kapalıdır. */
  source: string | null;
  onClose: () => void;
  onSave: (image: AnnotatedImage) => void;
}

function useLoadedImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!src) return;
    let alive = true;
    const el = new Image();
    el.onload = () => alive && setImg(el);
    el.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return img;
}

export function AnnotateDialog({ source, onClose, onSave }: Props) {
  const image = useLoadedImage(source);
  return (
    <Dialog open={source !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] max-w-6xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Ekran görüntüsünü düzenle</DialogTitle>
          <DialogDescription>
            Sorunu okla ya da kutuyla gösterin. Paylaşmak istemediğiniz bilgileri "Karart" ile kapatın.
          </DialogDescription>
        </DialogHeader>
        {image ? (
          <Editor key={source ?? ""} image={image} onClose={onClose} onSave={onSave} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Görüntü yükleniyor…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Editor({ image, onClose, onSave }: { image: HTMLImageElement; onClose: () => void; onSave: (i: AnnotatedImage) => void }) {
  const size = useMemo(() => ({ width: image.naturalWidth, height: image.naturalHeight }), [image]);
  const a = useAnnotator(size);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const out = exportPng({ image, width: size.width, height: size.height, snapshot: a.snapshot });
    if (!out) {
      setError("Görüntü kaydedilemedi.");
      return;
    }
    onSave(out);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || a.text) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      a.undo();
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      a.redo();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={onKeyDown}>
      <AnnotateToolbar a={a} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-muted/40 p-2">
        <AnnotateCanvas image={image} annotator={a} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="button" onClick={save}>
          Kaydet
        </Button>
      </DialogFooter>
    </div>
  );
}
