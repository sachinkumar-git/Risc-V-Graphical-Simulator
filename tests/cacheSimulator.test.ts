import { expect } from "chai"
import {
    analyzeCache, CacheConfig, DEFAULT_CACHE_CONFIG, validateCacheConfig,
} from "simulator/cacheSimulator"

const config = (updates: Partial<CacheConfig> = {}): CacheConfig => ({
    ...DEFAULT_CACHE_CONFIG,
    capacityBytes: 16,
    blockSizeBytes: 4,
    associativity: 1,
    ...updates,
})

describe("Data cache analysis", () => {
    it("counts cold misses and later hits", () => {
        const result = analyzeCache([
            { address: 0n, bytes: 4, operation: "read" },
            { address: 0n, bytes: 4, operation: "read" },
            { address: 4n, bytes: 4, operation: "write" },
        ], config())
        expect(result.accesses).to.equal(3)
        expect(result.reads).to.equal(2)
        expect(result.writes).to.equal(1)
        expect(result.hits).to.equal(1)
        expect(result.misses).to.equal(2)
        expect(result.hitRate).to.equal(1 / 3)
        expect(result.estimatedCycles).to.equal(43)
    })

    it("models direct-mapped conflicts and set-associative capacity", () => {
        const trace = [0n, 16n, 0n].map(address => ({ address, bytes: 4, operation: "read" as const }))
        const direct = analyzeCache(trace, config())
        const twoWay = analyzeCache(trace, config({ associativity: 2 }))
        expect(direct.misses).to.equal(3)
        expect(direct.evictions).to.equal(2)
        expect(twoWay.misses).to.equal(2)
        expect(twoWay.hits).to.equal(1)
    })

    it("supports LRU and FIFO replacement policies", () => {
        const trace = [0n, 8n, 0n, 16n, 8n].map(address =>
            ({ address, bytes: 4, operation: "read" as const })
        )
        const lru = analyzeCache(trace, config({ associativity: 2, replacementPolicy: "lru" }))
        const fifo = analyzeCache(trace, config({ associativity: 2, replacementPolicy: "fifo" }))
        expect(lru.hits).to.equal(1)
        expect(fifo.hits).to.equal(2)
    })

    it("splits an access that crosses a cache-block boundary", () => {
        const result = analyzeCache([
            { address: 3n, bytes: 2, operation: "read" },
        ], config())
        expect(result.accesses).to.equal(1)
        expect(result.blockLookups).to.equal(2)
        expect(result.misses).to.equal(2)
    })

    it("reports zero rates and time for an empty trace", () => {
        const result = analyzeCache([], config())
        expect(result.hitRate).to.equal(0)
        expect(result.missRate).to.equal(0)
        expect(result.averageAccessTimeCycles).to.equal(0)
    })

    it("rejects cache geometries that cannot form a whole number of sets", () => {
        const invalid = config({ capacityBytes: 8, blockSizeBytes: 8, associativity: 2 })
        expect(validateCacheConfig(invalid)).to.be.a("string")
        expect(() => analyzeCache([], invalid)).to.throw("Capacity must contain an integral number of sets")
    })
})
