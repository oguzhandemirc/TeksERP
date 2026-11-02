// "İş emri oluştur" girişi (K6): tohumsuz yeni kayıt sayfası önce seçiciyi gösterir (Standart: Terbiye / Dokuma ·
// Özel: kısayol rotaları). Seçim gezinme durumuna yazılır (sekme geri oku seçiciye döner); kısayol = rota uygulanmış form.
import type { ReactNode } from "react";
import { IsEmriSecici } from "./IsEmriSecici";
import { KisayolIsEmri } from "./KisayolIsEmri";
import type { OieStart } from "./nav";

export type { OieStart } from "./nav";

interface Props {
  start: OieStart | null;
  /** Bugünkü Terbiye formu; `belgeOkut=false` iken formun kendi "Belge okut" düğmesi çizilmez (kısayol üst şeridi taşır). */
  renderManual: (routeTemplateId: string | null, opts?: { belgeOkut?: boolean }) => ReactNode;
}

export function IsEmriGiris({ start, renderManual }: Props) {
  if (start?.kind === "terbiye") return <>{renderManual(null)}</>;
  if (start?.kind === "shortcut") return <KisayolIsEmri route={start.route} noteId={start.noteId ?? null} renderManual={renderManual} />;
  return <IsEmriSecici renderPlain={() => renderManual(null)} />;
}
