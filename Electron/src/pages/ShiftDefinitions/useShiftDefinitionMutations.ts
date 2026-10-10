// =============================================================================
// VARDİYA TANIMI — yazma mutasyonları (oluştur · düzenle · arşivle · geri al)
// =============================================================================
// `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i backend mesajıyla basar
// (409'lar adıyla: SHIFT_CODE_TAKEN · SHIFT_NAME_TAKEN · SHIFT_DEFINITION_ARCHIVED).
// Başarı metni takvim özetini söyler; çakışma uyarıları (`warnings`) interceptor'da basılır.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toastServerSuccess } from "@/lib/serverNotes";
import { shiftDefinitionService } from "./service";
import type { ShiftDefinitionFields, ShiftDefinitionWriteResult } from "./types";

export const SHIFT_DEFINITIONS_QUERY_KEY = "shift-definitions";

/** Takvim özetinin insan cümlesi — `null` = tetikleme düştü (zamanlayıcı tamamlar). SAF. */
export function calendarNote(c: ShiftDefinitionWriteResult["calendar"]): string {
  if (c === null) return "takvim birazdan güncellenecek";
  if (c === "disabled") return "dokuma kapalı, takvim yazılmadı";
  const parts = [
    c.created ? `${c.created} yeni pencere` : "",
    c.rewritten ? `${c.rewritten} pencere güncellendi` : "",
    c.retired ? `${c.retired} pencere iptal` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "takvimde değişiklik yok";
}

export function useShiftDefinitionMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: { data: ShiftDefinitionWriteResult; message?: string; warnings?: string[] }) => {
    toastServerSuccess({ ...res, message: `${res.message ?? "Kaydedildi."} (${calendarNote(res.data.calendar)})` }, "Kaydedildi.");
    onDone();
    void qc.invalidateQueries({ queryKey: [SHIFT_DEFINITIONS_QUERY_KEY] });
  };
  const create = useMutation({
    mutationFn: (body: ShiftDefinitionFields & { code: string }) => shiftDefinitionService.create(body),
    onSuccess: settle,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ShiftDefinitionFields> }) => shiftDefinitionService.update(id, body),
    onSuccess: settle,
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? shiftDefinitionService.restore(id) : shiftDefinitionService.archive(id),
    onSuccess: settle,
  });
  return { create, update, setActive };
}
