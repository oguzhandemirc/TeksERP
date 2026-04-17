import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userService } from "@/services/userService";

const registerSchema = z.object({
  username: z.string().min(3, "Kullanıcı adı en az 3 karakter"),
  password: z.string().min(6, "Şifre en az 6 karakter"),
  fullName: z.string().min(1, "Ad soyad zorunlu"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

interface RegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RegisterDialog({
  open,
  onOpenChange,
}: RegisterDialogProps) {
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", password: "", fullName: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ username: "", password: "", fullName: "" });
    }
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (data: RegisterFormValues) => userService.register(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "Kullanıcı oluşturuldu");
      qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Kullanıcı oluşturulamadı");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Kullanıcı Kayıt</DialogTitle>
          <DialogDescription>
            Kullanıcı oluşturulduktan sonra admin tarafından rol atanmalıdır.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="fullName" error={!!errors.fullName}>
              Ad Soyad
            </Label>
            <Input
              id="fullName"
              {...register("fullName")}
              error={!!errors.fullName}
              placeholder="ör: Ahmet Yılmaz"
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">
                {errors.fullName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" error={!!errors.username}>
              Kullanıcı Adı
            </Label>
            <Input
              id="username"
              {...register("username")}
              error={!!errors.username}
              placeholder="ör: ahmet.yilmaz"
            />
            {errors.username && (
              <p className="text-sm text-destructive">
                {errors.username.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" error={!!errors.password}>
              Şifre
            </Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
              error={!!errors.password}
              placeholder="En az 6 karakter"
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              İptal
            </Button>
            <Button type="submit" isLoading={mutation.isPending}>
              Kullanıcı Oluştur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
