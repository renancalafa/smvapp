import type { Metadata } from "next";
import Link from "next/link";
import { requireViewerAllowingPasswordChange } from "@/server/auth/dal";
import { logoutAction } from "@/server/auth/actions";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Trocar senha" };

export default async function ChangePasswordPage() {
  const viewer = await requireViewerAllowingPasswordChange();
  const mandatory = viewer.user.mustChangePassword;

  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Trocar senha</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {mandatory
          ? "Sua senha é temporária. Defina uma senha nova para continuar."
          : "Ao trocar a senha, as outras sessões abertas são encerradas."}
      </p>
      <ChangePasswordForm username={viewer.user.username} />
      <div className="mt-4 flex justify-between text-sm">
        {mandatory ? (
          <span />
        ) : (
          <Link href="/account" className="flex min-h-11 items-center px-1 text-zinc-600 hover:underline">
            Voltar
          </Link>
        )}
        <form action={logoutAction}>
          <button type="submit" className="flex min-h-11 items-center px-1 text-zinc-600 hover:underline">
            Sair
          </button>
        </form>
      </div>
    </>
  );
}
