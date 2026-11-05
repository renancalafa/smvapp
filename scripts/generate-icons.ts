// Redimensiona public/icons/logo.png para os ícones do PWA e o favicon.
// A imagem inteira entra em cada tamanho, na mesma proporção, sem corte.
// Rode de novo só se trocar o arquivo original: npm run icons
import { readFile, writeFile } from "node:fs/promises";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SOURCE = "public/icons/logo.png";

const ICONS = [
  { file: "public/icons/icon-192.png", size: 192, maskable: false },
  { file: "public/icons/icon-512.png", size: 512, maskable: false },
  { file: "public/icons/maskable-192.png", size: 192, maskable: true },
  { file: "public/icons/maskable-512.png", size: 512, maskable: true },
  { file: "public/icons/apple-touch-icon.png", size: 180, maskable: false },
] as const;

const FAVICON_SIZES = [16, 32, 48];

type RgbImage = { width: number; height: number; rgb: Uint8Array };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  if (upDistance <= diagonalDistance) return up;
  return upLeft;
}

function decodePng(buffer: Buffer): RgbImage {
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
  const rgb = new Uint8Array(width * height * 3);
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
      const alpha = channels === 4 ? current[from + 3] / 255 : 1;
      const to = (y * width + x) * 3;
      rgb[to] = Math.round(current[from] * alpha + 255 * (1 - alpha));
      rgb[to + 1] = Math.round(current[from + 1] * alpha + 255 * (1 - alpha));
      rgb[to + 2] = Math.round(current[from + 2] * alpha + 255 * (1 - alpha));
    }
    previous = current;
  }
  return { width, height, rgb };
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(image: RgbImage, rgba: boolean): Buffer {
  const channels = rgba ? 4 : 3;
  const stride = image.width * channels;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const start = y * (stride + 1);
    raw[start] = 0;
    if (!rgba) {
      raw.set(image.rgb.subarray(y * image.width * 3, (y + 1) * image.width * 3), start + 1);
      continue;
    }
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + x) * 3;
      const to = start + 1 + x * 4;
      raw[to] = image.rgb[from];
      raw[to + 1] = image.rgb[from + 1];
      raw[to + 2] = image.rgb[from + 2];
      raw[to + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = rgba ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Cabe a imagem inteira num quadrado, com a cor do canto se a origem não for quadrada. */
function containSquare(image: RgbImage): RgbImage {
  if (image.width === image.height) return image;
  const size = Math.max(image.width, image.height);
  const rgb = new Uint8Array(size * size * 3);
  const background = image.rgb.subarray(0, 3);
  for (let index = 0; index < rgb.length; index += 3) rgb.set(background, index);
  const offsetX = Math.floor((size - image.width) / 2);
  const offsetY = Math.floor((size - image.height) / 2);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 3;
    const to = ((y + offsetY) * size + offsetX) * 3;
    rgb.set(image.rgb.subarray(from, from + image.width * 3), to);
  }
  return { width: size, height: size, rgb };
}

/** Média da área de origem de cada pixel de destino. Reduz sem esticar e sem cortar. */
function scaleSquare(image: RgbImage, size: number): RgbImage {
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    const y0 = (y * image.height) / size;
    const y1 = ((y + 1) * image.height) / size;
    for (let x = 0; x < size; x += 1) {
      const x0 = (x * image.width) / size;
      const x1 = ((x + 1) * image.width) / size;
      let red = 0;
      let green = 0;
      let blue = 0;
      let weight = 0;
      const firstX = Math.floor(x0);
      const lastX = Math.min(image.width - 1, Math.ceil(x1) - 1);
      const firstY = Math.floor(y0);
      const lastY = Math.min(image.height - 1, Math.ceil(y1) - 1);
      for (let sourceY = firstY; sourceY <= lastY; sourceY += 1) {
        const yWeight = Math.min(sourceY + 1, y1) - Math.max(sourceY, y0);
        for (let sourceX = firstX; sourceX <= lastX; sourceX += 1) {
          const sampleWeight = yWeight * (Math.min(sourceX + 1, x1) - Math.max(sourceX, x0));
          const index = (sourceY * image.width + sourceX) * 3;
          red += image.rgb[index] * sampleWeight;
          green += image.rgb[index + 1] * sampleWeight;
          blue += image.rgb[index + 2] * sampleWeight;
          weight += sampleWeight;
        }
      }
      const index = (y * size + x) * 3;
      rgb[index] = Math.round(red / weight);
      rgb[index + 1] = Math.round(green / weight);
      rgb[index + 2] = Math.round(blue / weight);
    }
  }
  return { width: size, height: size, rgb };
}

/**
 * Ícone maskable: a arte inteira fica na zona segura central (80%).
 * O Android corta o que fica fora; aqui só entra margem da cor de fundo.
 */
function maskableSquare(image: RgbImage, size: number): RgbImage {
  const inner = Math.round(size * 0.8);
  const scaled = scaleSquare(image, inner);
  const rgb = new Uint8Array(size * size * 3);
  const background = image.rgb.subarray(0, 3);
  for (let index = 0; index < rgb.length; index += 3) rgb.set(background, index);
  const offset = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y += 1) {
    const from = y * inner * 3;
    rgb.set(scaled.rgb.subarray(from, from + inner * 3), ((y + offset) * size + offset) * 3);
  }
  return { width: size, height: size, rgb };
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
    const image = icon.maskable ? maskableSquare(square, icon.size) : scaleSquare(square, icon.size);
    await writeFile(icon.file, encodePng(image, false));
    console.log(`${icon.file} ${image.width}x${image.height}`);
  }
  const favicons = FAVICON_SIZES.map((size) => ({ size, png: encodePng(scaleSquare(square, size), true) }));
  await writeFile("src/app/favicon.ico", toIco(favicons));
  console.log("src/app/favicon.ico");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
