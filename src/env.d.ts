/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface Window {
  io?: (options: Record<string, unknown>) => {
    on: (event: string, callback: () => void) => void;
    disconnect: () => void;
  };
}
