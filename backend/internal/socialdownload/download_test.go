package socialdownload

import "testing"

func TestValidateURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "TikTok video", url: "https://www.tiktok.com/@user/video/123", want: true},
		{name: "TikTok short link", url: "https://vt.tiktok.com/ZSF123/", want: true},
		{name: "Instagram reel", url: "https://www.instagram.com/reel/abc/", want: true},
		{name: "Instagram post", url: "https://instagram.com/p/abc/", want: true},
		{name: "lookalike host", url: "https://tiktok.com.evil.example/@user/video/123"},
		{name: "unsupported host", url: "https://example.com/@user/video/123"},
		{name: "non-HTTPS", url: "http://www.tiktok.com/@user/video/123"},
		{name: "credentials", url: "https://user:pass@www.instagram.com/reel/abc/"},
		{name: "unsupported path", url: "https://www.instagram.com/accounts/login/"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateURL(tt.url)
			if (err == nil) != tt.want {
				t.Fatalf("ValidateURL(%q) error = %v, want valid %v", tt.url, err, tt.want)
			}
		})
	}
}
