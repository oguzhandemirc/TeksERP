import type { CrudService } from "@/services/crudService";
import { lowerTr } from "@/lib/tr-case";
import { labelTemplateService, type LabelTemplateListRow } from "@/services/labelTemplateService";

// EntityPickerModal bir CrudService ister; şablon havuzu ucu cursor'suz ve TEK
// istekte tamamını döndürür → süzme istemcide meşru (EL-15). Yalnız okuma metotları.

/** `filters.exclude` = virgüllü id listesi (sette zaten olanlar seçicide görünmez). */
export function filterPickerRows(
  rows: LabelTemplateListRow[],
  opts: { search?: string; exclude?: string },
): LabelTemplateListRow[] {
  const excluded = new Set((opts.exclude ?? "").split(",").filter(Boolean));
  const q = lowerTr((opts.search ?? "").trim());
  return rows.filter(
    (t) =>
      t.isActive &&
      !excluded.has(t.id) &&
      (q === "" || lowerTr(t.name).includes(q)),
  );
}

const loadAssignable = () => labelTemplateService.list({ assignable: true }).then((r) => r.data);

const readOnly = (): never => {
  throw new Error("Şablon seçicisi yalnız okur.");
};

export const assignableTemplatePickerService: CrudService<LabelTemplateListRow> = {
  listCursor: async (params) => {
    const exclude = params.filters.exclude;
    const data = filterPickerRows(await loadAssignable(), {
      search: params.search,
      exclude: Array.isArray(exclude) ? exclude.join(",") : exclude,
    });
    return {
      success: true,
      data,
      pagination: { nextCursor: null, hasMore: false, limit: data.length, totalEstimate: data.length },
    };
  },
  getById: async (id) => {
    const row = (await loadAssignable()).find((t) => t.id === id);
    if (!row) throw new Error("Şablon bulunamadı.");
    return { success: true, data: row };
  },
  getAll: readOnly,
  create: readOnly,
  update: readOnly,
  remove: readOnly,
  hardRemove: readOnly,
  restore: readOnly,
};
