// "Kime bildirildi" — her kademe çaldığında alıcılar RAISED satırına DONMUŞTUR (sonraki tanım değişikliği
// bunu değiştirmez). `BY_PERMISSION` (A4 öncesi alarm dahil) = sorumlu tanımlı değildi, yetkisi olan herkese.
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { LoomAlarmDetail, LoomAlarmNotification, LoomAlarmRecipientSource } from "./types";

export const RECIPIENT_SOURCE_LABEL: Readonly<Record<LoomAlarmRecipientSource, string>> = {
  HALL_SHIFT: "vardiya sorumlusu",
  DUTY_OVERRIDE: "nöbet değişikliği",
  USER: "kural: kişi",
  PERMISSION: "kural: yetki",
};

export function notificationText(n: LoomAlarmNotification): string {
  if (n.mode === "BY_PERMISSION") {
    const who = n.tier >= 2 ? "üst kademe yetkisi olan herkese" : "alarm görme yetkisi olan herkese";
    return `Sorumlu tanımlı değil — ${who}`;
  }
  return n.recipients.map((r) => `${r.name} (${RECIPIENT_SOURCE_LABEL[r.source]})`).join(", ");
}

export function AlarmNotifications({ detail }: { detail: LoomAlarmDetail }) {
  const list = detail.notifications ?? [];
  if (list.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Kime bildirildi</h3>
      <ul className="space-y-2">
        {list.map((n) => (
          <li key={`${n.tier}-${n.at}`} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="font-medium">Kademe {n.tier}</span>
              <span className="tabular-nums text-muted-foreground">{fmtFactoryDateTime(n.at)}</span>
            </div>
            <p className={n.mode === "BY_PERMISSION" ? "text-muted-foreground" : undefined}>{notificationText(n)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
