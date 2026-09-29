// PLANLI EYLEM (vadesinde kendiliğinden uygulanan K0–K3) ve TAKSİT PLANI (ödeme onayı → otomatik
// uzatma; vade + gecikme günü ödemesiz → K3). 7 günden kısa K3 geri sayımı AĞIRDIR: yalnız yönetici,
// lisans numarası AYNEN yazılarak (ikinci onay).
import { useState } from "react";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { useWrite } from "../../shared/attempt";
import { dateInputToIso, fmtDate, fmtDateTime } from "../../shared/format";
import { INSTALLMENT_STATUS_LABEL, MODULE_LABEL, PLANNED_STATUS_LABEL, SANCTION_LABEL, label } from "../../shared/labels";
import { HEAVY_K3_MIN_DAYS, INSTALLMENT_DEFAULT_RESTRICTION_DAYS, isHeavyPlannedK3 } from "../../shared/sanctions";
import { useApi, useCan } from "../../shared/session";
import { installationName, type InstallationDetail, type InstallmentItem, type InstallmentPlan, type PlannedAction } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, Section, Table } from "../../shared/ui";

export function plannedSummary(p: PlannedAction): string {
  const parts = [label(SANCTION_LABEL, p.tur)];
  if (p.parametre.gun !== null && p.parametre.gun !== undefined) parts.push(`${p.parametre.gun} gün geri sayım`);
  if (p.parametre.moduller?.length) parts.push(p.parametre.moduller.map((m) => label(MODULE_LABEL, m)).join(", "));
  if (p.parametre.mesaj) parts.push(`“${p.parametre.mesaj}”`);
  return parts.join(" · ");
}

export function PlannedPanel({ detail, modules, onChanged }: { detail: InstallationDetail; modules: readonly string[]; onChanged: () => void }) {
  const api = useApi();
  const canWrite = useCan("yaptirim:yaz");
  const [creating, setCreating] = useState(false);
  const [cancel, setCancel] = useState<PlannedAction | null>(null);
  const name = installationName(detail.kurulum);
  const done = () => {
    setCreating(false);
    setCancel(null);
    onChanged();
  };
  return (
    <Section title="Planlı eylemler" actions={canWrite ? <Button onClick={() => setCreating(true)}>Planlı eylem ekle</Button> : null}>
      <Table
        rows={detail.planliEylemler ?? []}
        rowKey={(r) => r.id}
        empty="Planlı eylem yok"
        columns={[
          { header: "Vade", render: (r) => fmtDateTime(r.vade) },
          { header: "Eylem", render: (r) => plannedSummary(r) },
          { header: "Durum", render: (r) => <Badge tone={r.durum === "BEKLIYOR" ? "warn" : r.durum === "UYGULANDI" ? "info" : "neutral"}>{label(PLANNED_STATUS_LABEL, r.durum)}</Badge> },
          { header: "Sebep", render: (r) => r.sebep + (r.iptalSebebi ? ` (iptal: ${r.iptalSebebi})` : "") },
          { header: "Yapan", render: (r) => r.yapan },
          { header: "", render: (r) => (canWrite && r.durum === "BEKLIYOR" ? <Button variant="ghost" onClick={() => setCancel(r)}>İptal et</Button> : null) },
        ]}
      />
      {creating ? (
        <PlannedCreateModal installationId={detail.kurulum.id} target={name} licenseNo={detail.hak?.lisansNo ?? null} modules={modules} onClose={() => setCreating(false)} onDone={done} />
      ) : null}
      {cancel ? (
        <ConfirmAction
          title="Planlı eylemi iptal et"
          description="Vadesinde uygulanmaz; iptal (kim, ne zaman, neden) satırda kalır."
          targets={[`${name} — ${plannedSummary(cancel)} — vade ${fmtDateTime(cancel.vade)}`]}
          confirmLabel="İptal et"
          danger
          send={(b) => api.post(`/planli-eylemler/${cancel.id}/iptal`, b)}
          onDone={done}
          onClose={() => setCancel(null)}
        />
      ) : null}
    </Section>
  );
}

