// lib/save-file.ts

/** Starts a browser download of `href` under `filename`. */
export function clickDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}

/**
 * Saves bytes already in memory. The object URL is freed as soon as the click
 * has handed it to the browser's download, so repeated saves do not pin blobs.
 */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    clickDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
