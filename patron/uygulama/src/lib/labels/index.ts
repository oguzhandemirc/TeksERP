// Etiket sözlükleri: ekranda ham enum yazılmaz; sözlükte yoksa değer ham döner (bekçi testleri eksikleri yakalar).
import { STATUS_DICT, type StatusEntry } from "./ortak";

export { STATUS_DICT, type StatusEntry, type StatusTone, type WireStatus } from "./ortak";

export function lookup<T extends string>(dict: Readonly<Partial<Record<T, string>>>, value: unknown): string {
  if (typeof value !== "string") return "—";
  return (dict as Readonly<Record<string, string | undefined>>)[value] ?? value;
}

/** Durum değeri → etiket + ton; bilinmeyen değer ham etiket ve "bilgi" tonuyla döner. */
export function statusEntry(value: unknown): StatusEntry {
  if (typeof value !== "string") return { label: "—", tone: "bilgi" };
  return (STATUS_DICT as Readonly<Record<string, StatusEntry | undefined>>)[value] ?? { label: value, tone: "bilgi" };
}
