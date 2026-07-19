/// <reference types="vite/client" />

declare module "*.yaml?raw" {
  const content: string;
  export default content;
}

declare module "*.yml?raw" {
  const content: string;
  export default content;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "@hyzyla/pdfium/dist/pdfium.wasm?url" {
  const url: string;
  export default url;
}
