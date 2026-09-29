// LİSANS (HAK) — taslak → parolalı imzalı sürüm (ilk imza · yenileme · kalıcıya çevir · bakım
// uzatma · modül tavanı). Satıcıda KÖK, bayide BAYİ parolası (bayi yalnız tavanı içinde). Etkinleştirme
// kodu imzalı hakkı olan kurulum için üretilir ve yalnız bir kez gösterilir. Sürümler ve kodlar
// EKLEME-YALNIZ defterdir.
import { useState } from "react";
import { ActivationCodeAction, EntitlementCreateModal, EntitlementVersionModal } from "./forms";
import { fmtDate, fmtDateTime } from "./format";
import { CODE_STATUS_LABEL, MODULE_LABEL, label } from "./labels";
import type { InstallationDetail } from "./types";
import { Badge, Button, KeyValues, Section, Table } from "./ui";

export interface EntitlementPolicy {
  readonly canWrite: boolean;
  readonly canCode: boolean;
  /** Seçilebilir modüller (satıcıda katalog, bayide tavan) ve yeni hakkın varsayılanı. */
  readonly modules: readonly string[] | undefined;
  readonly defaultModules: readonly string[];
  readonly passwordField: "kokParolasi" | "bayiParolasi";
  readonly passwordLabel: string;
  /** Kalıcı lisans verilebilir mi (bayide tavanın kalıcı izni). */
  readonly allowPerpetual: boolean;
  /** Bakım bitişi en geç (bayide tavanın bakım ay tavanı); yoksa sınırsız. */
  readonly maxMaintenanceMonths?: number;
  /** Kod yalnız hiç etkinleşmemiş kuruluma (bayi — D8; etkin kurulumun makine değişimi satıcı onaylı taşımadır). */
  readonly codeOnlyUnactivated?: boolean;
}

export function EntitlementPanel({ detail, policy, onChanged }: { detail: InstallationDetail; policy: EntitlementPolicy; onChanged: () => void }) {
  const { canWrite, canCode } = policy;
  const [dialog, setDialog] = useState<"create" | "version" | null>(null);
  const inst = detail.kurulum;
  const hak = detail.hak;
  const closed = inst.durum === "IPTAL" || !inst.aktif;
  const codeBlockedByState = policy.codeOnlyUnactivated === true && inst.durum !== "ETKINLESMEDI";
  const done = () => {
    setDialog(null);
    onChanged();
  };
  return (
    <>
      <Section
        title="Lisans hakkı"
        actions={
          canWrite && !closed ? (
            hak ? (
              <Button variant="primary" onClick={() => setDialog("version")}>
                {hak.guncelSurum === 0 ? "Lisansı imzala" : "Lisansı yenile"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setDialog("create")} disabled={!policy.modules}>
                Lisans hakkı oluştur
              </Button>
            )
          ) : null
        }
      >
        {hak ? (
          <KeyValues
            items={[
              ["Lisans no", <code key="n">{hak.lisansNo}</code>],
              ["İmzalı sürüm", hak.guncelSurum === 0 ? <Badge tone="warn">Henüz imzalanmadı</Badge> : String(hak.guncelSurum)],
              ["Tür", hak.kalici ? "Kalıcı" : "Vadeli"],
              ["Bakım bitişi", fmtDate(hak.bakimBitis)],
              ["Geçerlilik bitişi", hak.gecerlilikBitis ? fmtDate(hak.gecerlilikBitis) : "Süresiz"],
              ["Modüller", hak.moduller.map((m) => label(MODULE_LABEL, m)).join(", ") || "—"],
            ]}
          />
        ) : (
          <p className="muted">Bu kurulumun lisans hakkı yok.</p>
        )}
      </Section>
      <Section title="İmzalı sürümler">
        <Table
          rows={detail.hakSurumleri}
          rowKey={(r) => r.id}
          empty="Henüz imzalı sürüm yok"
          columns={[
            { header: "Sürüm", render: (r) => r.surum },
            { header: "Veriliş", render: (r) => fmtDateTime(r.verilis) },
            { header: "İmzalayan anahtar", render: (r) => <code>{r.imzalayanKid}</code> },
            { header: "Sebep", render: (r) => r.sebep },
            { header: "Yapan", render: (r) => r.yapan },
          ]}
        />
      </Section>
      <Section
        title="Etkinleştirme kodları"
        actions={canCode && !closed ? <ActivationCodeAction installation={inst} disabled={!hak || hak.guncelSurum === 0 || codeBlockedByState} /> : null}
      >
        {codeBlockedByState ? <p className="muted small">Etkin kurulumun makine değişimi satıcı onaylı taşımadır; bayi yalnız hiç etkinleşmemiş kuruluma kod üretir.</p> : null}
        {hak && hak.guncelSurum === 0 ? <p className="muted small">Kod üretmek için önce lisansı imzalayın.</p> : null}
        <Table
          rows={detail.etkinlestirmeKodlari}
          rowKey={(r) => r.id}
          empty="Kod üretilmedi"
          columns={[
            { header: "Kod", render: (r) => <code>…{r.kodSonu}</code> },
            { header: "Durum", render: (r) => label(CODE_STATUS_LABEL, r.durum) },
            { header: "Son geçerlilik", render: (r) => fmtDate(r.gecerlilikBitis) },
            { header: "Kullanım", render: (r) => fmtDateTime(r.kullanimZamani) },
            { header: "Üreten", render: (r) => r.yapan },
          ]}
        />
      </Section>
      {dialog === "create" && policy.modules ? (
        <EntitlementCreateModal
          installation={inst}
          modules={policy.modules}
          defaultModules={policy.defaultModules}
          allowPerpetual={policy.allowPerpetual}
          maxMaintenanceMonths={policy.maxMaintenanceMonths}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
      {dialog === "version" && hak ? (
        <EntitlementVersionModal
          entitlement={hak}
          modules={policy.modules ?? hak.moduller}
          passwordField={policy.passwordField}
          passwordLabel={policy.passwordLabel}
          allowPerpetual={policy.allowPerpetual}
          maxMaintenanceMonths={policy.maxMaintenanceMonths}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
    </>
  );
}
