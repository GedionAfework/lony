package chat

import "equilend/api/internal/media"

// DiskMedia is an alias for the shared media disk store.
type DiskMedia = media.DiskStore

func NewDiskMedia(root string) (*DiskMedia, error) {
	return media.NewDiskStore(root)
}
