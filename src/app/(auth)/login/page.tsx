import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth/dal";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.user.mustChangePassword ? "/change-password" : "/");

  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Entrar</h1>
      <p className="mt-1 text-sm text-zinc-500">Use o usuário e a senha recebidos do administrador.</p>
      <LoginForm />
    </>
  );
}
