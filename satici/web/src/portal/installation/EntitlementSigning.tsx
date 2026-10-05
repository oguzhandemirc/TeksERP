// HAK İMZA PLANI + SÜRÜM FORMU (satıcı · lisans v2 G4/K2). Plan sunucudan (`GET /haklar/:id/imza-plani`): ara imzacı ·
// kök · kök imzası kuyruğu ve nedeni. Form plana göre parola sorar (ara/kök) ya da sormaz (kuyruk) ve planı gövdede
// `imzaci` olarak beyan eder; plan arada değiştiyse sunucu 409 der ve parolayı KULLANMAZ — form yeni plana göre yenilenir.
// Çevrimdışı ufuk: DEMO/TEST ≤ 45 gün; 400'ü aşan ya da süresiz ufuk yalnız yöneticiye, lisans numarası AYNEN yazılarak.
// Karar sunucuda; burada yalnız gizleme ve ön uyarı.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api";
import { useWrite } from "../../shared/attempt";
import { ModulePicker, modulesReady } from "../../shared/forms";
import { dateInputToIso, fmtDate, isoToDateInput } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { PRODUCTION_MODULE_KEY, SIGNER_PLAN_LABEL, SIGNER_PLAN_REASON_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { isValidityEndRequired } from "../../shared/validity";
import type { EntitlementSummary, EntitlementVersionResult, SigningPlan } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Loading, Modal, ModalActions } from "../../shared/ui";

/** Lisans protokolünün ufuk sınırları — `lisans-protokol/belgeler.ts` · `anahtar-zinciri.ts` aynası (mirrors.test.ts). */
export const OFFLINE_HORIZON_DEFAULT_DAYS = 400;
export const OFFLINE_HORIZON_SHORT_CLASS_DAYS = 45;
export const OFFLINE_HORIZON_MAX_DAYS = 3650;
export const SHORT_HORIZON_CLASSES: readonly string[] = ["DEMO", "TEST"];
export const UNBOUNDED_HORIZON_CLASSES: readonly string[] = ["URETIM", "DR"];

/** Sınıfın ufuk tavanı (satıcı imzası: ara ya da kök). */
export function horizonCeiling(cls: string): number {
  if (SHORT_HORIZON_CLASSES.includes(cls)) return OFFLINE_HORIZON_SHORT_CLASS_DAYS;
  return UNBOUNDED_HORIZON_CLASSES.includes(cls) ? OFFLINE_HORIZON_MAX_DAYS : OFFLINE_HORIZON_DEFAULT_DAYS;
}

/** Uzun ufuk (K2): 400 günü aşan ya da süresiz — yalnız yönetici, ikinci onayla. */
export const isLongHorizon = (days: number | null): boolean => days === null || days > OFFLINE_HORIZON_DEFAULT_DAYS;

/** HAK'ın kayıtlı ufku: süresiz → null · gün · v1 HAK (alan hiç basılmadı) → undefined. */
export function storedHorizon(e: EntitlementSummary): number | null | undefined {
  if (e.cevrimdisiUfukSuresiz) return null;
  return e.cevrimdisiUfukGun ?? undefined;
}

export function horizonText(e: EntitlementSummary): string {
  const h = storedHorizon(e);
  if (h === null) return "Süresiz (uzun ufuk)";
  if (h === undefined) return "— (v1 HAK: sonraki sürüm varsayılanı alır)";
  return `${h} gün${isLongHorizon(h) ? " (uzun ufuk)" : ""}`;
}

/** Plan değişikliğinin (409 `DURUM_CAKISMASI` + `details.imzaci`) kullanıcıya açıklaması. */
export const PLAN_CHANGED_TEXT: Record<SigningPlan["imzaci"], string> = {
  ARA: "İmza planı değişti: kök anahtarı satıcı sunucusunda değil, bu HAK artık ARA İMZACIYLA imzalanır. Form yenilendi — ara imzacı parolasıyla yeniden imzalayın (girilen parola kullanılmadı).",
  KOK: "İmza planı değişti: bu HAK kök anahtarla imzalanır. Form yenilendi — kök anahtar parolasıyla yeniden imzalayın (girilen parola kullanılmadı).",
  KUYRUK:
    "İmza planı değişti: kök anahtarı satıcı sunucusunda değil ve kurulumun derlemesi ara imzalı HAK'ı tanımıyor. Değişiklik kök imzası kuyruğuna girer ve dönem töreninde imzalanır — parola istenmez, formu yeniden gönderin.",
};

