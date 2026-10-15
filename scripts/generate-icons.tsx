// Gera os ícones do PWA em public/icons e o src/app/favicon.ico.
// Rode de novo só se mudar a identidade visual: npm run icons
import { mkdir, writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

const THEME = "#047857";

type IconSpec = { file: string; size: number; textScale: number; label: string };

// Maskable: o conteúdo cabe no círculo seguro central (80% do lado).
const ICONS: IconSpec[] = [
  { file: "public/icons/icon-192.png", size: 192, textScale: 0.3, label: "SMV" },
  { file: "public/icons/icon-512.png", size: 512, textScale: 0.3, label: "SMV" },
  { file: "public/icons/maskable-192.png", size: 192, textScale: 0.22, label: "SMV" },
  { file: "public/icons/maskable-512.png", size: 512, textScale: 0.22, label: "SMV" },
  { file: "public/icons/apple-touch-icon.png", size: 180, textScale: 0.28, label: "SMV" },
];

const FAVICON_SIZES = [16, 32, 48];

async function render(size: number, textScale: number, label: string): Promise<Buffer> {
  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: THEME,
          color: "#ffffff",
          fontSize: Math.round(size * textScale),
          letterSpacing: label.length > 1 ? Math.round(size * 0.01) : 0,
        }}
      >
        {label}
      </div>
    ),
    { width: size, height: size },
  );
  return Buffer.from(await response.arrayBuffer());
}

/** ICO com imagens PNG embutidas (suportado por todos os navegadores atuais). */
function toIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main() {
  await mkdir("public/icons", { recursive: true });
  for (const icon of ICONS) {
    await writeFile(icon.file, await render(icon.size, icon.textScale, icon.label));
    console.log(icon.file);
  }
  const favicons = await Promise.all(
    FAVICON_SIZES.map(async (size) => ({ size, png: await render(size, 0.75, "S") })),
  );
  await writeFile("src/app/favicon.ico", toIco(favicons));
  console.log("src/app/favicon.ico");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
