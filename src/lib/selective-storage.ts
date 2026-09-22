import type { PersistStorage, StorageValue } from "zustand/middleware";

/** 界面状态变化不应重复序列化和写入整份资产快照。 */
export function selectiveStorage<T extends object>(storage: PersistStorage<T>): PersistStorage<T> {
  const written = new Map<string, StorageValue<T>>();
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      const previous = written.get(name);
      const keys = Object.keys(value.state) as (keyof T)[];
      if (
        previous?.version === value.version &&
        previous &&
        Object.keys(previous.state).length === keys.length &&
        keys.every((key) => Object.is(previous.state[key], value.state[key]))
      )
        return;
      written.set(name, value);
      try {
        const result = storage.setItem(name, value);
        {
          return Promise.resolve(result).catch((error: unknown) => {
            if (written.get(name) === value) written.delete(name);
            throw error;
          });
        }
      } catch (error) {
        if (written.get(name) === value) written.delete(name);
        throw error;
      }
    },
    removeItem: (name) => {
      written.delete(name);
      return storage.removeItem(name);
    },
  };
}
