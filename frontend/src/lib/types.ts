export type ItemType = "folder" | "image" | "video" | "file";

export type GalleryItem = {
  name: string;
  path: string;
  type: ItemType;
  mime?: string;
  size: number;
  modifiedAt: string;
  width?: number;
  height?: number;
  exifDate?: string;
  gpsLat?: number;
  gpsLng?: number;
  favorite: boolean;
  childCount?: number;
};

export type BrowseResult = {
  path: string;
  parent?: string;
  folders: GalleryItem[];
  items: GalleryItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  sort: string;
};

export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data?: T;
};
