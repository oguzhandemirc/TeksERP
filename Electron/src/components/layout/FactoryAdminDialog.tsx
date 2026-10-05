import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Copy, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { userFormSchema } from "@/pages/Access/Users/UserFormDialog";
import { adminUserService, type FactoryAdminCreated } from "@/services/adminUserService";
import { isAmbiguousFailure } from "@/lib/attemptToken";

const schema = userFormSchema.pick({ username: true, fullName: true });

/** Uç clientToken taşımaz (beyanlı istisna): kaybolan 201'in ikinci denemesi bu 409'u alır. */
export const FACTORY_ADMIN_EXISTS = "FACTORY_ADMIN_EXISTS";

/** Hata sonucu: belirsiz (cevap gelmedi) · zaten var (önceki deneme sonuçlanmış olabilir) · diğer (toast söyler). */
type Outcome = "uncertain" | "exists" | null;

function outcomeOf(error: unknown): Outcome {
  if (isAmbiguousFailure(error)) return "uncertain";
  const code = axios.isAxiosError(error)
    ? (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code
    : undefined;
  return code === FACTORY_ADMIN_EXISTS ? "exists" : null;
}

interface Props {
  open: boolean;
  /** Pencere kapandı — kart `/auth/me`yi tazeler (açıldı · zaten vardı · sonuç belirsiz). */
  onClose: () => void;
}

/**
 * Fabrika yöneticisini açar: parolayı ve yetkiyi SUNUCU belirler; geçici parola yalnız
 * bu pencerede, bir kez gösterilir ve pencere kapanınca bellekten atılır.
 */
export function FactoryAdminDialog({ open, onClose }: Props) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [errors, setErrors] = useState<{ username?: string; fullName?: string }>({});
  const [created, setCreated] = useState<FactoryAdminCreated | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (body: { username: string; fullName: string }) => adminUserService.createFactoryAdmin(body),
    onSuccess: (data) => setCreated(data),
    onError: (error) => setOutcome(outcomeOf(error)),
  });

  const close = () => {
    setCreated(null);
    setUsername("");
    setFullName("");
    setErrors({});
    setOutcome(null);
    mutation.reset();
    onClose();
  };

  const goToUsers = () => {
    close();
    navigate("/access/users");
  };

  const submit = () => {
    const parsed = schema.safeParse({ username, fullName });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ username: f.username?.[0], fullName: f.fullName?.[0] });
      return;
    }
    setErrors({});
    setOutcome(null);
    mutation.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {created ? "Fabrika yöneticisi açıldı" : "Fabrika yöneticisini aç"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "Geçici parola yalnız şimdi gösterilir. Yöneticiye iletin; ilk girişte kendi parolasını belirleyecek."
              : 'Hesaba "Admin (Tam Yetki)" yetkileri verilir. Geçici parolayı sistem üretir; yönetici ilk girişte kendi parolasını belirler.'}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <CreatedView created={created} />
        ) : (
          <FormView
            username={username}
            fullName={fullName}
            errors={errors}
            outcome={outcome}
            onUsername={setUsername}
            onFullName={setFullName}
          />
        )}

        <DialogFooter>
          <Actions
            created={created !== null}
            outcome={outcome}
            pending={mutation.isPending}
            onClose={close}
            onSubmit={submit}
            onUsers={goToUsers}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ActionsProps {
  created: boolean;
  outcome: Outcome;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onUsers: () => void;
}

/** Alt düğmeler: açıldı → Kapat · zaten var → Kullanıcılar ekranı (parola oradan) · form → Vazgeç / Hesabı aç. */
function Actions({ created, outcome, pending, onClose, onSubmit, onUsers }: ActionsProps) {
  if (created) {
    return (
      <Button type="button" onClick={onClose}>
        Kapat
      </Button>
    );
  }
  if (outcome === "exists") {
    return (
      <>
        <Button type="button" variant="outline" onClick={onClose}>
          Kapat
        </Button>
        <Button type="button" onClick={onUsers}>
          Kullanıcılar ekranına git
        </Button>
      </>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose}>
        Vazgeç
      </Button>
      <Button type="button" onClick={onSubmit} disabled={pending}>
        {pending ? "Açılıyor…" : "Hesabı aç"}
      </Button>
    </>
  );
}

/** Tek seferlik sonuç: kullanıcı adı + geçici parola (yalnız bu bileşenin ömrü boyunca). */
function CreatedView({ created }: { created: FactoryAdminCreated }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(created.temporaryPassword).then(() => setCopied(true));
  };
  return (
    <div className="space-y-3" data-testid="fabrika-yoneticisi-sonuc">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-muted-foreground">Kullanıcı adı</div>
        <div className="font-medium">{created.user.username}</div>
        <div className="mt-2 text-muted-foreground">Geçici parola</div>
        <div className="font-mono text-base tracking-wider" data-testid="gecici-parola">
          {created.temporaryPassword}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        <Copy className="mr-2 h-4 w-4" /> {copied ? "Kopyalandı" : "Parolayı kopyala"}
      </Button>
    </div>
  );
}

interface FormViewProps {
  username: string;
  fullName: string;
  errors: { username?: string; fullName?: string };
  outcome: Outcome;
  onUsername: (v: string) => void;
  onFullName: (v: string) => void;
}

function FormView({ username, fullName, errors, outcome, onUsername, onFullName }: FormViewProps) {
  return (
    <div className="space-y-3">
      <FormField
        label="Kullanıcı Adı"
        htmlFor="fy-username"
        error={errors.username ? { message: errors.username } : undefined}
        required
      >
        <Input
          id="fy-username"
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => onUsername(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
        />
      </FormField>
      <FormField
        label="Ad Soyad"
        htmlFor="fy-fullname"
        error={errors.fullName ? { message: errors.fullName } : undefined}
        required
      >
        <Input id="fy-fullname" value={fullName} onChange={(e) => onFullName(e.target.value)} />
      </FormField>
      {outcome === "uncertain" && (
        <Callout tone="warning" title="Sonuç belirsiz">
          Hesap açılmış olabilir. Yeniden denerseniz ikinci hesap açılmaz; hesap açıldıysa geçici parola
          yeniden gösterilemez — Yetkilendirme › Kullanıcılar ekranında hesabı açıp “Şifre Sıfırla” ile yeni
          parola verin.
        </Callout>
      )}
      {outcome === "exists" && (
        <Callout tone="warning" title="Fabrika yöneticisi zaten açılmış">
          Önceki denemeniz sonuçlanmış olabilir. Geçici parolayı görmediyseniz Yetkilendirme › Kullanıcılar
          ekranında hesabı açıp “Şifre Sıfırla” ile yeni geçici parola verin.
        </Callout>
      )}
    </div>
  );
}
