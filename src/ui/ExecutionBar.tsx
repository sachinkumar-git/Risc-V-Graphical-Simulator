import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome"
import { faEraser, faForwardFast, faPause, faPlay, faRotateLeft, faStepForward } from "@fortawesome/free-solid-svg-icons"

import { bits } from "utils/bits"
import type { SimState } from "./SimulatorUI"
import css from "./ExecutionBar.m.css"

type Props = {
    state: SimState
    /** Milliseconds between steps. 0 means "as fast as possible". */
    speed: number
    cycles: number
    pc: bigint
    /** Instructions the program executes in total, or null if unknown / it never finishes. */
    totalCycles: number | null
    onPlay?: () => void
    onPause?: () => void
    onStep?: () => void
    onRunToEnd?: () => void
    onReset?: () => void
    onClear?: () => void
    onSpeedChange?: (speed: number) => void
}

const speedTicks = [0.25, 0.5, 1, 2, 4, 8, 16, 32, Infinity].map(d => 1000 / d)

function speedText(ms: number): string {
    const perSecond = 1000 / ms
    if (perSecond >= Infinity) return "max"
    if (perSecond < 1) return `${1 / perSecond} s/instr`
    return `${perSecond}/s`
}

export default function ExecutionBar({ state, speed, cycles, pc, totalCycles, ...props }: Props) {
    const speedTick = speedTicks.indexOf(speedTicks.reduce((prev, curr) =>
        Math.abs(curr - speed) < Math.abs(prev - speed) ? curr : prev))

    const live = state != "unstarted"
    const finished = state == "done"
    const progress = finished ? 1 : totalCycles ? Math.min(1, cycles / totalCycles) : 0

    let cycleText = "—"
    if (live) cycleText = totalCycles === null ? `${cycles.toLocaleString()} / ?` : `${cycles.toLocaleString()} / ${totalCycles.toLocaleString()}`

    let remaining = ""
    if (state == "playing" && totalCycles !== null && speed > 0) {
        const seconds = Math.ceil((totalCycles - cycles) * speed / 1000)
        remaining = seconds >= 60 ? `~${Math.floor(seconds / 60)}m ${seconds % 60}s left` : `~${seconds}s left`
    }

    return (
        <footer className={css.bar}>
            <div className={css.buttons}>
                {state == "playing" ? (
                    <button className={css.primary} title="Pause simulation" onClick={props.onPause}>
                        <Icon icon={faPause} /> Pause
                    </button>
                ) : (
                    <button className={css.primary} title="Run simulation" disabled={finished} onClick={props.onPlay}>
                        <Icon icon={faPlay} /> Run
                    </button>
                )}
                <button
                    title="Step one instruction"
                    disabled={finished || state == "playing"}
                    onClick={props.onStep}
                >
                    <Icon icon={faStepForward} /> Step
                </button>
                <button
                    className={css.iconOnly}
                    title="Run to the end of the program"
                    disabled={finished || state == "playing"}
                    onClick={props.onRunToEnd}
                >
                    <Icon icon={faForwardFast} />
                </button>
                <span className={css.divider} />
                {live ? (
                    <button className={css.iconOnly} title="Reset the simulation" onClick={props.onReset}>
                        <Icon icon={faRotateLeft} />
                    </button>
                ) : (
                    <button className={css.iconOnly} title="Clear the editors" onClick={props.onClear}>
                        <Icon icon={faEraser} />
                    </button>
                )}
            </div>

            <label className={css.speed}>
                Speed
                <input
                    type="range"
                    min={0}
                    max={speedTicks.length - 1}
                    value={speedTick}
                    title={`Simulation speed: ${speedText(speedTicks[speedTick])}`}
                    onChange={e => props.onSpeedChange?.(speedTicks[+e.target.value])}
                />
                <span className={css.value}>{speedText(speedTicks[speedTick])}</span>
            </label>

            <div className={css.stats}>
                <span>Cycle <b className={css.value}>{cycleText}</b></span>
                <span>PC <b className={css.value}>{live ? bits(pc, 32).toString("hex") : "—"}</b></span>
            </div>

            <div className={css.progress} title={totalCycles === null && live ? "This program may not terminate" : undefined}>
                <div className={css.track}>
                    <div className={css.fill} style={{ width: `${(progress * 100).toFixed(1)}%` }} />
                </div>
                <span className={css.progressText}>
                    {finished ? "Finished" : remaining || (live && totalCycles !== null ? `${Math.floor(progress * 100)}%` : "")}
                </span>
            </div>
        </footer>
    )
}
