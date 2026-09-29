// YAPTIRIM — K0–K3 kendi ucundan, K4/K5 ağır uçtan. AĞIR eylem (K4 · K5 · geri sayımı 7 günden kısa
// K3) yalnız yönetici, lisans numarası AYNEN yazılarak (ikinci onay). Her eylem sebep ister ve deftere
// satırdır; geri alma ters satırdır (ileri satır silinmez). Kip (gözlem ↔ zorla), uzatma, geçerlilik.
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { useWrite } from "../../shared/attempt";
import { dateInputToIso, fmtDate, fmtDateTime } from "../../shared/format";
import { MODULE_LABEL, SANCTION_LABEL, label } from "../../shared/labels";
import { HEAVY_ENDPOINT_LEVELS, HEAVY_K3_MIN_DAYS, isHeavySanctionInput, isHeavySanctionRow, type SanctionLevel } from "../../shared/sanctions";
import { useApi, useCan } from "../../shared/session";
import { installationName, type InstallationDetail, type SanctionAction } from "../../shared/types";
import { Badge, Button, ErrorText, Field, KeyValues, Modal, ModalActions, Section, Table } from "../../shared/ui";

const LIGHT: readonly SanctionLevel[] = ["K0", "K1", "K2", "K3"];
const HEAVY: readonly SanctionLevel[] = ["K4", "K5"];
const DAY_PRESETS = [0, 7, 15, 30] as const;

function paramSummary(row: { tur: string; parametre: Record<string, unknown> }): string {
  const p = row.parametre ?? {};
  const parts: string[] = [];
  if (typeof p.mesaj === "string" && p.mesaj) parts.push(`“${p.mesaj}”`);
  if (Array.isArray(p.moduller)) parts.push(p.moduller.map((m) => label(MODULE_LABEL, String(m))).join(", "));
  if (typeof p.kisitlamaTarihi === "string") parts.push(`kısıtlama ${fmtDateTime(p.kisitlamaTarihi)}`);
  if (row.tur === "ZORLAMA") parts.push(p.yeni ? "gözlem → zorla" : "zorla → gözlem");
  if (row.tur === "GECERLILIK") parts.push(`${p.onceki ? fmtDate(String(p.onceki)) : "sınırsız"} → ${p.yeni ? fmtDate(String(p.yeni)) : "sınırsız"}`);
  if (row.tur === "GERI_AL" && typeof p.geriAlinanTur === "string") parts.push(`${p.geriAlinanTur} geri alındı`);
  return parts.join(" · ") || "—";
}

interface Draft {
  readonly level: SanctionLevel;
  readonly message: string;
  readonly modules: string[];
  readonly dayMode: "preset" | "custom" | "date";
  readonly days: number;
  readonly customDays: string;
  readonly date: string;
}

const EMPTY: Draft = { level: "K0", message: "", modules: [], dayMode: "preset", days: 15, customDays: "", date: "" };

/** Formdan sunucu gövdesi (sebep/onay/clientToken hariç). */
function sanctionBody(d: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = { kademe: d.level };
  if (d.message.trim()) body.mesaj = d.message.trim();
  if (d.level === "K2") body.moduller = d.modules;
  if (d.level === "K3") {
    if (d.dayMode === "date") body.kisitlamaTarihi = dateInputToIso(d.date);
    else body.kisitlamaGun = d.dayMode === "custom" ? Number(d.customDays) : d.days;
  }
  return body;
}

function draftInput(d: Draft) {
  return {
    level: d.level,
    restrictionDays: d.level === "K3" && d.dayMode !== "date" ? (d.dayMode === "custom" ? Number(d.customDays) : d.days) : undefined,
    restrictionDate: d.level === "K3" && d.dayMode === "date" ? dateInputToIso(d.date) : undefined,
  };
}

function draftValid(d: Draft): boolean {
  if (d.level === "K2" && d.modules.length === 0) return false;
  if (d.level === "K0" && !d.message.trim()) return false;
  if (d.level === "K3") {
    if (d.dayMode === "custom") return /^\d{1,4}$/.test(d.customDays) && Number(d.customDays) <= 3650;
    if (d.dayMode === "date") return dateInputToIso(d.date) !== undefined;
  }
  return true;
}

