import { safeFormat } from "@/lib/format";
import type { MachineDeletePreview } from "@/pages/Machines/service";

const DATE_FMT = "dd.MM.yyyy HH:mm";

function sessionLines(preview: MachineDeletePreview): string[] {
  const lines = preview.recentWorkSessions.map(
    (s) =>
      `• ${s.userName} — ${safeFormat(s.startedAt, DATE_FMT)} → ${s.endedAt ? safeFormat(s.endedAt, DATE_FMT) : "açık"}`,
  );
  const rest = preview.workSessionCount - preview.recentWorkSessions.length;
  if (rest > 0) lines.push(`• … ve ${rest} oturum daha`);
  return lines;
}

/**
 * Makine kalıcı silme onay metni (ConfirmDialog `\n`'i satır olarak çizer).
 * Oturum geçmişi silinmez, silmeyi engeller — engel ve boşa çıkacak donanım kayıt kayıt yazılır.
 */
export function buildMachineDeleteDescription(
  machineName: string,
  preview: MachineDeletePreview | undefined,
  isLoading: boolean,
): string {
  if (isLoading) return "Kontrol ediliyor…";
  if (!preview) return "Önizleme alınamadı — makineyi pasife almayı deneyin.";
  if (!preview.deletable) {
    const lines = [`"${machineName}" kalıcı silinemez:`, ...preview.blockers.map((b) => `• ${b.message}`)];
    if (preview.workSessionCount > 0) {
      lines.push("", "Oturum geçmişi korunur (en yeniden):", ...sessionLines(preview));
    }
    lines.push("", "Bunun yerine makineyi pasife alın — üretim ve oturum geçmişi korunur.");
    return lines.join("\n");
  }
  const lines = [`"${machineName}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`];
  if (preview.peripheralsToDetach.length > 0) {
    lines.push(
      "",
      "Bu makineden çözülüp boşa çıkacak donanımlar (kayıt ve ayarı korunur, sonra başka makineye atanabilir):",
      ...preview.peripheralsToDetach.map((p) => `• ${p.name} (${p.code})`),
    );
  }
  return lines.join("\n");
}
