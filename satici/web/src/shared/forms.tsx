// Satıcı ve bayi arayüzünün ORTAK formları (müşteri · tesis · kurulum · HAK · HAK sürümü ·
// etkinleştirme kodu). Uç yolları çağıran verir; her form bir mantıksal deneme = bir işlem kimliği.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { useWrite } from "./attempt";
import { dateInputToIso, fmtDate, isoToDateInput } from "./format";
import { CLASS_LABEL, MODULE_LABEL, PRODUCTION_MODULE_KEY, label } from "./labels";
import { OnceSecretModal } from "./OnceSecret";
import { useApi, useCan } from "./session";
import { defaultGroupFor, groupName } from "./update-groups";
import { isValidityEndRequired } from "./validity";
import type { ActivationCodeCreated, Customer, EntitlementSummary, Installation, Ref, Site } from "./types";
import { Button, ErrorText, Field, Modal, ModalActions } from "./ui";
import { CLOUD_RETENTION_DEFAULT, RETENTION_CHOICES, SYNC_MINUTES_DEFAULT, SYNC_MINUTES_MAX, SYNC_MINUTES_MIN, retentionBody, retentionValue } from "./cloud-settings";

// ---------------------------------------------------------------- modül seçici

/** Üretim modülü varsayılan dahildir; çıkarılırsa açık onay kutusu işaretlenmeden form gönderilmez. */
export function ModulePicker({
  available,
  value,
  onChange,
  productionRemovalConfirmed,
  onProductionRemovalConfirmed,
}: {
  available: readonly string[];
  value: readonly string[];
  onChange: (v: string[]) => void;
  productionRemovalConfirmed: boolean;
  onProductionRemovalConfirmed: (v: boolean) => void;
}) {
  const toggle = (m: string) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  const productionOff = !value.includes(PRODUCTION_MODULE_KEY);
  return (
    <div className="field">
      <span className="field-label">Modüller (lisans tavanı)</span>
      <div className="checks">
        {available.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={value.includes(m)} onChange={() => toggle(m)} />
            {label(MODULE_LABEL, m)}
          </label>
        ))}
      </div>
      {productionOff ? (
        <div className="warn-box">
          Üretim modülü lisanstan çıkarılıyor: fabrikada üretim ekranları ve tablet üretim girişi kapanır.
          <label className="check">
            <input type="checkbox" checked={productionRemovalConfirmed} onChange={(e) => onProductionRemovalConfirmed(e.target.checked)} />
            Üretim modülünü bilerek çıkarıyorum
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function modulesReady(value: readonly string[], confirmed: boolean): boolean {
  return value.includes(PRODUCTION_MODULE_KEY) || confirmed;
}

/** Bakım bitişi bugünden `months` takvim ayı sonrasını aşıyor mu (yalnız ön uyarı; kararı sunucu verir). */
export function maintenanceBeyond(iso: string | undefined, months: number | undefined, nowMs = Date.now()): boolean {
  if (!iso || months === undefined) return false;
  const limit = new Date(nowMs);
  limit.setUTCMonth(limit.getUTCMonth() + months);
  return Date.parse(iso) > limit.getTime() + 86_400_000;
}

// ---------------------------------------------------------------- müşteri · tesis

export function CustomerFormModal({
  customer,
  dealers,
  onClose,
  onSaved,
}: {
  /** Verilirse düzenleme (PATCH `/musteriler/:id`, yalnız satıcı); yoksa yeni (POST `/musteriler`). */
  customer?: Customer;
  dealers?: readonly Ref[];
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(customer?.ad ?? "");
  const [taxNo, setTaxNo] = useState(customer?.vergiNo ?? "");
  const [dealerId, setDealerId] = useState(customer?.bayiId ?? "");
  // Bayi bağı (atama · değişim · kaldırma) yalnız yöneticinin (sunucu da 403 verir); operatör bağı görür, değiştiremez.
  const canAssignDealer = useCan("bayi:yonet");
  const write = useWrite<Customer>((body) => (customer ? api.patch(`/musteriler/${customer.id}`, body) : api.post("/musteriler", body)));
  const submit = async () => {
    const body: Record<string, unknown> = { ad: name.trim(), vergiNo: taxNo.trim() || null };
    if (dealers && canAssignDealer) body.bayiId = dealerId || null;
    const r = await write.run(body);
    if (r.ok) onSaved(r.data);
  };
  return (
    <Modal title={customer ? "Müşteriyi düzenle" : "Yeni müşteri"} onClose={onClose} busy={write.pending}>
      <Field label="Ad">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Vergi no (isteğe bağlı)">
        <input value={taxNo} maxLength={20} onChange={(e) => setTaxNo(e.target.value)} />
      </Field>
      {dealers ? (
        <Field label="Bayi" hint={canAssignDealer ? "Boş: müşteriyi doğrudan satıcı yönetir." : "Bayi bağını yalnız yönetici değiştirir."}>
          <select value={dealerId} disabled={!canAssignDealer} onChange={(e) => setDealerId(e.target.value)}>
            <option value="">— Doğrudan satıcı —</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.ad}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !name.trim()}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function SiteFormModal({ customerId, site, onClose, onSaved }: { customerId: string; site?: Site; onClose: () => void; onSaved: (s: Site) => void }) {
  const api = useApi();
  const [name, setName] = useState(site?.ad ?? "");
  const write = useWrite<Site>((body) => (site ? api.patch(`/tesisler/${site.id}`, body) : api.post("/tesisler", body)));
  const submit = async () => {
    const r = await write.run(site ? { ad: name.trim() } : { musteriId: customerId, ad: name.trim() });
    if (r.ok) onSaved(r.data);
  };
  return (
    <Modal title={site ? "Tesisi düzenle" : "Yeni tesis"} onClose={onClose} busy={write.pending}>
      <Field label="Tesis adı">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !name.trim()}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}

// ---------------------------------------------------------------- kurulum

/**
 * Kurulumun lisans kimliği (`kurulumId`) SUNUCUDA doğar (D14) — formda sorulmaz; fabrikaya etkinleştirme
 * yanıtıyla gider. Etkinleştirme kodu bu kuruluma bağlıdır ve başka kurulumu etkinleştiremez.
 */
export function InstallationFormModal({
  siteId,
  classes,
  installation,
  allowPollInterval,
  channelOptions,
  noChannelText,
  onClose,
  onSaved,
}: {
  siteId: string;
  classes: readonly string[];
  installation?: Installation;
  /** Yoklama aralığı yalnız satıcıda. */
  allowPollInterval: boolean;
  /** Seçilebilir güncelleme grupları (satıcıda aktif gruplar, bayide tavandaki gruplar). */
  channelOptions: readonly string[];
  /** Seçilebilir grup yokken gösterilen yönlendirme. */
  noChannelText: string;
  onClose: () => void;
  onSaved: (i: Installation) => void;
}) {
  const api = useApi();
  const [cls, setCls] = useState(installation?.sinif ?? classes[0] ?? "URETIM");
  const [channel, setChannel] = useState(installation?.kanalKodu ?? "");
  const [name, setName] = useState(installation?.ad ?? "");
  const [poll, setPoll] = useState(String(installation?.yoklamaAraligiDk ?? 60));
  const [sync, setSync] = useState(String(installation?.esitlemeAraligiDk ?? SYNC_MINUTES_DEFAULT));
  const [retention, setRetention] = useState(retentionValue(installation ? installation.bulutSaklamaAy : CLOUD_RETENTION_DEFAULT));
  const write = useWrite<Installation>((body) => (installation ? api.patch(`/kurulumlar/${installation.id}`, body) : api.post("/kurulumlar", body)));
  // Düzenlenen kurulumun bugünkü grubu listede olmasa da (emekli kanal ya da tavandan çıkmış) seçili görünür.
  const currentRetired = installation !== undefined && !channelOptions.includes(installation.kanalKodu);
  const channelChoices = installation && currentRetired ? [installation.kanalKodu, ...channelOptions] : channelOptions;
  const groupChanged = installation !== undefined && channel !== installation.kanalKodu;
  const submit = async () => {
    // Boş grup gönderilmez (sunucu sınıftan seçer); düzenlemede grup yalnız değiştiyse gider.
    const body: Record<string, unknown> = { ad: name.trim() || null };
    if (!installation) {
      body.tesisId = siteId;
      body.sinif = cls;
      if (channel) body.kanalKodu = channel;
    } else {
      if (cls !== installation.sinif) body.sinif = cls;
      if (groupChanged) body.kanalKodu = channel;
    }
    if (allowPollInterval) {
      body.yoklamaAraligiDk = Number(poll);
      body.esitlemeAraligiDk = Number(sync);
      body.bulutSaklamaAy = retentionBody(retention);
    }
    const r = await write.run(body);
    if (r.ok) onSaved(r.data);
  };
  return (
    <Modal title={installation ? "Kurulumu düzenle" : "Yeni kurulum"} onClose={onClose} busy={write.pending}>
      {installation ? null : <p className="field-hint">Lisans kimliği kaydedince üretilir; fabrikaya etkinleştirme koduyla gider.</p>}
      <Field label="Lisans sınıfı" hint={installation ? "İmzalı hakkı olan kurulumun sınıfı değişmez." : undefined}>
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          {classes.map((c) => (
            <option key={c} value={c}>
              {label(CLASS_LABEL, c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Güncelleme grubu" hint="Kurulum hangi sürümleri hangi sırayla alır (test → öncü → genel).">
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {installation ? null : <option value="">Sınıftan: {groupName(defaultGroupFor(cls))}</option>}
          {channelChoices.map((c) => (
            <option key={c} value={c}>
              {groupName(c)}
              {installation && currentRetired && c === installation.kanalKodu ? " — emekli kanal" : ""}
            </option>
          ))}
        </select>
      </Field>
      {channelOptions.length === 0 ? <p className="error">{noChannelText}</p> : null}
      {groupChanged ? (
        <p className="field-hint">Geri sürüm yok: kurulum daha geride bir gruba alınırsa o grup kurulumun sürümüne yetişene dek güncelleme almaz; sonraki yoklamada yeni grup kiraya geçer.</p>
      ) : null}
      <Field label="Ad (isteğe bağlı)">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      {allowPollInterval ? (
        <Field label="Yoklama aralığı (dakika)">
          <input type="number" min={5} max={1440} value={poll} onChange={(e) => setPoll(e.target.value)} />
        </Field>
      ) : null}
      {allowPollInterval ? (
        <Field label="Patron bulutu eşitleme aralığı (dakika)" hint="1–60 dk; kiraya yazılır, fabrika bu aralıkla eşitler (patron bulutu hakkı varsa).">
          <input type="number" min={SYNC_MINUTES_MIN} max={SYNC_MINUTES_MAX} value={sync} onChange={(e) => setSync(e.target.value)} />
        </Field>
      ) : null}
      {allowPollInterval ? (
        <Field label="Buluttaki geçmiş" hint="Patron bulutunda tutulan geçmişin süresi; daha eskisi buluttan budanır.">
          <select value={retention} onChange={(e) => setRetention(e.target.value)}>
            {RETENTION_CHOICES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending}>
          Kaydet
        </Button>
      </ModalActions>
    </Modal>
  );
}

// ---------------------------------------------------------------- HAK

/** HAK taslağı (imzasız): modüller + kalıcı + bakım bitişi (+ DEMO'da zorunlu geçerlilik bitişi). İmza ayrı adımdır (parolalı sürüm). */
export function EntitlementCreateModal({
  installation,
  modules,
  defaultModules,
  allowPerpetual = true,
  maxMaintenanceMonths,
  onClose,
  onSaved,
}: {
  installation: Installation;
  modules: readonly string[];
  defaultModules: readonly string[];
  allowPerpetual?: boolean;
  maxMaintenanceMonths?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [selected, setSelected] = useState<string[]>(defaultModules.filter((m) => modules.includes(m)));
  const [confirmed, setConfirmed] = useState(false);
  const [perpetual, setPerpetual] = useState(allowPerpetual);
  const [maintenance, setMaintenance] = useState(isoToDateInput(new Date(Date.now() + 365 * 86_400_000).toISOString()));
  const validityRequired = isValidityEndRequired(installation.sinif);
  const [validity, setValidity] = useState("");
  const write = useWrite<EntitlementSummary>((body) => api.post(`/kurulumlar/${installation.id}/hak`, body));
  const iso = dateInputToIso(maintenance);
  const validityIso = validityRequired ? dateInputToIso(validity) : undefined;
  const tooLate = maintenanceBeyond(iso, maxMaintenanceMonths);
  const submit = async () => {
    const r = await write.run({
      moduller: selected,
      kalici: perpetual,
      bakimBitis: iso,
      ...(validityIso ? { gecerlilikBitis: validityIso } : {}),
      ...(selected.includes(PRODUCTION_MODULE_KEY) ? {} : { uretimModuluCikarilsin: confirmed }),
    });
    if (r.ok) onSaved();
  };
  return (
    <Modal title="Lisans hakkı oluştur" onClose={onClose} busy={write.pending} wide>
      <p className="muted">Hak önce taslak olarak doğar; fabrikaya gitmesi için “Lisansı imzala” ile imzalanmalıdır.</p>
      <ModulePicker available={modules} value={selected} onChange={setSelected} productionRemovalConfirmed={confirmed} onProductionRemovalConfirmed={setConfirmed} />
      <label className="check field">
        <input type="checkbox" checked={perpetual} disabled={!allowPerpetual} onChange={(e) => setPerpetual(e.target.checked)} />
        Kalıcı lisans (süre sınırı yok; bakım biterse program durmaz, son hak edilen sürümde kalır)
      </label>
      {!allowPerpetual ? <p className="muted small">Tavanınız kalıcı lisansa izin vermiyor: lisans vadeli doğar.</p> : null}
      <Field label="Bakım bitişi" hint={maxMaintenanceMonths ? `En geç bugünden ${maxMaintenanceMonths} ay sonra.` : undefined}>
        <input type="date" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
      </Field>
      {tooLate ? <p className="error">Bakım bitişi tavanı aşıyor (en çok {maxMaintenanceMonths} ay).</p> : null}
      {validityRequired ? (
        <Field label="Geçerlilik bitişi (zorunlu)" hint={`${label(CLASS_LABEL, installation.sinif)} lisansı bitiş tarihi olmadan kaydedilemez.`}>
          <input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} />
        </Field>
      ) : null}
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !iso || tooLate || (validityRequired && !validityIso) || !modulesReady(selected, confirmed)}>
          Oluştur
        </Button>
      </ModalActions>
    </Modal>
  );
}

/**
 * Lisansı imzala / yenile: HAK'ın yeni imzalı sürümü. Parola (satıcıda KÖK, bayide BAYİ parolası)
 * yalnız bu istekte gider; form kapanınca bellekten düşer, hiçbir yere yazılmaz.
 */
export function EntitlementVersionModal({
  entitlement,
  installationClass,
  modules,
  passwordField,
  passwordLabel,
  allowPerpetual = true,
  maxMaintenanceMonths,
  onClose,
  onSaved,
}: {
  entitlement: EntitlementSummary;
  /** Bitişi zorunlu sınıfta (DEMO) "kalıcıya çevir" sunulmaz — sunucu da reddeder. */
  installationClass?: string;
  modules: readonly string[];
  passwordField: "kokParolasi" | "bayiParolasi";
  passwordLabel: string;
  allowPerpetual?: boolean;
  maxMaintenanceMonths?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState(entitlement.guncelSurum === 0 ? "İlk imza" : "");
  const [changeModules, setChangeModules] = useState(false);
  const [selected, setSelected] = useState<string[]>([...entitlement.moduller]);
  const [confirmed, setConfirmed] = useState(false);
  const [makePerpetual, setMakePerpetual] = useState(false);
  const [maintenance, setMaintenance] = useState(isoToDateInput(entitlement.bakimBitis));
  const write = useWrite<unknown>((body) => api.post(`/haklar/${entitlement.id}/surum`, body));
  const maintenanceIso = dateInputToIso(maintenance);
  const maintenanceChanged = maintenanceIso !== undefined && isoToDateInput(entitlement.bakimBitis) !== maintenance;
  const tooLate = maintenanceChanged && maintenanceBeyond(maintenanceIso, maxMaintenanceMonths);
  const submit = async () => {
    const body: Record<string, unknown> = { [passwordField]: password, sebep: reason.trim() };
    if (changeModules) {
      body.moduller = selected;
      if (!selected.includes(PRODUCTION_MODULE_KEY)) body.uretimModuluCikarilsin = confirmed;
    }
    if (makePerpetual) body.kalici = true;
    if (maintenanceChanged) body.bakimBitis = maintenanceIso;
    const r = await write.run(body);
    setPassword("");
    if (r.ok) onSaved();
  };
  const wrongPassword = write.error instanceof ApiError && write.error.code === "IMZA_PAROLASI_HATALI";
  const signingLocked = write.error instanceof ApiError && write.error.code === "IMZA_PAROLASI_KILITLI";
  return (
    <Modal title={entitlement.guncelSurum === 0 ? "Lisansı imzala" : "Lisansı yenile (yeni imzalı sürüm)"} onClose={onClose} busy={write.pending} wide>
      <p className="muted">
        {entitlement.lisansNo} · şu anki sürüm {entitlement.guncelSurum} · bakım {fmtDate(entitlement.bakimBitis)} · {entitlement.kalici ? "kalıcı" : "vadeli"}
      </p>
      <label className="check field">
        <input type="checkbox" checked={changeModules} onChange={(e) => setChangeModules(e.target.checked)} />
        Modül tavanını değiştir
      </label>
      {changeModules ? (
        <ModulePicker available={modules} value={selected} onChange={setSelected} productionRemovalConfirmed={confirmed} onProductionRemovalConfirmed={setConfirmed} />
      ) : null}
      {!entitlement.kalici && allowPerpetual && !isValidityEndRequired(installationClass) ? (
        <label className="check field">
          <input type="checkbox" checked={makePerpetual} onChange={(e) => setMakePerpetual(e.target.checked)} />
          Kalıcıya çevir (vadeli geçerlilik bitişi kalkar)
        </label>
      ) : null}
      <Field label="Bakım bitişi" hint="Bakım süresini uzatmak yeni sürüm ister.">
        <input type="date" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
      </Field>
      {tooLate ? <p className="error">Bakım bitişi tavanı aşıyor (en çok {maxMaintenanceMonths} ay).</p> : null}
      <Field label="Sebep (deftere yazılır)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={passwordLabel} hint="Yalnız bu imza için kullanılır; kaydedilmez.">
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {wrongPassword ? (
        <p className="error">Parola hatalı. Art arda hatalı denemede imza bir süre kilitlenir.</p>
      ) : signingLocked ? (
        <p className="error" role="alert">
          Çok sayıda hatalı parola: imza geçici olarak kilitli ({(write.error as ApiError).message}). Portalı kullanmaya devam edebilirsiniz.
        </p>
      ) : (
        <ErrorText error={write.error} />
      )}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || !password || !reason.trim() || tooLate || (changeModules && !modulesReady(selected, confirmed))}>
          {write.pending ? "İmzalanıyor…" : "İmzala"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

// ---------------------------------------------------------------- etkinleştirme kodu

/** Kod üretir ve yalnız canlı yanıtta BİR KEZ gösterir; kapanınca bir daha gösterilemez. */
export function ActivationCodeAction({ installation, disabled }: { installation: Installation; disabled?: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [shown, setShown] = useState<ActivationCodeCreated | null>(null);
  const write = useWrite<ActivationCodeCreated>((body) => api.post(`/kurulumlar/${installation.id}/etkinlestirme-kodu`, body));
  const submit = async () => {
    const r = await write.run({ gecerlilikGun: Number(days) });
    if (r.ok) {
      setOpen(false);
      setShown(r.data);
      void queryClient.invalidateQueries({ queryKey: ["kurulum", installation.id] });
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        Etkinleştirme kodu üret
      </Button>
      {open ? (
        <Modal title="Etkinleştirme kodu üret" onClose={() => setOpen(false)} busy={write.pending}>
          <p>
            Kod yalnız <strong>{installation.ad ?? installation.kurulumId}</strong> kurulumunu etkinleştirir ve tek kullanımlıktır.
          </p>
          <Field label="Geçerlilik (gün)">
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <ErrorText error={write.error} />
          <ModalActions>
            <Button onClick={() => setOpen(false)} disabled={write.pending}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={submit} disabled={write.pending || !(Number(days) >= 1 && Number(days) <= 365)}>
              Üret
            </Button>
          </ModalActions>
        </Modal>
      ) : null}
      {shown ? (
        <OnceSecretModal
          title="Etkinleştirme kodu"
          secret={shown.kod}
          unavailable={shown.kodGosterilemez === true}
          note={`Kodu fabrikanın yöneticisine iletin (son geçerlilik ${fmtDate(shown.gecerlilikBitis)}).`}
          onClose={() => setShown(null)}
        />
      ) : null}
    </>
  );
}
