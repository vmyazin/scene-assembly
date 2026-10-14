// lib/file-data-url.ts

/** Reads a picked or dropped file into a `data:` URL, rejecting with `unreadable`. */
export function fileAsDataUrl(file: Blob, unreadable = 'Could not read that file.'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(unreadable));
    };
    reader.onerror = () => reject(new Error(unreadable));
    reader.readAsDataURL(file);
  });
}
