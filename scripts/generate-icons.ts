// Redimensiona public/icons/logo.png para os ícones do PWA e o favicon.
// A imagem inteira entra em cada tamanho, na mesma proporção, sem corte.
// Rode de novo só se trocar o arquivo original: npm run icons
import { readFile, writeFile } from "node:fs/promises";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SOURCE = "public/icons/logo.png";

const ICONS = [
  { file: "public/icons/icon-192.png", size: 192, maskable: false, opaque: false },
  { file: "public/icons/icon-512.png", size: 512, maskable: false, opaque: false },
  { file: "public/icons/maskable-192.png", size: 192, maskable: true, opaque: true },
  { file: "public/icons/maskable-512.png", size: 512, maskable: true, opaque: true },
  { file: "public/icons/apple-touch-icon.png", size: 180, maskable: false, opaque: true },
] as const;

const FAVICON_SIZES = [16, 32, 48];

type RgbaImage = { width: number; height: number; rgba: Uint8Array };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  if (upDistance <= diagonalDistance) return up;
  return upLeft;
}

function decodePng(buffer: Buffer): RgbaImage {
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error(`${SOURCE} não é um PNG.`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`${SOURCE} precisa ser PNG RGB ou RGBA de 8 bits.`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let source = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const row = raw.subarray(source, source + stride);
    source += stride;
    const current = new Uint8Array(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      const value = row[index];
      if (filter === 0) current[index] = value;
      else if (filter === 1) current[index] = (value + left) & 255;
      else if (filter === 2) current[index] = (value + up) & 255;
      else if (filter === 3) current[index] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) current[index] = (value + paeth(left, up, upLeft)) & 255;
      else throw new Error(`Filtro PNG ${filter} não suportado.`);
    }
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = current[from];
      rgba[to + 1] = current[from + 1];
      rgba[to + 2] = current[from + 2];
      rgba[to + 3] = channels === 4 ? current[from + 3] : 255;
    }
    previous = current;
  }
  return { width, height, rgba };
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(image: RgbaImage): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const start = y * (stride + 1);
    raw[start] = 0;
    raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), start + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Cabe a imagem inteira num quadrado. A margem extra fica transparente. */
function containSquare(image: RgbaImage): RgbaImage {
  if (image.width === image.height) return image;
  const size = Math.max(image.width, image.height);
  const rgba = new Uint8Array(size * size * 4);
  const offsetX = Math.floor((size - image.width) / 2);
  const offsetY = Math.floor((size - image.height) / 2);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 4;
    const to = ((y + offsetY) * size + offsetX) * 4;
    rgba.set(image.rgba.subarray(from, from + image.width * 4), to);
  }
  return { width: size, height: size, rgba };
}

/** Média da área de origem de cada pixel de destino. Reduz sem esticar e sem cortar. */
function scaleSquare(image: RgbaImage, size: number): RgbaImage {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const y0 = (y * image.height) / size;
    const y1 = ((y + 1) * image.height) / size;
    for (let x = 0; x < size; x += 1) {
      const x0 = (x * image.width) / size;
      const x1 = ((x + 1) * image.width) / size;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weight = 0;
      const firstX = Math.floor(x0);
      const lastX = Math.min(image.width - 1, Math.ceil(x1) - 1);
      const firstY = Math.floor(y0);
      const lastY = Math.min(image.height - 1, Math.ceil(y1) - 1);
      for (let sourceY = firstY; sourceY <= lastY; sourceY += 1) {
        const yWeight = Math.min(sourceY + 1, y1) - Math.max(sourceY, y0);
        for (let sourceX = firstX; sourceX <= lastX; sourceX += 1) {
          const sampleWeight = yWeight * (Math.min(sourceX + 1, x1) - Math.max(sourceX, x0));
          const index = (sourceY * image.width + sourceX) * 4;
          const sampleAlpha = image.rgba[index + 3] * sampleWeight;
          red += image.rgba[index] * sampleAlpha;
          green += image.rgba[index + 1] * sampleAlpha;
          blue += image.rgba[index + 2] * sampleAlpha;
          alpha += sampleAlpha;
          weight += sampleWeight;
        }
      }
      const index = (y * size + x) * 4;
      const coverage = alpha / 255;
      rgba[index] = coverage > 0 ? Math.round(red / alpha) : 0;
      rgba[index + 1] = coverage > 0 ? Math.round(green / alpha) : 0;
      rgba[index + 2] = coverage > 0 ? Math.round(blue / alpha) : 0;
      rgba[index + 3] = Math.round((alpha / weight));
    }
  }
  return { width: size, height: size, rgba };
}

/** Fundo opaco preto onde o original é transparente. O iPhone e o ícone maskable exigem isso. */
function onBlack(image: RgbaImage): RgbaImage {
  const rgba = new Uint8Array(image.rgba);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    rgba[index] = Math.round(rgba[index] * alpha);
    rgba[index + 1] = Math.round(rgba[index + 1] * alpha);
    rgba[index + 2] = Math.round(rgba[index + 2] * alpha);
    rgba[index + 3] = 255;
  }
  return { width: image.width, height: image.height, rgba };
}

/**
 * Ícone maskable: a arte inteira fica na zona segura central (80%), sobre preto.
 * O Android corta o que fica fora; a margem não corta o escudo.
 */
function maskableSquare(image: RgbaImage, size: number): RgbaImage {
  const inner = Math.round(size * 0.8);
  const scaled = scaleSquare(image, inner);
  const rgba = new Uint8Array(size * size * 4);
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
  const offset = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const from = (y * inner + x) * 4;
      const alpha = scaled.rgba[from + 3] / 255;
      const to = ((y + offset) * size + (x + offset)) * 4;
      rgba[to] = Math.round(scaled.rgba[from] * alpha);
      rgba[to + 1] = Math.round(scaled.rgba[from + 1] * alpha);
      rgba[to + 2] = Math.round(scaled.rgba[from + 2] * alpha);
      rgba[to + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

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
  const square = containSquare(decodePng(await readFile(SOURCE)));
  for (const icon of ICONS) {
    const scaled = icon.maskable ? maskableSquare(square, icon.size) : scaleSquare(square, icon.size);
    const image = icon.opaque ? onBlack(scaled) : scaled;
    await writeFile(icon.file, encodePng(image));
    console.log(`${icon.file} ${image.width}x${image.height}`);
  }
  const favicons = FAVICON_SIZES.map((size) => ({ size, png: encodePng(scaleSquare(square, size)) }));
  await writeFile("src/app/favicon.ico", toIco(favicons));
  console.log("src/app/favicon.ico");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
