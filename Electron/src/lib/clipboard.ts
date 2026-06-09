/** Pano yardımcıları — sağ-tık kopyala menüsü (CopyContextMenu) ve tablo satır
 *  menüsü (DataTable) paylaşır. */

/** Seçili metin — input/textarea içi seçim window.getSelection'a düşmez. */
export function getSelectedText(target: EventTarget | null): string {
  const el = target as HTMLElement | null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart != null && selectionEnd != null && selectionEnd > selectionStart) {
      return value.slice(selectionStart, selectionEnd);
    }
  }
  return window.getSelection()?.toString() ?? "";
}

/** Metni panoya yazar; pano API'si erişilemezse görünmez textarea + execCommand. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* yut */
    }
    document.body.removeChild(ta);
  }
}
