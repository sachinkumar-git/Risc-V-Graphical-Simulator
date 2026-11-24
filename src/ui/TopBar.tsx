import { useState } from "react"
import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome"
import { faDownload, faQuestion, faUpload } from "@fortawesome/free-solid-svg-icons"

import { Example } from "./examples"
import HelpModal from "./HelpModal"
import type { SimState } from "./SimulatorUI"
import css from "./TopBar.m.css"

type Props = {
    state: SimState
    examples: Example[]
    onLoadExample?: (example: Example) => void
    onImport?: () => void
    onExport?: () => void
}

const STATE_LABEL: Record<SimState, string> = {
    unstarted: "Ready",
    playing: "Running",
    paused: "Paused",
    done: "Finished",
}

export default function TopBar({ state, examples, onLoadExample, onImport, onExport }: Props) {
    const [showHelp, setShowHelp] = useState(false)

    return (
        <header className={css.topBar}>
            <div className={css.brand}>
                <strong>RISC-V Studio</strong>
                <span className={css.arch}>RV32I + popcnt, single-cycle</span>
            </div>

            <span className={css.state} data-state={state}>{STATE_LABEL[state]}</span>

            <div className={css.spacer} />

            <select
                className={css.examples}
                aria-label="Load an example program"
                value=""
                onChange={e => {
                    const example = examples.find(ex => ex.name == e.target.value)
                    if (example) onLoadExample?.(example)
                }}
            >
                <option value="" disabled>Examples…</option>
                {examples.map(example => (
                    <option key={example.name} value={example.name}>{example.name}</option>
                ))}
            </select>

            <div className={css.actions}>
                <button title="Import simulation setup" onClick={onImport}>
                    <Icon icon={faUpload} /> <span>Import</span>
                </button>
                <button title="Export simulation setup" onClick={onExport}>
                    <Icon icon={faDownload} /> <span>Export</span>
                </button>
                <button className={css.help} title="Help / About" onClick={() => setShowHelp(true)}>
                    <Icon icon={faQuestion} />
                </button>
            </div>

            <HelpModal show={showHelp} onHide={() => setShowHelp(false)} />
        </header>
    )
}
