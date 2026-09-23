import { randomBytes } from "node:crypto";

const PAGE_SIZE = 256;
const freshDescriptor = () => ({ version: 1, generation: randomBytes(12).toString("hex"), pages: 0, tail: [] });

/** Append-only pages keep each accounting snapshot bounded without expiring IDs. */
export async function loadIdLedger(secrets, prefix, stored, legacy = []) {
  let descriptor = stored ?? freshDescriptor();
  if (descriptor.version !== 1 || !/^[a-f0-9]{24}$/.test(descriptor.generation) ||
      !Number.isSafeInteger(descriptor.pages) || descriptor.pages < 0 ||
      !Array.isArray(descriptor.tail) || descriptor.tail.length >= PAGE_SIZE ||
      descriptor.tail.some((id) => typeof id !== "string")) {
    throw new Error("Invalid persisted event ID ledger");
  }
  const ids = new Set();
  const pageKey = (value, page) => `${prefix}-${value.generation}-${page}`;
  for (let page = 0; page < descriptor.pages; page += 1) {
    const value = JSON.parse(await secrets.get(pageKey(descriptor, page)));
    if (!Array.isArray(value) || value.length !== PAGE_SIZE || value.some((id) => typeof id !== "string")) {
      throw new Error("Missing or invalid persisted event ID page");
    }
    for (const id of value) ids.add(id);
  }
  for (const id of descriptor.tail) ids.add(id);
  const prepare = async (keys) => {
    const next = { ...descriptor, tail: [...descriptor.tail] };
    const added = new Set();
    for (const key of keys) {
      if (ids.has(key) || added.has(key)) continue;
      added.add(key);
      next.tail.push(key);
      if (next.tail.length === PAGE_SIZE) {
        await secrets.set(pageKey(next, next.pages), JSON.stringify(next.tail));
        next.pages += 1;
        next.tail = [];
      }
    }
    return next;
  };
  const commit = (next, keys) => {
    descriptor = next;
    for (const key of keys) ids.add(key);
  };
  if (legacy.length) commit(await prepare(legacy), legacy);
  return {
    ids,
    get descriptor() { return descriptor; },
    prepare,
    commit,
  };
}
