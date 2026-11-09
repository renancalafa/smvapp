import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { darkMuted, darkTitleMd } from "@/lib/ui/dark-surfaces";
import { getViewer } from "@/server/auth/dal";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.user.mustChangePassword ? "/change-password" : "/");

  return (
    <>
      <h1 className={darkTitleMd}>Entrar</h1>
      <p className={`mt-1 ${darkMuted}`}>Use o usuário e a senha recebidos do administrador.</p>
      <LoginForm />
    </>
  );
}
