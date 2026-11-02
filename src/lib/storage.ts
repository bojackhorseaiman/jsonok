// 本地存储（收藏、最近使用、设置、上次的输入），统一加前缀，读写失败时静默降级

const PREFIX = 'kj.';

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 存储已满或被浏览器禁用：忽略，不影响使用
  }
}
