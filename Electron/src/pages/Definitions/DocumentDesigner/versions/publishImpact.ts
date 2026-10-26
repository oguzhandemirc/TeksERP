import type { AffectedParty, TemplatePreviewResult, TemplateAssignments } from "@/services/documentTemplateService";

// Yayın onayının SAF hesapları: etkilenen profil/müşteri listesi + senaryo render özeti.

export interface PublishImpact {
  /** Şablon bu türün varsayılanı mı (profil ataması olmayan herkes etkilenir). */
  isDefault: boolean;
  profiles: Array<{ id: string; name: string; customers: AffectedParty[]; subcontractors: AffectedParty[] }>;
  customerCount: number;
  subcontractorCount: number;
}

export function publishImpact(templateId: string, a: TemplateAssignments | undefined): PublishImpact {
  const rows = (a?.profiles ?? []).filter((p) => p.template.id === templateId);
  const byProfile = new Map<string, PublishImpact["profiles"][number]>();
  for (const r of rows) {
    if (!byProfile.has(r.profile.id)) {
      byProfile.set(r.profile.id, { id: r.profile.id, name: r.profile.name, customers: r.affected.customers, subcontractors: r.affected.subcontractors });
    }
  }
  const profiles = [...byProfile.values()];
  const uniq = (list: AffectedParty[]) => new Set(list.map((x) => x.id)).size;
  return {
    isDefault: (a?.defaults ?? []).some((d) => d.template.id === templateId),
    profiles,
    customerCount: uniq(profiles.flatMap((p) => p.customers)),
    subcontractorCount: uniq(profiles.flatMap((p) => p.subcontractors)),
  };
}

export type ScenarioOutcome = "ok" | "warning" | "failed";

export interface ScenarioRow {
  senaryo: string;
  outcome: ScenarioOutcome;
  detail: string | null;
}

/** Bir senaryonun önizleme sonucu → özet satırı (hata > kesinti/uyarı > başarılı). */
export function scenarioRow(senaryo: string, r: TemplatePreviewResult | null, error?: string): ScenarioRow {
  if (!r) return { senaryo, outcome: "failed", detail: error ?? "Önizleme alınamadı" };
  if (r.hatalar.length) return { senaryo, outcome: "failed", detail: r.hatalar[0]?.mesaj ?? "Render hatası" };
  if (r.kesilenler.length) return { senaryo, outcome: "warning", detail: `Kesilen içerik: ${r.kesilenler.join(", ")}` };
  if (r.uyarilar.length) return { senaryo, outcome: "warning", detail: r.uyarilar.join(" · ") };
  return { senaryo, outcome: "ok", detail: null };
}

export function summarize(rows: ScenarioRow[]): { ok: number; warning: number; failed: number } {
  return {
    ok: rows.filter((r) => r.outcome === "ok").length,
    warning: rows.filter((r) => r.outcome === "warning").length,
    failed: rows.filter((r) => r.outcome === "failed").length,
  };
}
