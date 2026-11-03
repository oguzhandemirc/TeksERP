// K29 OKUTMAYLA ROTA — tablet tarafının SAF kararı (Kurşun/KK ve Tambur aynı modülü kullanır).
// Sunucu `by-card` 400 `SCAN_ROUTE_AVAILABLE` + `details.scanRoute` dönerse: uyarısız taşıma/ekleme sessiz uygulanır
// (bilgi tostu), yeniden işlem uyarısı ya da başka istasyonda açık iş onay ister, atlanamaz adım engeldir.

export interface ScanRouteView {
  kind: 'OPEN_EXISTING' | 'MOVE' | 'INSERT' | 'BLOCKED';
  workOrderId: string;
  stationId: string;
  stationName: string;
  targetStepId: string | null;
  skipped: Array<{ stepId: string; stationName: string }>;
  warnings: string[];
  block: null | { code: string; stepId: string; stationName: string; rollCount: number; message: string; closable: boolean };
  message: string;
}

export type ScanRoutePrompt =
  | { kind: 'SILENT'; toast: string }
  | { kind: 'CONFIRM'; title: string; body: string; confirmLabel: string; closeOpenStepId: string | null }
  | { kind: 'BLOCK'; title: string; body: string };

/** Hata gövdesinden okutmayla rota kararını çıkarır; başka hata → null (çağıranın bugünkü yolu). */
export function readScanRouteView(err: unknown): ScanRouteView | null {
  const d = (err as { details?: { code?: unknown; scanRoute?: unknown } } | null)?.details;
  if (!d || d.code !== 'SCAN_ROUTE_AVAILABLE' || !d.scanRoute || typeof d.scanRoute !== 'object') return null;
  const v = d.scanRoute as ScanRouteView;
  return typeof v.kind === 'string' ? v : null;
}

function skippedText(v: ScanRouteView): string {
  return v.skipped.length ? ` Atlandı: ${v.skipped.map((s) => s.stationName).join(', ')}.` : '';
}

export function decideScanRoutePrompt(v: ScanRouteView): ScanRoutePrompt {
  if (v.kind === 'BLOCKED' && v.block) {
    if (v.block.code === 'SCAN_ROUTE_OPEN_ELSEWHERE' && v.block.closable) {
      return {
        kind: 'CONFIRM',
        title: `"${v.block.stationName}" adımında iş sürüyor`,
        body: `${v.block.message} "${v.block.stationName}" bitmiş sayılırsa kumaş "${v.stationName}" istasyonuna geçer.`,
        confirmLabel: `"${v.block.stationName}" bitmiş say ve geç`,
        closeOpenStepId: v.block.stepId,
      };
    }
    return { kind: 'BLOCK', title: v.block.code === 'SCAN_ROUTE_MANDATORY_STEP' ? 'Bu adım atlanamaz' : 'Bu istasyona geçilemez', body: v.block.message };
  }
  if (v.warnings.length > 0) {
    return {
      kind: 'CONFIRM',
      title: 'Yeniden işlem',
      body: `${v.warnings.join(' ')}${skippedText(v)}`,
      confirmLabel: `"${v.stationName}" adımını ekle`,
      closeOpenStepId: null,
    };
  }
  const head = v.kind === 'INSERT' ? `"${v.stationName}" adımı iş emrine eklendi.` : `İş "${v.stationName}" adımına geçti.`;
  return { kind: 'SILENT', toast: `${head}${skippedText(v)}` };
}
