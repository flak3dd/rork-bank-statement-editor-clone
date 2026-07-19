/** Minimal DOM polyfills for Node vitest (pdfjs, canvas APIs). */

// localStorage mock — avoids ExperimentalWarning when code touches storage
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

// File polyfill for parsers that expect browser File
if (typeof globalThis.File === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).File = class File extends Blob {
    name: string;
    lastModified: number;
    constructor(
      bits: BlobPart[],
      name: string,
      opts?: FilePropertyBag,
    ) {
      super(bits, opts);
      this.name = name;
      this.lastModified = opts?.lastModified ?? Date.now();
    }
  };
}

if (typeof globalThis.DOMMatrix === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(_init?: string | number[]) {}
    multiplySelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Path2D = class Path2D {};
}

// ImageData for Pdfium/canvas verification paths under Node vitest
if (typeof globalThis.ImageData === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = "srgb";
    constructor(
      dataOrW: Uint8ClampedArray | number,
      wOrH: number,
      h?: number,
    ) {
      if (typeof dataOrW === "number") {
        this.width = dataOrW;
        this.height = wOrH;
        this.data = new Uint8ClampedArray(dataOrW * wOrH * 4);
      } else {
        this.data = dataOrW;
        this.width = wOrH;
        this.height = h ?? 0;
      }
    }
  };
}

// document.createElement('canvas') stub for pdfjs render paths in Node
if (typeof globalThis.document === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillRect: () => {},
            drawImage: () => {},
            getImageData: (x: number, y: number, w: number, h: number) =>
              new (globalThis as any).ImageData(w, h),
            putImageData: () => {},
          }),
          toDataURL: () => "data:image/png;base64,",
        };
      }
      return {};
    },
  };
}
