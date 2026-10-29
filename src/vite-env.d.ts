/** Типы для виртуальных модулей Vite (см. ai-client.ts). */
declare module "*?worker&inline" {
  const workerConstructor: new (options?: { name?: string }) => Worker;
  export default workerConstructor;
}
