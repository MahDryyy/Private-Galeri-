package gallery

import (
	"path/filepath"
	"strings"
)

var allowedExt = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
	".heif": "image/heif", ".bmp": "image/bmp", ".tif": "image/tiff",
	".tiff": "image/tiff", ".avif": "image/avif",
	".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
	".mkv": "video/x-matroska", ".webm": "video/webm", ".m4v": "video/x-m4v",
	".mpeg": "video/mpeg", ".mpg": "video/mpeg", ".3gp": "video/3gpp",
}

var blockedExt = map[string]struct{}{
	".php": {}, ".phtml": {}, ".exe": {}, ".sh": {}, ".bat": {}, ".cmd": {},
	".js": {}, ".mjs": {}, ".cjs": {}, ".com": {}, ".msi": {}, ".dll": {},
	".ps1": {}, ".vbs": {}, ".jar": {}, ".html": {}, ".htm": {}, ".shtml": {},
	".svg": {}, ".wasm": {}, ".py": {}, ".rb": {}, ".pl": {}, ".cgi": {},
	".asp": {}, ".aspx": {}, ".jsp": {}, ".htaccess": {},
}

func Classify(name string) (ItemType, string) {
	ext := strings.ToLower(filepath.Ext(name))
	mime, ok := allowedExt[ext]
	if !ok {
		return TypeFile, "application/octet-stream"
	}
	if strings.HasPrefix(mime, "image/") {
		return TypeImage, mime
	}
	if strings.HasPrefix(mime, "video/") {
		return TypeVideo, mime
	}
	return TypeFile, mime
}

func IsUploadAllowed(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" {
		return false
	}
	if _, blocked := blockedExt[ext]; blocked {
		return false
	}
	_, ok := allowedExt[ext]
	return ok
}

func IsImage(name string) bool {
	t, _ := Classify(name)
	return t == TypeImage
}

func IsVideo(name string) bool {
	t, _ := Classify(name)
	return t == TypeVideo
}
