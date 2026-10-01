package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port           string
	GalleryRoot    string
	ThumbnailDir   string
	AppDataDir     string
	MaxUploadSize  int64
	SessionSecret  string
	SessionTTL     time.Duration
	CookieSecure   bool
	CookieName     string
	AdminUsername  string
	AdminPassword  string
	AllowedOrigins []string
}

func Load() (Config, error) {
	cfg := Config{
		Port:          getenv("PORT", "8080"),
		GalleryRoot:   getenv("GALLERY_ROOT", "/data/gallery"),
		ThumbnailDir:  getenv("THUMBNAIL_DIR", "/data/cache/thumbnails"),
		AppDataDir:    getenv("APP_DATA_DIR", "/data/app"),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		CookieName:    getenv("COOKIE_NAME", "pg_session"),
		AdminUsername: getenv("ADMIN_USERNAME", "admin"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		CookieSecure:  parseBool(getenv("COOKIE_SECURE", "false")),
		SessionTTL:    parseDuration(getenv("SESSION_TTL", "168h")),
	}

	maxSize, err := ParseSize(getenv("MAX_UPLOAD_SIZE", "10GB"))
	if err != nil {
		return cfg, fmt.Errorf("MAX_UPLOAD_SIZE: %w", err)
	}
	cfg.MaxUploadSize = maxSize

	if cfg.SessionSecret == "" || cfg.SessionSecret == "CHANGE_ME" || cfg.SessionSecret == "CHANGE_ME_TO_A_LONG_RANDOM_STRING" {
		secret, err := loadOrCreateSecret(filepath.Join(cfg.AppDataDir, "session.key"))
		if err != nil {
			return cfg, fmt.Errorf("SESSION_SECRET: %w", err)
		}
		cfg.SessionSecret = secret
	}
	if cfg.AdminPassword == "" {
		return cfg, fmt.Errorf("ADMIN_PASSWORD must be set")
	}
	if cfg.AdminPassword == "CHANGE_ME" {
		fmt.Println("WARNING: ADMIN_PASSWORD is still CHANGE_ME. Set a strong password in .env before exposing this app.")
	}

	origins := getenv("ALLOWED_ORIGINS", "*")
	if origins != "*" {
		for _, o := range strings.Split(origins, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
			}
		}
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func parseBool(v string) bool {
	b, _ := strconv.ParseBool(v)
	return b
}

func parseDuration(v string) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil {
		return 168 * time.Hour
	}
	return d
}

func loadOrCreateSecret(path string) (string, error) {
	if b, err := os.ReadFile(path); err == nil {
		s := strings.TrimSpace(string(b))
		if len(s) >= 16 {
			return s, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	s := hex.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(s+"\n"), 0o600); err != nil {
		return "", err
	}
	return s, nil
}

func ParseSize(s string) (int64, error) {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return 0, fmt.Errorf("empty size")
	}
	multipliers := []struct {
		suffix string
		mult   int64
	}{
		{"GB", 1 << 30},
		{"G", 1 << 30},
		{"MB", 1 << 20},
		{"M", 1 << 20},
		{"KB", 1 << 10},
		{"K", 1 << 10},
		{"B", 1},
	}
	for _, m := range multipliers {
		if strings.HasSuffix(s, m.suffix) {
			num := strings.TrimSpace(strings.TrimSuffix(s, m.suffix))
			n, err := strconv.ParseFloat(num, 64)
			if err != nil {
				return 0, err
			}
			return int64(n * float64(m.mult)), nil
		}
	}
	return strconv.ParseInt(s, 10, 64)
}