export function useSigningPlan(entitlementId: string) {
  return useGet<SigningPlan>(["imza-plani", entitlementId], `/haklar/${entitlementId}/imza-plani`);
}

function planSummary(plan: SigningPlan): string {
  if (plan.imzaci === "KUYRUK") return `${SIGNER_PLAN_LABEL.KUYRUK} — ${label(SIGNER_PLAN_REASON_LABEL, plan.neden)}; değişiklik dönem töreninde Mac'te kökle imzalanır`;
  const why = plan.imzaci === "ARA" ? "kurulum ara imzalı HAK'ı tanıyor" : "kök bu sunucuda yüklü (hazırlık düzeni)";
  return `${label(SIGNER_PLAN_LABEL, plan.imzaci)} (${plan.kid ?? "—"}) — ${why}`;
}

function PendingRootRequest() {
  return (
    <p className="warn-box" role="note">
      Bu HAK için kök imzası bekleyen bir talep var: yeni sürüm, talep imzalanınca ya da iptal edilince yazılabilir. <Link to="/kok-kuyrugu">Kök imzası kuyruğu</Link>
    </p>
  );
}

/** Lisans hakkı panelindeki tek satır: hangi imzacı ve neden (okuma izni yeter; genel yolda da görünür). */
export function SigningPlanNote({ entitlementId }: { entitlementId: string }) {
  const q = useSigningPlan(entitlementId);
  if (!q.data) return null;
  return (
    <>
      <p className="muted small" role="note">
        İmza planı: {planSummary(q.data)}.
      </p>
      {q.data.bekleyenTalep ? <PendingRootRequest /> : null}
    </>
  );
}

interface HorizonState {
  readonly change: boolean;
  readonly days: string;
  readonly unlimited: boolean;
}

