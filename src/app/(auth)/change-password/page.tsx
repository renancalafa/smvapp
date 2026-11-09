import type { Metadata } from "next";
import Link from "next/link";
import { LogoutForm } from "@/components/logout-form";
import { darkBackLink, darkMuted, darkTitleMd } from "@/lib/ui/dark-surfaces";
import { requireViewerAllowingPasswordChange } from "@/server/auth/dal";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Trocar senha" };

export default async function ChangePasswordPage() {
  const viewer = await requireViewerAllowingPasswordChange();
  const mandatory = viewer.user.mustChangePassword;

  return (
    <>
      <h1 className={darkTitleMd}>Trocar senha</h1>
      <p className={`mt-1 ${darkMuted}`}>
        {mandatory
          ? "Sua senha é temporária. Defina uma senha nova para continuar."
          : "Ao trocar a senha, as outras sessões abertas são encerradas."}
      </p>
      <ChangePasswordForm username={viewer.user.username} />
      <div className="mt-4 flex justify-between text-sm">
        {mandatory ? (
          <span />
        ) : (
          <Link href="/account" className={`flex min-h-11 items-center px-1 ${darkBackLink}`}>
            Voltar
          </Link>
        )}
        <LogoutForm buttonClassName={`flex min-h-11 items-center px-1 ${darkBackLink}`} />
      </div>
    </>
  );
}
