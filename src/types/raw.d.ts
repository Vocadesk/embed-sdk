// Allow `import foo from "./file.js?raw"` (Vite turns this into a string literal).
declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*?inline" {
  const content: string;
  export default content;
}
