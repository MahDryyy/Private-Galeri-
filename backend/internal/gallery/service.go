package gallery

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rwcarlsen/goexif/exif"
	"github.com/secreat/personal-gallery/internal/fsutil"
)

type Service struct {
	Resolver *fsutil.Resolver
}

func New(resolver *fsutil.Resolver) *Service {
	return &Service{Resolver: resolver}
}

type BrowseOptions struct {
	Path  string
	Sort  string
	Page  int
	Limit int
	Query string
	Kind  string
}

func (s *Service) Browse(opts BrowseOptions) (*BrowseResult, error) {
	abs, err := s.Resolver.Resolve(opts.Path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory")
	}

	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 80
	}
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.Sort == "" {
		opts.Sort = "newest"
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	var folders []Item
	var files []Item
	q := strings.ToLower(strings.TrimSpace(opts.Query))

	for _, e := range entries {
		if fsutil.HiddenFromListing(e.Name()) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(e.Name()), q) {
			continue
		}
		full := filepath.Join(abs, e.Name())
		fi, err := e.Info()
		if err != nil {
			continue
		}
		rel, err := s.Resolver.Rel(full)
		if err != nil {
			continue
		}
		if e.IsDir() {
			count := childCount(full)
			folders = append(folders, Item{
				Name:       e.Name(),
				Path:       rel,
				Type:       TypeFolder,
				ModifiedAt: fi.ModTime().UTC(),
				ChildCount: count,
			})
			continue
		}
		typ, mime := Classify(e.Name())
		if opts.Kind == "image" && typ != TypeImage {
			continue
		}
		if opts.Kind == "video" && typ != TypeVideo {
			continue
		}
		files = append(files, Item{
			Name:       e.Name(),
			Path:       rel,
			Type:       typ,
			Mime:       mime,
			Size:       fi.Size(),
			ModifiedAt: fi.ModTime().UTC(),
		})
	}

	sortItems(folders, opts.Sort)
	sortItems(files, opts.Sort)

	total := len(files)
	start := (opts.Page - 1) * opts.Limit
	if start > total {
		start = total
	}
	end := start + opts.Limit
	if end > total {
		end = total
	}

	parent := ""
	rel, _ := s.Resolver.Rel(abs)
	if rel != "/" {
		parent = filepath.ToSlash(filepath.Dir(rel))
		if parent == "." {
			parent = "/"
		}
	}

	return &BrowseResult{
		Path:    rel,
		Parent:  parent,
		Folders: folders,
		Items:   files[start:end],
		Page:    opts.Page,
		Limit:   opts.Limit,
		Total:   total,
		HasMore: end < total,
		Sort:    opts.Sort,
	}, nil
}

func childCount(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if !fsutil.HiddenFromListing(e.Name()) {
			n++
		}
	}
	return n
}

