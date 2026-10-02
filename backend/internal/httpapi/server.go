package httpapi

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/secreat/personal-gallery/internal/auth"
	"github.com/secreat/personal-gallery/internal/config"
	"github.com/secreat/personal-gallery/internal/gallery"
	"github.com/secreat/personal-gallery/internal/thumbnail"
)

type Server struct {
	Cfg     config.Config
	Auth    *auth.Service
	Gallery *gallery.Service
	Thumbs  *thumbnail.Service
	Engine  *gin.Engine
}

func New(cfg config.Config, authSvc *auth.Service, gal *gallery.Service, thumbs *thumbnail.Service) *Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())
	r.Use(cors(cfg))
	r.MaxMultipartMemory = 32 << 20

	s := &Server{Cfg: cfg, Auth: authSvc, Gallery: gal, Thumbs: thumbs, Engine: r}

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	{
		api.POST("/auth/login", s.login)
		api.POST("/auth/logout", s.logout)
		api.GET("/auth/webauthn/status", s.webauthnStatus)

		authed := api.Group("")
		authed.Use(s.authRequired())
		{
			authed.GET("/auth/me", s.me)
			authed.GET("/gallery", s.browse)
			authed.GET("/gallery/browse", s.browse)
			authed.GET("/gallery/search", s.search)
			authed.GET("/gallery/tree", s.tree)
			authed.GET("/gallery/file", s.file)
			authed.GET("/gallery/thumbnail", s.thumb)
			authed.GET("/gallery/metadata", s.metadata)
			authed.GET("/gallery/folder/stats", s.folderStats)
			authed.POST("/gallery/folder", s.createFolder)
			authed.POST("/gallery/upload", s.upload)
			authed.POST("/gallery/download-social", s.downloadSocial)
			authed.POST("/gallery/rename", s.rename)
			authed.POST("/gallery/move", s.move)
			authed.POST("/gallery/scan", s.scan)
			authed.POST("/gallery/favorite", s.favorite)
			authed.POST("/gallery/download", s.downloadZip)
			authed.DELETE("/gallery/file", s.deleteItems)
			authed.DELETE("/gallery/folder", s.deleteItems)
			authed.DELETE("/gallery/items", s.deleteItems)
		}
	}
	return s
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s %d %s", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(start).Truncate(time.Millisecond))
	}
}

func cors(cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allow := ""
		if len(cfg.AllowedOrigins) == 0 {
			if origin != "" {
				allow = origin
			}
		} else {
			for _, o := range cfg.AllowedOrigins {
				if o == origin {
					allow = origin
					break
				}
			}
		}
		if allow != "" {
			c.Header("Access-Control-Allow-Origin", allow)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
			c.Header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
			c.Header("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func SanitizeLog(v string) string {
	return strings.ReplaceAll(v, "\n", " ")
}
