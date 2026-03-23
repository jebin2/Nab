import { useState } from "react";
import { type ImageEntry } from "./annotationTypes";
import { getRPC } from "./rpc";
import { pathsToImageEntries } from "./imageLoader";

// Shared hook for opening native image/folder dialogs.
// Eliminates duplicate dialog logic across UploadZone and ImageList.
export function useImagePicker(onLoad: (entries: ImageEntry[]) => void) {
  const [loading, setLoading] = useState(false);

  async function openImages() {
    setLoading(true);
    try {
      const { canceled, paths } = await getRPC().request.openImagesDialog({});
      if (!canceled && paths.length > 0) onLoad(pathsToImageEntries(paths));
    } finally {
      setLoading(false);
    }
  }

  async function openFolder() {
    setLoading(true);
    try {
      const { canceled, paths } = await getRPC().request.openFolderDialog({});
      if (!canceled && paths.length > 0) onLoad(pathsToImageEntries(paths));
    } finally {
      setLoading(false);
    }
  }

  return { openImages, openFolder, loading };
}