export function SanctionPanel({ detail, modules, onChanged }: { detail: InstallationDetail; modules: readonly string[]; onChanged: () => void }) {
  const api = useApi();
  const canWrite = useCan("yaptirim:yaz");
  const canHeavy = useCan("yaptirim:agir");
  const inst = detail.kurulum;
  const hak = detail.hak;
  const name = installationName(inst);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [revert, setRevert] = useState<SanctionAction | null>(null);
  const [enforce, setEnforce] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [validityOpen, setValidityOpen] = useState(false);
  const heavy = isHeavySanctionInput(draftInput(draft), Date.now());
  const ledger = detail.yaptirimDefteri ?? [];
  const reverted = new Set(ledger.flatMap((r) => (r.geriAlinanEylemId ? [r.geriAlinanEylemId] : [])));
  const state = detail.yaptirim;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const done = () => {
    setConfirming(false);
    setRevert(null);
    setEnforce(false);
    setExtendOpen(false);
    setValidityOpen(false);
    setDraft(EMPTY);
    onChanged();
  };

  const blockReason =
    heavy && !canHeavy
      ? `${draft.level === "K3" ? `Geri sayımı ${HEAVY_K3_MIN_DAYS} günden kısa K3` : draft.level} ağır yaptırımdır: yalnız yönetici uygular.`
      : heavy && !hak
        ? "Ağır yaptırım lisans numarasıyla onaylanır; bu kurulumun lisans hakkı yok."
        : null;
  const heavyEndpoint = HEAVY_ENDPOINT_LEVELS.includes(draft.level);

  return (
    <>
      <Section title="Güncel durum">
        <KeyValues
          items={[
            ["Kademe", state?.kademe ? <Badge tone={state.kademe >= "K3" ? "danger" : "warn"}>{label(SANCTION_LABEL, state.kademe)}</Badge> : <Badge tone="ok">Yaptırım yok</Badge>],
            ["Mesaj", state?.mesaj ?? "—"],
            ["Kısıtlama tarihi", fmtDateTime(state?.kisitlamaTarihi)],
            ["Donmuş modüller", state?.donmusModuller.length ? state.donmusModuller.map((m) => label(MODULE_LABEL, m)).join(", ") : "—"],
            ["Güncelleme", state?.guncellemeDonuk ? "Dondurulmuş" : "Açık"],
            ["Kip", inst.zorlama ? <Badge tone="warn">Zorla</Badge> : <Badge>Gözlem (sıfır fark)</Badge>],
            ["Geçerlilik bitişi", hak ? (hak.gecerlilikBitis ? fmtDate(hak.gecerlilikBitis) : hak.kalici ? "Süresiz (kalıcı)" : "Süresiz") : "—"],
          ]}
        />
        <div className="section-actions">
          {canHeavy ? <Button onClick={() => setEnforce(true)}>{inst.zorlama ? "Gözleme döndür" : "Zorla kipine geçir"}</Button> : null}
          {canWrite && hak ? <Button onClick={() => setExtendOpen(true)}>N gün uzat</Button> : null}
          {canWrite && hak ? <Button onClick={() => setValidityOpen(true)}>Geçerlilik bitişini ayarla</Button> : null}
        </div>
      </Section>

      {canWrite ? (
        <Section title="Yaptırım uygula">
          <Field label="Kademe">
            <select value={draft.level} onChange={(e) => set({ level: e.target.value as SanctionLevel })} aria-label="Kademe">
              {[...LIGHT, ...(canHeavy ? HEAVY : [])].map((l) => (
                <option key={l} value={l}>
                  {label(SANCTION_LABEL, l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={draft.level === "K0" ? "Mesaj (bantta görünür, zorunlu)" : "Mesaj (isteğe bağlı, bantta görünür)"}>
            <input value={draft.message} maxLength={500} onChange={(e) => set({ message: e.target.value })} />
          </Field>
          {draft.level === "K2" ? (
            <div className="field">
              <span className="field-label">Dondurulacak modüller</span>
              <div className="checks">
                {modules.map((m) => (
                  <label key={m} className="check">
                    <input
                      type="checkbox"
                      checked={draft.modules.includes(m)}
                      onChange={() => set({ modules: draft.modules.includes(m) ? draft.modules.filter((x) => x !== m) : [...draft.modules, m] })}
                    />
                    {label(MODULE_LABEL, m)}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {draft.level === "K3" ? (
            <div className="field">
              <span className="field-label">Kısıtlı kipe geri sayım</span>
              <div className="checks">
                {DAY_PRESETS.map((d) => (
                  <label key={d} className="check">
                    <input type="radio" name="k3" checked={draft.dayMode === "preset" && draft.days === d} onChange={() => set({ dayMode: "preset", days: d })} />
                    {d === 0 ? "Hemen" : `${d} gün`}
                  </label>
                ))}
                <label className="check">
                  <input type="radio" name="k3" checked={draft.dayMode === "custom"} onChange={() => set({ dayMode: "custom" })} />
                  Özel gün
                </label>
                <label className="check">
                  <input type="radio" name="k3" checked={draft.dayMode === "date"} onChange={() => set({ dayMode: "date" })} />
                  Tarih
                </label>
              </div>
              {draft.dayMode === "custom" ? <input type="number" min={0} max={3650} aria-label="Gün" value={draft.customDays} onChange={(e) => set({ customDays: e.target.value })} /> : null}
              {draft.dayMode === "date" ? <input type="date" aria-label="Kısıtlama tarihi" value={draft.date} onChange={(e) => set({ date: e.target.value })} /> : null}
            </div>
          ) : null}
          {heavy ? (
            <p className="warn-box">
              Ağır yaptırım: yalnız yönetici, kurulumun lisans numarası yazılarak ikinci onayla uygular. Fabrika zorla kipindeyse etkisi saniyeler içinde başlar.
            </p>
          ) : null}
          {blockReason ? <p className="error">{blockReason}</p> : null}
          <Button variant={heavy ? "danger" : "primary"} disabled={!draftValid(draft) || blockReason !== null} onClick={() => setConfirming(true)}>
            Uygula…
          </Button>
        </Section>
      ) : null}

      <Section title="Yaptırım defteri">
        <p className="muted small">Defter satırı silinmez ve düzeltilmez; geri alma yeni bir ters satırdır.</p>
        <Table
          rows={ledger}
          rowKey={(r) => r.id}
          columns={[
            { header: "Tarih", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Eylem", render: (r) => label(SANCTION_LABEL, r.tur) },
            { header: "Ayrıntı", render: (r) => paramSummary(r) },
            { header: "Sebep", render: (r) => r.sebep },
            { header: "Yapan", render: (r) => r.yapan },
            {
              header: "",
              render: (r) => {
                if (!/^K[0-5]$/.test(r.tur)) return null;
                if (reverted.has(r.id)) return <Badge>Geri alındı</Badge>;
                const heavyRow = isHeavySanctionRow(r);
                if (!canWrite || (heavyRow && !canHeavy)) return null;
                return (
                  <Button variant="ghost" onClick={() => setRevert(r)}>
                    Geri al
                  </Button>
                );
              },
            },
          ]}
        />
      </Section>

      {confirming ? (
        <ConfirmAction
          title={heavy ? `Ağır yaptırım: ${label(SANCTION_LABEL, draft.level)}` : `Yaptırım: ${label(SANCTION_LABEL, draft.level)}`}
          description={paramSummary({ tur: draft.level, parametre: { mesaj: draft.message.trim() || undefined, moduller: draft.level === "K2" ? draft.modules : undefined, kisitlamaTarihi: draft.level === "K3" ? previewDate(draft) : undefined } })}
          targets={[`${name} · ${inst.tesis.musteri.ad} › ${inst.tesis.ad}${hak ? ` · ${hak.lisansNo}` : ""}`]}
          confirmLabel="Uygula"
          danger={heavy}
          typedConfirmation={heavy && hak ? { expected: hak.lisansNo, label: "Lisans numarası (ikinci onay)" } : undefined}
          send={(b) => api.post(`/kurulumlar/${inst.id}/${heavyEndpoint ? "agir-yaptirim" : "yaptirim"}`, { ...sanctionBody(draft), ...b })}
          onDone={done}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      {revert ? (
        <ConfirmAction
          title="Yaptırımı geri al"
          description="Ters kayıt yazılır; ileri satır defterde kalır. Fabrika bir sonraki yoklamada (zil ile saniyeler içinde) normale döner."
          targets={[`${label(SANCTION_LABEL, revert.tur)} — ${fmtDateTime(revert.createdAt)} — ${revert.sebep}`, `${name}${hak ? ` · ${hak.lisansNo}` : ""}`]}
          confirmLabel="Geri al"
          send={(b) => api.post(`/yaptirimlar/${revert.id}/geri-al`, b)}
          onDone={done}
          onClose={() => setRevert(null)}
        />
      ) : null}
      {enforce ? (
        <ConfirmAction
          title={inst.zorlama ? "Gözlem kipine döndür" : "Zorla kipine geçir"}
          description={
            inst.zorlama
              ? "Gözlemde lisans kararları hesaplanır ama hiçbir istek engellenmez (sıfır fark)."
              : "Zorla kipinde yaptırım ve ek süre fabrikada UYGULANIR. Karar gözlem verisi ve yazılı onayla verilir."
          }
          targets={[`${name}${hak ? ` · ${hak.lisansNo}` : ""}`]}
          confirmLabel={inst.zorlama ? "Gözleme döndür" : "Zorla kipine geçir"}
          danger={!inst.zorlama}
          send={(b) => api.post(`/kurulumlar/${inst.id}/zorlama`, { ...b, zorla: !inst.zorlama })}
          onDone={done}
          onClose={() => setEnforce(false)}
        />
      ) : null}
      {extendOpen && hak ? <ExtendModal installationId={inst.id} target={`${name} · ${hak.lisansNo}`} current={hak.gecerlilikBitis} onClose={() => setExtendOpen(false)} onDone={done} /> : null}
      {validityOpen && hak ? <ValidityModal installationId={inst.id} target={`${name} · ${hak.lisansNo}`} current={hak.gecerlilikBitis} onClose={() => setValidityOpen(false)} onDone={done} /> : null}
    </>
  );
}

function previewDate(d: Draft): string | undefined {
  if (d.dayMode === "date") return dateInputToIso(d.date);
  const days = d.dayMode === "custom" ? Number(d.customDays) : d.days;
  return Number.isFinite(days) ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
}

function ExtendModal({ installationId, target, current, onClose, onDone }: { installationId: string; target: string; current: string | null; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const write = useWrite((b) => api.post(`/kurulumlar/${installationId}/uzat`, b));
  const n = Number(days);
  const ok = Number.isInteger(n) && n >= 1 && n <= 3650 && reason.trim() !== "";
  return (
    <Modal title="Geçerliliği uzat" onClose={onClose} busy={write.pending}>
      <p>
        <strong>{target}</strong> — şu anki bitiş: {current ? fmtDate(current) : "süresiz"}. Yeni bitiş = en geç(bugün, mevcut bitiş) + N gün.
      </p>
      <Field label="Gün">
        <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      <Field label="Sebep (zorunlu)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={async () => (await write.run({ gun: n, sebep: reason.trim() })).ok && onDone()}>
          Uzat
        </Button>
      </ModalActions>
    </Modal>
  );
}

function ValidityModal({ installationId, target, current, onClose, onDone }: { installationId: string; target: string; current: string | null; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [unlimited, setUnlimited] = useState(current === null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const write = useWrite((b) => api.post(`/kurulumlar/${installationId}/gecerlilik`, b));
  const iso = dateInputToIso(date);
  const ok = reason.trim() !== "" && (unlimited || iso !== undefined);
  return (
    <Modal title="Geçerlilik bitişi" onClose={onClose} busy={write.pending}>
      <p>
        <strong>{target}</strong> — şu anki bitiş: {current ? fmtDate(current) : "süresiz"}.
      </p>
      <label className="check field">
        <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
        Süre sınırını kaldır (vadesiz)
      </label>
      {!unlimited ? (
        <Field label="Bitiş tarihi">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Sebep (zorunlu)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={async () => (await write.run({ tarih: unlimited ? null : iso, sebep: reason.trim() })).ok && onDone()}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}
