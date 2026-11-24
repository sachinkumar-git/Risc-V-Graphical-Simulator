import { useEffect, useRef, useState } from "react"

import { assemble } from "assembler/assembler"
import { PipelineSimulator } from "simulator/pipelineSimulator"
import type { PipelineCycleStages, PipelineStageValue } from "simulator/pipelineSimulator"
import { Bits, Radix, bits } from "utils/bits"
import { useInterval } from "./reactUtils"
import css from "./InspectorPanel.m.css"

interface CycleSnapshot {
    cycle: number
    stages: PipelineCycleStages
    events: string[]
}

type Props = {
    programCode: string
    setupRegisters: bigint[]
    setupMemory: string
    memoryRadix: Radix
    memoryWordSize: number
}

const INSTRUCTION_LIMIT = 20_000
const VISIBLE_CYCLES = 20
const STAGES: (keyof PipelineCycleStages)[] = ["if", "id", "ex", "mem", "wb"]

function instructionLabel(instruction: PipelineStageValue | null): string {
    if (!instruction) return "—"
    const pc = bits(instruction.pc, 32).toString("hex")
    const word = bits(instruction.instruction, 32).toString("hex")
    return `${pc} · ${word}`
}

export default function PipelinePanel({
    programCode, setupRegisters, setupMemory, memoryRadix, memoryWordSize,
}: Props) {
    const simulator = useRef<PipelineSimulator>()
    const [revision, setRevision] = useState(0)
    const [history, setHistory] = useState<CycleSnapshot[]>([])
    const [playing, setPlaying] = useState(false)
    const [error, setError] = useState("")
    const [limited, setLimited] = useState(false)

    useEffect(() => {
        simulator.current = undefined
        setHistory([])
        setPlaying(false)
        setError("")
        setLimited(false)
        setRevision(value => value + 1)
    }, [programCode, setupRegisters, setupMemory, memoryRadix, memoryWordSize])

    const initialize = (): PipelineSimulator | undefined => {
        try {
            const program = assemble(programCode)
            if (program.length == 0) {
                setError("Enter a program before starting the pipeline.")
                return undefined
            }
            const memory = setupMemory.split("\n").filter(line => line.trim())
                .map(line => Bits.parse(line, memoryRadix, memoryWordSize).toInt())
            const regs = Object.fromEntries(setupRegisters.map((value, index) => [index, value]))
            const next = new PipelineSimulator(program, regs)
            next.setMemory(memory, memoryWordSize / 8)
            simulator.current = next
            setHistory([])
            setError("")
            setLimited(false)
            setRevision(value => value + 1)
            return next
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : String(reason)
            setError(`Could not start pipeline: ${message}`)
            return undefined
        }
    }

    const saveCycle = (sim: PipelineSimulator) => {
        setHistory(rows => [...rows, {
            cycle: sim.metrics.cycles,
            stages: { ...sim.cycleStages },
            events: [...sim.cycleEvents],
        }].slice(-VISIBLE_CYCLES))
        setRevision(value => value + 1)
    }

    const stepCycle = (): boolean => {
        const sim = simulator.current
        if (!sim || sim.isDone()) {
            setPlaying(false)
            return false
        }
        sim.tick()
        saveCycle(sim)
        if (sim.isDone()) setPlaying(false)
        return true
    }

    const runToEnd = () => {
        const sim = simulator.current ?? initialize()
        if (!sim) return
        setPlaying(false)
        const rows: CycleSnapshot[] = []
        while (!sim.isDone() && sim.metrics.instructions < INSTRUCTION_LIMIT) {
            sim.tick()
            rows.push({
                cycle: sim.metrics.cycles,
                stages: { ...sim.cycleStages },
                events: [...sim.cycleEvents],
            })
            if (rows.length > VISIBLE_CYCLES) rows.shift()
        }
        setHistory(previous => [...previous, ...rows].slice(-VISIBLE_CYCLES))
        setLimited(!sim.isDone())
        setRevision(value => value + 1)
    }

    useInterval(() => {
        const sim = simulator.current
        if (sim && sim.metrics.instructions >= INSTRUCTION_LIMIT) {
            setPlaying(false)
            setLimited(true)
        } else {
            stepCycle()
        }
    }, playing ? 500 : null)

    const sim = simulator.current
    void revision
    const started = !!sim
    const done = !!sim?.isDone()

    return (
        <section className={css.section} aria-label="Five-stage pipeline">
            <p className={css.note}>
                Step through an in-order IF–ID–EX–MEM–WB pipeline. ALU results are forwarded, load-use
                dependencies insert a bubble, and taken branches resolve in EX and flush younger work.
            </p>

            <div className={css.pipelineActions}>
                <button type="button" onClick={initialize}>Start / reset</button>
                <button type="button" disabled={!started || done} onClick={stepCycle}>Step cycle</button>
                <button type="button" disabled={!started || done} onClick={() => setPlaying(value => !value)}>
                    {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={runToEnd}>Run to end</button>
            </div>

            {error && <p className={css.pipelineError} role="alert">{error}</p>}
            {limited && (
                <p className={css.note}>
                    Stopped at the {INSTRUCTION_LIMIT.toLocaleString()}-instruction limit; the pipeline may not have drained.
                </p>
            )}

            {sim ? (
                <>
                    <div className={css.performanceMetrics}>
                        <div><span>Retired</span><strong>{sim.metrics.instructions.toLocaleString()}</strong></div>
                        <div><span>Cycles</span><strong>{sim.metrics.cycles.toLocaleString()}</strong></div>
                        <div><span>Estimated CPI</span><strong>
                            {sim.metrics.instructions ? (sim.metrics.cycles / sim.metrics.instructions).toFixed(2) : "—"}
                        </strong></div>
                        <div><span>Load-use stalls</span><strong>{sim.metrics.loadUseStalls.toLocaleString()}</strong></div>
                        <div><span>Forwarded operands</span><strong>{sim.metrics.dataForwardings.toLocaleString()}</strong></div>
                        <div><span>Taken / not taken</span><strong>
                            {sim.metrics.branchesTaken} / {sim.metrics.branchesNotTaken}
                        </strong></div>
                        <div><span>Flushed instructions</span><strong>{sim.metrics.flushedInstructions.toLocaleString()}</strong></div>
                    </div>

                    <div className={css.pipelineTimeline}>
                        <table aria-label="Pipeline cycle timeline">
                            <thead>
                                <tr>
                                    <th>Cycle</th>
                                    {STAGES.map(stage => <th key={stage}>{stage.toUpperCase()}</th>)}
                                    <th>Events</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(row => (
                                    <tr key={row.cycle}>
                                        <td>{row.cycle}</td>
                                        {STAGES.map(stage => (
                                            <td key={stage} title={instructionLabel(row.stages[stage])}>
                                                {instructionLabel(row.stages[stage])}
                                            </td>
                                        ))}
                                        <td>{row.events.join(", ") || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className={css.note}>
                        Timeline shows the latest {VISIBLE_CYCLES} cycles. Clock/CPI values are simulated, not measured hardware performance.
                    </p>
                </>
            ) : (
                <p className={css.idleText}>Start the pipeline to inspect stage activity, stalls, and forwarding.</p>
            )}
        </section>
    )
}
