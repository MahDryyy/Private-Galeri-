package fsutil

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

var (
	ErrPathTraversal = errors.New("path is outside gallery root")
	ErrInvalidPath   = errors.New("invalid path")
	ErrReservedName  = errors.New("reserved name")
)

var reservedNames = map[string]struct{}{
	".thumbnails": {},
	".gallery":    {},
	".":           {},
	"..":          {},
}

type Resolver struct {
	Root string
}

func NewResolver(root string) (*Resolver, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	abs, err = filepath.EvalSymlinks(abs)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
		if mkErr := os.MkdirAll(abs, 0o750); mkErr != nil {
			return nil, mkErr
		}
		abs, err = filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, err
		}
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("gallery root is not a directory")
	}
	return &Resolver{Root: abs}, nil
}

func (r *Resolver) Rel(absPath string) (string, error) {
	rel, err := filepath.Rel(r.Root, absPath)
	if err != nil {
		return "", err
	}
	if rel == "." {
		return "/", nil
	}
	if strings.HasPrefix(rel, "..") {
		return "", ErrPathTraversal
	}
	return "/" + filepath.ToSlash(rel), nil
}

func (r *Resolver) Resolve(userPath string) (string, error) {
	rel, err := NormalizeUserPath(userPath)
	if err != nil {
		return "", err
	}
	full := filepath.Join(r.Root, filepath.FromSlash(rel))
	full = filepath.Clean(full)
	if !r.within(full) {
		return "", ErrPathTraversal
	}
	if resolved, err := filepath.EvalSymlinks(full); err == nil {
		if !r.within(resolved) {
			return "", ErrPathTraversal
		}
		return resolved, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		parent := filepath.Dir(full)
		if parentResolved, perr := filepath.EvalSymlinks(parent); perr == nil {
			candidate := filepath.Join(parentResolved, filepath.Base(full))
			if !r.within(candidate) {
				return "", ErrPathTraversal
			}
			return candidate, nil
		}
	}
	return full, nil
}

func (r *Resolver) within(abs string) bool {
	abs = filepath.Clean(abs)
	root := r.Root
	if abs == root {
		return true
	}
	prefix := root + string(os.PathSeparator)
	return strings.HasPrefix(abs, prefix)
}

func NormalizeUserPath(userPath string) (string, error) {
	if userPath == "" {
		return "", nil
	}
	if strings.ContainsRune(userPath, 0) {
		return "", ErrInvalidPath
	}
	p := strings.ReplaceAll(userPath, "\\", "/")
	if strings.Contains(p, "://") {
		return "", ErrInvalidPath
	}
	if filepath.IsAbs(userPath) && (len(userPath) >= 2 && userPath[1] == ':') {
		return "", ErrInvalidPath
	}
	cleaned := pathCleanSlash(p)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", ErrPathTraversal
	}
	rel := strings.TrimPrefix(cleaned, "/")
	parts := strings.Split(rel, "/")
	for _, part := range parts {
		if part == "" {
			continue
		}
		if !utf8.ValidString(part) {
			return "", ErrInvalidPath
		}
		if _, ok := reservedNames[strings.ToLower(part)]; ok {
			return "", ErrReservedName
		}
		if part == "." || part == ".." {
			return "", ErrPathTraversal
		}
	}
	return rel, nil
}

func ValidateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name cannot be empty")
	}
	if strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return fmt.Errorf("name cannot contain path separators")
	}
	if name == "." || name == ".." {
		return ErrPathTraversal
	}
	if _, ok := reservedNames[strings.ToLower(name)]; ok {
		return ErrReservedName
	}
	if !utf8.ValidString(name) {
		return ErrInvalidPath
	}
	if len(name) > 255 {
		return fmt.Errorf("name too long")
	}
	return nil
}

func HiddenFromListing(name string) bool {
	if name == "" {
		return true
	}
	if strings.HasPrefix(name, ".") {
		return true
	}
	_, ok := reservedNames[strings.ToLower(name)]
	return ok
}

func pathCleanSlash(p string) string {
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	parts := strings.Split(p, "/")
	stack := make([]string, 0, len(parts))
	for _, part := range parts {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(stack) == 0 {
				return ".."
			}
			stack = stack[:len(stack)-1]
		default:
			stack = append(stack, part)
		}
	}
	if len(stack) == 0 {
		return "/"
	}
	return "/" + strings.Join(stack, "/")
}
