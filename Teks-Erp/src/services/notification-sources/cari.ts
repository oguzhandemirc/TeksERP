// =============================================================================
// CARİ KOŞUL KAYNAĞI — `cari.risk-limiti-asildi` (D4-I5, KOSUL; tasarım DALGA4 §12.2)
// =============================================================================
// Yüklem KOPYALANMAZ: "risk limiti aşıldı mı" yalnız `riskExposureTx` çekirdeğinin `exceeded`idir (fatura onayı
// ve iş kabulü/sevk kapısıyla AYNI hesap, ek = 0). Konu hesap × para birimi; bakiye limit içine dönünce kümeden
// düşer → motor "çözüldü" yazar. Yük TUTAR taşımaz (bakiye/limit yok). `evaluate` fırlatırsa motor hiçbir koşulu
// kapatmaz (fail-closed) — burada hata YAKALANMAZ. İlk tur sessiz tabanı motorun işidir (`notification-baseline`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { RISK_LIMITED_ACCOUNT_WHERE, riskExposureTx, type RiskExposure } from "../helpers/risk-exposure.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const CARI_CONDITION_PERIOD_MS = 300_000;
export const RISK_LIMIT_KIND = "cari.risk-limiti-asildi" satisfies NotificationKind;

export interface LimitedCariRow { id: string; name: string; code: string }

export interface CariSourceDeps {
  moduleOpen: (kind: NotificationKind) => Promise<boolean>;
  /** Limiti tanımlı, aktif cari hesaplar (id sırasıyla). */
  limitedCaris: () => Promise<LimitedCariRow[]>;
  /** Çekirdek: hesabın para birimi başına risk görünümü (ek = 0). */
  exposure: (cariId: string) => Promise<RiskExposure[]>;
}

async function moduleOpen(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

export const CARI_SOURCE_REAL_DEPS: Readonly<CariSourceDeps> = {
  moduleOpen,
  limitedCaris: async () => {
    const rows = await prisma.cariAccount.findMany({
      where: { isActive: true, ...RISK_LIMITED_ACCOUNT_WHERE },
      select: { id: true, customer: { select: { name: true, code: true } }, subcontractor: { select: { name: true, code: true } } },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => {
      const card = r.customer ?? r.subcontractor;
      return { id: r.id, name: card?.name ?? "Cari", code: card?.code ?? "—" };
    });
  },
  // Tx dışı tek ifade: FOR UPDATE satır kilidi ifade bitince bırakılır (tarama yazarı bekletmez).
  exposure: (cariId) => riskExposureTx(prisma, cariId, null, new Prisma.Decimal(0)),
};

let deps: CariSourceDeps = { ...CARI_SOURCE_REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideCariSourceDeps(p: Partial<CariSourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

export async function riskLimitExceededSubjects(): Promise<ConditionSubject[]> {
  if (!(await deps.moduleOpen(RISK_LIMIT_KIND))) return [];
  const out: ConditionSubject[] = [];
  for (const cari of await deps.limitedCaris()) {
    for (const e of await deps.exposure(cari.id)) {
      if (!e.exceeded) continue;
      out.push({
        key: `${cari.id}:${e.currency}`, type: "cari", id: cari.id,
        payload: { cariId: cari.id, cariAd: cari.name, cariKodu: cari.code, paraBirimi: e.currency },
      });
    }
  }
  return out;
}

/** Kaynağı tarayıcıya kaydeder (tekrar çağrı aynı kaydı yeniler). */
export function registerCariConditionSources(): void {
  registerConditionSource({ kind: RISK_LIMIT_KIND, periodMs: CARI_CONDITION_PERIOD_MS, evaluate: riskLimitExceededSubjects });
}
