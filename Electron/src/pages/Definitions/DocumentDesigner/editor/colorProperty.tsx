import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "grapesjs";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import { COLOR_PROPERTY_TYPE } from "./styleSectors";

/**
 * Renk özelliği: GrapesJS'in yerleşik (Spectrum) seçicisi yerine panelin
 * `react-colorful` tabanlı `ColorPickerInput`ı — aynı görünüm, ikinci bir
 * renk kütüphanesi yok. Her özellik kendi küçük React köküne çizilir.
 */
interface Mounted {
  root: Root;
  render: (value: string) => void;
}

const mounted = new WeakMap<HTMLElement, Mounted>();

type UpdateStyle = (value: string, opts?: { partial?: boolean }) => void;

export function colorPropertyPlugin(editor: Editor): void {
  editor.StyleManager.addType(COLOR_PROPERTY_TYPE, {
    create({ el, updateStyle }: { el: HTMLElement; updateStyle: UpdateStyle }) {
      const host = document.createElement("div");
      host.className = "tekserp-color-prop";
      const root = createRoot(host);
      const render = (value: string) =>
        root.render(<ColorPickerInput value={value} onChange={(v) => updateStyle(v)} placeholder="#000000" />);
      render("");
      mounted.set(el, { root, render });
      return host;
    },
    update({ el, value }: { el: HTMLElement; value: string }) {
      mounted.get(el)?.render(value ?? "");
    },
    destroy({ el }: { el: HTMLElement }) {
      const m = mounted.get(el);
      // React kökü GrapesJS'in senkron yıkımı sırasında sökülemez — bir sonraki tura bırakılır.
      if (m) queueMicrotask(() => m.root.unmount());
      mounted.delete(el);
    },
  });
}
