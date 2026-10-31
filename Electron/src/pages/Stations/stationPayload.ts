import type { StationFormValues } from "./schema";
import type { Station } from "./types";

// ⚠️ İSTEK GÖVDESİNİ ELLE KURAN HER KATMAN SESSİZ BİR ALLOWLIST'TİR
// (2026-08-13 dersi). 2026-09-03 taramasında ölçüldü: `appliesColor` ve
// `appliesProperty` kutuları formda vardı ama BURADAN GÖNDERİLMİYORDU — yani
// yetenek kutuları ÖLÜYDÜ (kaydet, hiçbir şey değişmez). Yeni bir alan
// eklerken bu satırı da ekle, yoksa kutu sessizce hiçbir şey yapmaz.
export const buildStationPayload = (v: StationFormValues, initial: Station | null): Partial<Station> => ({
  // Kod backend'de üretilir (IST+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  type: v.type,
  kind: v.kind,
  department: v.department || null,
  isActive: v.isActive,
  appliesColor: v.appliesColor,
  appliesProperty: v.appliesProperty,
  appliesQuality: v.appliesQuality,
  inspectionEnabled: v.inspectionEnabled,
  producesWarpBeam: v.producesWarpBeam,
  consumesWarpBeam: v.consumesWarpBeam,
  capturesWidth: v.capturesWidth,
  // Boş = genel adet (null); backend 1–5 doğrular, DB CHECK son kapı.
  defaultLabelCopies: v.defaultLabelCopies ?? null,
  defaultCategoryId: v.type === "EXTERNAL" ? v.defaultCategoryId ?? null : null,
});
