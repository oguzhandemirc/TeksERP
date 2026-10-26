// Bildirim satırı konusu → takip ucu kayıt türü (backend `FOLLOW_TARGET_BY_SUBJECT` aynası; eşlenmeyen konu
// için "Takipten çık" gösterilmez). Yalnız TAKIPCI/OLUSTURAN sebepli satır takipten çıkarılabilir.
import type { FollowRecordType, NotificationItem } from "./types";

const FOLLOW_TYPE_BY_SUBJECT: Readonly<Record<string, FollowRecordType>> = {
  siparis: "siparis",
  order: "siparis",
  isemri: "is-emri",
  "dokuma-isi": "dokuma-isi",
};

export function unfollowTarget(b: Pick<NotificationItem, "neden" | "konu">): { type: FollowRecordType; id: string } | null {
  if (b.neden !== "TAKIPCI" && b.neden !== "OLUSTURAN") return null;
  const type = FOLLOW_TYPE_BY_SUBJECT[b.konu.tip];
  return type && b.konu.id ? { type, id: b.konu.id } : null;
}
