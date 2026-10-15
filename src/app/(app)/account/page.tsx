import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/server/auth/actions";
import { requireViewer } from "@/server/auth/dal";
import { MODALITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "../labels";
import { InstallHint } from "./install-hint";

export const metadata: Metadata = { title: "Conta" };

export default async function AccountPage() {
  const viewer = await requireViewer();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900">Conta</h1>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
        <dt className="text-zinc-500">Nome</dt>
        <dd className="text-zinc-900">{viewer.user.name}</dd>
        <dt className="text-zinc-500">Usuário</dt>
        <dd className="text-zinc-900">{viewer.user.username}</dd>
        <dt className="text-zinc-500">Papel</dt>
        <dd className="text-zinc-900">{ROLE_LABEL[viewer.member.role]}</dd>
        <dt className="text-zinc-500">Modalidade</dt>
        <dd className="text-zinc-900">{MODALITY_LABEL[viewer.member.modality]}</dd>
        <dt className="text-zinc-500">Situação</dt>
        <dd className="text-zinc-900">{STATUS_LABEL[viewer.member.status]}</dd>
      </dl>

      <InstallHint />

      <div className="flex flex-col gap-2">
        <Link
          href="/change-password"
          className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 font-medium text-zinc-900 active:bg-zinc-100"
        >
          Trocar senha
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center rounded-xl px-4 font-medium text-red-700 active:bg-red-50"
          >
            Sair
          </button>
        </form>
      </div>
    </section>
  );
}
