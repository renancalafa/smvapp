import { NextResponse } from "next/server";
import { isDeclarationWithoutReceipt } from "@/domain/finance/receiptUpload";
import { getViewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { readReceiptObject } from "@/server/modules/finance/receipt-storage";

export const dynamic = "force-dynamic";

/** Download autenticado do comprovante (dono ou ADMIN). Nunca público. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ receiptId: string }> },
) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { receiptId } = await context.params;
  const receipt = await db.paymentReceipt.findFirst({
    where: { id: receiptId, groupId: viewer.group.id },
    select: {
      storageKey: true,
      mimeType: true,
      originalFilename: true,
      memberId: true,
      uploadedByUserId: true,
    },
  });
  if (!receipt) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const isOwner = receipt.memberId === viewer.member.id || receipt.uploadedByUserId === viewer.user.id;
  const isAdmin = viewer.member.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  if (isDeclarationWithoutReceipt(receipt)) {
    return NextResponse.json(
      { error: "Esta declaração não possui arquivo de comprovante." },
      { status: 404 },
    );
  }

  try {
    const bytes = await readReceiptObject(receipt.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": receipt.mimeType,
        "Content-Disposition": `inline; filename="${receipt.originalFilename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
  }
}
