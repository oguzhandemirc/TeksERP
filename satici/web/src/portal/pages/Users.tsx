// PORTAL KULLANICILARI (yalnız yönetici) — hesap aç (TOTP kurulumu BURADA: sır ve QR yalnız bu canlı
// yanıtta bir kez; kullanıcı ilk girişten önce doğrulayıcısına okutur), TOTP sıfırla (telefon kaybı —
// kurtarma kodu YOK), kilit aç, parola sıfırla, pasife al. Satıcı rolleri yalnız tailnet'ten, BAYI
// yalnız genel adresten girer.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { ROLE_LABEL, label } from "../../shared/labels";
import { OnceSecretModal } from "../../shared/OnceSecret";
import type { PortalRole } from "../../shared/permissions";
import { useApi, useUser } from "../../shared/session";
import type { Dealer, PortalUserView, TotpEnrollmentResponse } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,59}$/;
const ROLES: readonly PortalRole[] = ["SATICI_YONETICI", "SATICI_OPERATOR", "BAYI"];

type Dialog =
  | { kind: "create" }
  | { kind: "totp"; user: PortalUserView }
  | { kind: "unlock"; user: PortalUserView }
  | { kind: "password"; user: PortalUserView }
  | { kind: "active"; user: PortalUserView }
  | null;

export function userLabel(u: PortalUserView, dealers: readonly Dealer[]): string {
  const dealer = u.bayiId ? dealers.find((d) => d.id === u.bayiId)?.ad : null;
  return `${u.adSoyad} (${u.kullaniciAdi}) — ${label(ROLE_LABEL, u.rol)}${dealer ? ` · ${dealer}` : ""}`;
}

