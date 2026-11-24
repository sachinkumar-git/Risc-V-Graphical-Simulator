import { useRef, useState } from "react"
import toast from "react-hot-toast"

import { examples, Example, SimSetup } from "./examples"
import { Radix, Bits } from "utils/bits"
import { Simulator } from "simulator/simulator"
import { analyzeMulticycle } from "simulator/multicycleSimulator"
import { analyzePipeline } from "simulator/pipelineSimulator"
import type { ExecutionAnalysis, ImplementationComparison } from "simulator/multicycleSimulator"
import { assembleKeepLineInfo } from "assembler/assembler"
import EditorPanels, { EditorTab } from "./EditorPanels"
import FrontPanel from "./FrontPanel"
import InspectorPanel from "./InspectorPanel"
import TopBar from "./TopBar"
import ExecutionBar from "./ExecutionBar"
import ProcessorScene from "./three/ProcessorScene"
import { useInterval } from "./reactUtils"
import css from "./SimulatorUI.m.css"

export type SimState = "unstarted" | "playing" | "paused" | "done"

/** A parser or simulation error, with the source line when it can be determined. */
type SimError = { message: string, line?: number }

/**
 * Programs that execute more instructions than this are treated as non-terminating: the run pauses
 * there instead of looping forever.
 */
export const RUN_LIMIT = 20_000

/**
 * Counts how many instructions a program executes before it finishes, by running it on a throwaway
 * simulator. Returns null if it doesn't finish within RUN_LIMIT. This is what lets the execution bar
 * show real progress: the PC alone jumps back on every loop iteration.
 */
function analyzeSingleCycle(
    code: bigint[],
    regs: Record<number, bigint>,
    mem: bigint[],
    wordSize: number,
): ExecutionAnalysis {
    const sim = new Simulator(code, regs)
    sim.dataMem.data.storeArray(0n, wordSize / 8, mem)
    while (!sim.isDone() && sim.metrics.instructions < RUN_LIMIT) sim.tick()
    if (!sim.isDone() && sim.metrics.instructions >= RUN_LIMIT && sim.isNextPCOutsideCode()) sim.tick()
    return {
        metrics: { ...sim.metrics },
        completed: sim.isDone(),
        memoryAccesses: [...sim.dataMem.accessLog],
    }
}

function errorLine(e: any): number | undefined {
    if (typeof e?.line == "number") return e.line
    const match = /line (\d+)/.exec(e?.message ?? "")
    return match ? +match[1] : undefined
}

/**
 * Hack to use Simulator as state. Simulator is mutable, so we internally use a ref and manually update a wrapper proxy
 * object so the object identity changes trigger rerender. This is hacky and not good react style, but deepCopying the
 * simulator every time would be expensive.
 *
 * Do all updates to sim via updateSim, and be careful about mixing mutations and reads since if you create a new sim
 * the sim wrapper won't update until the next render like normal state. You should treat the `sim` result like normal
 * immutable state that doesn't update until next render, even if that isn't always true in this case.
 */
function useSim(): [Simulator, <T = void>(val: Simulator | ((sim: Simulator) => T)) => T] {
    const simRef = useRef<Simulator>()
    if (!simRef.current) {
        simRef.current = new Simulator()
        simRef.current.tick() // initialize the components so the datapath has valid state
    }

    const [simWrapper, setSimWrapper] = useState(new Proxy(simRef.current!, {})) // Dummy proxy to change identity

    const updateSim = <T = void>(val: Simulator | ((sim: Simulator) => T)): T => {
        let rtrn: any = undefined
        if (val instanceof Simulator) {
            simRef.current = val
        } else {
            rtrn = val(simRef.current!)
        }
        setSimWrapper(new Proxy(simRef.current!, {}))
        return rtrn
    }

    return [simWrapper, updateSim]
}

const defaultRegisters = new Simulator().regFile.registers

