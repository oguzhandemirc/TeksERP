import { useEffect, useRef, useState } from "react";
import { ekranTemasi, type GrafikTema } from "@/pages/Reports/_v2/grafik/tema";

/** Tema değişimini izler: koyu kip (`class`), hazır tema / özel renk (`data-preset`, `style`) — canvas CSS değişkenini kendisi izlemez. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const g = new MutationObserver(() => setVersion((s) => s + 1));
    g.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-preset", "style"] });
    return () => g.disconnect();
  }, []);
  return version;
}

interface Props {
  /** Saf seçenek kurucu — tema paleti `--chart-*` belirteçlerinden. */
  secenek: (tema: GrafikTema) => Record<string, unknown>;
  yukseklik: number;
  etiket: string;
}

/**
 * Pano grafiği — rapor grafiğiyle aynı ECharts motoru (`_v2/grafik/motor`, tembel yükleme; yeni Recharts yok).
 * Renkler sabit değil, belirteçten: tema rengi değişince pano da yeniden boyanır.
 */
export function PanoGrafik({ secenek, yukseklik, etiket }: Props) {
  const kap = useRef<HTMLDivElement>(null);
  const version = useThemeVersion();

  useEffect(() => {
    if (!kap.current) return;
    let iptal = false;
    let dispose: (() => void) | undefined;
    void import("@/pages/Reports/_v2/grafik/motor").then(({ echarts }) => {
      const el = kap.current;
      if (iptal || !el) return;
      const grafik = echarts.init(el, null, { renderer: "canvas" });
      grafik.setOption(secenek(ekranTemasi()));
      const gozlemci = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => grafik.resize());
      gozlemci?.observe(el);
      dispose = () => {
        gozlemci?.disconnect();
        grafik.dispose();
      };
    });
    return () => {
      iptal = true;
      dispose?.();
    };
  }, [secenek, version]);

  return <div ref={kap} role="img" aria-label={etiket} style={{ height: yukseklik, width: "100%" }} />;
}

/** `hsl(250, 72%, 58%)` → aynı renk, verilen saydamlıkla (alan dolgusu degradesi için). */
export function saydam(renk: string, alfa: number): string {
  const m = /^hsl\((.+)\)$/.exec(renk);
  return m ? `hsla(${m[1]}, ${alfa})` : renk;
}
