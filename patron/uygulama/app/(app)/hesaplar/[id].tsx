// Hesap ayrıntısı: kimlik kartı (rol + durum), izinler (bulut kataloğundan; Türkçe ad + açıklama, gruplu), durum geçişi
// (onaylı), daveti yenile. İzin kararı sunucuda; burada yalnız seçim ve gösterim.
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { Account, AccountInviteResult } from "../../../src/api/wire";
import { formatDateTime } from "../../../src/lib/format";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { lastSeen } from "../../../src/ui/diger/AccountRow";
import { Avatar, GroupNote } from "../../../src/ui/diger/parts";
import { PermissionChecklist } from "../../../src/ui/diger/PermissionChecklist";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Card, ConfirmButton } from "../../../src/ui/kit";
import { InviteShown } from "../../../src/ui/InviteShown";
import { RoleBadge } from "../../../src/ui/RoleBadge";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";
import { useWrite } from "../../../src/ui/useWrite";
import { EMPTY_ICON } from "../../../src/ui/icons";

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const s = useStyles();
  const list = useRemote("hesaplar", () => api.accountList());
  const catalog = useRemote("izinler", () => api.permissions());
  const [acc, setAcc] = useState<Account | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [invite, setInvite] = useState<AccountInviteResult | null>(null);
  useEffect(() => {
    const a = list.data?.find((x) => x.id === id) ?? null;
    setAcc(a);
    if (a) setPerms([...a.izinler]);
  }, [list.data, id]);

  const save = useWrite(useCallback((t: string) => api.accountUpdate(String(id), { clientToken: t, izinler: perms }), [api, id, perms]));
  // Hedef durum ref'te: aynı dokunuşta yazılıp okunur (state güncellemesi bir sonraki render'a kalır).
  const target = useRef<"AKTIF" | "KILITLI" | "PASIF">("KILITLI");
  const setTarget = (t: "AKTIF" | "KILITLI" | "PASIF") => { target.current = t; };
  const status = useWrite(useCallback((t: string) => api.accountStatus(String(id), { clientToken: t, durum: target.current }), [api, id]));
  const reset = useWrite(useCallback((t: string) => api.accountReset(String(id), t), [api, id]));
  const toggle = (p: string) => setPerms((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));
  const apply = async <T,>(w: { run: (k?: string) => Promise<T | null> }, key: string, then: (r: T) => void) => { const r = await w.run(key); if (r) then(r); };

  const shell = (title: string, children: ReactNode) => (
    <Screen title={title} module="hesaplar" back onRefresh={list.reload} refreshing={list.refreshing}>{children}</Screen>
  );
  if (list.loading && !list.data) return shell("Hesap", <LoadingSkeleton rows={4} />);
  if (list.error && !list.data) return shell("Hesap", <ErrorState text={list.error} onRetry={list.reload} />);
  if (!acc) return shell("Hesap", <Empty icon={EMPTY_ICON.bulunamadi} text="Hesap bulunamadı" />);
  const err = save.error ?? status.error ?? reset.error;
  const dirty = perms.length !== acc.izinler.length || perms.some((p) => !acc.izinler.includes(p));
  return shell(
    acc.ad,
    <>
      <Card>
        <View style={s.head}>
          <Avatar name={acc.ad} permissions={acc.izinler} size={56} />
          <View style={s.flex}>
            <Text style={s.name} numberOfLines={2}>{acc.ad}</Text>
            <Text style={s.mail} numberOfLines={1} selectable>{acc.eposta}</Text>
          </View>
        </View>
        <View style={s.badges}>
          <RoleBadge permissions={acc.izinler} testID="hesap-rol" />
          <StatusBadge value={acc.durum} testID="hesap-durum" />
        </View>
        <Text style={s.meta}>{lastSeen(acc)}</Text>
        {acc.durum === "DAVETLI" && acc.davetBitis ? <Text style={s.meta}>{`Davet geçerliliği: ${formatDateTime(acc.davetBitis)}`}</Text> : null}
      </Card>
      {invite ? <InviteShown r={invite} /> : null}
      {err ? <Banner tone="error" text={err} /> : null}

      <SectionHeader title="İzinler" count={perms.length} />
      <GroupNote>Hesabın göreceği bölümleri seçin; hazır şablon kümeyi doldurur, kaydetmeden uygulanmaz.</GroupNote>
      {catalog.loading && !catalog.data ? <LoadingSkeleton rows={3} /> : null}
      {catalog.error && !catalog.data ? <ErrorState text={catalog.error} onRetry={catalog.reload} /> : null}
      {catalog.data ? (
        <PermissionChecklist codes={catalog.data.izinler} selected={perms} onToggle={toggle} templates={catalog.data.sablonlar} onTemplate={(c) => setPerms([...c])} />
      ) : null}
      {dirty ? <Banner tone="warn" icon="create-outline" text="Kaydedilmemiş izin değişikliği var." testID="izin-degisti" /> : null}
      <Button label="İzinleri kaydet" icon="checkmark" busy={save.busy} disabled={save.disabled || !dirty} testID="izin-kaydet"
        onPress={() => void apply(save, JSON.stringify(perms), (r: Account) => { setAcc(r); list.reload(); })} />

      <SectionHeader title="Durum" />
      {acc.durum !== "AKTIF" && acc.durum !== "DAVETLI" ? (
        <Button label="Etkinleştir" tone="plain" icon="lock-open-outline" busy={status.busy} onPress={() => { setTarget("AKTIF"); void apply(status, "AKTIF", () => list.reload()); }} testID="hesap-etkinlestir" />
      ) : null}
      {acc.durum === "AKTIF" ? (
        <ConfirmButton label="Kilitle" question="Hesap kilitlensin mi? Açık oturumları düşer." busy={status.busy} onConfirm={() => { setTarget("KILITLI"); void apply(status, "KILITLI", () => list.reload()); }} testID="hesap-kilitle" />
      ) : null}
      {acc.durum !== "PASIF" ? (
        <ConfirmButton label="Arşive al" question="Hesap arşive alınsın mı? Giriş yapamaz." busy={status.busy} onConfirm={() => { setTarget("PASIF"); void apply(status, "PASIF", () => list.reload()); }} testID="hesap-arsivle" />
      ) : null}

      <SectionHeader title="Davet" />
      <GroupNote>Parolasını ya da doğrulama uygulamasını kaybeden kişi için yeni davet kodu üretin.</GroupNote>
      <ConfirmButton label="Daveti yenile / parola sıfırla" question="Yeni davet kodu üretilsin mi? Hesap yeniden kurulum yapar." busy={reset.busy} onConfirm={() => void apply(reset, "sifirla", (r: AccountInviteResult) => { setInvite(r); list.reload(); })} testID="hesap-sifirla" />
    </>,
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  flex: { flex: 1, minWidth: 0 },
  name: { ...typography.title2, color: t.text },
  mail: { ...typography.subhead, color: t.textSecondary, marginTop: 2 },
  badges: { flexDirection: "row" as const, gap: space.s, marginTop: space.m, flexWrap: "wrap" as const, alignItems: "center" as const },
  meta: { ...typography.footnote, color: t.textMuted, marginTop: space.s },
}));
