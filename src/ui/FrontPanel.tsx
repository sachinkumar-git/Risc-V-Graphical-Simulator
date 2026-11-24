import { useState } from "react"

import { Simulator } from "simulator/simulator"
import { registerNames } from "simulator/constants"
import type { SimState } from "./SimulatorUI"
import { formatFrontPanelHex, readFrontPanelState } from "./frontPanelState"
import css from "./FrontPanel.m.css"

type Props = {
    sim: Simulator
    state: SimState
}

const switchBits = [4, 3, 2, 1, 0]

const segmentNames = ["a", "b", "c", "d", "e", "f", "g"] as const
type SegmentName = typeof segmentNames[number]

const segmentClasses: Record<SegmentName, string> = {
    a: css.segmentA,
    b: css.segmentB,
    c: css.segmentC,
    d: css.segmentD,
    e: css.segmentE,
    f: css.segmentF,
    g: css.segmentG,
}

const hexSegments: Record<string, SegmentName[]> = {
    "0": ["a", "b", "c", "d", "e", "f"],
    "1": ["b", "c"],
    "2": ["a", "b", "d", "e", "g"],
    "3": ["a", "b", "c", "d", "g"],
    "4": ["b", "c", "f", "g"],
    "5": ["a", "c", "d", "f", "g"],
    "6": ["a", "c", "d", "e", "f", "g"],
    "7": ["a", "b", "c"],
    "8": ["a", "b", "c", "d", "e", "f", "g"],
    "9": ["a", "b", "c", "d", "f", "g"],
    "A": ["a", "b", "c", "e", "f", "g"],
    "B": ["c", "d", "e", "f", "g"],
    "C": ["a", "d", "e", "f"],
    "D": ["b", "c", "d", "e", "g"],
    "E": ["a", "d", "e", "f", "g"],
    "F": ["a", "e", "f", "g"],
    "-": ["g"],
}

function SevenSegmentDisplay({ label, value, active }: { label: string, value: bigint, active: boolean }) {
    const digits = active ? formatFrontPanelHex(value) : "--------"

    return (
        <div className={css.display}>
            <span className={css.displayLabel}>{label}</span>
            <span className={css.digits} role="img" aria-label={`${label}: ${digits}`}>
                {digits.split("").map((digit, index) => {
                    const litSegments = hexSegments[digit] ?? []
                    return (
                        <span className={css.digit} key={`${index}-${digit}`} aria-hidden="true">
                            {segmentNames.map(segment => (
                                <i
                                    key={segment}
                                    className={[
                                        css.segment,
                                        segmentClasses[segment],
                                        litSegments.includes(segment) && active ? css.segmentOn : "",
                                    ].filter(Boolean).join(" ")}
                                />
                            ))}
                        </span>
                    )
                })}
            </span>
        </div>
    )
}

export default function FrontPanel({ sim, state }: Props) {
    const [registerIndex, setRegisterIndex] = useState(0)
    const live = state !== "unstarted"
    const snapshot = readFrontPanelState(sim, registerIndex)
    const leds = live ? snapshot.leds : {
        registerWrite: false,
        memoryRead: false,
        memoryWrite: false,
        branchTaken: false,
        aluZero: false,
    }

    const indicators = [
        { label: "RegWrite", on: leds.registerWrite },
        { label: "MemRead", on: leds.memoryRead },
        { label: "MemWrite", on: leds.memoryWrite },
        { label: "Branch", on: leds.branchTaken },
        { label: "Zero", on: leds.aluZero },
    ]

    return (
        <section className={css.panel} aria-label="CPU front panel">
            <header className={css.header}>
                <h2>Front panel</h2>
                <span>{state === "unstarted" ? "Ready" : state === "playing" ? "Running" : state === "paused" ? "Paused" : "Finished"}</span>
            </header>

            <div className={css.body}>
                <div className={css.switchBank} role="group" aria-label="Register select switches">
                    <div className={css.groupTitle}>
                        Register select
                        <strong>{registerNames[registerIndex]} · x{registerIndex}</strong>
                    </div>
                    <div className={css.switches}>
                        {switchBits.map(bit => {
                            const on = (registerIndex & (1 << bit)) !== 0
                            return (
                                <button
                                    key={bit}
                                    type="button"
                                    className={css.switch}
                                    aria-label={`Register select bit ${bit}`}
                                    aria-pressed={on}
                                    onClick={() => setRegisterIndex(value => value ^ (1 << bit))}
                                >
                                    <span>D{bit}</span>
                                    <i className={on ? css.switchOn : css.switchOff} />
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className={css.indicatorBank} role="group" aria-label="CPU status LEDs">
                    <span className={css.groupTitle}>Status LEDs</span>
                    <div className={css.indicators}>
                        {indicators.map(indicator => (
                            <div
                                className={css.indicator}
                                key={indicator.label}
                                role="img"
                                aria-label={`${indicator.label} LED ${indicator.on ? "on" : "off"}`}
                            >
                                <i className={indicator.on ? `${css.led} ${css.ledOn}` : css.led} aria-hidden="true" />
                                <span aria-hidden="true">{indicator.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={css.displays} role="group" aria-label="Seven-segment displays">
                    <SevenSegmentDisplay label="PC" value={snapshot.pc} active={live} />
                    <SevenSegmentDisplay label="Instruction" value={snapshot.instruction} active={live} />
                    <SevenSegmentDisplay label="ALU result" value={snapshot.aluResult} active={live} />
                    <SevenSegmentDisplay label={`Register x${registerIndex}`} value={snapshot.registerValue} active={live} />
                </div>
            </div>
        </section>
    )
}
