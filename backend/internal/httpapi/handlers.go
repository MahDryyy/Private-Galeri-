package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/secreat/personal-gallery/internal/audit"
	"github.com/secreat/personal-gallery/internal/auth"
	"github.com/secreat/personal-gallery/internal/config"
	"github.com/secreat/personal-gallery/internal/fsutil"
	"github.com/secreat/personal-gallery/internal/gallery"
	"github.com/secreat/personal-gallery/internal/socialdownload"
)

func (s *Server) login(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	user, sess, err := s.Auth.Login(body.Username, body.Password, c.ClientIP())
	if err != nil {
		if errors.Is(err, auth.ErrRateLimited) {
			Fail(c, http.StatusTooManyRequests, "Terlalu banyak percobaan login")
			return
		}
		Fail(c, http.StatusUnauthorized, "Username atau password salah")
		return
	}
	s.setSessionCookie(c, sess)
	audit.Log("LOGIN", user.Username, "ok")
	OK(c, gin.H{"username": user.Username})
}

func (s *Server) logout(c *gin.Context) {
	id, _ := c.Cookie(s.Cfg.CookieName)
	if id != "" {
		_ = s.Auth.DeleteSession(id)
	}
	s.clearSessionCookie(c)
	if u, ok := currentUser(c); ok {
		audit.Log("LOGOUT", u.Username, "ok")
	}
	OK(c, gin.H{"loggedOut": true})
}

func (s *Server) me(c *gin.Context) {
	u, ok := currentUser(c)
	if !ok {
		Fail(c, http.StatusUnauthorized, "Tidak terautentikasi")
		return
	}
	OK(c, gin.H{"username": u.Username})
}

func (s *Server) webauthnStatus(c *gin.Context) {
	OK(c, gin.H{
		"enabled": false,
		"ready":   false,
		"message": "WebAuthn/Passkey dijadwalkan untuk V2. Tabel kredensial sudah disiapkan.",
	})
}

func (s *Server) browse(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "80"))
	res, err := s.Gallery.Browse(gallery.BrowseOptions{
		Path:  c.Query("path"),
		Sort:  c.DefaultQuery("sort", "newest"),
		Page:  page,
		Limit: limit,
		Query: c.Query("q"),
		Kind:  c.Query("type"),
	})
	if err != nil {
		mapFSError(c, err)
		return
	}
	if u, ok := currentUser(c); ok {
		favs, _ := s.Auth.Favorites(u.ID)
		for i := range res.Items {
			_, res.Items[i].Favorite = favs[res.Items[i].Path]
		}
		for i := range res.Folders {
			_, res.Folders[i].Favorite = favs[res.Folders[i].Path]
		}
	}
	OK(c, res)
}

func (s *Server) search(c *gin.Context) {
	items, err := s.Gallery.Search(c.Query("q"), 200)
	if err != nil {
		mapFSError(c, err)
		return
	}
	OK(c, gin.H{"items": items})
}

func (s *Server) createFolder(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	rel, err := s.Gallery.CreateFolder(body.Path, body.Name)
	if err != nil {
		mapFSError(c, err)
		return
	}
	u, _ := currentUser(c)
	audit.Log("CREATE_FOLDER", u.Username, rel)
	OK(c, gin.H{"path": rel})
}

func (s *Server) rename(c *gin.Context) {
	var body struct {
		Path    string `json:"path"`
		NewName string `json:"newName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	rel, err := s.Gallery.Rename(body.Path, body.NewName)
	if err != nil {
		mapFSError(c, err)
		return
	}
	if u, ok := currentUser(c); ok {
		_ = s.Auth.RenameFavorite(u.ID, body.Path, rel)
		audit.Log("RENAME", u.Username, body.Path+" -> "+rel)
	}
	OK(c, gin.H{"path": rel})
}

func (s *Server) move(c *gin.Context) {
	var body struct {
		Paths       []string `json:"paths"`
		Destination string   `json:"destination"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Paths) == 0 {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	var moved []string
	for _, p := range body.Paths {
		rel, err := s.Gallery.Move(p, body.Destination)
		if err != nil {
			mapFSError(c, err)
			return
		}
		moved = append(moved, rel)
		if u, ok := currentUser(c); ok {
			_ = s.Auth.RenameFavorite(u.ID, p, rel)
		}
	}
	u, _ := currentUser(c)
	audit.Log("MOVE", u.Username, strings.Join(body.Paths, ",")+" -> "+body.Destination)
	OK(c, gin.H{"paths": moved})
}

func (s *Server) deleteItems(c *gin.Context) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Paths) == 0 {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	for _, p := range body.Paths {
		if err := s.Gallery.Delete(p); err != nil {
			mapFSError(c, err)
			return
		}
		if u, ok := currentUser(c); ok {
			_ = s.Auth.SetFavorite(u.ID, p, false)
		}
	}
	u, _ := currentUser(c)
	audit.Log("DELETE", u.Username, strings.Join(body.Paths, ","))
	OK(c, gin.H{"deleted": body.Paths})
}

