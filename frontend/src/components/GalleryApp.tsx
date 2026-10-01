"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpFromLine,
  CheckSquare,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  Menu,
  Search,
  Settings,
  Video,
  X,
} from "lucide-react";
import { fileUrl, formatBytes, formatDate, galleryApi, thumbUrl, type TreeNode } from "@/lib/api";
import type { BrowseResult, GalleryItem } from "@/lib/types";

type Toast = { id: number; text: string; kind: "ok" | "err" };
type UploadJob = { name: string; progress: number; status: "up" | "done" | "err"; error?: string };
type ViewFilter = "all" | "image" | "video" | "folders";

const SORTS = [
  { id: "newest", label: "Terbaru" },
  { id: "oldest", label: "Terlama" },
  { id: "name_asc", label: "Nama A-Z" },
  { id: "name_desc", label: "Nama Z-A" },
  { id: "size_desc", label: "Ukuran terbesar" },
  { id: "size_asc", label: "Ukuran terkecil" },
];

export default function GalleryApp() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [path, setPath] = useState("/");
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchHits, setSearchHits] = useState<GalleryItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebar, setSidebar] = useState(false);
  const [viewer, setViewer] = useState<GalleryItem | null>(null);
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dialog, setDialog] = useState<null | { kind: "folder" | "rename" | "move" | "delete" | "settings" }>(null);
  const [nameInput, setNameInput] = useState("");
  const [renameTarget, setRenameTarget] = useState<GalleryItem | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [moveDest, setMoveDest] = useState("/");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [meta, setMeta] = useState<GalleryItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const toastId = useRef(1);

  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const load = useCallback(
    async (nextPath = path, page = 1, append = false) => {
      setLoading(true);
      try {
        const kind = filter === "image" || filter === "video" ? filter : undefined;
        const res = await galleryApi.browse({
          path: nextPath,
          sort,
          page,
          limit: 80,
          type: kind,
        });
        setData((prev) => {
          if (append && prev && prev.path === res.path) {
            return { ...res, items: [...prev.items, ...res.items], folders: res.folders };
          }
          return res;
        });
        if (!append) setSelected(new Set());
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gagal memuat";
        if (msg.toLowerCase().includes("autentikasi") || msg.includes("401")) {
          router.replace("/login");
          return;
        }
        toast(msg, "err");
      } finally {
        setLoading(false);
      }
    },
    [filter, path, router, sort, toast],
  );

  useEffect(() => {
    galleryApi
      .me()
      .then((u) => setUsername(u.username))
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    if (!username) return;
    void load(path, 1, false);
  }, [username, path, sort, filter, load]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchHits(null);
      return;
    }
    const t = setTimeout(() => {
      galleryApi
        .search(q)
        .then((r) => setSearchHits(r.items))
        .catch(() => setSearchHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const mediaItems = useMemo(() => {
    if (searchHits) return searchHits.filter((i) => i.type !== "folder");
    return data?.items ?? [];
  }, [data, searchHits]);

  const folders = useMemo(() => {
    if (searchHits) return searchHits.filter((i) => i.type === "folder");
    if (filter === "image" || filter === "video") return [];
    return data?.folders ?? [];
  }, [data, filter, searchHits]);

  const crumbs = useMemo(() => {
    const p = searchHits ? "Hasil pencarian" : data?.path || path;
    if (searchHits) return [{ label: "Home", value: "/" }, { label: p, value: path }];
    const parts = (data?.path || "/").split("/").filter(Boolean);
    const list = [{ label: "Home", value: "/" }];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      list.push({ label: part, value: acc });
    }
    return list;
  }, [data?.path, path, searchHits]);

  function toggleSelect(itemPath: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (next.has(itemPath)) next.delete(itemPath);
      else next.add(itemPath);
      return next;
    });
  }

  function selectAll() {
    const all = [...folders, ...mediaItems].map((i) => i.path);
    setSelected(new Set(all));
  }

  async function onUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const jobs: UploadJob[] = list.map((f) => ({ name: f.name, progress: 0, status: "up" }));
    setUploads(jobs);
    await Promise.all(
      list.map(
        (file, idx) =>
          new Promise<void>((resolve) => {
            const xhr = new XMLHttpRequest();
            const form = new FormData();
            form.append("path", path);
            form.append("files", file);
            xhr.open("POST", "/api/gallery/upload");
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
              if (!e.lengthComputable) return;
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploads((u) => u.map((j, i) => (i === idx ? { ...j, progress: pct } : j)));
            };
            xhr.onload = () => {
              const ok = xhr.status >= 200 && xhr.status < 300;
              setUploads((u) =>
                u.map((j, i) =>
                  i === idx
                    ? { ...j, progress: 100, status: ok ? "done" : "err", error: ok ? undefined : "Gagal" }
                    : j,
                ),
              );
              resolve();
            };
            xhr.onerror = () => {
              setUploads((u) => u.map((j, i) => (i === idx ? { ...j, status: "err", error: "Jaringan" } : j)));
              resolve();
            };
            xhr.send(form);
          }),
      ),
    );
    toast("Upload selesai");
    await load(path, 1, false);
    setTimeout(() => setUploads([]), 2500);
  }

  function onDropFiles(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length) void onUpload(e.dataTransfer.files);
  }

  async function openFolderCreate() {
    setNameInput("");
    setDialog({ kind: "folder" });
  }

  async function submitFolder() {
    try {
      await galleryApi.createFolder(path, nameInput.trim());
      toast("Folder dibuat");
      setDialog(null);
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    }
  }

  async function openRename() {
    const only = [...selected][0];
    const item = [...folders, ...mediaItems].find((i) => i.path === only);
    if (!item) return;
    setRenameTarget(item);
    setNameInput(item.name);
    setDialog({ kind: "rename" });
  }

  async function submitRename() {
    if (!renameTarget) return;
    try {
      await galleryApi.rename(renameTarget.path, nameInput.trim());
      toast("Nama diubah");
      setDialog(null);
      setSelected(new Set());
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    }
  }

  async function openMove() {
    try {
      const t = await galleryApi.tree();
      setTree(t);
      setMoveDest("/");
      setDialog({ kind: "move" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal memuat folder", "err");
    }
  }

  async function submitMove() {
    try {
      await galleryApi.move([...selected], moveDest);
      toast("File dipindahkan");
      setDialog(null);
      setSelected(new Set());
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    }
  }

  async function openDelete() {
    const paths = [...selected];
    const folder = folders.find((f) => paths.includes(f.path));
    if (paths.length === 1 && folder) {
      try {
        const st = await galleryApi.folderStats(folder.path);
        setDeleteMsg(`Folder ini berisi ${st.count} item. Hapus seluruh folder beserta isinya?`);
      } catch {
        setDeleteMsg(`Hapus folder ${folder.name} beserta isinya?`);
      }
    } else {
      setDeleteMsg(`Apakah Anda yakin ingin menghapus ${paths.length} item?`);
    }
    setDialog({ kind: "delete" });
  }

  async function submitDelete() {
    try {
      await galleryApi.remove([...selected]);
      toast("Dihapus");
      setDialog(null);
      setSelected(new Set());
      setViewer(null);
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    }
  }

  async function downloadSelected() {
    const paths = [...selected];
    if (paths.length === 1) {
      const a = document.createElement("a");
      a.href = fileUrl(paths[0], true);
      a.download = "";
      a.click();
      return;
    }
    const res = await fetch("/api/gallery/download", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) {
      toast("Download gagal", "err");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gallery-download.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  function openViewer(item: GalleryItem) {
    if (item.type === "folder") {
      setSearch("");
      setSearchHits(null);
      setPath(item.path);
      return;
    }
    setViewer(item);
    galleryApi.metadata(item.path).then(setMeta).catch(() => setMeta(item));
  }

  function navViewer(dir: -1 | 1) {
    if (!viewer) return;
    const list = mediaItems.filter((i) => i.type === "image" || i.type === "video");
    const idx = list.findIndex((i) => i.path === viewer.path);
    const next = list[idx + dir];
    if (next) openViewer(next);
  }

  async function dropOnFolder(folderPath: string, itemPath: string) {
    if (folderPath === itemPath) return;
    if (!window.confirm(`Pindahkan item ke folder ini?`)) return;
    try {
      await galleryApi.move([itemPath], folderPath);
      toast("Dipindahkan");
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setViewer(null);
        setDialog(null);
        setSidebar(false);
      }
      if (viewer && e.key === "ArrowRight") navViewer(1);
      if (viewer && e.key === "ArrowLeft") navViewer(-1);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !dialog) {
        e.preventDefault();
        selectAll();
      }
      if (e.key === "Delete" && selected.size && !dialog && !viewer) {
        void openDelete();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!username) {
    return <div className="min-h-screen grid place-items-center text-zinc-400">Memuat...</div>;
  }

  return (
    <div className="min-h-screen flex bg-ink-950" onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-white/10 bg-ink-900 p-4 transition-transform md:static md:translate-x-0 ${
          sidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300/80">Gallery</p>
            <h1 className="text-lg font-semibold">Personal Library</h1>
          </div>
          <button className="md:hidden" onClick={() => setSidebar(false)} aria-label="Tutup menu">
            <X size={18} />
          </button>
        </div>
        <nav className="mt-6 space-y-1 text-sm">
          <SideBtn active={filter === "all"} onClick={() => { setFilter("all"); setPath("/"); setSearchHits(null); }}>
            <HardDrive size={16} /> All Photos
          </SideBtn>
          <SideBtn active={filter === "video"} onClick={() => { setFilter("video"); setSearchHits(null); }}>
            <Video size={16} /> Videos
          </SideBtn>
          <SideBtn active={filter === "folders"} onClick={() => { setFilter("folders"); setSearchHits(null); }}>
            <ImageIcon size={16} /> Folders
          </SideBtn>
        </nav>
        <div className="mt-6 space-y-2">
          <button onClick={openFolderCreate} className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10">
            + New Folder
          </button>
          <button onClick={() => fileRef.current?.click()} className="w-full rounded-lg bg-blue-500/90 px-3 py-2 text-left text-sm hover:bg-blue-400">
            ↑ Upload
          </button>
        </div>
        <div className="absolute bottom-4 left-4 right-4 space-y-2 text-sm">
          <button onClick={() => setDialog({ kind: "settings" })} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/5">
            <Settings size={16} /> Settings
          </button>
          <button
            onClick={async () => {
              await galleryApi.logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/5"
          >
            <LogOut size={16} /> Logout ({username})
          </button>
        </div>
      </aside>

      {sidebar ? <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebar(false)} /> : null}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
          <button className="md:hidden" onClick={() => setSidebar(true)} aria-label="Menu">
            <Menu />
          </button>
          <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm text-zinc-400">
            {crumbs.map((c, i) => (
              <span key={c.value + i} className="flex items-center gap-1">
                {i > 0 ? <span>/</span> : null}
                <button className="hover:text-white" onClick={() => { setSearch(""); setSearchHits(null); setPath(c.value); }}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          <label className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama file atau folder"
              className="w-52 rounded-lg border border-white/10 bg-ink-900 py-2 pl-7 pr-3 text-sm outline-none focus:border-blue-400"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-white/10 bg-ink-900 px-2 py-2 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button onClick={selectAll} className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
            <CheckSquare size={14} className="inline mr-1" /> Select
          </button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg bg-blue-500 px-3 py-2 text-sm hover:bg-blue-400">
            <ArrowUpFromLine size={14} className="inline mr-1" /> Upload
          </button>
          <button onClick={openFolderCreate} className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
            <FolderPlus size={14} className="inline mr-1" /> Folder
          </button>
        </header>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-ink-900 px-4 py-2 text-sm">
            <span>{selected.size} dipilih</span>
            <button className="rounded bg-white/10 px-2 py-1" onClick={() => void downloadSelected()}>Download</button>
            <button className="rounded bg-white/10 px-2 py-1" onClick={() => void openMove()}>Move</button>
            <button className="rounded bg-white/10 px-2 py-1" onClick={() => void openDelete()}>Delete</button>
            {selected.size === 1 ? (
              <button className="rounded bg-white/10 px-2 py-1" onClick={() => void openRename()}>Rename</button>
            ) : null}
            <button className="rounded bg-white/10 px-2 py-1" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        ) : null}

        <div ref={dropRef} className="flex-1 overflow-auto p-4">
          {loading && !data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : null}

          {!loading && folders.length === 0 && mediaItems.length === 0 ? (
            <div className="grid place-items-center py-24 text-center text-zinc-400">
              <p className="text-lg">Folder ini kosong</p>
              <p className="mt-1 text-sm">Upload foto/video atau buat folder baru. File yang sudah ada di server akan muncul di sini.</p>
            </div>
          ) : null}

          {folders.length > 0 ? (
            <section className="mb-6">
              <h2 className="mb-3 text-sm uppercase tracking-wide text-zinc-500">Folders</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {folders.map((f) => (
                  <button
                    key={f.path}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/path", f.path)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const src = e.dataTransfer.getData("text/path");
                      if (src) void dropOnFolder(f.path, src);
                    }}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) toggleSelect(f.path, true);
                      else openViewer(f);
                    }}
                    className={`rounded-xl border p-4 text-left hover:border-blue-400 ${
                      selected.has(f.path) ? "border-blue-400 bg-blue-500/10" : "border-white/10 bg-ink-900"
                    }`}
                  >
                    <div className="text-3xl">📁</div>
                    <div className="mt-2 truncate font-medium">{f.name}</div>
                    <div className="text-xs text-zinc-500">{f.childCount ?? 0} item</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {mediaItems.length > 0 && filter !== "folders" ? (
            <section>
              <h2 className="mb-3 text-sm uppercase tracking-wide text-zinc-500">Media</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {mediaItems.map((item) => (
                  <article
                    key={item.path}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/path", item.path)}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) toggleSelect(item.path, true);
                      else openViewer(item);
                    }}
                    className={`group relative aspect-square overflow-hidden rounded-lg border ${
                      selected.has(item.path) ? "border-blue-400 ring-2 ring-blue-400" : "border-transparent"
                    }`}
                  >
                    <label className="absolute left-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.path)}
                        onChange={() => toggleSelect(item.path, true)}
                      />
                    </label>
                    {item.type === "image" || item.type === "video" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(item.path)} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full place-items-center bg-ink-800 text-xs">{item.name}</div>
                    )}
                    {item.type === "video" ? (
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 text-xs">VID</span>
                    ) : null}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/80 p-2 text-xs group-hover:block">
                      {item.name}
                    </div>
                  </article>
                ))}
              </div>
              {data?.hasMore && !searchHits ? (
                <button
                  className="mx-auto mt-6 block rounded-lg border border-white/10 px-4 py-2 text-sm"
                  onClick={() => void load(path, (data.page || 1) + 1, true)}
                >
                  Muat lebih banyak
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
      </main>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,.heic,.heif,.mkv,.mov,.avi"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.files) void onUpload(e.target.files);
          e.target.value = "";
        }}
      />

      {uploads.length > 0 ? (
        <div className="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-white/10 bg-ink-900 p-3 text-sm shadow-xl">
          <p className="mb-2 font-medium">Upload</p>
          {uploads.map((u) => (
            <div key={u.name} className="mb-2">
              <div className="flex justify-between text-xs">
                <span className="truncate">{u.name}</span>
                <span>{u.status === "err" ? u.error : `${u.progress}%`}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10">
                <div className={`h-full ${u.status === "err" ? "bg-red-500" : "bg-blue-400"}`} style={{ width: `${u.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="fixed bottom-4 left-4 z-40 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-3 py-2 text-sm shadow ${t.kind === "err" ? "bg-red-500" : "bg-emerald-600"}`}>
            {t.text}
          </div>
        ))}
      </div>

      {viewer ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p className="font-medium">{viewer.name}</p>
              <p className="text-zinc-400">
                {formatBytes(meta?.size || viewer.size)} · {formatDate(meta?.exifDate || viewer.modifiedAt)}
                {meta?.width ? ` · ${meta.width}×${meta.height}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <a className="rounded bg-white/10 px-3 py-1" href={fileUrl(viewer.path, true)}>
                Download
              </a>
              <button className="rounded bg-white/10 px-3 py-1" onClick={() => document.documentElement.requestFullscreen().catch(() => undefined)}>
                Fullscreen
              </button>
              <button className="rounded bg-white/10 px-3 py-1" onClick={() => setViewer(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            <button className="absolute left-3 rounded-full bg-white/10 px-3 py-2" onClick={() => navViewer(-1)}>
              ‹
            </button>
            {viewer.type === "video" ? (
              <video src={fileUrl(viewer.path)} controls autoPlay className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <ZoomImage src={fileUrl(viewer.path)} alt={viewer.name} />
            )}
            <button className="absolute right-3 rounded-full bg-white/10 px-3 py-2" onClick={() => navViewer(1)}>
              ›
            </button>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-5">
            {dialog.kind === "folder" ? (
              <>
                <h3 className="text-lg font-medium">Folder baru</h3>
                <input className="mt-3 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Nama folder" />
                <DialogActions onCancel={() => setDialog(null)} onOk={submitFolder} ok="Buat" />
              </>
            ) : null}
            {dialog.kind === "rename" ? (
              <>
                <h3 className="text-lg font-medium">Rename</h3>
                <input className="mt-3 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
                <DialogActions onCancel={() => setDialog(null)} onOk={submitRename} ok="Simpan" />
              </>
            ) : null}
            {dialog.kind === "move" ? (
              <>
                <h3 className="text-lg font-medium">Pindahkan ke</h3>
                <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-white/10 p-2 text-sm">
                  {tree ? <TreePick node={tree} selected={moveDest} onPick={setMoveDest} /> : null}
                </div>
                <DialogActions onCancel={() => setDialog(null)} onOk={submitMove} ok="Pindahkan" />
              </>
            ) : null}
            {dialog.kind === "delete" ? (
              <>
                <h3 className="text-lg font-medium">Konfirmasi hapus</h3>
                <p className="mt-3 text-sm text-zinc-300">{deleteMsg}</p>
                <DialogActions onCancel={() => setDialog(null)} onOk={submitDelete} ok="Hapus" danger />
              </>
            ) : null}
            {dialog.kind === "settings" ? (
              <>
                <h3 className="text-lg font-medium">Settings</h3>
                <p className="mt-3 text-sm text-zinc-400">
                  Media dibaca langsung dari filesystem. Thumbnail di-cache terpisah. Password memakai Argon2id. WebAuthn/Passkey disiapkan untuk V2.
                </p>
                <button
                  className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm"
                  onClick={async () => {
                    try {
                      const r = await galleryApi.scan();
                      toast("Scan selesai");
                      console.info(r);
                    } catch (err) {
                      toast(err instanceof Error ? err.message : "Scan gagal", "err");
                    }
                  }}
                >
                  Scan filesystem
                </button>
                <DialogActions onCancel={() => setDialog(null)} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${active ? "bg-blue-500/20 text-blue-100" : "hover:bg-white/5"}`}
    >
      {children}
    </button>
  );
}

function DialogActions({
  onCancel,
  onOk,
  ok,
  danger,
}: {
  onCancel: () => void;
  onOk?: () => void;
  ok?: string;
  danger?: boolean;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm hover:bg-white/5">
        Batal
      </button>
      {onOk ? (
        <button onClick={onOk} className={`rounded-lg px-3 py-2 text-sm ${danger ? "bg-red-500" : "bg-blue-500"}`}>
          {ok}
        </button>
      ) : null}
    </div>
  );
}

function TreePick({ node, selected, onPick }: { node: TreeNode; selected: string; onPick: (p: string) => void }) {
  return (
    <div>
      <button
        onClick={() => onPick(node.path)}
        className={`block w-full rounded px-2 py-1 text-left ${selected === node.path ? "bg-blue-500/30" : "hover:bg-white/5"}`}
      >
        {node.name}
      </button>
      <div className="ml-4">
        {node.children?.map((c) => (
          <TreePick key={c.path} node={c} selected={selected} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onWheel={(e) => {
        e.preventDefault();
        setZoom((z) => Math.min(5, Math.max(1, z + (e.deltaY > 0 ? -0.15 : 0.15))));
      }}
      onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
      style={{ transform: `scale(${zoom})` }}
      className="max-h-full max-w-full object-contain transition-transform"
    />
  );
}
