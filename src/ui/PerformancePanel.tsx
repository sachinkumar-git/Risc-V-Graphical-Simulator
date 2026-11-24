import type { ExecutionMetrics } from "simulator/simulator"
import {
    MULTICYCLE_CLOCK_PERIOD_PS, PIPELINE_CLOCK_PERIOD_PS, SINGLE_CYCLE_CLOCK_PERIOD_PS,
} from "simulator/multicycleSimulator"
import type { ImplementationComparison } from "simulator/multicycleSimulator"
import type { SimState } from "./SimulatorUI"
import css from "./InspectorPanel.m.css"

export interface SavedPerformanceRun {
    id: number
    label: string
    comparison: ImplementationComparison
}

type Props = {
    metrics: ExecutionMetrics
    state: SimState
    programCode: string
    comparison?: ImplementationComparison
    savedRuns: SavedPerformanceRun[]
    onSaveRun: () => void
    onClearRuns: () => void
}

const EMPTY_METRICS: ExecutionMetrics = {
    instructions: 0,
    cycles: 0,
    conditionalBranches: 0,
    branchesTaken: 0,
    branchesNotTaken: 0,
}

function cpi(metrics: ExecutionMetrics): string {
    return metrics.instructions == 0 ? "—" : (metrics.cycles / metrics.instructions).toFixed(2)
}

function nanoseconds(cycles: number, periodPs: number, completed: boolean): string {
    const time = `${(cycles * periodPs / 1000).toFixed(2)} ns`
    return completed ? time : `≥ ${time}`
}

function count(value: number, completed: boolean): string {
    return completed ? value.toLocaleString() : `≥ ${value.toLocaleString()}`
}

