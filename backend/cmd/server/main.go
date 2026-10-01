package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/secreat/personal-gallery/internal/auth"
	"github.com/secreat/personal-gallery/internal/config"
	"github.com/secreat/personal-gallery/internal/db"
	"github.com/secreat/personal-gallery/internal/fsutil"
	"github.com/secreat/personal-gallery/internal/gallery"
	"github.com/secreat/personal-gallery/internal/httpapi"
	"github.com/secreat/personal-gallery/internal/thumbnail"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	log.Printf("checking gallery root %s (existing files will not be moved or deleted)", cfg.GalleryRoot)
	resolver, err := fsutil.NewResolver(cfg.GalleryRoot)
	if err != nil {
		log.Fatalf("gallery root: %v", err)
	}
	info, err := os.Stat(resolver.Root)
	if err != nil {
		log.Fatalf("gallery root stat: %v", err)
	}
	if !info.IsDir() {
		log.Fatalf("gallery root is not a directory")
	}
	log.Printf("gallery root ready: %s", resolver.Root)

	conn, err := db.Open(cfg.AppDataDir)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer conn.Close()

	authSvc := auth.New(conn, cfg.SessionTTL)
	if err := authSvc.EnsureAdmin(cfg.AdminUsername, cfg.AdminPassword); err != nil {
		log.Fatalf("admin user: %v", err)
	}

	thumbs, err := thumbnail.New(cfg.ThumbnailDir)
	if err != nil {
		log.Fatalf("thumbnails: %v", err)
	}

	gal := gallery.New(resolver)
	srv := httpapi.New(cfg, authSvc, gal, thumbs)

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Engine,
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	log.Printf("personal gallery backend listening on :%s", cfg.Port)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}