func sortItems(items []Item, mode string) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		switch mode {
		case "oldest":
			if a.ModifiedAt.Equal(b.ModifiedAt) {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
			return a.ModifiedAt.Before(b.ModifiedAt)
		case "name_asc":
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		case "name_desc":
			return strings.ToLower(a.Name) > strings.ToLower(b.Name)
		case "size_desc":
			if a.Size == b.Size {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
			return a.Size > b.Size
		case "size_asc":
			if a.Size == b.Size {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
			return a.Size < b.Size
		default:
			if a.ModifiedAt.Equal(b.ModifiedAt) {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
			return a.ModifiedAt.After(b.ModifiedAt)
		}
	})
}

func (s *Service) Search(query string, limit int) ([]Item, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return []Item{}, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var results []Item
	err := filepath.WalkDir(s.Resolver.Root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == s.Resolver.Root {
			return nil
		}
		if fsutil.HiddenFromListing(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.Contains(strings.ToLower(d.Name()), query) {
			return nil
		}
		rel, rerr := s.Resolver.Rel(path)
		if rerr != nil {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		item := Item{
			Name:       d.Name(),
			Path:       rel,
			ModifiedAt: info.ModTime().UTC(),
			Size:       info.Size(),
		}
		if d.IsDir() {
			item.Type = TypeFolder
			item.Size = 0
		} else {
			item.Type, item.Mime = Classify(d.Name())
		}
		results = append(results, item)
		if len(results) >= limit {
			return filepath.SkipAll
		}
		return nil
	})
	return results, err
}

func (s *Service) CreateFolder(parent, name string) (string, error) {
	if err := fsutil.ValidateName(name); err != nil {
		return "", err
	}
	parentAbs, err := s.Resolver.Resolve(parent)
	if err != nil {
		return "", err
	}
	target := filepath.Join(parentAbs, name)
	if _, err := s.Resolver.Resolve(filepath.Join(parent, name)); err != nil {
		return "", err
	}
	if err := os.Mkdir(target, 0o750); err != nil {
		return "", err
	}
	return s.Resolver.Rel(target)
}

func (s *Service) Rename(srcPath, newName string) (string, error) {
	if err := fsutil.ValidateName(newName); err != nil {
		return "", err
	}
	src, err := s.Resolver.Resolve(srcPath)
	if err != nil {
		return "", err
	}
	if src == s.Resolver.Root {
		return "", fmt.Errorf("cannot rename gallery root")
	}
	dst := filepath.Join(filepath.Dir(src), newName)
	if !s.underRoot(dst) {
		return "", fsutil.ErrPathTraversal
	}
	if _, err := os.Stat(dst); err == nil {
		return "", os.ErrExist
	}
	if err := os.Rename(src, dst); err != nil {
		return "", err
	}
	return s.Resolver.Rel(dst)
}

func (s *Service) Move(srcPath, destDir string) (string, error) {
	src, err := s.Resolver.Resolve(srcPath)
	if err != nil {
		return "", err
	}
	if src == s.Resolver.Root {
		return "", fmt.Errorf("cannot move gallery root")
	}
	dest, err := s.Resolver.Resolve(destDir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(dest)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("destination is not a folder")
	}
	if src == dest {
		return "", fmt.Errorf("cannot move a folder into itself")
	}
	if isNested(src, dest) {
		return "", fmt.Errorf("cannot move a folder into its descendant")
	}
	dst := filepath.Join(dest, filepath.Base(src))
	if !s.underRoot(dst) {
		return "", fsutil.ErrPathTraversal
	}
	if _, err := os.Stat(dst); err == nil {
		return "", os.ErrExist
	}
	if err := os.Rename(src, dst); err != nil {
		return "", err
	}
	return s.Resolver.Rel(dst)
}

func (s *Service) Delete(rel string) error {
	abs, err := s.Resolver.Resolve(rel)
	if err != nil {
		return err
	}
	if abs == s.Resolver.Root {
		return fmt.Errorf("cannot delete gallery root")
	}
	return os.RemoveAll(abs)
}

func (s *Service) FolderStats(rel string) (int, error) {
	abs, err := s.Resolver.Resolve(rel)
	if err != nil {
		return 0, err
	}
	n := 0
	_ = filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
		if err != nil || path == abs {
			return nil
		}
		if fsutil.HiddenFromListing(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		n++
		return nil
	})
	return n, nil
}

func (s *Service) SaveUpload(destDir, filename string, src io.Reader, maxSize int64) (string, error) {
	if err := fsutil.ValidateName(filename); err != nil {
		return "", err
	}
	if !IsUploadAllowed(filename) {
		return "", fmt.Errorf("file type not allowed")
	}
	dir, err := s.Resolver.Resolve(destDir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("destination is not a folder")
	}
	filename = uniqueName(dir, filename)
	dstPath := filepath.Join(dir, filename)
	if !s.underRoot(dstPath) {
		return "", fsutil.ErrPathTraversal
	}
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()
	limited := io.LimitReader(src, maxSize+1)
	written, err := io.Copy(tmp, limited)
	if err != nil {
		_ = tmp.Close()
		return "", err
	}
	if written > maxSize {
		_ = tmp.Close()
		return "", ErrTooLarge
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, dstPath); err != nil {
		return "", err
	}
	_ = os.Chmod(dstPath, 0o640)
	return s.Resolver.Rel(dstPath)
}

var ErrTooLarge = errors.New("file too large")

func uniqueName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; i < 10000; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Stat(filepath.Join(dir, candidate)); err != nil {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d%s", base, time.Now().Unix(), ext)
}

func (s *Service) underRoot(abs string) bool {
	abs = filepath.Clean(abs)
	root := s.Resolver.Root
	if abs == root {
		return true
	}
	return strings.HasPrefix(abs, root+string(os.PathSeparator))
}

func isNested(parent, child string) bool {
	parent = filepath.Clean(parent)
	child = filepath.Clean(child)
	prefix := parent + string(os.PathSeparator)
	return strings.HasPrefix(child, prefix)
}

func (s *Service) Scan() (*ScanResult, error) {
	res := &ScanResult{}
	err := filepath.WalkDir(s.Resolver.Root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == s.Resolver.Root {
			return nil
		}
		if fsutil.HiddenFromListing(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			res.Folders++
			return nil
		}
		res.Files++
		if IsImage(d.Name()) {
			res.Images++
		} else if IsVideo(d.Name()) {
			res.Videos++
		}
		return nil
	})
	return res, err
}

