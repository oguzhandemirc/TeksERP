// Bölge/zarf şablon KODU → motor şablonu (dosyadaki tek kaynak); bilinmeyen kod undefined (aday/metre kaynağı yok).
import { loadTemplates, type DocumentTemplate } from "./motor";

let cache: Map<string, DocumentTemplate> | null = null;

export function templateByCode(code: string | null | undefined): DocumentTemplate | undefined {
  if (!code) return undefined;
  cache ??= new Map(loadTemplates().map((t) => [t.id, t]));
  return cache.get(code);
}
