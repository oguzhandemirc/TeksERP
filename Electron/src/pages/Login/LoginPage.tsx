import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";
import { useAuthStore } from "@/store/auth";
import { canEnterApp } from "@/types/auth";

const schema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await authService.login(values);
      await tokenStore.set(res.data.token);
      const decoded = decodeJwt(res.data.token) ?? res.data.user;
      if (!canEnterApp(decoded.permissions)) {
        await tokenStore.clear();
        toast.error("Bu uygulamayı kullanma yetkin yok. Yöneticine başvur.");
        return;
      }
      setUser(decoded);
      const dest = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";
      navigate(dest, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid h-screen w-screen place-items-center bg-background p-6 app-drag">
      <Card className="w-full max-w-sm app-no-drag">
        <CardHeader>
          <CardTitle>Adnan Şahin ERP</CardTitle>
          <CardDescription>Yönetim paneli giriş ekranı.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField label="Kullanıcı adı" htmlFor="username" error={form.formState.errors.username} required>
              <Input id="username" autoFocus autoComplete="username" {...form.register("username")} />
            </FormField>
            <FormField label="Şifre" htmlFor="password" error={form.formState.errors.password} required>
              <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
            </FormField>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
