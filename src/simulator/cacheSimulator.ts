import type { MemoryAccess } from "./components"

export type CacheReplacementPolicy = "lru" | "fifo"

export interface CacheConfig {
    capacityBytes: number
    blockSizeBytes: number
    associativity: number
    hitTimeCycles: number
    missPenaltyCycles: number
    replacementPolicy: CacheReplacementPolicy
}

export interface CacheMetrics {
    accesses: number
    blockLookups: number
    reads: number
    writes: number
    hits: number
    misses: number
    evictions: number
    hitRate: number
    missRate: number
    estimatedCycles: number
    averageAccessTimeCycles: number
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
    capacityBytes: 256,
    blockSizeBytes: 16,
    associativity: 2,
    hitTimeCycles: 1,
    missPenaltyCycles: 20,
    replacementPolicy: "lru",
}

interface CacheLine {
    tag: bigint
    insertedAt: number
    lastUsedAt: number
}

function isPowerOfTwo(value: number): boolean {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) == 0
}

export function validateCacheConfig(config: CacheConfig): string | undefined {
    if (!isPowerOfTwo(config.capacityBytes)) return "Cache capacity must be a positive power of two."
    if (!isPowerOfTwo(config.blockSizeBytes)) return "Block size must be a positive power of two."
    if (!isPowerOfTwo(config.associativity)) return "Associativity must be a positive power of two."
    if (!Number.isInteger(config.hitTimeCycles) || config.hitTimeCycles < 1)
        return "Hit time must be a positive whole number of cycles."
    if (!Number.isInteger(config.missPenaltyCycles) || config.missPenaltyCycles < 1)
        return "Miss penalty must be a positive whole number of cycles."
    if (config.blockSizeBytes * config.associativity > config.capacityBytes ||
        config.capacityBytes % (config.blockSizeBytes * config.associativity) != 0)
        return "Capacity must contain an integral number of sets for this block size and associativity."
    return undefined
}

/** Replays data-memory accesses through a set-associative, write-through, write-allocate cache. */
export function analyzeCache(accesses: MemoryAccess[], config: CacheConfig): CacheMetrics {
    const configError = validateCacheConfig(config)
    if (configError) throw Error(configError)

    const setCount = config.capacityBytes / (config.blockSizeBytes * config.associativity)
    const sets: CacheLine[][] = Array.from({ length: setCount }, () => [])
    let blockLookups = 0
    let reads = 0
    let writes = 0
    let hits = 0
    let misses = 0
    let evictions = 0
    let timestamp = 0

    const lookup = (blockNumber: bigint) => {
        timestamp++
        blockLookups++
        const setIndex = Number(blockNumber % BigInt(setCount))
        const tag = blockNumber / BigInt(setCount)
        const set = sets[setIndex]
        const hit = set.find(line => line.tag == tag)
        if (hit) {
            hits++
            hit.lastUsedAt = timestamp
            return
        }

        misses++
        if (set.length == config.associativity) {
            evictions++
            const replacementIndex = set.reduce((oldestIndex, line, index) => {
                const lineTime = config.replacementPolicy == "lru" ? line.lastUsedAt : line.insertedAt
                const oldest = set[oldestIndex]
                const oldestTime = config.replacementPolicy == "lru"
                    ? oldest.lastUsedAt
                    : oldest.insertedAt
                return lineTime < oldestTime ? index : oldestIndex
            }, 0)
            set.splice(replacementIndex, 1)
        }
        set.push({ tag, insertedAt: timestamp, lastUsedAt: timestamp })
    }

    for (const access of accesses) {
        if (access.address < 0n) throw Error("Cache access address must be non-negative.")
        if (!Number.isInteger(access.bytes) || access.bytes < 1)
            throw Error("Cache access size must be a positive whole number of bytes.")

        if (access.operation == "read") reads++
        else writes++

        const firstBlock = access.address / BigInt(config.blockSizeBytes)
        const lastBlock = (access.address + BigInt(access.bytes - 1)) / BigInt(config.blockSizeBytes)
        for (let block = firstBlock; block <= lastBlock; block++) lookup(block)
    }

    const hitRate = blockLookups == 0 ? 0 : hits / blockLookups
    const missRate = blockLookups == 0 ? 0 : misses / blockLookups
    const estimatedCycles = blockLookups * config.hitTimeCycles + misses * config.missPenaltyCycles
    return {
        accesses: accesses.length,
        blockLookups,
        reads,
        writes,
        hits,
        misses,
        evictions,
        hitRate,
        missRate,
        estimatedCycles,
        averageAccessTimeCycles: blockLookups == 0 ? 0 : estimatedCycles / blockLookups,
    }
}
