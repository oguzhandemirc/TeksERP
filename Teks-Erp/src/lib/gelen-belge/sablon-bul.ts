// Bölge/zarf şablon KODU → motor şablonu: dosya şablonları + kullanıcı şablonları (`u-…`, DB). Bilinmeyen kod undefined.
// Kullanıcı şablonu kümesi `setUserTemplates` ile yazılır (servis her yükleyişte/yazımda tazeler; backend TEK süreç).
import { loadTemplates, type DocumentTemplate } from "./motor";

let cache: Map<string, DocumentTemplate> | null = null;
let userCache: Map<string, DocumentTemplate> = new Map();

export function templateByCode(code: string | null | undefined): DocumentTemplate | undefined {
  if (!code) return undefined;
  cache ??= new Map(loadTemplates().map((t) => [t.id, t]));
  return cache.get(code) ?? userCache.get(code);
}

/** Aktif kullanıcı şablonlarının güncel kümesi (yalnız `gelen-belge-ozel-sablon.service` yazar). */
export function setUserTemplates(list: readonly DocumentTemplate[]): void {
  userCache = new Map(list.map((t) => [t.id, t]));
}
