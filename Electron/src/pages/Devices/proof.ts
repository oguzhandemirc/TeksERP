import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { deviceService } from "./service";
import type { ProofLostDevice, ProofResetOutcome } from "./types";

export const PROOF_LOST_QUERY_KEY = "admin-device-proof-lost";

/** Kanıtı doğrulanamayan cihazlar (D5). Eski backend 404 → `null` (bölüm, rozet ve süzgeç gizli). */
export function useProofLost() {
  const { hasPermission } = useRoleAccess();
  return useQuery({
    queryKey: [PROOF_LOST_QUERY_KEY],
    queryFn: deviceService.proofLost,
    enabled: hasPermission("admin:settings"),
    retry: false,
    staleTime: 60_000,
  });
}

/** Varsayılan seçim: listedeki her cihaz (hepsi zaten kilitli). Yönetici kayıt kayıt çıkarabilir. */
export function defaultProofResetSelection(devices: readonly ProofLostDevice[]): Set<string> {
  return new Set(devices.map((d) => d.id));
}

/** Donanım özeti olmayan cihaz yeni sırrı kendiliğinden ALAMAZ — onaya düşer (önizlemede söylenir). */
export function proofResetNote(d: Pick<ProofLostDevice, "hasHw">): string {
  return d.hasHw
    ? "Tablet açılınca aynı donanımla kendiliğinden yeniden bağlanır."
    : "Donanım kimliği bilinmiyor: tablet açılınca onay bekleyene düşer, buradan yeniden onaylayın.";
}

const SKIP_REASON: Record<Extract<ProofResetOutcome, { sonuc: "ATLANDI" }>["neden"], string> = {
  YOK: "kayıt bulunamadı",
  KANIT_YOK: "kanıtı zaten sıfırlanmış",
  HALKADA: "anahtarı yerinde, sorun yok",
  DEGISTI: "bu arada değişti, listeyi yenileyin",
};

/** Sonuç satırının günlük dilde metni. */
export function proofResetOutcomeText(o: ProofResetOutcome): string {
  if (o.sonuc === "SIFIRLANDI") return o.hasHw ? "Yeniden bağlanmaya hazır" : "Sıfırlandı — tablet onaya düşecek";
  return `Atlandı: ${SKIP_REASON[o.neden]}`;
}
