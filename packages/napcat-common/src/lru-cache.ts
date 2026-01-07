export class LRUCache<K, V> {
  private capacity: number;
  private ttl: number; // Time to live in milliseconds, 0 means no expiry
  public cache: Map<K, { value: V, expiry: number }>;

  constructor (capacity: number, ttl: number = 0) {
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map<K, { value: V, expiry: number }>();
  }

  public get (key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) {
      return undefined;
    }

    // Check for expiry
    if (this.ttl > 0 && Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // Move the accessed key to the end to mark it as most recently used
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  public put (key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove the least recently used key
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    const expiry = this.ttl > 0 ? Date.now() + this.ttl : Infinity;
    this.cache.set(key, { value, expiry });
  }

  public resetCapacity (newCapacity: number): void {
    this.capacity = newCapacity;
    while (this.cache.size > this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }
  
  public prune(): void {
    if (this.ttl <= 0) return;
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}