export function UsersPage() {
  const api = useApi();
  const me = useUser();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const dealerFilter = params.get("bayiId");
  const list = useGet<PortalUserView[]>(["kullanicilar"], "/kullanicilar");
  const dealersQ = useGet<Dealer[]>(["bayiler"], "/bayiler");
  const dealers = dealersQ.data ?? [];
  const [dialog, setDialog] = useState<Dialog>(null);
  const [secret, setSecret] = useState<TotpEnrollmentResponse | null>(null);
  const rows = (list.data ?? []).filter((u) => !dealerFilter || u.bayiId === dealerFilter);
  const refresh = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["kullanicilar"] });
  };
  const showSecret = (r: TotpEnrollmentResponse) => {
    refresh();
    setSecret(r);
  };
  return (
    <>
      <PageTitle
        title="Portal kullanıcıları"
        sub="Giriş: kullanıcı adı + parola + doğrulama kodu. Kurtarma kodu yoktur; telefon kaybında doğrulama kodu buradan sıfırlanır."
        actions={<Button variant="primary" onClick={() => setDialog({ kind: "create" })}>Yeni kullanıcı</Button>}
      />
      <Section title={dealerFilter ? `Bayi kullanıcıları — ${dealers.find((d) => d.id === dealerFilter)?.ad ?? ""}` : "Liste"}>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Kullanıcı", render: (r) => <code>{r.kullaniciAdi}</code> },
            { header: "Ad soyad", render: (r) => r.adSoyad },
            { header: "Rol", render: (r) => label(ROLE_LABEL, r.rol) },
            { header: "Bayi", render: (r) => (r.bayiId ? (dealers.find((d) => d.id === r.bayiId)?.ad ?? "—") : "—") },
            {
              header: "Durum",
              render: (r) => (!r.aktif ? <Badge>Pasif</Badge> : r.kilitli ? <Badge tone="warn">Kilitli ({fmtDateTime(r.kilitBitis)})</Badge> : <Badge tone="ok">Aktif</Badge>),
            },
            { header: "Son giriş", render: (r) => fmtDateTime(r.sonGiris) },
            {
              header: "",
              render: (r) => (
                <span className="section-actions">
                  {r.kilitli ? (
                    <Button variant="ghost" onClick={() => setDialog({ kind: "unlock", user: r })}>
                      Kilidi aç
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setDialog({ kind: "totp", user: r })}>
                    Doğrulama kodunu sıfırla
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: "password", user: r })}>
                    Parola sıfırla
                  </Button>
                  {r.id !== me.id ? (
                    <Button variant="ghost" onClick={() => setDialog({ kind: "active", user: r })}>
                      {r.aktif ? "Pasife al" : "Aktif et"}
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Section>

      {dialog?.kind === "create" ? <UserCreateModal dealers={dealers} presetDealerId={dealerFilter} onClose={() => setDialog(null)} onCreated={showSecret} /> : null}
      {dialog?.kind === "totp" ? (
        <ConfirmAction<TotpEnrollmentResponse>
          title="Doğrulama kodunu sıfırla"
          description="Eski doğrulayıcı geçersiz olur ve kullanıcının açık oturumları kapanır. Yeni QR kodu yalnız bir sonraki ekranda BİR KEZ gösterilir; kullanıcıya güvenli yoldan iletin."
          targets={[userLabel(dialog.user, dealers)]}
          confirmLabel="Sıfırla"
          danger
          send={(b) => api.post(`/kullanicilar/${dialog.user.id}/totp-sifirla`, b)}
          onDone={showSecret}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "unlock" ? (
        <ConfirmAction
          title="Hesap kilidini aç"
          description="Ardışık başarısız girişle konan süreli kilit kalkar."
          targets={[userLabel(dialog.user, dealers)]}
          confirmLabel="Kilidi aç"
          requireReason={false}
          send={(b) => api.post(`/kullanicilar/${dialog.user.id}/kilit-ac`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "active" ? (
        <ConfirmAction
          title={dialog.user.aktif ? "Kullanıcıyı pasife al" : "Kullanıcıyı aktif et"}
          description={dialog.user.aktif ? "Kullanıcı giriş yapamaz; açık oturumları kapanır. Geçmiş eylemleri defterde kalır." : "Kullanıcı yeniden giriş yapabilir."}
          targets={[userLabel(dialog.user, dealers)]}
          confirmLabel={dialog.user.aktif ? "Pasife al" : "Aktif et"}
          danger={dialog.user.aktif}
          send={(b) => api.post(`/kullanicilar/${dialog.user.id}/${dialog.user.aktif ? "pasif" : "aktif"}`, b)}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "password" ? <PasswordResetModal user={dialog.user} target={userLabel(dialog.user, dealers)} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {secret ? (
        <OnceSecretModal
          title={`Doğrulayıcı kurulumu — ${secret.kullanici.kullaniciAdi}`}
          secret={secret.totp?.sir ?? null}
          qrValue={secret.totp?.otpauthUri ?? null}
          unavailable={secret.totpGosterilemez === true || secret.totp === null}
          note="Kullanıcı bu QR kodunu doğrulayıcı uygulamasına okutmadan giriş yapamaz. Kod okutulamıyorsa aşağıdaki anahtar elle girilir."
          onClose={() => setSecret(null)}
        />
      ) : null}
    </>
  );
}

function UserCreateModal({
  dealers,
  presetDealerId,
  onClose,
  onCreated,
}: {
  dealers: readonly Dealer[];
  presetDealerId: string | null;
  onClose: () => void;
  onCreated: (r: TotpEnrollmentResponse) => void;
}) {
  const api = useApi();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<PortalRole>(presetDealerId ? "BAYI" : "SATICI_OPERATOR");
  const [dealerId, setDealerId] = useState(presetDealerId ?? "");
  const [password, setPassword] = useState("");
  const write = useWrite<TotpEnrollmentResponse>((b) => api.post("/kullanicilar", b));
  const name = username.trim().toLowerCase();
  const ok = USERNAME.test(name) && fullName.trim() !== "" && password.length >= 12 && (role !== "BAYI" || dealerId !== "");
  const submit = async () => {
    const r = await write.run({ kullaniciAdi: name, adSoyad: fullName.trim(), rol: role, bayiId: role === "BAYI" ? dealerId : null, parola: password });
    setPassword("");
    if (r.ok) onCreated(r.data);
  };
  return (
    <Modal title="Yeni portal kullanıcısı" onClose={onClose} busy={write.pending}>
      <Field label="Kullanıcı adı" hint="3–60 karakter: küçük harf, rakam, nokta, alt çizgi, tire.">
        <input value={username} autoCapitalize="none" spellCheck={false} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="Ad soyad">
        <input value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="Rol" hint="Satıcı rolleri yalnız tailnet adresinden, bayi yalnız genel adresten giriş yapar.">
        <select value={role} onChange={(e) => setRole(e.target.value as PortalRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {label(ROLE_LABEL, r)}
            </option>
          ))}
        </select>
      </Field>
      {role === "BAYI" ? (
        <Field label="Bayi">
          <select value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
            <option value="">— Bayi seçin —</option>
            {dealers
              .filter((d) => d.aktif || d.id === dealerId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.ad}
                </option>
              ))}
          </select>
        </Field>
      ) : null}
      <Field label="İlk parola" hint="En az 12 karakter; kullanıcı ilk girişten sonra Hesabım'dan değiştirir.">
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <p className="muted small">Kaydedince doğrulayıcı QR kodu yalnız bir kez gösterilir.</p>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ok || write.pending}>
          Oluştur
        </Button>
      </ModalActions>
    </Modal>
  );
}

function PasswordResetModal({ user, target, onClose, onDone }: { user: PortalUserView; target: string; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const write = useWrite((b) => api.post(`/kullanicilar/${user.id}/parola`, b));
  const ok = password.length >= 12 && reason.trim() !== "";
  const submit = async () => {
    const r = await write.run({ parola: password, sebep: reason.trim() });
    setPassword("");
    if (r.ok) onDone();
  };
  return (
    <Modal title="Parola sıfırla" onClose={onClose} busy={write.pending}>
      <p>
        <strong>{target}</strong> — kullanıcının açık oturumları kapanır.
      </p>
      <Field label="Yeni parola" hint="En az 12 karakter.">
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Sebep (zorunlu)">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="danger" onClick={submit} disabled={!ok || write.pending}>
          Parolayı sıfırla
        </Button>
      </ModalActions>
    </Modal>
  );
}
