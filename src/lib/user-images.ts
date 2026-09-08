import {
  inspectRaster,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_BYTES,
  validateImageDataUrl,
} from "../../electron/services/image-data.mjs";

export async function prepareImage(file: File, maxEdge = 512): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("仅支持 PNG、JPEG 或 WebP 图片。");
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error("上传图片不能超过 8 MiB。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectRaster(bytes, file.type);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("图片无法解码，请重新选择图片。");
  });
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 8192 ||
      bitmap.height > 8192 ||
      bitmap.width * bitmap.height > 24_000_000
    )
      throw new Error("图片尺寸无效。");
    const edge = Math.min(Math.max(1, maxEdge), 512);
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败，请重试。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL("image/png");
    if (result.length > 22 + Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      canvas.width = Math.max(1, Math.floor(canvas.width / 2));
      canvas.height = Math.max(1, Math.floor(canvas.height / 2));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      result = canvas.toDataURL("image/png");
    }
    return validateImageDataUrl(result);
  } finally {
    bitmap.close();
  }
}
