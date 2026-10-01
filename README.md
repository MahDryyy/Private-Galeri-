# Personal Photo & Video Gallery

Aplikasi gallery **private** dan **self-hosted** untuk mengelola foto dan video yang sudah ada di server. Filesystem adalah sumber kebenaran. Database hanya dipakai untuk akun, sesi, dan metadata tambahan (favorit). File media **tidak** dipindahkan, **tidak** diubah saat startup, dan **tidak** disimpan sebagai BLOB.

Alur:

```
/home/secreat/Secreat_data
        ↓  Docker volume (hanya folder ini)
/data/gallery
        ↓
Go + Gin backend
        ↓  REST API
Next.js frontend
        ↓
Browser  →  http://SERVER_IP:3000
```

## 1. Requirement

- Docker dan Docker Compose
- Folder media yang sudah ada, misalnya `/home/secreat/Secreat_data`
- User OS yang menjalankan container harus bisa **membaca** (dan menulis, jika ingin upload/rename/move/delete) folder tersebut
- Jangan menggunakan `chmod 777`

Di dalam container, backend hanya melihat:

```
GALLERY_ROOT=/data/gallery
```

Folder `/home/secreat` secara keseluruhan **tidak** di-mount.

## 2. Folder structure

```
personal-gallery/
├── docker-compose.yml
├── .env.example
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── go.mod
│   ├── cmd/server/main.go
│   └── internal/
│       ├── auth/
│       ├── config/
│       ├── db/
│       ├── fsutil/
│       ├── gallery/
│       ├── httpapi/
│       └── thumbnail/
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── next.config.ts
    └── src/
```

## 3. Environment

Salin contoh env, lalu ganti password:

```bash
cp .env.example .env
```

Variabel penting:

| Variable | Arti |
|---|---|
| `GALLERY_HOST_PATH` | Folder media di host. Default `/home/secreat/Secreat_data` |
| `GALLERY_ROOT` | Path di dalam container. Default `/data/gallery` |
| `MAX_UPLOAD_SIZE` | Batas upload, contoh `10GB` atau `500MB` |
| `SESSION_SECRET` | Kunci sesi. Jika masih `CHANGE_ME...`, backend membuat kunci di volume aplikasi |
| `COOKIE_SECURE` | `true` jika aplikasi diakses lewat HTTPS |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Akun login pertama |
| `FRONTEND_PORT` / `BACKEND_PORT` | Port yang di-publish ke host |

Jangan commit file `.env`.

Password disimpan dengan **Argon2id**, bukan plaintext.

## 4. Docker installation

```bash
git clone <url-repo-ini>
cd personal-gallery
cp .env.example .env
# edit ADMIN_PASSWORD di .env
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f
```

Buka:

- Frontend: `http://SERVER_IP:3000`
- Backend: `http://SERVER_IP:8080`
- Health: `http://SERVER_IP:8080/health` → `{ "status": "ok" }`

## 5. First startup

Saat backend start:

1. Cek `GALLERY_ROOT`
2. Pastikan folder ada
3. **Tidak** menghapus, memindahkan, atau merename file existing
4. **Tidak** mengubah permission folder media secara agresif
5. Gallery langsung membaca isi folder (termasuk file yang sudah ada sebelum aplikasi dibuat)

Thumbnail disimpan di volume terpisah `/data/cache/thumbnails`, bukan dengan menimpa foto asli.

## 6. Login

Buka `http://SERVER_IP:3000`, lalu masuk dengan `ADMIN_USERNAME` dan `ADMIN_PASSWORD`.

Sesi memakai cookie:

- HttpOnly
- SameSite=Lax
- Secure jika `COOKIE_SECURE=true`
- Expiration (`SESSION_TTL`, default 7 hari)

Logout menghapus sesi di server.

**WebAuthn / Passkey:** struktur tabel `webauthn_credentials` dan endpoint `/api/auth/webauthn/status` sudah disiapkan. Login Passkey (Windows Hello / Face ID / Touch ID) adalah V2. Aplikasi **tidak** menyimpan foto wajah dan **tidak** melakukan face recognition.

## 7. Upload

Upload masuk ke folder yang sedang dibuka. Multiple file, drag & drop, dan progress tersedia.

Tipe yang diizinkan antara lain: jpg, jpeg, png, webp, heic, gif, mp4, mov, avi, mkv, webm.

Ditolak: `.php`, `.exe`, `.sh`, `.bat`, `.js`, dan executable/script sejenis.

## 8. Folder

