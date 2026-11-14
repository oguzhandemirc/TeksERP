// =============================================================================
// VADE KOŞUL KAYNAĞI — `finans.vade-yaklasti` · `finans.vade-gecti` (S5b, KOSUL)
// =============================================================================
// Yüklem KOPYALANMAZ: açık kalemler Cari Yaşlandırma'nın çekirdeğinden (`collectAgingRows`, sanal FIFO mahsup SONRASI
// `netOpen`), vade kararı `helpers/invoice-due.helper.ts#dueWindowState`ten. Rapor bir kalemi "gecikmiş" kovaya koyuyorsa
// bildirim de "vadesi geçti" der — ikinci formül yok. Konu cari × para birimi × yön (alacak: cari bize borçlu, borç: biz
// ona). Yük TUTAR taşımaz: belge sayısı + gün. `evaluate` fırlatırsa motor hiçbir koşulu kapatmaz (fail-closed).
// =============================================================================
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { collectAgingRows, type AgingCariRow } from "../reports/finance-aging.report";
import { dueWindowState, type DueWindowState } from "../helpers/invoice-due.helper";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const DUE_SOON_KIND = "finans.vade-yaklasti" satisfies NotificationKind;
export const OVERDUE_KIND = "finans.vade-gecti" satisfies NotificationKind;
const PERIOD_MS = 1_800_000;

export interface DueSourceDeps {
  moduleOpen: (kind: NotificationKind) => Promise<boolean>;
  /** Yaşlandırma çekirdeği, kalem kırılımlı (asOf = şimdi). */
  agingRows: (asOf: Date) => Promise<AgingCariRow[]>;
}

async function moduleOpen(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

export const DUE_SOURCE_REAL_DEPS: Readonly<DueSourceDeps> = {
  moduleOpen,
  agingRows: (asOf) => collectAgingRows({ asOf, includeDetail: true }),
};

let deps: DueSourceDeps = { ...DUE_SOURCE_REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideDueSourceDeps(p: Partial<DueSourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

interface Group { row: AgingCariRow; yon: "alacak" | "borç"; count: number; gun: number }

/**
 * Saf gruplama: hedef durumdaki (`want`) açık kalemleri cari × para birimi × yön başına sayar. `gun`: gecikmede en
 * eski gecikme günü, yaklaşanda en yakın vadeye kalan gün (en az 1). `minOverdue` yalnız gecikmede uygulanır.
 */
export function groupDueItems(rows: readonly AgingCariRow[], want: DueWindowState, p: { windowDays: number; minOverdue: number }): ConditionSubject[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    for (const it of row.items ?? []) {
      const net = Number(it.netOpen);
      if (net === 0 || dueWindowState(it.daysOverdue, p.windowDays) !== want) continue;
      if (want === "OVERDUE" && it.daysOverdue! < p.minOverdue) continue;
      const yon = net > 0 ? "alacak" : "borç";
      const key = `${row.cariId}:${row.currency}:${yon}`;
      const gun = want === "OVERDUE" ? it.daysOverdue! : Math.max(1, -it.daysOverdue!);
      const g = groups.get(key);
      if (!g) groups.set(key, { row, yon, count: 1, gun });
      else {
        g.count += 1;
        g.gun = want === "OVERDUE" ? Math.max(g.gun, gun) : Math.min(g.gun, gun);
      }
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, g]) => ({
    key, type: "cari", id: g.row.cariId,
    payload: {
      cariId: g.row.cariId, cariAd: g.row.name, yon: g.yon, paraBirimi: g.row.currency,
      belgeSayisi: g.count, gun: g.gun,
    },
  }));
}

export async function dueSoonSubjects(now: Date = new Date()): Promise<ConditionSubject[]> {
  if (!(await deps.moduleOpen(DUE_SOON_KIND))) return [];
  const windowDays = Number(effectiveNotificationParams(DUE_SOON_KIND).gun);
  return groupDueItems(await deps.agingRows(now), "DUE_SOON", { windowDays, minOverdue: 0 });
}

export async function overdueSubjects(now: Date = new Date()): Promise<ConditionSubject[]> {
  if (!(await deps.moduleOpen(OVERDUE_KIND))) return [];
  const minOverdue = Number(effectiveNotificationParams(OVERDUE_KIND).tolerans);
  return groupDueItems(await deps.agingRows(now), "OVERDUE", { windowDays: 0, minOverdue });
}

export function registerDueConditionSources(): void {
  registerConditionSource({ kind: DUE_SOON_KIND, periodMs: PERIOD_MS, evaluate: () => dueSoonSubjects() });
  registerConditionSource({ kind: OVERDUE_KIND, periodMs: PERIOD_MS, evaluate: () => overdueSubjects() });
}
