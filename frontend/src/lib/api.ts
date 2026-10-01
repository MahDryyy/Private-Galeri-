import type { ApiResponse, BrowseResult, GalleryItem } from "./types";

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return body.data as T;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  });
  return parse<T>(res);
}

export const galleryApi = {
  me: () => api<{ username: string }>("/api/auth/me"),
  login: (username: string, password: string) =>
    api<{ username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => api("/api/auth/logout", { method: "POST" }),
  browse: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") q.set(k, String(v));
    });
    return api<BrowseResult>(`/api/gallery/browse?${q.toString()}`);
  },
  search: (q: string) => api<{ items: GalleryItem[] }>(`/api/gallery/search?q=${encodeURIComponent(q)}`),
  createFolder: (path: string, name: string) =>
    api<{ path: string }>("/api/gallery/folder", { method: "POST", body: JSON.stringify({ path, name }) }),
  rename: (path: string, newName: string) =>
    api<{ path: string }>("/api/gallery/rename", { method: "POST", body: JSON.stringify({ path, newName }) }),
  move: (paths: string[], destination: string) =>
    api("/api/gallery/move", { method: "POST", body: JSON.stringify({ paths, destination }) }),
  remove: (paths: string[]) =>
    api("/api/gallery/items", { method: "DELETE", body: JSON.stringify({ paths }) }),
  folderStats: (path: string) => api<{ count: number }>(`/api/gallery/folder/stats?path=${encodeURIComponent(path)}`),
  tree: () => api<{ name: string; path: string; children?: TreeNode[] }>("/api/gallery/tree"),
  favorite: (path: string, favorite: boolean) =>
    api("/api/gallery/favorite", { method: "POST", body: JSON.stringify({ path, favorite }) }),
  metadata: (path: string) => api<GalleryItem>(`/api/gallery/metadata?path=${encodeURIComponent(path)}`),
  scan: () => api("/api/gallery/scan", { method: "POST" }),
};

export type TreeNode = { name: string; path: string; children?: TreeNode[] };

export function fileUrl(path: string, download = false) {
  return `/api/gallery/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

export function thumbUrl(path: string) {
  return `/api/gallery/thumbnail?path=${encodeURIComponent(path)}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(v?: string) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("id-ID");
}
