// =============================================================================
// ÇEK STORNO ONAYI — saf yardımcılar
// =============================================================================
// Yıkıcı işlemin onayı SOMUT konuşur: hangi para/cari satırı terslenecek, çek
// hangi duruma dönecek. Backend stornoyu en yeni ileri olaydan çözer; ekran da
// AYNI olaya bakar ki onay metni ile sunucunun yaptığı ayrışmasın.
// =============================================================================
import { money } from "../service";
import { STATUS_LABEL, cariName } from "./labels";
import { toNum } from "./service";
import type { ChequeEventRow, ChequeEventType, ChequeRow } from "./service";

/**
 * Terslenecek ileri olay: EN YENİ yazım (`createdAt`) — `eventDate` geriye
 * tarihlenebilir. Alan yoksa (eski backend) kronolojik dizinin sonuncusu.
 */
export function latestEventOfType(
  events: readonly ChequeEventRow[],
  type: ChequeEventType,
): ChequeEventRow | null {
  let best: ChequeEventRow | null = null;
  for (const e of events) {
    if (e.type !== type) continue;
    if (!best || !e.createdAt || !best.createdAt || e.createdAt >= best.createdAt) best = e;
  }
  return best;
}

function accountPhrase(event: ChequeEventRow, suffix: "from" | "to"): string | null {
  if (event.cashBox) return `"${event.cashBox.name}" ${suffix === "from" ? "kasasından" : "kasasına"}`;
  if (event.bankAccount) {
    return `"${event.bankAccount.name}" ${suffix === "from" ? "banka hesabından" : "banka hesabına"}`;
  }
  return null;
}

/**
 * Onay cümlesi. `null` = olay/hesap kaydı okunamadı → ekran bunu söyler ve
 * kesin cevabı sunucuya bırakır (backend fail-closed'dur).
 */
export function reversalSummary(
  type: ChequeEventType,
  event: ChequeEventRow | null,
  row: Pick<ChequeRow, "amount" | "currency">,
): string | null {
  if (!event?.fromStatus) return null;
  const amount = money(toNum(row.amount), row.currency);
  const back = `çek "${STATUS_LABEL[event.fromStatus]}" durumuna dönecek.`;
  switch (type) {
    case "COLLECT": {
      const from = accountPhrase(event, "from");
      return from ? `${amount} tutar ${from} geri çekilecek; ${back} Hesap sonradan pasifleşmiş olsa da işlem yapılır.` : null;
    }
    case "PAY": {
      const to = accountPhrase(event, "to");
      return to ? `${amount} tutar ${to} geri girecek; ${back} Hesap sonradan pasifleşmiş olsa da işlem yapılır.` : null;
    }
    case "ENDORSE":
      return event.counterCari
        ? `"${cariName(event.counterCari)}" carisine yazılan ${amount} ciro borcu ters kayıtla kapanacak; ${back}`
        : null;
    case "BOUNCE": {
      const endorsee = event.counterCari ? `; "${cariName(event.counterCari)}" carisinin ciro borcu yeniden doğacak` : "";
      return `Müşteriye yazılan ${amount} karşılıksız borcu ters kayıtla kapanacak${endorsee}; ${back}`;
    }
    case "RETURN":
      return `İadenin ${amount} tutarlı cari satırı ters kayıtla kapanacak; ${back}`;
    case "DEPOSIT": {
      // Para oynamaz — cümle tutar değil BANKA söyler; banka okunamıyorsa yine anlamlı.
      const bank = event.bankAccount ? `"${event.bankAccount.name}" banka hesabından geri alınacak, ` : "";
      return `Çek ${bank}başlıktaki banka kalkacak; para ve cari defter oynamayacak; ${back}`;
    }
    default:
      return null;
  }
}
