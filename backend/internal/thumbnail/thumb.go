package thumbnail

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/gif"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/secreat/personal-gallery/internal/gallery"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

type Service struct {
	dir   string
	mu    sync.Mutex
	inflight map[string]*call
}

type call struct {
	wg  sync.WaitGroup
	err error
}

func New(dir string) (*Service, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	return &Service{dir: dir, inflight: make(map[string]*call)}, nil
}

func (s *Service) PathFor(srcAbs string, modUnix int64) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%d", srcAbs, modUnix)))
	name := hex.EncodeToString(sum[:]) + ".jpg"
	return filepath.Join(s.dir, name[:2], name)
}

func (s *Service) Ensure(srcAbs string, info os.FileInfo) (string, error) {
	dest := s.PathFor(srcAbs, info.ModTime().Unix())
	if _, err := os.Stat(dest); err == nil {
		return dest, nil
	}
	key := dest
	s.mu.Lock()
	if c, ok := s.inflight[key]; ok {
		s.mu.Unlock()
		c.wg.Wait()
		return dest, c.err
	}
	c := &call{}
	c.wg.Add(1)
	s.inflight[key] = c
	s.mu.Unlock()

	err := s.generate(srcAbs, dest, info.Name())
	c.err = err
	c.wg.Done()

	s.mu.Lock()
	delete(s.inflight, key)
	s.mu.Unlock()
	if err != nil {
		return "", err
	}
	return dest, nil
}

func (s *Service) generate(src, dest, name string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return err
	}
	tmp := dest + ".tmp"
	defer os.Remove(tmp)

	if gallery.IsVideo(name) {
		if err := ffmpegThumb(src, tmp); err != nil {
			return err
		}
	} else if gallery.IsImage(name) {
		ext := strings.ToLower(filepath.Ext(name))
		if ext == ".heic" || ext == ".heif" {
			if err := ffmpegThumb(src, tmp); err != nil {
				return err
			}
		} else if err := imageThumb(src, tmp); err != nil {
			return err
		}
	} else {
		return fmt.Errorf("no thumbnail")
	}
	return os.Rename(tmp, dest)
}

func imageThumb(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return fmt.Errorf("invalid image")
	}
	maxW := 360
	nw := maxW
	nh := h * nw / w
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	return jpeg.Encode(out, dst, &jpeg.Options{Quality: 78})
}

func ffmpegThumb(src, dest string) error {
	cmd := exec.Command(
		"ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-ss", "0.5", "-i", src, "-frames:v", "1",
		"-vf", "scale=360:-1", dest,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w %s", err, stderr.String())
	}
	return nil
}
