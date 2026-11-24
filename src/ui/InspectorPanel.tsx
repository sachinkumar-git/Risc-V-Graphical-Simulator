import { useEffect, useMemo, useRef, useState } from "react"

import { Simulator } from "simulator/simulator"
import type { ImplementationComparison } from "simulator/multicycleSimulator"
import { registerNames } from "simulator/constants"
import { Bits, Radix, bits } from "utils/bits"
import type { SimState } from "./SimulatorUI"
import PerformancePanel, { performanceRunLabel } from "./PerformancePanel"
import type { SavedPerformanceRun } from "./PerformancePanel"
import PipelinePanel from "./PipelinePanel"
import CachePanel from "./CachePanel"
import { controlSignals, decodeInstruction, explainInstruction, nodeRole } from "./instructionInfo"
import { getProcessorNode, NodeKind, ProcessorNode } from "./three/processorModel"
import css from "./InspectorPanel.m.css"

type InspectorTab = "registers" | "memory" | "instruction" | "control" | "performance" | "pipeline" | "cache" | "component"

type Props = {
    sim: Simulator
    state: SimState
    cycles: number
    /** Propagation stage currently animated in the 3D view (null once settled). */
    activeStage?: number | null
    selectedNode?: string
    setupRegisters: bigint[]
    setupMemory: string
    registerRadix: Radix
    onRegisterRadixChange?: (radix: Radix) => void
    memoryRadix: Radix
    onMemoryRadixChange?: (radix: Radix) => void
    memoryWordSize: number
    onMemoryWordSizeChange?: (wordSize: number) => void
    programCode: string
    comparison?: ImplementationComparison
}

const TABS: { id: InspectorTab, label: string }[] = [
    { id: "registers", label: "Registers" },
    { id: "memory", label: "Memory" },
    { id: "instruction", label: "Instruction" },
    { id: "control", label: "Control" },
    { id: "performance", label: "Performance" },
    { id: "pipeline", label: "Pipeline" },
    { id: "cache", label: "Cache" },
    { id: "component", label: "Component" },
]

