import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { GRAFIK_VERI_YOK, grafikBosMu, grafikSecenek, type Egilim } from "./secenek";
import { ekranTemasi } from "./tema";
import type { GrafikBlok } from "../sunum";

interface Props {
  blok: GrafikBlok;
  /** Piksel yükseklik; genişlik kabı doldurur. */
  yukseklik?: number;
  /** Ekran okuyucu için grafik adı. */
  baslik?: string;
  /** Saçılımda sunucunun eğilim çizgisi (R3-ANALIZ). */
  egilim?: Egilim | null;
}

/**
 * Rapor grafiğinin TEK ekran bileşeni (ECharts, canvas). Motor ilk çizimde tembel
 * yüklenir ([KU-17]); kap boyutu değişince yeniden ölçeklenir; tema değişince yeniden
 * çizilir (canvas CSS değişkenini kendisi izlemez).
 */
export function RaporGrafik({ blok, yukseklik = 280, baslik, egilim }: Props) {
  const kap = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const bos = grafikBosMu(blok);

  useEffect(() => {
    if (bos || !kap.current) return;
    let iptal = false;
    let dispose: (() => void) | undefined;
    void import("./motor").then(({ echarts }) => {
      const el = kap.current;
      if (iptal || !el) return;
      const grafik = echarts.init(el, null, { renderer: "canvas" });
      grafik.setOption(grafikSecenek(blok, ekranTemasi(), { egilim }));
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
  }, [blok, bos, resolvedTheme, egilim]);

  if (bos) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: yukseklik }}>
        {GRAFIK_VERI_YOK}
      </div>
    );
  }
  return <div ref={kap} role="img" aria-label={baslik ?? blok.eksen.y.ad} style={{ height: yukseklik, width: "100%" }} />;
}
