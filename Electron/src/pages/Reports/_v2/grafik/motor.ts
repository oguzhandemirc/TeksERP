// ECharts çekirdeği + yalnız kullanılan grafik/bileşenler (ağaç sallama). Bu modül
// YALNIZ `await import("./motor")` ile yüklenir ([KU-17]; ölçüldü 2026-10-24: ~656 KB küçültülmüş / ~224 KB gzip, ayrı parça):
// statik import eden dosya onu panel açılış paketine çeker.
import * as echarts from "echarts/core";
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  ScatterChart,
  BoxplotChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
  SVGRenderer,
]);

export { echarts };
