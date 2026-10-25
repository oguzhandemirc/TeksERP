import type { Editor } from "grapesjs";

/**
 * Kanvas iframe'inin sandbox'ı — kural "renderer'daki HER iframe sandbox taşır"
 * (belge-etiket.md). GrapesJS iframe'i kendisi yaratır; `frame:render` iframe
 * DOM'a girmeden ÖNCE tetiklenir, öznitelik ilk gezinmeden önce yerleşir.
 *
 * Ölçüm (2026-10-24, Chromium + grapesjs 0.23.8): `allow-same-origin` ile
 * seçim, üzerine gelme, metin düzenleme ve blok bırakma çalışır; kanvasa
 * enjekte edilen <script> ve `onerror` ÇALIŞMAZ (sandbox'sız iframe'de çalışıyordu).
 */
export const CANVAS_FRAME_SANDBOX = "allow-same-origin";

export const SANDBOX_FAILURE_MESSAGE =
  "Kanvas güvenlik ayarı (sandbox) uygulanamadı; tasarımcı güvenli olmadığı için durduruldu.";

interface FrameViewLike {
  readonly el: HTMLIFrameElement;
}

/** Eklenti: her kanvas çerçevesine sandbox koyar; yüklenen çerçevede yoksa FAIL-CLOSED. */
export function frameSandboxPlugin(onFailure: (message: string) => void) {
  return (editor: Editor): void => {
    editor.on("frame:render", (view: FrameViewLike) => {
      view.el.setAttribute("sandbox", CANVAS_FRAME_SANDBOX);
    });
    editor.on("canvas:frame:load", ({ el }: { el: HTMLIFrameElement }) => {
      if (el.getAttribute("sandbox") !== CANVAS_FRAME_SANDBOX) onFailure(SANDBOX_FAILURE_MESSAGE);
    });
  };
}
