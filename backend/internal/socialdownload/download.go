package socialdownload

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/secreat/personal-gallery/internal/gallery"
)

var (
	ErrInvalidURL  = errors.New("URL TikTok atau Instagram tidak valid")
	ErrUnavailable = errors.New("yt-dlp tidak terpasang")
	ErrNoMedia     = errors.New("tidak ada video yang dapat diunduh")
)

const (
	MaxDownloadSize int64 = 512 << 20
	MaxDuration           = 5 * time.Minute
)

func ValidateURL(raw string) error {
	if len(raw) > 2048 {
		return ErrInvalidURL
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return ErrInvalidURL
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host != "tiktok.com" && host != "www.tiktok.com" && host != "m.tiktok.com" &&
		host != "vm.tiktok.com" && host != "vt.tiktok.com" &&
		host != "instagram.com" && host != "www.instagram.com" && host != "m.instagram.com" {
		return ErrInvalidURL
	}
	if host == "tiktok.com" || host == "www.tiktok.com" || host == "m.tiktok.com" {
		if !strings.Contains(u.Path, "/video/") {
			return ErrInvalidURL
		}
	} else if host == "vm.tiktok.com" || host == "vt.tiktok.com" {
		if u.Path == "/" || u.Path == "" {
			return ErrInvalidURL
		}
	} else if !strings.HasPrefix(u.Path, "/reel/") && !strings.HasPrefix(u.Path, "/p/") && !strings.HasPrefix(u.Path, "/tv/") {
		return ErrInvalidURL
	}
	return nil
}

func Download(ctx context.Context, rawURL, outputDir string) (string, error) {
	if err := ValidateURL(rawURL); err != nil {
		return "", err
	}
	rawURL = strings.TrimSpace(rawURL)
	if _, err := exec.LookPath("yt-dlp"); err != nil {
		return "", ErrUnavailable
	}
	args := []string{
		"--ignore-config", "--no-playlist", "--no-progress", "--no-warnings",
		"--no-write-thumbnail", "--no-write-info-json", "--no-write-description", "--no-write-subs",
		"--socket-timeout", "20", "--max-filesize", "512M",
		"--format", "best[ext=mp4]/best", "--output", filepath.Join(outputDir, "%(id)s.%(ext)s"),
		rawURL,
	}
	cmd := exec.CommandContext(ctx, "yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("download timeout: %w", ctx.Err())
		}
		return "", fmt.Errorf("yt-dlp: %w: %s", err, strings.TrimSpace(string(output)))
	}

	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() || !gallery.IsVideo(entry.Name()) {
			continue
		}
		path := filepath.Join(outputDir, entry.Name())
		info, err := os.Lstat(path)
		if err == nil && info.Mode().IsRegular() && info.Size() <= MaxDownloadSize {
			return path, nil
		}
	}
	return "", ErrNoMedia
}
