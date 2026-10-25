// Analiz bloğunun plan + sorgu kabuğu (R3-ISTAT); şema dosyası satır tavanında olduğundan ayrı.
import { SEMANTIC_CUBES } from "./katalog";
import { planAnalysis, type AnalysisPlan } from "./analiz-plan";
import type { AnalysisBlock, BlockQuery } from "./rapor-tanimi.schema";
import type { SemanticCube } from "./tipler";

/** Analiz bloğunun semantik sorgu kabuğu: süzgeç/zaman başvuruları sorgu bloklarıyla AYNI yoldan çözülür. */
export function analysisQueryShell(b: AnalysisBlock, plan: AnalysisPlan): BlockQuery {
  const measures = plan.kind === "corr" ? [plan.xm.id, plan.ym.id] : [plan.count.id];
  const dims = plan.kind === "rate" ? [plan.x.id] : plan.kind === "table" ? [plan.x.id, plan.y.id] : [plan.group.id];
  return { kup: plan.cube.id, olculer: measures, boyutlar: dims, ...(b.suzgec ? { suzgec: b.suzgec } : {}), ...(b.zaman ? { zaman: b.zaman } : {}) };
}

/** Bloğun planı (süzgeç değerleri planı etkilemez; yalnız kimlikler). */
export function planAnalysisBlock(b: AnalysisBlock, cubes: readonly SemanticCube[] = SEMANTIC_CUBES) {
  return planAnalysis({ yontem: b.yontem, kup: b.kup, x: b.x, y: b.y, maruziyet: b.maruziyet, kirilim: b.kirilim, suzgec: [] }, cubes);
}
