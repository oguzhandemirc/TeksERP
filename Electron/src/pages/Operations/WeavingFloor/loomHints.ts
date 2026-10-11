// Salon ipuçlarının İÇERİĞİ — saf (bileşen değil; birim testli). Kartın her simgesi aynı
// modeli çizer (`FloorHint`); metin burada bir kez kurulur ki simge ile ekran okuyucu ayrışmasın.
import { formatFactory } from "@/lib/factory-time";
import { STATE_SOURCE_HINT, STATE_SOURCE_LABEL, STATUS_LABEL, TIER_LABEL, statusOf } from "./palette";
import { escalationTierOf, formatNumber, formatShortDuration, todayAvailabilityPct } from "./metrics";
import type { BeamState, LiveLoom, LossClass, OpenStop } from "./types";

export type HintTone = "warn" | "danger";

export interface HintLine {
  label: string;
  value: string;
  tone?: HintTone;
}

export interface HintModel {
  title: string;
  subtitle?: string;
  lines: HintLine[];
  note?: string;
}

const MINUTE = 60_000;

/** Duruşun planlama karşılığı — "plan dışı mı" sorusunun cevabı tek yerde. */
const CLASS_TEXT: Record<LossClass, string> = {
  UNPLANNED: "Plansız duruş (kayıp)",
  SETUP: "Ayar / hazırlık",
  PLANNED: "Planlı duruş",
  NON_SCHEDULED: "Plan dışı — planlı süreye sayılmaz",
};

/** Başlangıç fabrika saatiyle; başka fabrika gününe düşüyorsa tarih de yazılır. */
function startText(startedAt: number, now: number): string {
  const sameDay = formatFactory(startedAt, "yyyy-MM-dd") === formatFactory(now, "yyyy-MM-dd");
  return formatFactory(startedAt, sameDay ? "HH:mm" : "dd.MM.yyyy HH:mm");
}

function targetLine(stop: OpenStop, now: number): HintLine {
  const tier = escalationTierOf(stop, now);
  if (stop.targetMin === null) return { label: "Hedef", value: "Yok — süre izlenmiyor" };
  const over = now - stop.startedAt - stop.targetMin * MINUTE;
  if (tier === "WITHIN") return { label: "Hedef", value: `${stop.targetMin} dk · ${formatShortDuration(-over)} kaldı` };
  const tone: HintTone = tier === "ESCALATED" ? "danger" : "warn";
  return { label: "Hedef", value: `${stop.targetMin} dk · ${formatShortDuration(over)} aşıldı`, tone };
}

function sourceLine(t: LiveLoom): HintLine[] {
  return t.stateSource ? [{ label: "Kaynak", value: STATE_SOURCE_LABEL[t.stateSource] }] : [];
}

function jobLine(t: LiveLoom): HintLine[] {
  return t.job ? [{ label: "Dokunan iş", value: `${t.job.no} · ${t.job.fabric}` }] : [];
}

function attendantLines(stop: OpenStop, now: number): HintLine[] {
  if (!stop.attendant) return [];
  const notified = stop.notifiedAt !== null && stop.notifiedAt <= now;
  const state = stop.respondedAt !== null ? "tezgahta" : notified ? "bildirim aldı" : "bildirim yok";
  return [{ label: "Görevli", value: `${stop.attendant.name} · ${state}` }];
}

function stopHint(t: LiveLoom, stop: OpenStop, now: number): HintModel {
  const tier = escalationTierOf(stop, now);
  const lines: HintLine[] = [
    { label: "Sebep", value: stop.reasonCode === null && stop.lossClass === null ? "Sebep bekleniyor" : stop.label },
    { label: "Tür", value: stop.lossClass ? CLASS_TEXT[stop.lossClass] : "Sınıfı yok — plansız sayılır" },
    { label: "Başladı", value: startText(stop.startedAt, now) },
    { label: "Süre", value: `${formatShortDuration(now - stop.startedAt)} duruyor` },
    targetLine(stop, now),
    ...(tier === "ESCALATED" ? [{ label: "Durum", value: TIER_LABEL.ESCALATED, tone: "danger" as const }] : []),
    ...attendantLines(stop, now),
    ...sourceLine(t),
    ...jobLine(t),
  ];
  return { title: t.code, subtitle: STATUS_LABEL[statusOf(t)], lines };
}

