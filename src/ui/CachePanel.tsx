import { useMemo, useState } from "react"

import { analyzeCache, CacheConfig, validateCacheConfig } from "simulator/cacheSimulator"
import type { MemoryAccess } from "simulator/components"
import css from "./InspectorPanel.m.css"

type Props = {
    accesses?: MemoryAccess[]
    traceCompleted?: boolean
}

const CAPACITIES = [64, 128, 256, 512, 1024]
const BLOCK_SIZES = [4, 8, 16, 32, 64]
const ASSOCIATIVITIES = [1, 2, 4, 8]
const HIT_TIMES = [1, 2, 3]
const MISS_PENALTIES = [5, 10, 20, 50, 100]

function isValidGeometry(capacity: number, blockSize: number, ways: number): boolean {
    const bytesPerSet = blockSize * ways
    return capacity >= bytesPerSet && capacity % bytesPerSet == 0
}

function percentage(value: number): string {
    return `${(value * 100).toFixed(1)}%`
}

export default function CachePanel({ accesses, traceCompleted }: Props) {
    const [config, setConfig] = useState<CacheConfig>({
        capacityBytes: 256,
        blockSizeBytes: 16,
        associativity: 2,
        hitTimeCycles: 1,
        missPenaltyCycles: 20,
        replacementPolicy: "lru",
    })
    const configError = validateCacheConfig(config)
    const result = useMemo(
        () => accesses && !configError ? analyzeCache(accesses, config) : undefined,
        [accesses, config, configError],
    )

    return (
        <section className={css.section} aria-label="Data cache analysis">
            <p className={css.note}>
                Replays the program&rsquo;s loads and stores through a configurable data cache; instruction fetches
                are excluded. This model uses write-through, write-allocate behavior and estimates timing
                from the selected hit time and miss penalty; write-through traffic is assumed buffered.
            </p>

            <div className={css.cacheSettings}>
                <label>
                    Capacity
                    <select
                        aria-label="Cache capacity"
                        value={config.capacityBytes}
                        onChange={event => setConfig(current => ({ ...current, capacityBytes: +event.target.value }))}
                    >
                        {CAPACITIES.filter(capacity =>
                            isValidGeometry(capacity, config.blockSizeBytes, config.associativity)
                        ).map(capacity => <option key={capacity} value={capacity}>{capacity} B</option>)}
                    </select>
                </label>
                <label>
                    Block
                    <select
                        aria-label="Cache block size"
                        value={config.blockSizeBytes}
                        onChange={event => setConfig(current => ({ ...current, blockSizeBytes: +event.target.value }))}
                    >
                        {BLOCK_SIZES.filter(blockSize =>
                            isValidGeometry(config.capacityBytes, blockSize, config.associativity)
                        ).map(blockSize => <option key={blockSize} value={blockSize}>{blockSize} B</option>)}
                    </select>
                </label>
                <label>
                    Ways
                    <select
                        aria-label="Cache associativity"
                        value={config.associativity}
                        onChange={event => setConfig(current => ({ ...current, associativity: +event.target.value }))}
                    >
                        {ASSOCIATIVITIES.filter(ways =>
                            isValidGeometry(config.capacityBytes, config.blockSizeBytes, ways)
                        ).map(ways => <option key={ways} value={ways}>{ways == 1 ? "Direct mapped" : `${ways}-way`}</option>)}
                    </select>
                </label>
                <label>
                    Replacement
                    <select
                        aria-label="Cache replacement policy"
                        value={config.replacementPolicy}
                        onChange={event => setConfig(current => ({
                            ...current,
                            replacementPolicy: event.target.value as CacheConfig["replacementPolicy"],
                        }))}
                    >
                        <option value="lru">LRU</option>
                        <option value="fifo">FIFO</option>
                    </select>
                </label>
                <label>
                    Hit time
                    <select
                        aria-label="Cache hit time"
                        value={config.hitTimeCycles}
                        onChange={event => setConfig(current => ({ ...current, hitTimeCycles: +event.target.value }))}
                    >
                        {HIT_TIMES.map(cycles => <option key={cycles} value={cycles}>{cycles} cycles</option>)}
                    </select>
                </label>
                <label>
                    Miss penalty
                    <select
                        aria-label="Cache miss penalty"
                        value={config.missPenaltyCycles}
                        onChange={event => setConfig(current => ({ ...current, missPenaltyCycles: +event.target.value }))}
                    >
                        {MISS_PENALTIES.map(cycles =>
                            <option key={cycles} value={cycles}>{cycles} cycles</option>
                        )}
                    </select>
                </label>
            </div>

            {configError && <p className={css.pipelineError} role="alert">{configError}</p>}
            {result ? (
                <>
                    {traceCompleted === false && (
                        <p className={css.note}>
                            The source run reached its instruction limit; these cache results cover only the recorded partial trace.
                        </p>
                    )}
                    <div className={css.performanceMetrics}>
                        <div><span>Data accesses</span><strong>{result.accesses.toLocaleString()}</strong></div>
                        <div><span>Block lookups</span><strong>{result.blockLookups.toLocaleString()}</strong></div>
                        <div><span>Reads / writes</span><strong>{result.reads.toLocaleString()} / {result.writes.toLocaleString()}</strong></div>
                        <div><span>Hits / misses</span><strong>{result.hits.toLocaleString()} / {result.misses.toLocaleString()}</strong></div>
                        <div><span>Hit rate</span><strong>{percentage(result.hitRate)}</strong></div>
                        <div><span>Miss rate</span><strong>{percentage(result.missRate)}</strong></div>
                        <div><span>Evictions</span><strong>{result.evictions.toLocaleString()}</strong></div>
                        <div><span>Estimated AMAT</span><strong>{result.averageAccessTimeCycles.toFixed(2)} cycles</strong></div>
                        <div><span>Estimated access cycles</span><strong>{result.estimatedCycles.toLocaleString()}</strong></div>
                    </div>
                    <p className={css.note}>
                        AMAT = hit time + miss rate × miss penalty. Miss penalty is the additional backing-memory
                        delay; values are model assumptions, not measured hardware timings.
                    </p>
                </>
            ) : (
                <p className={css.idleText}>
                    {accesses
                        ? "Cache configuration is invalid."
                        : "Run a program first to capture its data-memory access trace."}
                </p>
            )}
        </section>
    )
}
