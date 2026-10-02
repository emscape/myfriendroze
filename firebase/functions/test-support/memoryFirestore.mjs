// In-memory stand-in for the parts of the Admin SDK Firestore API the
// checkout-hold code uses: doc get/set/update/delete, equality where()
// queries, and transactions. Transaction writes are buffered and applied
// only after the callback resolves, and a read after a write throws, as in
// real Firestore, so tests catch read-after-write ordering mistakes.
// Not a test file itself (no .test. in the name), so vitest doesn't run it.

export function memoryFirestore(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs).map(([path, data]) => [path, structuredClone(data)]));

  function snapshot(path) {
    const ref = docRef(path);
    return {
      id: ref.id,
      ref,
      exists: store.has(path),
      data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
    };
  }

  function applyUpdate(path, data) {
    if (!store.has(path)) throw new Error(`No document to update: ${path}`);
    store.set(path, { ...store.get(path), ...structuredClone(data) });
  }

  function docRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => snapshot(path),
      set: async (data) => {
        store.set(path, structuredClone(data));
      },
      update: async (data) => applyUpdate(path, data),
      delete: async () => {
        store.delete(path);
      },
    };
  }

  function query(collectionName, filters) {
    return {
      isQuery: true,
      where: (field, op, value) => {
        if (op !== '==') throw new Error(`memoryFirestore only supports '==', got ${op}`);
        return query(collectionName, [...filters, [field, value]]);
      },
      get: async () => {
        const docs = [...store.keys()]
          .filter((path) => path.startsWith(`${collectionName}/`) && path.split('/').length === 2)
          .filter((path) => filters.every(([field, value]) => store.get(path)[field] === value))
          .map(snapshot);
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  return {
    // Test inspection helpers.
    dump: (path) => (store.has(path) ? structuredClone(store.get(path)) : undefined),
    has: (path) => store.has(path),

    collection: (name) => ({
      doc: (id) => docRef(`${name}/${id}`),
      where: (field, op, value) => query(name, []).where(field, op, value),
    }),

    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (refOrQuery) => {
          if (writes.length) throw new Error('Firestore transactions require all reads before any writes');
          return refOrQuery.get();
        },
        set: (ref, data) => {
          writes.push(() => store.set(ref.path, structuredClone(data)));
          return tx;
        },
        update: (ref, data) => {
          writes.push(() => applyUpdate(ref.path, data));
          return tx;
        },
        delete: (ref) => {
          writes.push(() => store.delete(ref.path));
          return tx;
        },
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
}
