/**
 * The slice of libheif's API this app uses.
 *
 * The package ships its own types for the pure-JavaScript entry point but not
 * for `wasm-bundle`, which is the one worth loading in a browser: it carries
 * the WebAssembly inside the JavaScript, so there is no second asset for a
 * bundler to lose. Four methods is the whole of what `services/attachments.ts`
 * touches, so four methods is what is declared.
 */
declare module 'libheif-js/wasm-bundle' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    /** Fills `data` with RGBA pixels, then calls back with it - or with null. */
    display(data: ImageData, done: (filled: ImageData | null) => void): void;
  }

  export class HeifDecoder {
    /** Every image in the file; a phone photo is one, a burst is several. */
    decode(bytes: Uint8Array): HeifImage[];
  }
}
