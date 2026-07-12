// Cloudinary unsigned upload. NEVER expose API secret. Uses unsigned preset only.
const CLOUD_NAME = "r0pmigfd";
const UPLOAD_PRESET = "Daniyal chat";

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  resource_type: "image" | "video" | "raw" | "auto";
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  original_filename?: string;
}

function resourceTypeFor(file: File): "image" | "video" | "raw" | "auto" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "video"; // Cloudinary handles audio as video resource
  return "raw";
}

export async function uploadToCloudinary(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryUploadResult> {
  const resourceType = resourceTypeFor(file);
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data?.error?.message || "Upload failed"));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading to Cloudinary"));
    xhr.send(form);
  });
}

export function cldImage(url: string, opts: { w?: number; h?: number; q?: string } = {}) {
  if (!url.includes("/upload/")) return url;
  const parts: string[] = ["f_auto", `q_${opts.q ?? "auto"}`];
  if (opts.w) parts.push(`w_${opts.w}`);
  if (opts.h) parts.push(`h_${opts.h}`);
  parts.push("c_limit");
  return url.replace("/upload/", `/upload/${parts.join(",")}/`);
}