function HorizonFields({
  entitlement,
  cls,
  admin,
  value,
  onChange,
  confirm,
  onConfirm,
}: {
  entitlement: EntitlementSummary;
  cls: string;
  admin: boolean;
  value: HorizonState;
  onChange: (v: HorizonState) => void;
  confirm: string;
  onConfirm: (v: string) => void;
}) {
  const ceiling = horizonCeiling(cls);
  const requested = horizonRequest(value);
  const needsConfirm = value.change && requested !== undefined && longGrant(entitlement, requested);
  return (
    <>
      <label className="check field">
        <input type="checkbox" checked={value.change} onChange={(e) => onChange({ ...value, change: e.target.checked })} />
        Çevrimdışı ufku değiştir (şu an: {horizonText(entitlement)})
      </label>
      {value.change ? (
        <>
          <Field
            label="Çevrimdışı ufuk (gün)"
            hint={
              SHORT_HORIZON_CLASSES.includes(cls)
                ? `Bu sınıfta en çok ${OFFLINE_HORIZON_SHORT_CLASS_DAYS} gün.`
                : admin
                  ? `${OFFLINE_HORIZON_DEFAULT_DAYS} günü aşan ufuk uzun ufuktur: lisans numarasıyla ikinci onay ister.`
                  : `En çok ${OFFLINE_HORIZON_DEFAULT_DAYS} gün; daha uzunu yalnız yöneticinin işidir.`
            }
          >
            <input type="number" min={1} max={ceiling} value={value.days} disabled={value.unlimited} onChange={(e) => onChange({ ...value, days: e.target.value })} />
          </Field>
          {admin && UNBOUNDED_HORIZON_CLASSES.includes(cls) ? (
            <label className="check field">
              <input type="checkbox" checked={value.unlimited} onChange={(e) => onChange({ ...value, unlimited: e.target.checked })} />
              Süresiz ufuk (fabrika internetsiz süresiz çalışır)
            </label>
          ) : null}
          {needsConfirm ? (
            <Field label="Lisans numarası (uzun ufuk ikinci onayı)" hint={<>Onay için aynen yazın: <code>{entitlement.lisansNo}</code></>}>
              <input value={confirm} autoComplete="off" spellCheck={false} onChange={(e) => onConfirm(e.target.value)} />
            </Field>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** İstenen ufuk: değiştirilmiyorsa undefined (sunucu kayıtlıyı korur), süresiz null, aksi hâlde gün (geçersizse NaN). */
function horizonRequest(v: HorizonState): number | null | undefined {
  if (!v.change) return undefined;
  if (v.unlimited) return null;
  return v.days.trim() === "" ? Number.NaN : Number(v.days);
}

/** Uzun ufuk bu sürümle YENİ mi veriliyor (kayıtlı uzun ufkun aynısı ikinci onay istemez — sunucu `granted`). */
function longGrant(e: EntitlementSummary, requested: number | null): boolean {
  if (!isLongHorizon(requested)) return false;
  const stored = storedHorizon(e);
  return !(stored !== undefined && isLongHorizon(stored) && stored === requested);
}

/** Ufuk alanı geçerli mi; değilse ekranda gösterilecek neden. */
function horizonProblem(requested: number | null | undefined, cls: string, admin: boolean): string | null {
  if (requested === undefined) return null;
  if (requested !== null && (!Number.isInteger(requested) || requested < 1 || requested > horizonCeiling(cls))) {
    return `Çevrimdışı ufuk 1–${horizonCeiling(cls)} gün olmalı.`;
  }
  if (isLongHorizon(requested) && !admin) return `${OFFLINE_HORIZON_DEFAULT_DAYS} günü aşan ya da süresiz ufuk yalnız yöneticinin işidir.`;
  return null;
}

function QueuedResult({ result, onClose }: { result: Extract<EntitlementVersionResult, { kuyruk: true }>; onClose: () => void }) {
  return (
    <Modal title="Kök imzası kuyruğuna girdi" onClose={onClose}>
      <p>
        Değişiklik (sürüm {result.surum}) kök imzası bekliyor: dönem töreninde Mac'te kökle imzalanıp içe aktarılınca fabrikaya gider. Kurulum o güne dek elindeki
        lisansla çalışır.
      </p>
      <ModalActions>
        <Link to="/kok-kuyrugu">Kök imzası kuyruğuna git</Link>
        <Button variant="primary" onClick={onClose}>
          Kapat
        </Button>
      </ModalActions>
    </Modal>
  );
}

/**
 * Lisansı imzala / yenile (satıcı): HAK'ın yeni sürümü plana göre ara imzacıyla, kökle ya da kök kuyruğuna. Parola yalnız bu
 * istekte gider; form kapanınca bellekten düşer, hiçbir yere yazılmaz.
 */
export function VendorEntitlementVersionModal({
  entitlement,
  installationClass,
  modules,
  onClose,
  onSaved,
}: {
  entitlement: EntitlementSummary;
  installationClass: string;
  modules: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const admin = useCan("hak:uzun-ufuk");
  const planQuery = useSigningPlan(entitlement.id);
  const plan = planQuery.data;
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState(entitlement.guncelSurum === 0 ? "İlk imza" : "");
  const [changeModules, setChangeModules] = useState(false);
  const [selected, setSelected] = useState<string[]>([...entitlement.moduller]);
  const [confirmed, setConfirmed] = useState(false);
  const [makePerpetual, setMakePerpetual] = useState(false);
  const [maintenance, setMaintenance] = useState(isoToDateInput(entitlement.bakimBitis));
  const [horizon, setHorizon] = useState<HorizonState>({ change: false, days: String(storedHorizon(entitlement) ?? Math.min(OFFLINE_HORIZON_DEFAULT_DAYS, horizonCeiling(installationClass))), unlimited: false });
  const [horizonConfirm, setHorizonConfirm] = useState("");
  const [modeFloor, setModeFloor] = useState(entitlement.kipAltSiniriZorla === true);
  const [queued, setQueued] = useState<Extract<EntitlementVersionResult, { kuyruk: true }> | null>(null);
  const write = useWrite<EntitlementVersionResult>((body) => api.post(`/haklar/${entitlement.id}/surum`, body));
  const err = write.error instanceof ApiError ? write.error : null;
  const changedPlan = err?.status === 409 && err.code === "DURUM_CAKISMASI" && typeof err.details.imzaci === "string" ? (err.details.imzaci as SigningPlan["imzaci"]) : null;
  const refetchPlan = planQuery.refetch;
  useEffect(() => {
    if (changedPlan) void refetchPlan();
  }, [changedPlan, refetchPlan]);

  if (queued) return <QueuedResult result={queued} onClose={onSaved} />;
  const maintenanceIso = dateInputToIso(maintenance);
  const maintenanceChanged = maintenanceIso !== undefined && isoToDateInput(entitlement.bakimBitis) !== maintenance;
  const requested = horizonRequest(horizon);
  const problem = horizonProblem(requested, installationClass, admin);
  const confirmNeeded = requested !== undefined && longGrant(entitlement, requested);
  const confirmOk = !confirmNeeded || horizonConfirm.trim() === entitlement.lisansNo;
  const queue = plan?.imzaci === "KUYRUK";
  const submit = async () => {
    if (!plan) return;
    const body: Record<string, unknown> = { imzaci: plan.imzaci, sebep: reason.trim() };
    if (!queue) body.imzaParolasi = password;
    if (changeModules) {
      body.moduller = selected;
      if (!selected.includes(PRODUCTION_MODULE_KEY)) body.uretimModuluCikarilsin = confirmed;
    }
    if (makePerpetual) body.kalici = true;
    if (maintenanceChanged) body.bakimBitis = maintenanceIso;
    if (requested !== undefined) body.cevrimdisiUfukGun = requested;
    if (confirmNeeded) body.onay = horizonConfirm.trim();
    if (modeFloor !== (entitlement.kipAltSiniriZorla === true)) body.kipAltSiniriZorla = modeFloor;
    const r = await write.run(body);
    setPassword("");
    if (!r.ok) return;
    void queryClient.invalidateQueries({ queryKey: ["imza-plani", entitlement.id] });
    void queryClient.invalidateQueries({ queryKey: ["kok-kuyrugu"] });
    if (r.data.kuyruk) setQueued(r.data);
    else onSaved();
  };
  const wrongPassword = err?.code === "IMZA_PAROLASI_HATALI";
  const signingLocked = err?.code === "IMZA_PAROLASI_KILITLI";
  const blocked = !plan || plan.bekleyenTalep !== null;
  return (
    <Modal title={entitlement.guncelSurum === 0 ? "Lisansı imzala" : "Lisansı yenile (yeni imzalı sürüm)"} onClose={onClose} busy={write.pending} wide>
      <p className="muted">
        {entitlement.lisansNo} · şu anki sürüm {entitlement.guncelSurum} · bakım {fmtDate(entitlement.bakimBitis)} · {entitlement.kalici ? "kalıcı" : "vadeli"}
      </p>
      {plan ? (
        <p role="note">
          <Badge tone={queue ? "warn" : "info"}>{label(SIGNER_PLAN_LABEL, plan.imzaci)}</Badge> {planSummary(plan)}.
        </p>
      ) : (
        <Loading />
      )}
      {plan?.bekleyenTalep ? <PendingRootRequest /> : null}
      <label className="check field">
        <input type="checkbox" checked={changeModules} onChange={(e) => setChangeModules(e.target.checked)} />
        Modül tavanını değiştir
      </label>
      {changeModules ? (
        <ModulePicker available={modules} value={selected} onChange={setSelected} productionRemovalConfirmed={confirmed} onProductionRemovalConfirmed={setConfirmed} />
      ) : null}
      {!entitlement.kalici && !isValidityEndRequired(installationClass) ? (
        <label className="check field">
          <input type="checkbox" checked={makePerpetual} onChange={(e) => setMakePerpetual(e.target.checked)} />
          Kalıcıya çevir (vadeli geçerlilik bitişi kalkar)
        </label>
      ) : null}
      <Field label="Bakım bitişi" hint="Bakım süresini uzatmak yeni sürüm ister.">
        <input type="date" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
      </Field>
      <HorizonFields entitlement={entitlement} cls={installationClass} admin={admin} value={horizon} onChange={setHorizon} confirm={horizonConfirm} onConfirm={setHorizonConfirm} />
      {problem ? <p className="error">{problem}</p> : null}
      <label className="check field">
        <input type="checkbox" checked={modeFloor} onChange={(e) => setModeFloor(e.target.checked)} />
        Kip alt sınırı: zorla (fabrika gözlem kipine inemez)
      </label>
      <Field label="Sebep (deftere yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {plan && !queue ? (
        <Field label={plan.imzaci === "ARA" ? "Ara imzacı parolası" : "Kök anahtar parolası"} hint="Yalnız bu imza için kullanılır; kaydedilmez.">
          <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      ) : null}
      {queue ? <p className="muted small">Parola istenmez: değişiklik kök imzası kuyruğuna girer.</p> : null}
      {changedPlan ? (
        <p className="error" role="alert">
          {PLAN_CHANGED_TEXT[changedPlan]}
        </p>
      ) : wrongPassword ? (
        <p className="error">Parola hatalı. Art arda hatalı denemede imza bir süre kilitlenir.</p>
      ) : signingLocked ? (
        <p className="error" role="alert">
          Çok sayıda hatalı parola: imza geçici olarak kilitli ({err?.message}). Portalı kullanmaya devam edebilirsiniz.
        </p>
      ) : (
        <ErrorText error={write.error} />
      )}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={write.pending || blocked || (!queue && !password) || !reason.trim() || problem !== null || !confirmOk || (changeModules && !modulesReady(selected, confirmed))}
        >
          {write.pending ? "Gönderiliyor…" : queue ? "Kök kuyruğuna gönder" : "İmzala"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
