declare module 'astro:content' {
  export const z: {
    object: (schema: any) => any;
    string: () => any;
    number: () => any;
    boolean: () => any;
    enum: (values: string[]) => any;
    array: (inner: any) => any;
    union: (options: any[]) => any;
    optional: () => any;
    coerce: { date: () => any };
  };

  export function defineCollection<T>(config: T): T;
  export function getCollection(name: string): Promise<any[]>;
}

declare module 'astro/config' {
  export function defineConfig(config: any): any;
}

declare module '@astrojs/react' {
  export default function react(): any;
}

declare module '@astrojs/sitemap' {
  export default function sitemap(): any;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}

declare module 'imagequant/imagequant_bg.js' {
  export function __wbg_set_wasm(val: any): void;
  export function __wbindgen_error_new(arg0: any, arg1: any): any;
  export function __wbindgen_throw(arg0: any, arg1: any): void;
  export class Imagequant {
    constructor();
    free(): void;
    set_max_colors(max_colors: number): void;
    set_quality(minimum: number, target: number): void;
    set_speed(value: number): void;
    set_min_posterization(value: number): void;
    process(image: any): Uint8Array;
  }
  export class ImagequantImage {
    constructor(data: Uint8Array, width: number, height: number, gamma: number);
    free(): void;
  }
}