func (s *Server) folderStats(c *gin.Context) {
	n, err := s.Gallery.FolderStats(c.Query("path"))
	if err != nil {
		mapFSError(c, err)
		return
	}
	OK(c, gin.H{"count": n})
}

func (s *Server) upload(c *gin.Context) {
	dest := c.PostForm("path")
	form, err := c.MultipartForm()
	if err != nil {
		Fail(c, http.StatusBadRequest, "Upload tidak valid")
		return
	}
	files := form.File["files"]
	if len(files) == 0 {
		files = form.File["file"]
	}
	if len(files) == 0 {
		Fail(c, http.StatusBadRequest, "Tidak ada file")
		return
	}
	var saved []string
	for _, fh := range files {
		if fh.Size > s.Cfg.MaxUploadSize {
			Fail(c, http.StatusRequestEntityTooLarge, "File terlalu besar")
			return
		}
		src, err := fh.Open()
		if err != nil {
			Fail(c, http.StatusBadRequest, "Gagal membaca file")
			return
		}
		rel, err := s.Gallery.SaveUpload(dest, filepath.Base(fh.Filename), src, s.Cfg.MaxUploadSize)
		_ = src.Close()
		if err != nil {
			if errors.Is(err, gallery.ErrTooLarge) {
				Fail(c, http.StatusRequestEntityTooLarge, "File terlalu besar")
				return
			}
			mapFSError(c, err)
			return
		}
		saved = append(saved, rel)
	}
	u, _ := currentUser(c)
	audit.Log("UPLOAD", u.Username, dest+" "+strings.Join(saved, ","))
	OK(c, gin.H{"paths": saved})
}

func (s *Server) downloadSocial(c *gin.Context) {
	var body struct {
		URL         string `json:"url"`
		Destination string `json:"destination"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.URL == "" {
		Fail(c, http.StatusBadRequest, "Link tidak valid")
		return
	}
	if err := socialdownload.ValidateURL(body.URL); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	dest, err := s.Gallery.Resolver.Resolve(body.Destination)
	if err != nil {
		mapFSError(c, err)
		return
	}
	destInfo, err := os.Stat(dest)
	if err != nil {
		mapFSError(c, err)
		return
	}
	if !destInfo.IsDir() {
		Fail(c, http.StatusBadRequest, "Folder tujuan tidak valid")
		return
	}

	tmpDir, err := os.MkdirTemp("", "personal-gallery-download-")
	if err != nil {
		Fail(c, http.StatusInternalServerError, "Gagal menyiapkan download")
		return
	}
	defer os.RemoveAll(tmpDir)

	ctx, cancel := context.WithTimeout(c.Request.Context(), socialdownload.MaxDuration)
	defer cancel()
	outPath, err := socialdownload.Download(ctx, body.URL, tmpDir)
	if err != nil {
		switch {
		case errors.Is(err, socialdownload.ErrUnavailable):
			Fail(c, http.StatusServiceUnavailable, "Downloader belum tersedia di server")
		case errors.Is(err, socialdownload.ErrNoMedia):
			Fail(c, http.StatusUnprocessableEntity, "Tidak ada video yang bisa diunduh dari link ini")
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			Fail(c, http.StatusGatewayTimeout, "Download melewati batas waktu")
		default:
			Fail(c, http.StatusBadGateway, "Gagal mengunduh. Pastikan konten publik dan link didukung.")
		}
		return
	}
	file, err := os.Open(outPath)
	if err != nil {
		Fail(c, http.StatusInternalServerError, "Gagal membaca hasil download")
		return
	}
	savedPath, err := s.Gallery.SaveUpload(body.Destination, filepath.Base(outPath), file, socialdownload.MaxDownloadSize)
	_ = file.Close()
	if err != nil {
		if errors.Is(err, gallery.ErrTooLarge) {
			Fail(c, http.StatusRequestEntityTooLarge, "Video melebihi batas 512 MB")
			return
		}
		mapFSError(c, err)
		return
	}
	if u, ok := currentUser(c); ok {
		audit.Log("SOCIAL_DOWNLOAD", u.Username, savedPath)
	}
	OK(c, gin.H{"path": savedPath})
}

func (s *Server) file(c *gin.Context) {
	abs, err := s.Gallery.Resolver.Resolve(c.Query("path"))
	if err != nil {
		mapFSError(c, err)
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		mapFSError(c, err)
		return
	}
	if info.IsDir() {
		Fail(c, http.StatusBadRequest, "Bukan file")
		return
	}
	if c.Query("download") == "1" {
		c.Header("Content-Disposition", `attachment; filename="`+filepath.Base(abs)+`"`)
	} else {
		c.Header("Content-Disposition", `inline; filename="`+filepath.Base(abs)+`"`)
	}
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "private, max-age=3600")
	http.ServeFile(c.Writer, c.Request, abs)
}

func (s *Server) metadata(c *gin.Context) {
	item, err := s.Gallery.Metadata(c.Query("path"))
	if err != nil {
		mapFSError(c, err)
		return
	}
	OK(c, item)
}

func (s *Server) thumb(c *gin.Context) {
	abs, err := s.Gallery.Resolver.Resolve(c.Query("path"))
	if err != nil {
		mapFSError(c, err)
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		mapFSError(c, err)
		return
	}
	if info.IsDir() {
		Fail(c, http.StatusBadRequest, "Bukan file")
		return
	}
	p, err := s.Thumbs.Ensure(abs, info)
	if err != nil {
		c.Status(http.StatusNoContent)
		return
	}
	c.Header("Cache-Control", "private, max-age=86400")
	http.ServeFile(c.Writer, c.Request, p)
}

func (s *Server) scan(c *gin.Context) {
	res, err := s.Gallery.Scan()
	if err != nil {
		mapFSError(c, err)
		return
	}
	OK(c, res)
}

func (s *Server) tree(c *gin.Context) {
	res, err := s.Gallery.FolderTree()
	if err != nil {
		mapFSError(c, err)
		return
	}
	OK(c, res)
}

func (s *Server) favorite(c *gin.Context) {
	var body struct {
		Path     string `json:"path"`
		Favorite bool   `json:"favorite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	if _, err := s.Gallery.Resolver.Resolve(body.Path); err != nil {
		mapFSError(c, err)
		return
	}
	u, _ := currentUser(c)
	if err := s.Auth.SetFavorite(u.ID, body.Path, body.Favorite); err != nil {
		Fail(c, http.StatusInternalServerError, "Gagal menyimpan favorit")
		return
	}
	OK(c, gin.H{"path": body.Path, "favorite": body.Favorite})
}

