import type { Metadata } from "next";
import Link from "next/link";
import { LogoutForm } from "@/components/logout-form";
import {
  darkBtnDanger,
  darkBtnSecondary,
  darkCardPad,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { requireViewer } from "@/server/auth/dal";
import { getOwnAccountProfile } from "@/server/modules/members/queries";
import { countPushSubscriptions, getVapidPublicKey } from "@/server/modules/notifications/push";
import { MODALITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "../labels";
import { InstallHint } from "./install-hint";
import { ProfileForm } from "./profile-form";
import { PushSettings } from "./push-settings";

export const metadata: Metadata = { title: "Conta" };

export default async function AccountPage() {
  const viewer = await requireViewer();
  const [pushDeviceCount, profile] = await Promise.all([
    countPushSubscriptions(viewer.user.id),
    getOwnAccountProfile(viewer.group.id, viewer.member.id, viewer.user.id),
  ]);
  if (!profile) throw new Error("Perfil da conta não encontrado.");

  return (
    <section className="flex flex-col gap-4 text-smv-cream">
      <h1 className={darkTitle}>Conta</h1>

      <ProfileForm
        username={profile.user.username}
        name={profile.user.name}
        nickname={profile.nickname}
        email={profile.user.email}
      />

      <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm ${darkCardPad}`}>
        <dt className={darkMuted}>Papel</dt>
        <dd className="text-white">{ROLE_LABEL[viewer.member.role]}</dd>
        <dt className={darkMuted}>Modalidade</dt>
        <dd className="text-white">{MODALITY_LABEL[viewer.member.modality]}</dd>
        <dt className={darkMuted}>Situação</dt>
        <dd className="text-white">{STATUS_LABEL[viewer.member.status]}</dd>
      </dl>

      <InstallHint />

      <PushSettings vapidPublicKey={getVapidPublicKey()} deviceCount={pushDeviceCount} />

      <div className="flex flex-col gap-2">
        <Link href={`/stats/players/${viewer.member.id}`} className={darkBtnSecondary}>
          Minhas estatísticas
        </Link>
        <Link href="/stats" className={darkBtnSecondary}>
          Rankings
        </Link>
        <Link href="/change-password" className={darkBtnSecondary}>
          Trocar senha
        </Link>
        <LogoutForm buttonClassName={`w-full ${darkBtnDanger}`} />
      </div>
    </section>
  );
}
