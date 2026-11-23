import { Navigate, useParams } from "react-router-dom";

/** Etiket Stüdyosu adresi — Etiketler ekranının altında (B3: ayrı "Etiket Tasarımı" ekranı kalktı). */
export function labelStudioPath(id: string): string {
  return `/definitions/labels/studio/${id}`;
}

/** Eski `/definitions/label-templates/:id` bağlantıları (baskı geçmişi, yer imleri) yeni adrese döner. */
export function LegacyLabelStudioRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? labelStudioPath(id) : "/definitions/labels?tab=templates"} replace />;
}