function PlannedCreateModal({
  installationId,
  target,
  licenseNo,
  modules,
  onClose,
  onDone,
}: {
  installationId: string;
  target: string;
  licenseNo: string | null;
  modules: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const canHeavy = useCan("yaptirim:agir");
  const [level, setLevel] = useState("K3");
  const [due, setDue] = useState("");
  const [message, setMessage] = useState("");
  const [days, setDays] = useState("15");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const write = useWrite((b) => api.post(`/kurulumlar/${installationId}/planli-eylem`, b));
  const dueIso = dateInputToIso(due);
  const n = Number(days);
  const shortK3 = isHeavyPlannedK3(level, days.trim() === "" ? undefined : n);
  const ok =
    dueIso !== undefined &&
    reason.trim() !== "" &&
    (level !== "K3" || (Number.isInteger(n) && n >= 0 && n <= 3650)) &&
    (level !== "K2" || selected.length > 0) &&
    (level !== "K0" || message.trim() !== "") &&
    (!shortK3 || (canHeavy && licenseNo !== null && typed.trim() === licenseNo));
  const submit = async () => {
    const body: Record<string, unknown> = { kademe: level, vade: dueIso, sebep: reason.trim() };
    if (message.trim()) body.mesaj = message.trim();
    if (level === "K3") body.kisitlamaGun = n;
    if (level === "K2") body.moduller = selected;
    if (shortK3) body.onay = typed.trim();
    if ((await write.run(body)).ok) onDone();
  };
  return (
    <Modal title="Planlı eylem" onClose={onClose} busy={write.pending}>
      <p>
        <strong>{target}</strong> — vade günü gelince kendiliğinden uygulanır (ör. vade + 15 gün ödeme yoksa K3).
      </p>
      <Field label="Kademe">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {["K0", "K1", "K2", "K3"].map((l) => (
            <option key={l} value={l}>
              {label(SANCTION_LABEL, l)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vade">
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      {level === "K3" ? (
        <Field label="Kısıtlı kipe geri sayım (gün, vadeden itibaren)">
          <input type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      ) : null}
      {shortK3 ? <HeavyK3Confirmation canHeavy={canHeavy} licenseNo={licenseNo} typed={typed} onTyped={setTyped} what="planlanır" /> : null}
      {level === "K2" ? (
        <div className="field">
          <span className="field-label">Dondurulacak modüller</span>
          <div className="checks">
            {modules.map((m) => (
              <label key={m} className="check">
                <input type="checkbox" checked={selected.includes(m)} onChange={() => setSelected(selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m])} />
                {label(MODULE_LABEL, m)}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <Field label={level === "K0" ? "Mesaj (zorunlu)" : "Mesaj (isteğe bağlı)"}>
        <input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Field label="Sebep (zorunlu)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={submit}>
          Planla
        </Button>
      </ModalActions>
    </Modal>
  );
}

type InstallmentDialog = { kind: "create" } | { kind: "pay"; plan: InstallmentPlan; item: InstallmentItem } | { kind: "close"; plan: InstallmentPlan } | null;

export function InstallmentPanel({ detail, onChanged }: { detail: InstallationDetail; onChanged: () => void }) {
  const api = useApi();
  const canWrite = useCan("yaptirim:yaz");
  const [dialog, setDialog] = useState<InstallmentDialog>(null);
  const name = installationName(detail.kurulum);
  const plans = detail.taksitPlanlari ?? [];
  const done = () => {
    setDialog(null);
    onChanged();
  };
  return (
    <>
      <Section title="Taksit planları" actions={canWrite && detail.hak ? <Button onClick={() => setDialog({ kind: "create" })}>Taksit planı oluştur</Button> : null}>
        {!detail.hak ? <p className="muted">Taksit planı için kurulumun lisans hakkı olmalı.</p> : null}
        {plans.length === 0 ? <p className="muted">Taksit planı yok.</p> : null}
        {plans.map((plan) => (
          <div key={plan.id} className="card">
            <div className="section-head">
              <div>
                <strong>{plan.aciklama}</strong> {plan.aktif ? <Badge tone="info">Açık</Badge> : <Badge>Kapandı{plan.kapanisSebebi ? `: ${plan.kapanisSebebi}` : ""}</Badge>}
                <div className="muted small">
                  Ödemede sonraki vade + {plan.uzatmaGun} gün uzar · vade + {plan.gecikmeGun} gün ödemesiz → K3 ({plan.kisitlamaGun} gün geri sayım)
                </div>
              </div>
              {canWrite && plan.aktif ? (
                <Button variant="ghost" onClick={() => setDialog({ kind: "close", plan })}>
                  Planı kapat
                </Button>
              ) : null}
            </div>
            <Table
              rows={plan.kalemler}
              rowKey={(r) => r.id}
              columns={[
                { header: "#", render: (r) => r.sira },
                { header: "Vade", render: (r) => fmtDate(r.vade) },
                { header: "Tutar", render: (r) => r.tutar, className: "num-col" },
                { header: "Durum", render: (r) => <Badge tone={r.durum === "ODENDI" ? "ok" : r.durum === "GECIKTI" ? "danger" : "neutral"}>{label(INSTALLMENT_STATUS_LABEL, r.durum)}</Badge> },
                { header: "Ödeme", render: (r) => fmtDateTime(r.odemeZamani) },
                {
                  header: "",
                  render: (r) =>
                    canWrite && plan.aktif && (r.durum === "BEKLIYOR" || r.durum === "GECIKTI") ? (
                      <Button variant="ghost" onClick={() => setDialog({ kind: "pay", plan, item: r })}>
                        Ödeme alındı
                      </Button>
                    ) : null,
                },
              ]}
            />
          </div>
        ))}
      </Section>
      {dialog?.kind === "create" ? (
        <InstallmentCreateModal installationId={detail.kurulum.id} target={name} licenseNo={detail.hak?.lisansNo ?? null} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === "pay" ? (
        <ConfirmAction
          title="Ödeme onayı"
          description="Kalem ödendi olur; gecikme K3'ü varsa ters kayıtla kalkar ve geçerlilik bir sonraki vadeye uzar (son kalemde süre sınırı kalkar)."
          targets={[`${name} — ${dialog.plan.aciklama} — taksit ${dialog.item.sira} (${fmtDate(dialog.item.vade)}, ${dialog.item.tutar})`]}
          confirmLabel="Ödemeyi onayla"
          requireReason={false}
          send={(b) => api.post(`/taksit-kalemleri/${dialog.item.id}/odeme`, b)}
          onDone={done}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "close" ? (
        <ConfirmAction
          title="Taksit planını kapat"
          description="Bekleyen kalemler iptal olur; geçerlilik bitişi DEĞİŞMEZ (ayrı eylemle ayarlanır)."
          targets={[`${name} — ${dialog.plan.aciklama}`, ...dialog.plan.kalemler.filter((k) => k.durum === "BEKLIYOR").map((k) => `Taksit ${k.sira} — ${fmtDate(k.vade)} — ${k.tutar} (iptal olur)`)]}
          confirmLabel="Planı kapat"
          danger
          send={(b) => api.post(`/taksit-planlari/${dialog.plan.id}/kapat`, b)}
          onDone={done}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function InstallmentCreateModal({
  installationId,
  target,
  licenseNo,
  onClose,
  onDone,
}: {
  installationId: string;
  target: string;
  licenseNo: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const canHeavy = useCan("yaptirim:agir");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<{ vade: string; tutar: string }[]>([{ vade: "", tutar: "" }]);
  const [extend, setExtend] = useState("15");
  const [grace, setGrace] = useState("15");
  const [restrict, setRestrict] = useState(String(INSTALLMENT_DEFAULT_RESTRICTION_DAYS));
  const [typed, setTyped] = useState("");
  const write = useWrite((b) => api.post(`/kurulumlar/${installationId}/taksit-plani`, b));
  const dayOk = (v: string) => /^\d{1,4}$/.test(v) && Number(v) <= 3650;
  const itemsOk = items.length > 0 && items.every((i) => dateInputToIso(i.vade) !== undefined && /^\d{1,12}(\.\d{1,2})?$/.test(i.tutar) && Number(i.tutar) > 0);
  const shortK3 = dayOk(restrict) && isHeavyPlannedK3("K3", Number(restrict));
  const heavyOk = !shortK3 || (canHeavy && licenseNo !== null && typed.trim() === licenseNo);
  const ok = description.trim() !== "" && itemsOk && dayOk(extend) && dayOk(grace) && dayOk(restrict) && heavyOk;
  const update = (i: number, patch: Partial<{ vade: string; tutar: string }>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const submit = async () => {
    const r = await write.run({
      aciklama: description.trim(),
      kalemler: items.map((i) => ({ vade: dateInputToIso(i.vade), tutar: i.tutar })),
      uzatmaGun: Number(extend),
      gecikmeGun: Number(grace),
      kisitlamaGun: Number(restrict),
      ...(shortK3 ? { onay: typed.trim() } : {}),
    });
    if (r.ok) onDone();
  };
  return (
    <Modal title="Taksit planı" onClose={onClose} busy={write.pending} wide>
      <p>
        <strong>{target}</strong> — plan açılınca geçerlilik bitişi ilk vade + uzatma günü olur.
      </p>
      <Field label="Açıklama">
        <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="field">
        <span className="field-label">Kalemler</span>
        {items.map((it, i) => (
          <div key={i} className="toolbar">
            <input type="date" aria-label={`Vade ${i + 1}`} value={it.vade} onChange={(e) => update(i, { vade: e.target.value })} />
            <input placeholder="Tutar (ör. 15000.00)" aria-label={`Tutar ${i + 1}`} value={it.tutar} onChange={(e) => update(i, { tutar: e.target.value.replace(",", ".") })} />
            {items.length > 1 ? (
              <Button variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                Sil
              </Button>
            ) : null}
          </div>
        ))}
        <Button variant="ghost" onClick={() => setItems([...items, { vade: "", tutar: "" }])} disabled={items.length >= 120}>
          + Kalem ekle
        </Button>
      </div>
      <div className="toolbar">
        <Field label="Uzatma (gün)">
          <input type="number" min={0} value={extend} onChange={(e) => setExtend(e.target.value)} />
        </Field>
        <Field label="Gecikme (gün)">
          <input type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} />
        </Field>
        <Field label="K3 geri sayımı (gün)">
          <input type="number" min={0} value={restrict} onChange={(e) => setRestrict(e.target.value)} />
        </Field>
      </div>
      {shortK3 ? <HeavyK3Confirmation canHeavy={canHeavy} licenseNo={licenseNo} typed={typed} onTyped={setTyped} what="kurulur" /> : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" disabled={!ok || write.pending} onClick={submit}>
          Oluştur
        </Button>
      </ModalActions>
    </Modal>
  );
}

/** Kısa K3 (ağır): yönetici değilse engel iletisi; yöneticiyse lisans numarası AYNEN (ikinci onay). */
function HeavyK3Confirmation({ canHeavy, licenseNo, typed, onTyped, what }: { canHeavy: boolean; licenseNo: string | null; typed: string; onTyped: (v: string) => void; what: string }) {
  if (!canHeavy) return <p className="error">Geri sayımı {HEAVY_K3_MIN_DAYS} günden kısa K3 ağır yaptırımdır: yalnız yönetici tarafından {what}.</p>;
  if (!licenseNo) return <p className="error">Ağır yaptırım lisans numarasıyla onaylanır; bu kurulumun lisans hakkı yok.</p>;
  return (
    <>
      <p className="warn-box">Geri sayımı {HEAVY_K3_MIN_DAYS} günden kısa K3 ağır yaptırımdır: ikinci onay olarak lisans numarasını yazın.</p>
      <Field label="Lisans numarası (ikinci onay)" hint={<>Onay için aynen yazın: <code>{licenseNo}</code></>}>
        <input value={typed} autoComplete="off" spellCheck={false} onChange={(e) => onTyped(e.target.value)} />
      </Field>
    </>
  );
}