/** Kartın bütün hikâyesi — ad, durum simgesi, sebep simgesi ve klavye odağı aynı modeli gösterir. */
export function loomHintOf(t: LiveLoom, now: number): HintModel {
  if (!t.monitored) {
    return { title: t.code, subtitle: STATUS_LABEL.UNMONITORED, lines: jobLine(t), note: STATE_SOURCE_HINT.cikarim };
  }
  if (t.openStop) return stopHint(t, t.openStop, now);
  const pct = todayAvailabilityPct(t);
  const lines: HintLine[] = [
    ...(t.rpm !== null ? [{ label: "Devir", value: `${formatNumber(t.rpm)} atkı/dk` }] : []),
    { label: "Bugün", value: pct === null ? "—" : `%${pct} çalıştı` },
    ...sourceLine(t),
    ...jobLine(t),
  ];
  return { title: t.code, subtitle: STATUS_LABEL.RUN, lines };
}

export function sourceHintOf(source: keyof typeof STATE_SOURCE_LABEL): HintModel {
  return { title: `Kaynak: ${STATE_SOURCE_LABEL[source]}`, lines: [], note: STATE_SOURCE_HINT[source] };
}

export function beamHintOf(beams: readonly BeamState[]): HintModel {
  return {
    title: beams.length > 1 ? "Takılı leventler" : "Takılı levent",
    lines: beams.map((b) => ({
      label: `${b.no}${b.slot !== null ? ` (yuva ${b.slot})` : ""}`,
      value: `${formatNumber(b.remainingM)} m kaldı`,
    })),
    note: "Rozet ilk bitecek leventin kalanını gösterir.",
  };
}

export const TODAY_PCT_HINT: HintModel = {
  title: "Bugün %",
  lines: [],
  note: "Bugünkü çalışma süresi payı: çalışılan süre / planlı süre (plan dışı duruş sayılmaz).",
};

export const STAR_HINT: HintModel = { title: "Vardiyanın yıldızı", lines: [], note: "Bu vardiyada en yüksek çalışma payına sahip tezgah." };

/** Uyarı zincirinin bir halkası — simge + o halkanın durumu. */
export function chainStepHintOf(step: "notify" | "respond" | "escalate", stop: OpenStop, now: number): HintModel {
  if (step === "notify") {
    const notified = stop.notifiedAt !== null && stop.notifiedAt <= now;
    return notified && stop.attendant
      ? { title: "Görevliye bildirildi", lines: [{ label: stop.attendant.name, value: formatFactory(stop.notifiedAt!, "HH:mm") }] }
      : { title: "Görevliye bildirim yok", lines: [] };
  }
  if (step === "respond") {
    return stop.respondedAt !== null
      ? { title: "Görevli tezgahta", lines: [{ label: "Geldi", value: formatFactory(stop.respondedAt, "HH:mm") }] }
      : { title: "Görevli henüz gelmedi", lines: [] };
  }
  const escalated = escalationTierOf(stop, now) === "ESCALATED";
  return escalated && stop.escalatedAt !== null
    ? { title: "Patrona iletildi", lines: [{ label: "İletildi", value: formatFactory(stop.escalatedAt, "HH:mm") }] }
    : { title: "Patrona iletilmedi", lines: [], note: "Hedef süre ve iletim payı dolunca patrona iletilir." };
}

/** Model → düz metin (aria / test). */
export function hintText(h: HintModel): string {
  return [h.title, h.subtitle, ...h.lines.map((l) => `${l.label}: ${l.value}`), h.note].filter(Boolean).join("\n");
}
