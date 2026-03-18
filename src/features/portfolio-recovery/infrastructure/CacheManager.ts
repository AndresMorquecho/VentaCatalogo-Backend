/**
 * Portfolio Recovery Analysis - Cache Manager
 * 
 * Manages in-memory caching with TTL for portfolio recovery queries.
 * Uses node-cache for simple, fast in-memory caching with automatic expiration.
 * 
 * NOTE: Requires 'node-cache' package to be installed:
 * npm install node-cache
 * npm install --save-dev @types/node-cache
 */

import NodeCache from 'node-cache';

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /**
   * Default TTL in seconds (default: 60)
   */
  ttlSeconds?: number;

  /**
   * Check period for expired keys in seconds (default: ttlSeconds * 0.2)
   */
  checkPeriod?: number;

  /**
   * Use clones for get/set operations (default: false for better performance)
   */
  useClones?: boolean;
}

/**
 * Cache Manager for portfolio recovery analytics
 * 
 * Provides simple key-value caching with automatic expiration.
 * Falls back gracefully on errors to ensure system availability.
 */
export class CacheManager {
  private cache: NodeCache;
  private defaultTTL: number;

  constructor(config: CacheConfig = {}) {
    const ttlSeconds = config.ttlSeconds || 60;
    
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: config.checkPeriod || ttlSeconds * 0.2,
      useClones: config.useClones !== undefined ? config.useClones : false,
    });

    this.defaultTTL = ttlSeconds;

    // Log cache statistics periodically in development
    if (process.env.NODE_ENV === 'development') {
      setInterval(() => {
        const stats = this.cache.getStats();
        console.log('[CacheManager] Stats:', {
          keys: stats.keys,
          hits: stats.hits,
          misses: stats.misses,
          hitRate: stats.hits / (stats.hits + stats.misses) || 0,
        });
      }, 60000); // Every minute
    }
  }

  /**
   * Get value from cache
   * 
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = this.cache.get<T>(key);
      
      if (value !== undefined) {
        console.log(`[CacheManager] Cache HIT: ${key}`);
        return value;
      }
      
      console.log(`[CacheManager] Cache MISS: ${key}`);
      return null;
    } catch (error) {
      console.warn('[CacheManager] Cache get failed, falling back to database', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL
   * 
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Optional TTL in seconds (uses default if not provided)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const success = this.cache.set(key, value, ttl || this.defaultTTL);
      
      if (success) {
        console.log(`[CacheManager] Cache SET: ${key} (TTL: ${ttl || this.defaultTTL}s)`);
      } else {
        console.warn(`[CacheManager] Cache SET failed: ${key}`);
      }
    } catch (error) {
      console.warn('[CacheManager] Cache set failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - cache failures should not break the application
    }
  }

  /**
   * Delete a specific key from cache
   * 
   * @param key - Cache key to delete
   */
  async delete(key: string): Promise<void> {
    try {
      const deleted = this.cache.del(key);
      console.log(`[CacheManager] Cache DELETE: ${key} (deleted: ${deleted})`);
    } catch (error) {
      console.warn('[CacheManager] Cache delete failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Invalidate all cache keys matching a pattern
   * 
   * @param pattern - String pattern to match (uses includes())
   */
  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = this.cache.keys();
      const matchingKeys = keys.filter((k) => k.includes(pattern));
      
      if (matchingKeys.length > 0) {
        this.cache.del(matchingKeys);
        console.log(`[CacheManager] Cache INVALIDATE: ${pattern} (${matchingKeys.length} keys)`);
      }
    } catch (error) {
      console.warn('[CacheManager] Cache invalidate failed', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    try {
      this.cache.flushAll();
      console.log('[CacheManager] Cache CLEARED');
    } catch (error) {
      console.warn('[CacheManager] Cache clear failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get current TTL setting
   * 
   * @returns Default TTL in seconds
   */
  getTTL(): number {
    return this.defaultTTL;
  }

  /**
   * Get cache statistics
   * 
   * @returns Cache statistics object
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Check if a key exists in cache
   * 
   * @param key - Cache key to check
   * @returns true if key exists and is not expired
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get remaining TTL for a key
   * 
   * @param key - Cache key
   * @returns Remaining TTL in seconds, or undefined if key doesn't exist
   */
  getTTLForKey(key: string): number | undefined {
    return this.cache.getTtl(key);
  }
}

/**
 * Build a cache key from filters and pagination
 * 
 * @param prefix - Key prefix (e.g., 'brand-metrics', 'client-metrics')
 * @param filters - Recovery filters object
 * @param pagination - Pagination object (optional)
 * @returns Cache key string
 */
export function buildCacheKey(
  prefix: string,
  filters: any,
  pagination?: any
): string {
  const parts = [prefix];

  // Add filter values to key
  if (filters.dateFrom) parts.push(`from:${filters.dateFrom.toISOString()}`);
  if (filters.dateTo) parts.push(`to:${filters.dateTo.toISOString()}`);
  if (filters.brandIds?.length) parts.push(`brands:${filters.brandIds.sort().join(',')}`);
  if (filters.clientIds?.length) parts.push(`clients:${filters.clientIds.sort().join(',')}`);
  if (filters.recoveryStatus) parts.push(`status:${filters.recoveryStatus}`);
  if (filters.minDaysInWarehouse !== undefined) parts.push(`minDays:${filters.minDaysInWarehouse}`);
  if (filters.minAmount !== undefined) parts.push(`minAmount:${filters.minAmount}`);

  // Add pagination to key
  if (pagination) {
    parts.push(`page:${pagination.page}`);
    parts.push(`size:${pagination.pageSize}`);
  }

  return parts.join('|');
}
