import { useCallback, useState } from "react";
import { dataUrlOf, type DraftAttachment } from "./attachments";
import type { AnnotatedImage } from "./annotate/AnnotateDialog";
import type { AttachmentDrafts } from "./useAttachmentDrafts";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ekran yakalama köprüsü var mı (web panelinde yok). */
export function canCaptureScreen(): boolean {
  return typeof window !== "undefined" && typeof window.api?.screen?.capture === "function";
}

/**
 * Ek listesindeki görüntüyü düzenleme ve ekran görüntüsünü yeniden alma.
 * Yeniden alırken `capturing` true olur: çağıran kendi diyaloğunu gizler ki görüntüye girmesin.
 */
export function useScreenshotActions(drafts: AttachmentDrafts) {
  const [editing, setEditing] = useState<DraftAttachment | null>(null);
  const [capturing, setCapturing] = useState(false);

  const capture = useCallback(async () => {
    if (!canCaptureScreen()) return;
    setCapturing(true);
    try {
      // Diyaloğun kapanıp boyanması için iki kare + kısa bekleme.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await wait(150);
      const shot = await window.api.screen.capture();
      if (shot) {
        drafts.setScreenshot(shot.dataBase64);
        setEditing({ id: "", name: "ekran-goruntusu.png", contentType: "image/png", base64: shot.dataBase64, size: 0, source: "screenshot" });
      }
    } catch {
      /* yakalama düşerse form olduğu gibi kalır */
    } finally {
      setCapturing(false);
    }
  }, [drafts]);

  const saveEdit = useCallback(
    (img: AnnotatedImage) => {
      if (!editing) return;
      if (editing.id) drafts.replace(editing.id, img.base64);
      else drafts.setScreenshot(img.base64);
      setEditing(null);
    },
    [editing, drafts],
  );

  return {
    editing,
    editSource: editing ? dataUrlOf(editing) : null,
    startEdit: setEditing,
    cancelEdit: () => setEditing(null),
    saveEdit,
    capturing,
    capture: canCaptureScreen() ? capture : undefined,
  };
}
