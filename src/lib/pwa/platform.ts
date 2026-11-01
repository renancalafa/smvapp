// Só no navegador.

const STANDALONE_QUERY = "(display-mode: standalone)";

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia(STANDALONE_QUERY).matches;
}

/** iPadOS se apresenta como Mac; o toque denuncia. */
export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function subscribeToDisplayMode(onChange: () => void): () => void {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
