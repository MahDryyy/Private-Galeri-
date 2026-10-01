package gallery

import "time"

type ItemType string

const (
	TypeFolder ItemType = "folder"
	TypeImage  ItemType = "image"
	TypeVideo  ItemType = "video"
	TypeFile   ItemType = "file"
)

type Item struct {
	Name       string     `json:"name"`
	Path       string     `json:"path"`
	Type       ItemType   `json:"type"`
	Mime       string     `json:"mime,omitempty"`
	Size       int64      `json:"size"`
	ModifiedAt time.Time  `json:"modifiedAt"`
	Width      int        `json:"width,omitempty"`
	Height     int        `json:"height,omitempty"`
	ExifDate   *time.Time `json:"exifDate,omitempty"`
	GPSLat     *float64   `json:"gpsLat,omitempty"`
	GPSLng     *float64   `json:"gpsLng,omitempty"`
	Favorite   bool       `json:"favorite"`
	ChildCount int        `json:"childCount,omitempty"`
}

type BrowseResult struct {
	Path    string `json:"path"`
	Parent  string `json:"parent,omitempty"`
	Folders []Item `json:"folders"`
	Items   []Item `json:"items"`
	Page    int    `json:"page"`
	Limit   int    `json:"limit"`
	Total   int    `json:"total"`
	HasMore bool   `json:"hasMore"`
	Sort    string `json:"sort"`
}

type ScanResult struct {
	Folders int `json:"folders"`
	Files   int `json:"files"`
	Images  int `json:"images"`
	Videos  int `json:"videos"`
}

type TreeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Children []TreeNode `json:"children,omitempty"`
}
