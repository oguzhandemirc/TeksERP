import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type {
  LabelTemplate,
  LabelTemplateCatalog,
  LabelTemplateCreateRequest,
  LabelTemplateUpdateRequest,
  LabelKind,
} from '../types/models';

// =============================================================================
// Label Template endpoints
// =============================================================================
// Etiket standardı (alan toggle + sıra + Türkçe başlık + bold + fontSize).
// Mobile uygulama açılışında her LabelKind için liste fetch + AsyncStorage cache.
// `label-template:write` yetkili operatör/admin master template'i kalıcı düzenler.
// =============================================================================

export const labelTemplateService = {
  /** LabelKind filtresi opsiyonel. includeInactive ile pasifleri de göster. */
  list: (opts?: {
    kind?: LabelKind;
    includeInactive?: boolean;
  }): Promise<ApiResponse<LabelTemplate[]>> => {
    const qs = new URLSearchParams();
    if (opts?.kind) qs.set('kind', opts.kind);
    if (opts?.includeInactive) qs.set('includeInactive', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiClient
      .get<ApiResponse<LabelTemplate[]>>(`/label-templates${suffix}`)
      .then((r) => r.data);
  },

  /** Bir LabelKind için izinli alanlar (template editor'da alan havuzu). */
  catalog: (kind: LabelKind): Promise<ApiResponse<LabelTemplateCatalog>> =>
    apiClient
      .get<ApiResponse<LabelTemplateCatalog>>(`/label-templates/catalog/${kind}`)
      .then((r) => r.data),

  findById: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .get<ApiResponse<LabelTemplate>>(`/label-templates/${id}`)
      .then((r) => r.data),

  create: (data: LabelTemplateCreateRequest): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>('/label-templates', data)
      .then((r) => r.data),

  /** fields gönderildiyse complete-replace (tutarlılık için parça güncelleme yok). */
  update: (
    id: string,
    data: LabelTemplateUpdateRequest
  ): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .patch<ApiResponse<LabelTemplate>>(`/label-templates/${id}`, data)
      .then((r) => r.data),

  setDefault: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/label-templates/${id}/set-default`)
      .then((r) => r.data),

  /** Soft delete (isActive=false). Default template silinemez. */
  deactivate: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .delete<ApiResponse<LabelTemplate>>(`/label-templates/${id}`)
      .then((r) => r.data),
};
