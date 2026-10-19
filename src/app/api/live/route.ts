import { formatEtag, normalizeRevisionToken, revisionsMatch } from "@/domain/live/polling";
import { getViewer } from "@/server/auth/dal";
import { getSpectatorLiveSnapshot, getSpectatorRevision } from "@/server/modules/matches/spectator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, no-cache, must-revalidate";

function clientRevision(request: Request): string | null {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) return normalizeRevisionToken(ifNoneMatch);
  const url = new URL(request.url);
  return normalizeRevisionToken(url.searchParams.get("since"));
}

/**
 * Snapshot autenticado do placar Ao Vivo.
 * If-None-Match / ?since= → 304 quando a revisão (Match.version + sessão) não mudou.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return Response.json(
      { error: "Não autenticado." },
      { status: 401, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const since = clientRevision(request);
  const now = new Date();

  if (since) {
    const { revision, pollPhase, focus } = await getSpectatorRevision(viewer.group.id, now);
    if (revisionsMatch(since, revision)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: formatEtag(revision),
          "Cache-Control": NO_STORE,
          "X-Live-Poll-Phase": pollPhase,
          "X-Live-Revision": revision,
        },
      });
    }
    const snapshot = await getSpectatorLiveSnapshot(viewer.group.id, now, focus);
    return Response.json(snapshot, {
      status: 200,
      headers: {
        ETag: formatEtag(snapshot.revision),
        "Cache-Control": NO_STORE,
        "X-Live-Poll-Phase": snapshot.pollPhase,
        "X-Live-Revision": snapshot.revision,
      },
    });
  }

  const snapshot = await getSpectatorLiveSnapshot(viewer.group.id, now);
  return Response.json(snapshot, {
    status: 200,
    headers: {
      ETag: formatEtag(snapshot.revision),
      "Cache-Control": NO_STORE,
      "X-Live-Poll-Phase": snapshot.pollPhase,
      "X-Live-Revision": snapshot.revision,
    },
  });
}