func (s *Service) FolderTree() (TreeNode, error) {
	return s.walkTree(s.Resolver.Root, 0)
}

func (s *Service) walkTree(abs string, depth int) (TreeNode, error) {
	rel, err := s.Resolver.Rel(abs)
	if err != nil {
		return TreeNode{}, err
	}
	node := TreeNode{Name: filepath.Base(abs), Path: rel}
	if rel == "/" {
		node.Name = "Home"
	}
	if depth > 12 {
		return node, nil
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return node, err
	}
	for _, e := range entries {
		if !e.IsDir() || fsutil.HiddenFromListing(e.Name()) {
			continue
		}
		child, err := s.walkTree(filepath.Join(abs, e.Name()), depth+1)
		if err != nil {
			continue
		}
		node.Children = append(node.Children, child)
	}
	sort.Slice(node.Children, func(i, j int) bool {
		return strings.ToLower(node.Children[i].Name) < strings.ToLower(node.Children[j].Name)
	})
	return node, nil
}

func (s *Service) Metadata(rel string) (*Item, error) {
	abs, err := s.Resolver.Resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("not a file")
	}
	pathRel, _ := s.Resolver.Rel(abs)
	typ, mime := Classify(info.Name())
	item := &Item{
		Name:       info.Name(),
		Path:       pathRel,
		Type:       typ,
		Mime:       mime,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC(),
	}
	fillExif(abs, item)
	return item, nil
}

func fillExif(abs string, item *Item) {
	f, err := os.Open(abs)
	if err != nil {
		return
	}
	defer f.Close()
	x, err := exif.Decode(f)
	if err != nil {
		return
	}
	if dt, err := x.DateTime(); err == nil {
		t := dt.UTC()
		item.ExifDate = &t
	}
	if lat, lng, err := x.LatLong(); err == nil {
		item.GPSLat = &lat
		item.GPSLng = &lng
	}
	if tag, err := x.Get(exif.PixelXDimension); err == nil && tag.Count > 0 {
		if v, err := tag.Int(0); err == nil {
			item.Width = int(v)
		}
	}
	if tag, err := x.Get(exif.PixelYDimension); err == nil && tag.Count > 0 {
		if v, err := tag.Int(0); err == nil {
			item.Height = int(v)
		}
	}
}

func (s *Service) Zip(paths []string, w io.Writer) error {
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range paths {
		abs, err := s.Resolver.Resolve(p)
		if err != nil {
			return err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if d.IsDir() || fsutil.HiddenFromListing(d.Name()) {
					if d.IsDir() && fsutil.HiddenFromListing(d.Name()) && path != abs {
						return filepath.SkipDir
					}
					return nil
				}
				rel, rerr := s.Resolver.Rel(path)
				if rerr != nil {
					return nil
				}
				return addZipFile(zw, path, strings.TrimPrefix(rel, "/"))
			})
			if err != nil {
				return err
			}
			continue
		}
		rel, _ := s.Resolver.Rel(abs)
		if err := addZipFile(zw, abs, strings.TrimPrefix(rel, "/")); err != nil {
			return err
		}
	}
	return nil
}

func addZipFile(zw *zip.Writer, abs, name string) error {
	f, err := os.Open(abs)
	if err != nil {
		return err
	}
	defer f.Close()
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}
