// =============================================================================
// ETKİN YAPI istemci servisi (Seyitoğlu SY-A4) — atkı kartı · desen kartı seçici adaptörleri + etkin yapı okuması
// =============================================================================
// `/api/weft-specs` ve `/api/weave-designs` düz liste döner (cursor yok); `EntityPickerModal` yalnız
// `listCursor` + `getById` çağırır → tek sayfalık adaptör. Üç uç da `requireDokumaEnabled` + `warpspec:read`
// arkasında: çağıran bileşen modül + izin yoksa sorguyu hiç atmaz (koşulsuz 403 yok).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { CrudService } from "@/services/crudService";
import type { ApiResponse, CursorParams, CursorPaginatedResponse } from "@/types/api";

export interface WeftSpecRef {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface WeaveDesignRef {
  id: string;
  code: string;
  name: string;
  kind: string;
  isActive: boolean;
}

function plainListPicker<T>(base: string): CrudService<T> {
  const adapter = {
    listCursor: (p: CursorParams): Promise<CursorPaginatedResponse<T>> => {
      const sp = new URLSearchParams();
      if (p.search) sp.set("search", p.search);
      const qs = sp.toString();
      return apiClient.get<ApiResponse<T[]>>(qs ? `${base}?${qs}` : base).then((r) => {
        const data = r.data.data ?? [];
        return { success: true, data, pagination: { nextCursor: null, hasMore: false, limit: data.length } };
      });
    },
    getById: (id: string) => apiClient.get<ApiResponse<T>>(`${base}/${id}`).then((r) => r.data),
  };
  return adapter as unknown as CrudService<T>;
}

export const weftSpecPickerService = plainListPicker<WeftSpecRef>("/api/weft-specs");
export const weaveDesignPickerService = plainListPicker<WeaveDesignRef>("/api/weave-designs");

interface YarnRef {
  id: string;
  code: string;
  name: string;
}

/** `GET /api/item-construction/:itemId` — sunucunun `EffectiveConstruction`ının panelin okuduğu kısmı. */
export interface EffectiveConstruction {
  itemId: string;
  recipeId: string | null;
  variantCode: string | null;
  groundWarp: { id: string; code: string; name: string } | null;
  warpLayers: Array<{ role: string; beamMode: string; sortOrder: number; warpSpec: { id: string; code: string; name: string } }>;
  weft: {
    weftSpecId: string;
    code: string;
    name: string;
    picksPerCm: string | number | null;
    sequenceCode: string | null;
    weftProgramNo: string | null;
    picksInRepeatTotal: number;
    yarns: Array<{ sortOrder: number; letter: string; picksInRepeat: number; yarnItem: YarnRef; cardYarnItem: YarnRef | null }>;
  } | null;
  weaveDesign: { id: string; code: string; name: string; kind: string; loomFileName: string | null; frameCount: number | null } | null;
  warnings: Array<{ code: string; message: string }>;
}

export function fetchEffectiveConstruction(itemId: string, recipeId?: string | null): Promise<EffectiveConstruction | null> {
  const qs = recipeId ? `?recipeId=${encodeURIComponent(recipeId)}` : "";
  return apiClient.get<ApiResponse<EffectiveConstruction>>(`/api/item-construction/${itemId}${qs}`).then((r) => r.data.data ?? null);
}