func (s *Server) downloadZip(c *gin.Context) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Paths) == 0 {
		Fail(c, http.StatusBadRequest, "Invalid request")
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="gallery-download.zip"`)
	c.Status(http.StatusOK)
	if err := s.Gallery.Zip(body.Paths, c.Writer); err != nil && !errors.Is(err, io.EOF) {
		return
	}
}

func mapFSError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, fsutil.ErrPathTraversal):
		Fail(c, http.StatusForbidden, "Path tidak diizinkan")
	case errors.Is(err, fsutil.ErrReservedName), errors.Is(err, fsutil.ErrInvalidPath):
		Fail(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, os.ErrExist) || os.IsExist(err):
		Fail(c, http.StatusConflict, "Nama sudah digunakan")
	case os.IsNotExist(err):
		Fail(c, http.StatusNotFound, "File tidak ditemukan")
	case os.IsPermission(err):
		Fail(c, http.StatusForbidden, "Akses filesystem ditolak")
	default:
		msg := err.Error()
		if strings.Contains(strings.ToLower(msg), "not allowed") ||
			strings.Contains(strings.ToLower(msg), "cannot") ||
			strings.Contains(strings.ToLower(msg), "empty") ||
			strings.Contains(strings.ToLower(msg), "separator") {
			Fail(c, http.StatusBadRequest, msg)
			return
		}
		Fail(c, http.StatusBadRequest, msg)
	}
}

func currentUser(c *gin.Context) (*auth.User, bool) {
	v, ok := c.Get("user")
	if !ok {
		return nil, false
	}
	u, ok := v.(*auth.User)
	return u, ok
}

func (s *Server) setSessionCookie(c *gin.Context, sess *auth.Session) {
	maxAge := int(time.Until(sess.ExpiresAt).Seconds())
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.CookieName, sess.ID, maxAge, "/", "", s.Cfg.CookieSecure, true)
}

func (s *Server) clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.CookieName, "", -1, "/", "", s.Cfg.CookieSecure, true)
}

func (s *Server) authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, _ := c.Cookie(s.Cfg.CookieName)
		_, user, err := s.Auth.GetSession(id)
		if err != nil {
			Fail(c, http.StatusUnauthorized, "Tidak terautentikasi")
			c.Abort()
			return
		}
		c.Set("user", user)
		c.Next()
	}
}

var _ = config.Config{}
