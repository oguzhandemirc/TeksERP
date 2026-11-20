import { useCallback, useState } from "react";
import { fileToDraft, screenFiles, screenshotDraft, type DraftAttachment } from "./attachments";

/** Formdaki ek listesi: dosya ekleme (doğrulamalı), çıkarma, ekran görüntüsünü değiştirme. */
export function useAttachmentDrafts() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      const { accepted, errors: rejected } = screenFiles(items.length, files);
      const errs = [...rejected];
      const drafts: DraftAttachment[] = [];
      for (const f of accepted) {
        try {
          drafts.push(await fileToDraft(f));
        } catch {
          errs.push(`${f.name}: dosya okunamadı.`);
        }
      }
      setErrors(errs);
      if (drafts.length > 0) setItems((cur) => [...cur, ...drafts].slice(0, 5));
    },
    [items.length],
  );

  /** Ekran görüntüsünü ekler ya da (varsa) yerine koyar — listede en çok bir tane ekran görüntüsü durur. */
  const setScreenshot = useCallback((base64: string) => {
    setItems((cur) => {
      const shot = screenshotDraft(base64);
      const idx = cur.findIndex((a) => a.source === "screenshot");
      if (idx < 0) return [shot, ...cur].slice(0, 5);
      const next = [...cur];
      next[idx] = shot;
      return next;
    });
  }, []);

  const replace = useCallback((id: string, base64: string) => {
    // Düzenlenen görsel PNG olarak çıkar: ad uzantısı da türle aynı olsun.
    const pngName = (n: string) => `${n.replace(/\.[^.]+$/, "")}.png`;
    setItems((cur) => cur.map((a) => (a.id === id ? { ...screenshotDraft(base64, pngName(a.name)), id: a.id, source: a.source } : a)));
  }, []);

  const remove = useCallback((id: string) => setItems((cur) => cur.filter((a) => a.id !== id)), []);

  const reset = useCallback((initialShot: string | null) => {
    setErrors([]);
    setItems(initialShot ? [screenshotDraft(initialShot)] : []);
  }, []);

  return { items, errors, addFiles, setScreenshot, replace, remove, reset, clearErrors: () => setErrors([]) };
}

export type AttachmentDrafts = ReturnType<typeof useAttachmentDrafts>;
