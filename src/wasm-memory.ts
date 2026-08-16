/**
 * BNES PQC WASM 記憶體管理工具
 *
 * 風險背景：Go/C 編譯至 WASM 的 ML-DSA-87 函式庫，在 JavaScript 端操作
 * 完畢後，若未主動呼叫 Module._free()，WASM 線性記憶體（Linear Memory）
 * 內的 malloc'd 區塊將永遠不會被 GC 回收，導致瀏覽器長期運作後崩潰。
 *
 * 使用方式：
 *   import { withWasmArena } from './wasm-memory';
 *
 *   const result = await withWasmArena(wasmModule, async (alloc, free) => {
 *     const ptr = alloc(MLDSA87_PK_BYTES);
 *     // ... 寫入資料 / 呼叫 WASM 函數 ...
 *     const output = readWasmBuffer(ptr, outputLen);
 *     return output;
 *   });
 *   // withWasmArena 結束後，所有 alloc 的指標均已釋放
 */

/**
 * WASM 模組最小介面（Go/C emscripten 輸出的常見 API）
 */
export interface WasmModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

/**
 * 追蹤一個呼叫期間所有 WASM 指標並在結束後統一釋放。
 *
 * @param mod     已初始化的 WASM 模組實例
 * @param fn      使用者非同步回呼；接收 alloc / free 工具函數
 * @returns       回呼的回傳值
 *
 * 注意：任何在 fn 內主動呼叫 free(ptr) 的指標，
 * withWasmArena 不會重複釋放（內部使用 Set 追蹤未釋放指標）。
 */
export async function withWasmArena<T>(
  mod: WasmModule,
  fn: (
    alloc: (size: number) => number,
    free: (ptr: number) => void,
  ) => Promise<T>,
): Promise<T> {
  const allocated = new Set<number>();

  // 包裝 _malloc：記錄每個配置的指標
  const alloc = (size: number): number => {
    const ptr = mod._malloc(size);
    if (ptr === 0) {
      throw new Error(
        `[BNES WASM] _malloc(${size}) 失敗：WASM 線性記憶體不足`,
      );
    }
    allocated.add(ptr);
    return ptr;
  };

  // 包裝 _free：釋放並從追蹤集合中移除
  const free = (ptr: number): void => {
    if (allocated.has(ptr)) {
      mod._free(ptr);
      allocated.delete(ptr);
    }
  };

  try {
    return await fn(alloc, free);
  } finally {
    // 保證：即使 fn 拋出例外，所有未釋放指標均被清理
    for (const ptr of allocated) {
      mod._free(ptr);
    }
    allocated.clear();
  }
}

/**
 * 將 Uint8Array 寫入 WASM 線性記憶體並回傳指標。
 * 需在 withWasmArena 內部使用，由 arena 負責釋放。
 */
export function writeToWasm(
  mod: WasmModule,
  alloc: (size: number) => number,
  data: Uint8Array,
): number {
  const ptr = alloc(data.length);
  mod.HEAPU8.set(data, ptr);
  return ptr;
}

/**
 * 從 WASM 線性記憶體讀取指定長度的位元組並複製為 JS Uint8Array。
 * 此操作不管理記憶體生命週期，指標仍需由 withWasmArena 釋放。
 */
export function readFromWasm(
  mod: WasmModule,
  ptr: number,
  length: number,
): Uint8Array {
  return mod.HEAPU8.slice(ptr, ptr + length);
}

/**
 * 安全地銷毀 WASM 模組實例（若模組支援 destroy 方法）。
 * 在 Service Worker 重啟或分頁卸載時呼叫，釋放整塊 WASM 記憶體。
 */
export function destroyWasmModule(mod: WasmModule & { destroy?: () => void }): void {
  try {
    mod.destroy?.();
  } catch {
    // 靜默處理，避免 Service Worker 生命週期內拋出未捕獲例外
  }
}