export function performanceRunLabel(code: string, index: number): string {
    const lines = code.split(/\r?\n/).map(line => line.trim())
    const comment = lines.find(line => line.startsWith("#"))
    if (comment) return comment.replace(/^#+\s*/, "") || `Run ${index + 1}`

    const firstInstruction = lines
        .map(line => line.split("#", 1)[0].trim())
        .find(line => line.length > 0)
    return firstInstruction ? `Run ${index + 1}: ${firstInstruction}` : `Run ${index + 1}`
}

export default function PerformancePanel({
    metrics, state, programCode, comparison, savedRuns, onSaveRun, onClearRuns,
}: Props) {
    const currentMetrics = state == "unstarted" ? EMPTY_METRICS : metrics
    const hasRun = currentMetrics.instructions > 0
    const currentLabel = performanceRunLabel(programCode, savedRuns.length)
    const rows = [
        ...(comparison && state != "unstarted"
            ? [{ id: "current", label: `Current: ${currentLabel}`, comparison }]
            : []),
        ...savedRuns,
    ]
    const canSave = state == "done" && hasRun &&
        !!comparison?.singleCycle.completed && !!comparison.multiCycle.completed && !!comparison.pipeline.completed

    return (
        <section className={css.section} aria-label="Performance analysis">
            <p className={css.note}>
                Clock periods use an illustrative delay model, not measured hardware timing: fetch 180 ps,
                decode 120 ps, execute 180 ps, memory 220 ps, and write-back 80 ps. The single-cycle period
                is their sum; multi-cycle and pipeline periods use the slowest stage. Pipeline cycles include
                fill, drain, data-stall, and control-flush cycles.
            </p>

            <div className={css.performanceMetrics}>
                <div><span>Instructions</span><strong>{currentMetrics.instructions.toLocaleString()}</strong></div>
                <div><span>Clock cycles</span><strong>{currentMetrics.cycles.toLocaleString()}</strong></div>
                <div><span>Estimated CPI</span><strong>{cpi(currentMetrics)}</strong></div>
                <div><span>Single-cycle period</span><strong>{(SINGLE_CYCLE_CLOCK_PERIOD_PS / 1000).toFixed(2)} ns</strong></div>
                <div><span>Multi-cycle period</span><strong>{(MULTICYCLE_CLOCK_PERIOD_PS / 1000).toFixed(2)} ns</strong></div>
                <div><span>Pipeline period</span><strong>{(PIPELINE_CLOCK_PERIOD_PS / 1000).toFixed(2)} ns</strong></div>
                <div>
                    <span>Pipeline load stalls / flushes</span>
                    <strong>
                        {comparison
                            ? `${count(comparison.pipeline.metrics.loadUseStalls, comparison.pipeline.completed)} / ` +
                              count(comparison.pipeline.metrics.flushedInstructions, comparison.pipeline.completed)
                            : "—"}
                    </strong>
                </div>
                <div>
                    <span>Conditional branches</span>
                    <strong>{currentMetrics.conditionalBranches.toLocaleString()}</strong>
                </div>
                <div>
                    <span>Taken / not taken</span>
                    <strong>{currentMetrics.branchesTaken.toLocaleString()} / {currentMetrics.branchesNotTaken.toLocaleString()}</strong>
                </div>
            </div>

            <div className={css.performanceActions}>
                <button
                    type="button"
                    disabled={!canSave}
                    onClick={onSaveRun}
                >
                    Save completed comparison
                </button>
                <button type="button" disabled={savedRuns.length == 0} onClick={onClearRuns}>
                    Clear comparisons
                </button>
            </div>

            {rows.length > 0 ? (
                <div className={css.comparisonTable}>
                    <table aria-label="Run comparison">
                        <thead>
                            <tr>
                                <th>Program</th>
                                <th>Instructions (single / multi / pipeline)</th>
                                <th>Cycles (single / multi / pipeline)</th>
                                <th>CPI (single / multi / pipeline)</th>
                                <th>Period (single / multi / pipeline)</th>
                                <th>Est. time (single / multi / pipeline)</th>
                                <th>Pipeline stalls / flushes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(run => (
                                <tr key={run.id}>
                                    <td>{run.label}</td>
                                    <td>
                                        {count(run.comparison.singleCycle.metrics.instructions, run.comparison.singleCycle.completed)}
                                        {" / "}
                                        {count(run.comparison.multiCycle.metrics.instructions, run.comparison.multiCycle.completed)}
                                        {" / "}
                                        {count(run.comparison.pipeline.metrics.instructions, run.comparison.pipeline.completed)}
                                    </td>
                                    <td>
                                        {count(run.comparison.singleCycle.metrics.cycles, run.comparison.singleCycle.completed)}
                                        {" / "}
                                        {count(run.comparison.multiCycle.metrics.cycles, run.comparison.multiCycle.completed)}
                                        {" / "}
                                        {count(run.comparison.pipeline.metrics.cycles, run.comparison.pipeline.completed)}
                                    </td>
                                    <td>
                                        {cpi(run.comparison.singleCycle.metrics)}
                                        {" / "}
                                        {cpi(run.comparison.multiCycle.metrics)}
                                        {" / "}
                                        {cpi(run.comparison.pipeline.metrics)}
                                    </td>
                                    <td>
                                        {(SINGLE_CYCLE_CLOCK_PERIOD_PS / 1000).toFixed(2)}
                                        {" / "}
                                        {(MULTICYCLE_CLOCK_PERIOD_PS / 1000).toFixed(2)}
                                        {" / "}
                                        {(PIPELINE_CLOCK_PERIOD_PS / 1000).toFixed(2)}
                                        {" ns"}
                                    </td>
                                    <td>
                                        {nanoseconds(
                                            run.comparison.singleCycle.metrics.cycles,
                                            SINGLE_CYCLE_CLOCK_PERIOD_PS,
                                            run.comparison.singleCycle.completed,
                                        )}
                                        {" / "}
                                        {nanoseconds(
                                            run.comparison.multiCycle.metrics.cycles,
                                            MULTICYCLE_CLOCK_PERIOD_PS,
                                            run.comparison.multiCycle.completed,
                                        )}
                                        {" / "}
                                        {nanoseconds(
                                            run.comparison.pipeline.metrics.cycles,
                                            PIPELINE_CLOCK_PERIOD_PS,
                                            run.comparison.pipeline.completed,
                                        )}
                                    </td>
                                    <td>
                                        {count(run.comparison.pipeline.metrics.loadUseStalls, run.comparison.pipeline.completed)}
                                        {" / "}
                                        {count(run.comparison.pipeline.metrics.flushedInstructions, run.comparison.pipeline.completed)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className={css.idleText}>Run a program to compare the single-cycle, multi-cycle, and pipeline models.</p>
            )}
        </section>
    )
}
