import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "@/lib/chart-theme";

interface LineDef {
  key: string;
  label: string;
  color?: string;
  /**
   * İKİNCİ EKSEN (opsiyonel). Farklı BİRİMDEKİ iki seriyi tek eksende çizmek
   * küçük olanı dibe yapıştırır: Sipariş Karnesi'nde metraj ~5500'e çıkarken
   * sipariş adedi 1–3 olduğu için adet çizgisi görünmez oluyordu (ölçüldü).
   * Farklı birimler → ayrı eksen, ERP/BI standardı.
   *
   * ⚠️ Hiçbir seri `"right"` demezse eksen kimliği HİÇ üretilmez — mevcut
   * çağıranların (Sevk & Termin karnesi) çıktısı birebir aynı kalır.
   */
  axis?: "left" | "right";
}

interface Props<T> {
  data: T[];
  xKey: string;
  lines: LineDef[];
  formatValue?: (v: number) => string;
  formatCategory?: (v: string) => string;
}

export function SimpleLineChart<T>({
  data,
  xKey,
  lines,
  formatValue,
  formatCategory,
}: Props<T>) {
  const valueFmt = formatValue ? (v: unknown) => formatValue(Number(v)) : undefined;
  const catFmt = formatCategory ? (v: unknown) => formatCategory(String(v)) : undefined;
  const dual = lines.some((l) => l.axis === "right");

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey={xKey} tickFormatter={catFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
        <YAxis
          {...(dual ? { yAxisId: "left" } : {})}
          tickFormatter={valueFmt}
          fontSize={11}
          stroke="hsl(var(--muted-foreground))"
        />
        {dual && (
          // Sağ eksen SAYAÇ içindir — biçimlendirici uygulanmaz (metraj
          // biçimi adet sütununa yanlış birim yazardı).
          <YAxis
            yAxisId="right"
            orientation="right"
            fontSize={11}
            stroke="hsl(var(--muted-foreground))"
            allowDecimals={false}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
            borderRadius: 6,
          }}
          formatter={valueFmt}
          labelFormatter={catFmt}
        />
        {lines.map((l, idx) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.label}
            {...(dual ? { yAxisId: l.axis ?? "left" } : {})}
            stroke={l.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
