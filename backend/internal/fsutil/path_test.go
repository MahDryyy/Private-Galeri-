package fsutil_test

import (
	"strings"
	"testing"

	"github.com/secreat/personal-gallery/internal/fsutil"
)

func TestNormalizeRejectsTraversal(t *testing.T) {
	cases := []string{
		"../../etc/passwd",
		"../",
		"foo/../../etc",
		"..",
		`..\..\windows`,
	}
	for _, c := range cases {
		_, err := fsutil.NormalizeUserPath(c)
		if err == nil {
			t.Fatalf("expected reject for %q", c)
		}
	}
}

func TestNormalizeAllowsRel(t *testing.T) {
	rel, err := fsutil.NormalizeUserPath("/Liburan/Bali")
	if err != nil {
		t.Fatal(err)
	}
	if rel != "Liburan/Bali" {
		t.Fatalf("got %q", rel)
	}
}

func TestValidateName(t *testing.T) {
	if err := fsutil.ValidateName("../x"); err == nil {
		t.Fatal("expected error")
	}
	if err := fsutil.ValidateName("Pantai Bali 2026.jpeg"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(fsutil.ErrPathTraversal.Error(), "outside") {
		t.Fatal("sentinel")
	}
}