export default function InspectorPanel({
    sim, state, cycles, activeStage = null, selectedNode, setupRegisters, setupMemory,
    registerRadix, onRegisterRadixChange, memoryRadix, onMemoryRadixChange,
    memoryWordSize, onMemoryWordSizeChange, programCode, comparison,
}: Props) {
    const [tab, setTab] = useState<InspectorTab>("registers")
    const [savedRuns, setSavedRuns] = useState<SavedPerformanceRun[]>([])
    const live = state != "unstarted"
    const selected = selectedNode ? getProcessorNode(selectedNode) : undefined

    useEffect(() => {
        if (selectedNode) setTab("component")
    }, [selectedNode])

    const decoded = useMemo(
        () => live ? decodeInstruction(sim.instrMem.instruction, sim.immGen.immediate) : undefined,
        [sim, live],
    )
    const explanation = useMemo(() => live ? explainInstruction(sim) : undefined, [sim, live])

    // keep the step being animated in view, without scrolling the page itself
    const stepsRef = useRef<HTMLOListElement>(null)
    useEffect(() => {
        const list = stepsRef.current
        const current = list?.querySelector<HTMLElement>("[data-progress='current']")
        const scroller = list?.parentElement
        if (!current || !scroller) return
        const box = scroller.getBoundingClientRect()
        const item = current.getBoundingClientRect()
        if (item.top < box.top || item.bottom > box.bottom) {
            scroller.scrollTo({ top: scroller.scrollTop + item.top - box.top - 8, behavior: "smooth" })
        }
    }, [activeStage, explanation])

    const readRegs = live && decoded ? [decoded.rs1, decoded.rs2] : []
    const writeReg = live && decoded && sim.control.regWrite ? decoded.rd : undefined

    const savePerformanceRun = () => {
        if (!comparison) return
        setSavedRuns(runs => [...runs, {
            id: runs.length,
            label: performanceRunLabel(programCode, runs.length),
            comparison,
        }])
    }

    const memoryRows = useMemo(() => {
        const bytes = memoryWordSize / 8
        if (live) {
            return [...sim.dataMem.data.dump(bytes)].map(([addr, value]) =>
                typeof addr == "bigint" ? { addr, value } : { addr: null, value }
            )
        }
        const values = setupMemory.split("\n").map(s => s.trim()).filter(s => s)
        return values.map((text, i) => {
            try {
                return { addr: BigInt(i * bytes), value: Bits.parse(text, memoryRadix, memoryWordSize).toInt() }
            } catch {
                return { addr: null, value: 0n }
            }
        })
    }, [sim, live, setupMemory, memoryRadix, memoryWordSize])

    const memoryAddress = live && (sim.control.memRead || sim.control.memWrite)
        ? (sim.dataMem.address.toInt() / BigInt(memoryWordSize / 8)) * BigInt(memoryWordSize / 8)
        : undefined

    return (
        <aside className={css.inspector}>
            <header className={css.header}>
                <span className={css.headerTitle}>Inspector</span>
                <span className={css.cycleBadge}>{live ? `Cycle ${cycles}` : "Not running"}</span>
            </header>

            <section className={css.explanation}>
                <div className={css.explanationHead}>
                    <span>Current instruction</span>
                    {live && decoded && <code>{explanation?.headline || decoded.mnemonic || "unknown"}</code>}
                </div>
                {live && explanation ? (
                    <ol className={css.steps} ref={stepsRef}>
                        {explanation.steps.map(step => (
                            <li
                                key={step.title}
                                data-progress={
                                    activeStage === null ? undefined
                                        : step.stage == activeStage ? "current"
                                        : step.stage > activeStage ? "pending" : undefined
                                }
                            >
                                <span className={css.stepTitle}>{step.title}</span>
                                <p>{step.text}</p>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className={css.idleText}>
                        Run the program to see a step-by-step explanation of each instruction, built from
                        the datapath&rsquo;s actual control signals and values.
                    </p>
                )}
            </section>

            <nav className={css.tabs}>
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={tab == t.id ? css.tabActive : undefined}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            <div className={css.content}>
                {tab == "registers" && (
                    <section className={css.section}>
                        <div className={css.toolbar}>
                            <span className={css.toolbarLabel}>Representation</span>
                            <select value={registerRadix} onChange={e => onRegisterRadixChange?.(e.target.value as Radix)}>
                                <option value="hex">Hex</option>
                                <option value="signed">Signed decimal</option>
                                <option value="unsigned">Unsigned decimal</option>
                            </select>
                        </div>
                        <table className={css.dataTable}>
                            <tbody>
                                {(live ? sim.regFile.registers : setupRegisters).map((value, i) => {
                                    const read = readRegs.includes(i)
                                    const written = writeReg == i
                                    return (
                                        <tr
                                            key={i}
                                            className={written ? css.rowWritten : read ? css.rowRead : undefined}
                                        >
                                            <td className={css.mono}>{`${registerNames[i]} (x${i})`}</td>
                                            <td className={css.monoValue}>{bits(value, 32).toString(registerRadix)}</td>
                                            <td className={css.rowFlag}>{written ? "write" : read ? "read" : ""}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </section>
                )}

                {tab == "memory" && (
                    <section className={css.section}>
                        <div className={css.toolbar}>
                            <select value={memoryRadix} onChange={e => onMemoryRadixChange?.(e.target.value as Radix)}>
                                <option value="hex">Hex</option>
                                <option value="signed">Signed decimal</option>
                                <option value="unsigned">Unsigned decimal</option>
                            </select>
                            <select value={memoryWordSize} onChange={e => onMemoryWordSizeChange?.(+e.target.value)}>
                                <option value="8">Byte</option>
                                <option value="16">Half-word</option>
                                <option value="32">Word</option>
                            </select>
                        </div>
                        {memoryRows.length == 0 ? (
                            <p className={css.idleText}>No data memory values. Load an example or enter values in the Memory editor.</p>
                        ) : (
                            <table className={css.dataTable}>
                                <tbody>
                                    {memoryRows.map((row, i) => row.addr === null ? (
                                        <tr key={`gap-${i}`}><td colSpan={2} className={css.gap}>⋯</td></tr>
                                    ) : (
                                        <tr key={`${row.addr}`} className={row.addr === memoryAddress ? css.rowWritten : undefined}>
                                            <td className={css.mono}>{bits(row.addr, 32).toString("hex")}</td>
                                            <td className={css.monoValue}>{bits(row.value, memoryWordSize).toString(memoryRadix)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        {memoryAddress !== undefined && (
                            <p className={css.note}>Active address: {bits(memoryAddress, 32).toString("hex")}</p>
                        )}
                    </section>
                )}

                {tab == "instruction" && (
                    <section className={css.section}>
                        {live && decoded ? (
                            <>
                                <div className={css.machineCode}>
                                    <span>{sim.instrMem.instruction.toString("bin")}</span>
                                    <strong>{sim.instrMem.instruction.toString("hex")}</strong>
                                </div>
                                <dl className={css.fields}>
                                    <div><dt>PC</dt><dd>{sim.pc.out.toString("hex")}</dd></div>
                                    <div><dt>Assembly</dt><dd>{decoded.assembly || "unknown"}</dd></div>
                                    <div><dt>Format</dt><dd>{decoded.format}</dd></div>
                                    <div><dt>Mnemonic</dt><dd>{decoded.mnemonic || "unknown"}</dd></div>
                                    <div><dt>rd</dt><dd>{decoded.rd} · {registerNames[decoded.rd]}</dd></div>
                                    <div><dt>rs1</dt><dd>{decoded.rs1} · {registerNames[decoded.rs1]}</dd></div>
                                    <div><dt>rs2</dt><dd>{decoded.rs2} · {registerNames[decoded.rs2]}</dd></div>
                                    <div><dt>funct3</dt><dd>{decoded.funct3.toString("bin")}</dd></div>
                                    <div><dt>funct7</dt><dd>{decoded.funct7.toString("bin")}</dd></div>
                                    <div><dt>opcode</dt><dd>{decoded.opcode.toString("bin")}</dd></div>
                                    <div><dt>Immediate</dt><dd>{decoded.immediate.toString("signed")} ({decoded.immediate.toString("hex")})</dd></div>
                                    <div><dt>Cycle</dt><dd>{cycles}</dd></div>
                                </dl>
                            </>
                        ) : (
                            <p className={css.idleText}>Start the simulation to decode the instruction at the program counter.</p>
                        )}
                    </section>
                )}

                {tab == "control" && (
                    <section className={css.section}>
                        {live ? (
                            <>
                                <p className={css.note}>
                                    Live outputs of the control unit and ALU control for the instruction in the datapath.
                                </p>
                                <div className={css.signalList}>
                                    {controlSignals(sim).map(signal => (
                                        <div key={signal.name} className={signal.active ? css.signalActive : css.signal}>
                                            <span className={css.signalDot} />
                                            <span className={css.signalName}>{signal.name}</span>
                                            <span className={css.signalValue}>{signal.value}</span>
                                            <span className={css.signalMeaning}>{signal.meaning}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className={css.idleText}>Control signals appear here while the simulator is running.</p>
                        )}
                    </section>
                )}

                {tab == "performance" && (
                    <PerformancePanel
                        metrics={sim.metrics}
                        state={state}
                        programCode={programCode}
                        comparison={comparison}
                        savedRuns={savedRuns}
                        onSaveRun={savePerformanceRun}
                        onClearRuns={() => setSavedRuns([])}
                    />
                )}

                {tab == "pipeline" && (
                    <PipelinePanel
                        programCode={programCode}
                        setupRegisters={setupRegisters}
                        setupMemory={setupMemory}
                        memoryRadix={memoryRadix}
                        memoryWordSize={memoryWordSize}
                    />
                )}

                {tab == "cache" && (
                    <CachePanel
                        accesses={comparison?.singleCycle.memoryAccesses}
                        traceCompleted={comparison?.singleCycle.completed}
                    />
                )}

                {tab == "component" && (
                    <ComponentDetails node={selected} sim={sim} live={live} />
                )}
            </div>
        </aside>
    )
}

const KIND_LABEL: Record<NodeKind, string> = {
    fetch: "Fetch",
    decode: "Decode",
    control: "Control",
    execute: "Execute",
    memory: "Memory",
    writeback: "Write-back",
    mux: "Multiplexer",
    adder: "Adder",
}

function ComponentDetails({ node, sim, live }: { node?: ProcessorNode, sim: Simulator, live: boolean }) {
    if (!node) {
        return (
            <section className={css.section}>
                <p className={css.idleText}>
                    Click a component in the datapath to see what it does, its live inputs and outputs, and its
                    role in the current instruction.
                </p>
            </section>
        )
    }

    return (
        <section className={css.section}>
            <div className={css.componentHead}>
                <h3>{node.label}</h3>
                <span>{KIND_LABEL[node.kind]}</span>
            </div>

            <p className={css.description}>{node.description}</p>
            <p className={css.how}>{node.howItWorks}</p>

            {live && (
                <div className={css.role}>
                    <span>In this instruction</span>
                    <p>{nodeRole(node.id, sim)}</p>
                </div>
            )}

            {live ? (
                <div className={css.ioColumns}>
                    <div>
                        <h4>Inputs</h4>
                        {node.inputs(sim).map((field, i) => (
                            <div className={css.ioRow} key={`in-${i}`}>
                                <span>{field.label}</span>
                                <code>{field.value}</code>
                            </div>
                        ))}
                    </div>
                    <div>
                        <h4>Outputs</h4>
                        {node.outputs(sim).map((field, i) => (
                            <div className={css.ioRow} key={`out-${i}`}>
                                <span>{field.label}</span>
                                <code>{field.value}</code>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <p className={css.idleText}>Start the simulation to see this component&rsquo;s live inputs and outputs.</p>
            )}

            {!live && <p className={css.hint}>Current value: {node.value(sim)}</p>}
        </section>
    )
}
