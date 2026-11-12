import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth/dal";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.user.mustChangePassword ? "/change-password" : "/");

  return <LoginForm />;
}