Folder yang dibuat di UI adalah folder nyata di filesystem, misalnya:

```
/data/gallery/Liburan/Bali
```

yang setara dengan:

```
/home/secreat/Secreat_data/Liburan/Bali
```

## 9. Move

Memakai `rename` filesystem (bukan copy). Multi-select didukung. Drag file ke folder juga memindahkan file setelah konfirmasi.

## 10. Rename

Nama tidak boleh kosong, tidak boleh mengandung `..` atau pemisah path, dan tidak boleh keluar dari `GALLERY_ROOT`.

## 11. Delete

Semua delete butuh login. Ada dialog konfirmasi, termasuk jumlah isi folder. Delete menghapus file/folder di filesystem.

## 12. Thumbnail

Grid memakai thumbnail kecil on-demand. Foto/video asli tidak diubah. Video memakai FFmpeg di container backend. Saat foto/video dibuka, original-lah yang dipakai. Video original dilayani dengan HTTP Range Request.

## 13. Backup

Backup folder media di host (`GALLERY_HOST_PATH`) dengan rsync, snapshot disk, atau tool backup Anda. Jangan mengandalkan ZIP permanen di dalam folder media.

Volume Docker `app-data` berisi SQLite (user/sesi/favorit) dan perlu di-backup terpisah jika Anda memakai favorit.

## 14. Security

- Semua path dari client di-resolve lalu dicek tetap di dalam `GALLERY_ROOT`
- `../`, `/etc/passwd`, dan path di luar gallery ditolak
- Frontend **tidak** mengakses filesystem; hanya REST API
- Endpoint gallery (termasuk delete, upload, move) membutuhkan authentication
- Login di-rate-limit
- Audit log: LOGIN, LOGOUT, UPLOAD, MOVE, RENAME, DELETE, CREATE_FOLDER (tanpa password/cookie)

## 15. Troubleshooting

**Gallery kosong atau error permission**  
User di dalam container harus bisa membaca `GALLERY_HOST_PATH`. Jangan `chmod 777`. Samakan pemilik folder dengan user yang menjalankan Docker, atau jalankan compose sebagai user yang sudah punya akses.

**Tidak bisa login**  
Cek `ADMIN_USERNAME` / `ADMIN_PASSWORD` di `.env`. Restart backend setelah mengubah env: `docker compose up -d --force-recreate backend`.

**Cookie tidak tersimpan di HTTP**  
Pastikan `COOKIE_SECURE=false` jika belum memakai HTTPS.

**Video tidak play**  
Browser harus mendukung codec file. Backend mengirim Range Request; cek log backend jika FFmpeg gagal membuat thumbnail (playback original tetap bisa).

**Upload ditolak**  
Periksa ekstensi, MIME, dan `MAX_UPLOAD_SIZE`.

**Path traversal**  
Request seperti `/api/gallery/browse?path=../../etc` mengembalikan 403.

## 16. Cara mengganti port

Di `.env`:

```
FRONTEND_PORT=3000
BACKEND_PORT=8080
```

Lalu `docker compose up -d`.

## 17. Cara mengganti media directory

Di `.env`:

```
GALLERY_HOST_PATH=/path/baru/ke/foto
```

Hanya folder itu yang di-mount ke `/data/gallery`. Restart:

```bash
docker compose up -d
```

File existing tidak dimigrasikan; aplikasi membaca folder baru apa adanya.

## 18. Cara update aplikasi

```bash
cd personal-gallery
git pull
docker compose build
docker compose up -d
```

Volume media, cache thumbnail, dan database aplikasi tetap ada.

## API (ringkas)

| Method | Path | Ket |
|---|---|---|
| GET | `/health` | Healthcheck |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | User saat ini |
| GET | `/api/gallery/browse` | List folder + file (pagination) |
| GET | `/api/gallery/search` | Cari nama file/folder |
| POST | `/api/gallery/upload` | Upload |
| POST | `/api/gallery/folder` | Buat folder |
| POST | `/api/gallery/rename` | Rename |
| POST | `/api/gallery/move` | Move |
| DELETE | `/api/gallery/items` | Hapus (auth wajib) |
| GET | `/api/gallery/file` | Stream/download (Range) |
| GET | `/api/gallery/thumbnail` | Thumbnail lazy |
| POST | `/api/gallery/scan` | Hitung isi filesystem, tidak mengubah file |
| POST | `/api/gallery/favorite` | Favorit (SQLite) |

Face recognition **tidak** ada di V1. Arsitektur metadata (favorit di DB, file di disk) siap ditambah fitur People nanti.
