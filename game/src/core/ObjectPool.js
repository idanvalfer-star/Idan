/**
 * ObjectPool — generic pool used for tracers, damage numbers, muzzle
 * flashes and enemies. Objects must implement reset(...) when acquired;
 * the pool calls obj.onRelease?.() when returned.
 */
export class ObjectPool {
  /**
   * @param {() => object} factory creates a fresh instance
   * @param {number} prewarm how many to create up-front
   */
  constructor(factory, prewarm = 0) {
    this.factory = factory;
    this.free = [];
    this.active = new Set();
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  acquire(...args) {
    const obj = this.free.pop() || this.factory();
    this.active.add(obj);
    obj.reset?.(...args);
    return obj;
  }

  release(obj) {
    if (!this.active.delete(obj)) return;
    obj.onRelease?.();
    this.free.push(obj);
  }

  releaseAll() {
    for (const obj of this.active) {
      obj.onRelease?.();
      this.free.push(obj);
    }
    this.active.clear();
  }

  /** Iterate active objects safely (copies the set). */
  forEachActive(fn) {
    for (const obj of [...this.active]) fn(obj);
  }
}
