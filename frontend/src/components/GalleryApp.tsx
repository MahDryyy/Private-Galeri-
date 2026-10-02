"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
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
  ChevronDown,
  CheckSquare,
  Download,
  ExternalLink,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Link2,
  LogOut,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { fileUrl, formatBytes, formatDate, galleryApi, thumbUrl, type TreeNode } from "@/lib/api";
import type { BrowseResult, GalleryItem } from "@/lib/types";

type Toast = { id: number; text: string; kind: "ok" | "err" };
type UploadJob = { name: string; progress: number; status: "up" | "done" | "err"; error?: string };
type SavedLink = { id: string; title: string; url: string };
type ViewFilter = "all" | "image" | "video" | "folders";
const SAVED_LINKS_KEY = "personal-gallery-saved-links";

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
  const [dialog, setDialog] = useState<null | { kind: "folder" | "rename" | "move" | "delete" | "settings" | "socialDownload" }>(null);
  const [nameInput, setNameInput] = useState("");
  const [renameTarget, setRenameTarget] = useState<GalleryItem | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [moveDest, setMoveDest] = useState("/");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [linksOpen, setLinksOpen] = useState(true);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [socialUrl, setSocialUrl] = useState("");
  const [socialDestination, setSocialDestination] = useState("/");
  const [socialDownloading, setSocialDownloading] = useState(false);
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
    try {
      const stored = window.localStorage.getItem(SAVED_LINKS_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedLinks(parsed.filter((item): item is SavedLink =>
            typeof item?.id === "string" && typeof item?.title === "string" && typeof item?.url === "string",
          ));
        }
      }
    } catch {
      setSavedLinks([]);
    } finally {
      setLinksLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!linksLoaded) return;
    try {
      window.localStorage.setItem(SAVED_LINKS_KEY, JSON.stringify(savedLinks));
    } catch {
      toast("Tautan tidak dapat disimpan di browser", "err");
    }
  }, [linksLoaded, savedLinks, toast]);

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

  function addSavedLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = linkUrl.trim();
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      setSavedLinks((links) => [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: linkTitle.trim() || parsed.hostname,
        url: parsed.href,
      }, ...links]);
      setLinkTitle("");
      setLinkUrl("");
      setLinkFormOpen(false);
      setLinksOpen(true);
      toast("Tautan disimpan");
    } catch {
      toast("Masukkan URL yang valid (http atau https)", "err");
    }
  }

  function removeSavedLink(id: string) {
    setSavedLinks((links) => links.filter((link) => link.id !== id));
  }

  async function openSocialDownload(initialUrl = "") {
    try {
      setTree(await galleryApi.tree());
      setSocialUrl(initialUrl);
      setSocialDestination(path);
      setDialog({ kind: "socialDownload" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal memuat folder", "err");
    }
  }

  async function submitSocialDownload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSocialDownloading(true);
    try {
      const result = await galleryApi.downloadSocial(socialUrl.trim(), socialDestination);
      toast(`Video disimpan: ${result.path}`);
      setDialog(null);
      setSearch("");
      setSearchHits(null);
      setPath(socialDestination);
      await load(socialDestination, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Download gagal", "err");
    } finally {
      setSocialDownloading(false);
    }
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

  function startItemDrag(e: DragEvent<HTMLElement>, itemPath: string) {
    const paths = selected.has(itemPath) ? [...selected] : [itemPath];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-gallery-paths", JSON.stringify(paths));
    e.dataTransfer.setData("text/path", itemPath);
  }

  async function dropOnFolder(folderPath: string, itemPaths: string[]) {
    const paths = itemPaths.filter((itemPath) => itemPath !== folderPath);
    if (!paths.length) return;
    try {
      await galleryApi.move(paths, folderPath);
      toast(`${paths.length} item dipindahkan`);
      setSelected(new Set());
      await load(path, 1, false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal", "err");
    } finally {
      setDropTarget(null);
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
    <div className="gallery-shell min-h-screen flex" onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <aside
        className={`gallery-sidebar fixed inset-y-0 left-0 z-30 flex w-72 flex-col overflow-y-auto border-r p-4 transition-transform md:static md:translate-x-0 ${
          sidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-lime-300 text-lg font-semibold text-ink-950 shadow-lg shadow-lime-950/20">G</div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-lime-200/70">Gallery</p>
              <h1 className="text-sm font-semibold tracking-wide">Personal Library</h1>
            </div>
          </div>
          <button className="md:hidden" onClick={() => setSidebar(false)} aria-label="Tutup menu">
            <X size={18} />
          </button>
        </div>
        <p className="mb-2 mt-9 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Library</p>
        <nav className="space-y-1 text-sm">
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
        <section className="mt-7 border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-expanded={linksOpen}
              onClick={() => setLinksOpen((open) => !open)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"
            >
              <Link2 size={15} className="shrink-0 text-lime-200" />
              <span className="flex-1 truncate">Tautan tersimpan</span>
              <span className="text-[10px] text-zinc-600">{savedLinks.length}</span>
              <ChevronDown size={15} className={`text-zinc-500 transition-transform ${linksOpen ? "rotate-180" : ""}`} />
            </button>
            <button
              type="button"
              title="Tambah tautan"
              aria-label="Tambah tautan"
              onClick={() => { setLinkFormOpen((open) => !open); setLinksOpen(true); }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-lime-200/10 hover:text-lime-200"
            >
              <Plus size={16} />
            </button>
          </div>
          {linksOpen ? (
            <div className="mt-1 space-y-1 pl-1">
              {savedLinks.map((link) => (
                <div key={link.id} className="group flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/[0.04]">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-xs text-zinc-400 hover:text-lime-100">
                    <ExternalLink size={13} className="shrink-0 text-zinc-600 group-hover:text-lime-200" />
                    <span className="truncate">{link.title}</span>
                  </a>
                  <button type="button" title={`Download ${link.title} ke galeri`} aria-label={`Download ${link.title} ke galeri`} onClick={() => void openSocialDownload(link.url)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-zinc-600 transition hover:bg-lime-200/10 hover:text-lime-200">
                    <Download size={13} />
                  </button>
                  <button type="button" title={`Hapus ${link.title}`} aria-label={`Hapus ${link.title}`} onClick={() => removeSavedLink(link.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-zinc-600 opacity-0 transition hover:bg-red-400/10 hover:text-red-200 focus:opacity-100 group-hover:opacity-100">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {savedLinks.length === 0 && !linkFormOpen ? <p className="px-3 py-2 text-xs text-zinc-600">Belum ada tautan</p> : null}
              {linkFormOpen ? (
                <form onSubmit={addSavedLink} className="mt-2 space-y-2 rounded-xl border border-white/[0.08] bg-black/15 p-3">
                  <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="Nama tautan" className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-lime-300/50 focus:outline-none" />
                  <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://contoh.com" required className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-lime-300/50 focus:outline-none" />
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setLinkFormOpen(false)} className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-200">Batal</button>
                    <button type="submit" className="rounded-md bg-lime-300 px-2.5 py-1.5 text-xs font-semibold text-ink-950 hover:bg-lime-200">Simpan</button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
        <div className="mt-7 space-y-2 border-t border-white/[0.06] pt-5">
          <button onClick={() => fileRef.current?.click()} className="gallery-action-primary flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold">
            <ArrowUpFromLine size={16} /> Upload media
          </button>
          <button onClick={openFolderCreate} className="gallery-action-secondary flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm">
            <FolderPlus size={16} /> New folder
          </button>
        </div>
        <div className="mt-auto space-y-2 pt-7 text-sm">
          <button onClick={() => setDialog({ kind: "settings" })} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-zinc-400 transition hover:bg-white/5 hover:text-white">
            <Settings size={16} /> Settings
          </button>
          <button
            onClick={async () => {
              await galleryApi.logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} /> Logout ({username})
          </button>
        </div>
      </aside>

      {sidebar ? <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebar(false)} /> : null}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="gallery-header sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
          <button className="md:hidden" onClick={() => setSidebar(true)} aria-label="Menu">
            <Menu />
          </button>
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-zinc-500">
            {crumbs.map((c, i) => (
              <span key={c.value + i} className="flex items-center gap-1">
                {i > 0 ? <span>/</span> : null}
                <button className={`truncate transition hover:text-lime-200 ${i === crumbs.length - 1 ? "max-w-40 font-medium text-zinc-100" : "max-w-24"}`} onClick={() => { setSearch(""); setSearchHits(null); setPath(c.value); }}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          <label className="gallery-search relative w-full sm:w-auto">
            <Search size={14} className="absolute left-2 top-2.5 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama file atau folder"
              className="w-full rounded-xl py-2 pl-8 pr-3 text-sm sm:w-52"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="gallery-control rounded-xl px-3 py-2 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button onClick={selectAll} className="gallery-action-secondary rounded-xl px-3 py-2 text-sm">
            <CheckSquare size={14} className="inline mr-1" /> Select
          </button>
          <button onClick={() => void openSocialDownload()} className="gallery-action-secondary rounded-xl px-3 py-2 text-sm">
            <Link2 size={14} className="mr-1 inline" /> Dari link
          </button>
          <button onClick={() => fileRef.current?.click()} className="gallery-action-primary rounded-xl px-3 py-2 text-sm font-semibold sm:hidden">
            <ArrowUpFromLine size={14} className="inline mr-1" /> Upload
          </button>
          <button onClick={openFolderCreate} className="gallery-action-secondary hidden rounded-xl px-3 py-2 text-sm sm:inline-flex sm:items-center">
            <FolderPlus size={14} className="inline mr-1" /> Folder
          </button>
        </header>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] bg-lime-300/[0.06] px-4 py-2.5 text-sm md:px-6">
            <span className="mr-2 font-medium text-lime-100">{selected.size} dipilih</span>
            <button className="gallery-action-secondary rounded-lg px-3 py-1.5" onClick={() => void downloadSelected()}>Download</button>
            <button className="gallery-action-secondary rounded-lg px-3 py-1.5" onClick={() => void openMove()}>Move</button>
            <button className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-red-200 hover:bg-red-400/20" onClick={() => void openDelete()}>Delete</button>
            {selected.size === 1 ? (
              <button className="gallery-action-secondary rounded-lg px-3 py-1.5" onClick={() => void openRename()}>Rename</button>
            ) : null}
            <button className="ml-auto rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-white/5 hover:text-white" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        ) : null}

        <div ref={dropRef} className="flex-1 overflow-auto p-4 md:px-6 md:py-6">
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
              <h2 className="gallery-section-title mb-3 text-[11px] font-semibold uppercase">Folders <span className="ml-1 text-zinc-600">{folders.length}</span></h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {folders.map((f) => (
                  <button
                    key={f.path}
                    draggable
                    onDragStart={(e) => startItemDrag(e, f.path)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropTarget(f.path);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const payload = e.dataTransfer.getData("application/x-gallery-paths");
                      let paths: string[] = [];
                      try {
                        const parsed: unknown = JSON.parse(payload);
                        if (Array.isArray(parsed)) paths = parsed.filter((item): item is string => typeof item === "string");
                      } catch {
                        paths = [];
                      }
                      if (!paths.length) {
                        const source = e.dataTransfer.getData("text/path");
                        if (source) paths = [source];
                      }
                      if (paths.length) void dropOnFolder(f.path, paths);
                      else setDropTarget(null);
                    }}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) toggleSelect(f.path, true);
                      else openViewer(f);
                    }}
                    className={`folder-card rounded-2xl border p-4 text-left ${
                      dropTarget === f.path ? "is-drop-target" : selected.has(f.path) ? "is-selected" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className={`grid h-10 w-10 place-items-center rounded-xl ${dropTarget === f.path ? "bg-emerald-200/15 text-emerald-200" : "bg-lime-200/10 text-lime-200"}`}>
                        <Folder size={21} strokeWidth={1.8} />
                      </div>
                      <span className="text-[10px] font-medium tracking-wider text-zinc-600">FOLDER</span>
                    </div>
                    <div className="mt-4 truncate font-medium text-zinc-100">{f.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{f.childCount ?? 0} item</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {mediaItems.length > 0 && filter !== "folders" ? (
            <section>
              <h2 className="gallery-section-title mb-3 text-[11px] font-semibold uppercase">Media <span className="ml-1 text-zinc-600">{mediaItems.length}</span></h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {mediaItems.map((item) => (
                  <article
                    key={item.path}
                    draggable
                    onDragStart={(e) => startItemDrag(e, item.path)}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) toggleSelect(item.path, true);
                      else openViewer(item);
                    }}
                    className={`media-card group relative aspect-square overflow-hidden rounded-xl border ${
                      selected.has(item.path) ? "is-selected" : "border-transparent"
                    }`}
                  >
                    <label className="absolute left-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.path)}
                        onChange={() => toggleSelect(item.path, true)}
                        className="h-4 w-4 cursor-pointer accent-lime-300"
                      />
                    </label>
                    {item.type === "image" || item.type === "video" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(item.path)} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full place-items-center bg-ink-800 text-xs">{item.name}</div>
                    )}
                    {item.type === "video" ? (
                      <span className="absolute right-2 top-2 rounded-md border border-white/15 bg-black/60 px-1.5 py-1 text-[9px] font-semibold tracking-wider text-white backdrop-blur">VIDEO</span>
                    ) : null}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2.5 pt-10 text-xs">
                      <p className="truncate font-medium text-white">{item.name}</p>
                      <p className="mt-0.5 text-[10px] text-white/60">{formatBytes(item.size)}</p>
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
          <div className="gallery-dialog w-full max-w-md rounded-2xl border p-5">
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
            {dialog.kind === "socialDownload" ? (
              <form onSubmit={(e) => void submitSocialDownload(e)}>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime-200/10 text-lime-200">
                    <Link2 size={19} />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">Download dari link</h3>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">Video publik dari TikTok atau Instagram. Maksimal 512 MB dan 5 menit.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-zinc-300">
                        <SiTiktok size={12} aria-hidden="true" /> TikTok
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-zinc-300">
                        <SiInstagram size={12} className="text-pink-300" aria-hidden="true" /> Instagram
                      </span>
                    </div>
                  </div>
                </div>
                <label className="mt-5 block text-xs font-medium text-zinc-400">
                  Link post atau reel
                  <input
                    type="url"
                    required
                    value={socialUrl}
                    onChange={(e) => setSocialUrl(e.target.value)}
                    placeholder="https://www.tiktok.com/@.../video/..."
                    disabled={socialDownloading}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-lime-300/50 focus:outline-none disabled:opacity-60"
                  />
                </label>
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-zinc-400">Simpan ke folder</p>
                  <div className="max-h-44 overflow-auto rounded-lg border border-white/10 p-2 text-sm">
                    {tree ? <TreePick node={tree} selected={socialDestination} onPick={setSocialDestination} /> : null}
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" disabled={socialDownloading} onClick={() => setDialog(null)} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 disabled:opacity-50">Batal</button>
                  <button type="submit" disabled={socialDownloading} className="flex items-center gap-2 rounded-lg bg-lime-300 px-3 py-2 text-sm font-medium text-ink-950 hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60">
                    {socialDownloading ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUpFromLine size={15} />}
                    {socialDownloading ? "Mengunduh..." : "Download"}
                  </button>
                </div>
              </form>
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
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${active ? "bg-lime-200/10 text-lime-100 ring-1 ring-lime-200/10" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
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
        <button onClick={onOk} className={`rounded-lg px-3 py-2 text-sm font-medium ${danger ? "bg-red-500 text-white hover:bg-red-400" : "bg-lime-300 text-ink-950 hover:bg-lime-200"}`}>
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
