import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { PermissionsTab } from "./PermissionsTab";
import { ResetPasswordTab } from "./ResetPasswordTab";
import { CardTokenTab } from "./CardTokenTab";
import { QuickPinTab } from "./QuickPinTab";
import { TwoFactorTab } from "./TwoFactorTab";
import { adminUserService, type AdminUserListItem } from "@/services/adminUserService";

type UserDetailTab = "permissions" | "password" | "card" | "quick-pin" | "two-factor";

interface Props {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Açılışta gösterilecek sekme (örn. yeni-kullanıcı "yönet" → hızlı PIN). */
  initialTab?: UserDetailTab;
}

/**
 * Kullanıcı detayı — geniş, ortalanmış modal. (Eskiden sağdan açılan slide-over'dı;
 * modal olarak yeniden yazıldı.) Sabit yükseklik: başlık + sekme çubuğu üstte sabit
 * kalır, yalnız aktif sekmenin gövdesi kayar → sekmeler kaydırmayla kaybolmaz.
 */
export function UserDetailDialog({ user, open, onOpenChange, initialTab = "permissions" }: Props) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Yalnız kullanıcı değişince sıfırla — parent'ın stale snapshot'ı optimistic
  // düzenlemeyi ezmesin diye user?.fullName kasıtlı dep dışında.
  useEffect(() => {
    setFullName(user?.fullName ?? "");
    setRenameOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const renameMut = useMutation({
    mutationFn: (value: string) => adminUserService.updateFullName(user!.id, value),
    onSuccess: (_res, value) => {
      toast.success("Ad soyad güncellendi.");
      setFullName(value);
      setRenameOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const saveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (trimmed === fullName) {
      setRenameOpen(false);
      return;
    }
    renameMut.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <div className="flex items-baseline gap-2">
            <DialogTitle>{fullName || "—"}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Ad soyadı düzenle"
              onClick={() => {
                setNameInput(fullName);
                setRenameOpen(true);
              }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <DialogDescription>
              <span className="font-mono">{user?.username}</span>
              {" · "}
              {user?.isSystemAccount ? "Tüm yetkiler" : `${user?._count?.permissions ?? 0} yetki`}
            </DialogDescription>
          </div>
        </DialogHeader>

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Ad Soyadı Düzenle</DialogTitle>
            </DialogHeader>
            <FormField label="Ad Soyad" htmlFor="rename-fullName" required>
              <Input
                id="rename-fullName"
                autoFocus
                value={nameInput}
                disabled={renameMut.isPending}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                }}
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renameMut.isPending}
                onClick={() => setRenameOpen(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="button"
                disabled={renameMut.isPending || !nameInput.trim()}
                onClick={saveName}
              >
                {renameMut.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {user && (
          // key={initialTab}: farklı sekmeyle yeniden açılınca defaultValue tekrar uygulansın.
          <Tabs key={initialTab} defaultValue={initialTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-6 mt-2 shrink-0">
              <TabsTrigger value="permissions" className="flex-1">Yetkiler</TabsTrigger>
              <TabsTrigger value="password" className="flex-1">Şifre Sıfırla</TabsTrigger>
              <TabsTrigger value="card" className="flex-1">Personel Kartı</TabsTrigger>
              <TabsTrigger value="quick-pin" className="flex-1">Hızlı PIN</TabsTrigger>
              <TabsTrigger value="two-factor" className="flex-1">İki Adımlı</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
              <TabsContent value="permissions" className="mt-0 h-full">
                <PermissionsTab userId={user.id} />
              </TabsContent>
              <TabsContent value="password" className="mt-0">
                <ResetPasswordTab userId={user.id} username={user.username} />
              </TabsContent>
              <TabsContent value="card" className="mt-0">
                <CardTokenTab userId={user.id} username={user.username} fullName={fullName} />
              </TabsContent>
              <TabsContent value="quick-pin" className="mt-0">
                <QuickPinTab userId={user.id} username={user.username} />
              </TabsContent>
              <TabsContent value="two-factor" className="mt-0">
                <TwoFactorTab userId={user.id} username={user.username} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