export default function SimulatorUI() {
    const [sim, updateSim] = useSim()

    const [state, setState] = useState<SimState>("unstarted")
    const [speed, setSpeed] = useState(250) // ms per instruction (4 instructions/s)
    const [cycles, setCycles] = useState(0)
    /** Instructions the loaded program executes in total; null if it doesn't finish within RUN_LIMIT. */
    const [totalCycles, setTotalCycles] = useState<number | null>(null)
    const [comparison, setComparison] = useState<ImplementationComparison>()
    // the cycle count as of the latest step, readable within the same event (state lags a render)
    const executedRef = useRef(0)

    const [code, setCode] = useState("")
    const [assembled, setAssembled] = useState<[number, bigint][]>([])
    const [registers, setRegisters] = useState<bigint[]>(defaultRegisters)
    const [registerRadix, setRegisterRadix] = useState<Radix>("hex")
    const [memory, setMemory] = useState<string>("")
    const [memoryRadix, setMemoryRadix] = useState<Radix>("hex")
    const [memoryWordSize, setMemoryWordSize] = useState(32)

    const [tab, setTab] = useState<EditorTab>("code")
    const [selectedNode, setSelectedNode] = useState<string>()
    const [propagationStage, setPropagationStage] = useState<number | null>(null)
    const [collapsed, setCollapsed] = useState(false)
    const [simError, setSimError] = useState<SimError>()

    const showError = (message: string, line?: number) => {
        console.error(message)
        setSimError({ message, line })
        toast.error(message, { id: "error" })
    }

    const reset = () => {
        setState("unstarted")
        setAssembled([])
        setCycles(0)
        setTotalCycles(null)
        setComparison(undefined)
        executedRef.current = 0
        setSimError(undefined)
    }

    /**
     * Load code/memory/registers and start the simulation.
     * Returns true if started successfully, false otherwise.
     */
    const start = () => {
        setSimError(undefined)

        let newAssembled: [number, bigint][]
        try {
            newAssembled = assembleKeepLineInfo(code)
            setAssembled(newAssembled)
        } catch (e: any) {
            showError(`Couldn't parse code:\n${e.message}`, errorLine(e))
            return false
        }

        if (newAssembled.length === 0) {
            showError("Please enter some code to run.")
            return false
        }

        let mem: bigint[]
        try {
            mem = memory.split("\n").filter(s => s).map(s => Bits.parse(s, memoryRadix, memoryWordSize).toInt())
        } catch (e: any) {
            showError(`Couldn't parse data memory:\n${e.message}`)
            return false
        }

        // We've got all the data so we can start the simulator
        const program = newAssembled.map(([, instr]) => instr)
        const newSim = new Simulator(program, registers)
        newSim.dataMem.data.storeArray(0n, memoryWordSize / 8, mem)
        updateSim(newSim)
        setCycles(0)
        executedRef.current = 0

        const initialRegisters = Object.fromEntries(registers.map((value, index) => [index, value]))
        const singleCycle = analyzeSingleCycle(program, initialRegisters, mem, memoryWordSize)
        const multiCycle = analyzeMulticycle(program, initialRegisters, mem, memoryWordSize / 8, RUN_LIMIT)
        const pipeline = analyzePipeline(program, initialRegisters, mem, memoryWordSize / 8, RUN_LIMIT)
        setComparison({ singleCycle, multiCycle, pipeline })
        setTotalCycles(singleCycle.completed ? singleCycle.metrics.instructions : null)
        if (!singleCycle.completed || !multiCycle.completed || !pipeline.completed) {
            toast(`This program doesn't finish within ${RUN_LIMIT.toLocaleString()} instructions, ` +
                  "so it may loop forever. It will pause automatically at that point.", { id: "runaway", duration: 6000 })
        }

        return true
    }

    /** Steps the simulation. */
    const step = (mode: "play" | "step", count = 1) => {
        let nextState = state
        if (nextState == "unstarted") { // try to start if we are unstarted
            if (!start()) return
            nextState = (mode == "play" ? "playing" : "paused")
        }

        if (["paused", "playing"].includes(nextState)) {
            try {
                // Step the simulation `count` times. We step multiple at once when playing at full speed to avoid
                // rendering each tick.
                const result = updateSim(sim => {
                    let executed = 0
                    while (executed < count && !sim.isDone()) {
                        if (sim.tick()) executed++
                        if (sim.isBreak()) break
                    }
                    if (!sim.isDone() && !sim.isBreak() && executed >= count && sim.isNextPCOutsideCode()) sim.tick()

                    if (sim.isDone()) {
                        return { state: "done" as SimState, executed }
                    } else if (sim.isBreak()) {
                        return { state: "paused" as SimState, executed }
                    } else {
                        return { state: (mode == "play" ? "playing" : "paused") as SimState, executed }
                    }
                })
                if (result.executed > 0) setCycles(c => c + result.executed)
                executedRef.current += result.executed
                nextState = result.state

                // guard against programs that never finish
                const before = executedRef.current - result.executed
                if (nextState != "done" && before < RUN_LIMIT && executedRef.current >= RUN_LIMIT) {
                    nextState = "paused"
                    toast(`Paused after ${RUN_LIMIT.toLocaleString()} instructions: the program doesn't seem to ` +
                          "reach its end. Check your loop conditions.", { id: "runaway", duration: 8000 })
                }
                if (nextState == "paused" && mode == "play") clearPlayInterval()
            } catch (e: any) { // this shouldn't happen.
                nextState = "done"
                showError(`Error in simulation:\n${e.message}`)
            }
        }

        setState(nextState)
    }

    const loadSimSetup = (setup: SimSetup) => {
        reset()
        setCode(setup.code ?? "")
        setRegisters(defaultRegisters.map((reg, i) => BigInt(setup.registers?.[i] ?? reg)))
        setRegisterRadix(setup.registerRadix ?? "hex")
        setMemory(setup.memory ?? "")
        setMemoryRadix(setup.memoryRadix ?? "hex")
        setMemoryWordSize(setup.memoryWordSize ?? 32)
        setTab("code")
    }

    const importSimSetup = () => {
        const input = document.createElement("input")
        input.setAttribute("type", "file")
        input.setAttribute("accept", "application/json,.json")
        input.addEventListener("change", async (event: any) => {
            let setup: SimSetup
            try {
                setup = JSON.parse(await event.target.files[0].text())
            } catch {
                showError("Invalid import file")
                return
            }
            loadSimSetup(setup)
            toast.success("Imported simulation setup", { duration: 2000 })
        }, false)
        input.click()
        input.remove()
    }

    const exportSimSetup = () => {
        const setup: SimSetup = {
            code: code,
            memory: memory,
            registers: Object.fromEntries(registers.map((v, i) => [i, `${v}`])),
            memoryRadix: memoryRadix,
            memoryWordSize: memoryWordSize,
            registerRadix: registerRadix,
        }

        const link = document.createElement("a")
        link.download = `risc-v-simulation-setup-${new Date().toISOString().replace(/[-:.]/g, "")}.json`
        link.href = `data:application/json;base64,${btoa(JSON.stringify(setup, undefined, 4))}`
        link.click()
        link.remove()
    }

    const loadExample = async (example: Example) => {
        try {
            const setup = await fetch(example.url).then(res => res.json() as Promise<SimSetup>)
            loadSimSetup(setup)
            toast.success(`Loaded ${example.name}`, { duration: 1800 })
        } catch {
            showError(`Couldn't load ${example.name}`)
        }
    }

    const clearPlayInterval = useInterval(() => {
        step("play", speed == 0 ? 1000 : 1)
    }, (state == "playing") ? speed : null)

    const instructionIndex = Number(sim.pc.data - Simulator.textStart) / 4
    const currentLine = state != "unstarted"
        ? assembled[instructionIndex]?.[0]
        : undefined
    const live = state != "unstarted"

    return (
        <div className={css.app}>
            <TopBar
                state={state}
                examples={examples}
                onLoadExample={loadExample}
                onImport={importSimSetup}
                onExport={exportSimSetup}
            />

            <main className={css.main} data-collapsed={collapsed ? "true" : undefined}>
                <div className={css.editorSlot}>
                    <EditorPanels
                        code={code}
                        onCodeChange={value => { setCode(value); setSimError(undefined) }}
                        memory={memory}
                        onMemoryChange={value => { setMemory(value); setSimError(undefined) }}
                        registerRadix={registerRadix}
                        onRegisterRadixChange={setRegisterRadix}
                        memoryRadix={memoryRadix}
                        onMemoryRadixChange={setMemoryRadix}
                        memoryWordSize={memoryWordSize}
                        onMemoryWordSizeChange={setMemoryWordSize}
                        registers={registers}
                        onRegistersChange={setRegisters}
                        tab={tab}
                        onTabChange={setTab}
                        editable={!live}
                        currentLine={currentLine}
                        errorLine={simError?.line}
                        errorMessage={simError?.message}
                        collapsed={collapsed}
                        onToggleCollapse={() => setCollapsed(c => !c)}
                    />
                </div>

                <div className={css.sceneSlot}>
                    <ProcessorScene
                        sim={sim}
                        state={state}
                        speed={speed}
                        selectedNode={selectedNode}
                        onSelectNode={setSelectedNode}
                        onStageChange={setPropagationStage}
                    />
                </div>

                <div className={css.inspectorSlot}>
                    <InspectorPanel
                        sim={sim}
                        state={state}
                        cycles={cycles}
                        activeStage={propagationStage}
                        selectedNode={selectedNode}
                        setupRegisters={registers}
                        setupMemory={memory}
                        registerRadix={registerRadix}
                        onRegisterRadixChange={setRegisterRadix}
                        memoryRadix={memoryRadix}
                        onMemoryRadixChange={setMemoryRadix}
                        memoryWordSize={memoryWordSize}
                        onMemoryWordSizeChange={setMemoryWordSize}
                        programCode={code}
                        comparison={comparison}
                    />
                </div>
            </main>

            <FrontPanel sim={sim} state={state} />

            <ExecutionBar
                state={state}
                speed={speed}
                cycles={cycles}
                pc={sim.pc.data}
                totalCycles={totalCycles}
                onPlay={() => step("play")}
                onPause={() => { if (state == "playing") setState("paused") }}
                onStep={() => step("step")}
                onRunToEnd={() => step("step", RUN_LIMIT)}
                onReset={reset}
                onClear={() => loadSimSetup({})}
                onSpeedChange={setSpeed}
            />
        </div>
    )
}
