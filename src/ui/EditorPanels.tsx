import { useEffect, useMemo, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { vscodeDark } from "@uiw/codemirror-themes-all"
import { Decoration, EditorView, ViewPlugin, ViewUpdate, lineNumbers } from "@codemirror/view"
import { Range } from "@codemirror/state"
import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome"
import { faChevronLeft, faChevronRight, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons"

import { riscv as riscvLang } from "./riscvLang"
import { Radix, bits, Bits } from "utils/bits"
import { registerNames } from "simulator/constants"
import { StyleProps, getStyleProps } from "./reactUtils"
import css from "./EditorPanels.m.css"

export type EditorTab = "code" | "registers" | "memory"

function hexLine(num: number, inc: number, start = 0n): string {
    return bits(start + BigInt((num - 1) * inc), 32).toString("hex")
}

/** Highlights the line currently executing (or the line with an assembly error). */
function lineHighlighter(currentLine?: number, errorLine?: number) {
    const build = (view: EditorView) => {
        const ranges: Range<Decoration>[] = []
        const lineNo = errorLine ?? currentLine
        if (lineNo && lineNo >= 1 && lineNo <= view.state.doc.lines) {
            ranges.push(Decoration.line({
                class: errorLine ? "cm-sim-error-line" : "cm-sim-current-line",
            }).range(view.state.doc.line(lineNo).from))
        }
        return Decoration.set(ranges, true)
    }

    return ViewPlugin.fromClass(class {
        decorations: ReturnType<typeof build>
        constructor(view: EditorView) { this.decorations = build(view) }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
        }
    }, {
        decorations: value => value.decorations,
    })
}

type CodeEditorProps = {
    code: string
    onCodeChange?: (code: string) => void
    editable: boolean
    currentLine?: number
    errorLine?: number
}

export function CodeEditor({ code, onCodeChange, editable, currentLine, errorLine }: CodeEditorProps) {
    const [localCode, setLocalCode] = useState(code)
    useEffect(() => setLocalCode(code), [code])

    const extensions = useMemo(() => [
        riscvLang(),
        EditorView.lineWrapping,
        lineHighlighter(currentLine, errorLine),
    ], [currentLine, errorLine])

    return (
        <CodeMirror
            className={css.codeEditor}
            style={{ height: "100%" }}
            height="100%"
            placeholder="Write RISC-V assembly…"
            theme={vscodeDark}
            value={localCode}
            editable={editable}
            readOnly={!editable}
            basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false,
            }}
            extensions={extensions}
            onChange={setLocalCode}
            onBlur={() => onCodeChange?.(localCode)}
        />
    )
}

type RegisterEditorProps = {
    registers: bigint[]
    onRegistersChange?: (newRegisters: bigint[]) => void
    registerRadix: Radix
    onRegisterRadixChange?: (newRadix: Radix) => void
}

export function RegisterEditor({ registers, onRegistersChange, registerRadix, onRegisterRadixChange }: RegisterEditorProps) {
    const registersToStr = (vals: bigint[]) => vals.map(reg => bits(reg, 32).toString(registerRadix))
    const [localRegisters, setLocalRegisters] = useState(registersToStr(registers))
    useEffect(() => setLocalRegisters(registersToStr(registers)), [registers, registerRadix])

    return (
        <div className={css.editorBody}>
            <div className={css.toolbar}>
                <span>Initial values</span>
                <select value={registerRadix} onChange={e => onRegisterRadixChange?.(e.target.value as Radix)}>
                    <option value="hex">Hex</option>
                    <option value="signed">Signed decimal</option>
                    <option value="unsigned">Unsigned decimal</option>
                </select>
            </div>
            <div className={css.scroll}>
                <table className={css.dataTable}>
                    <tbody>
                        {localRegisters.map((reg, i) => (
                            <tr key={i}>
                                <td className={css.regName}>{`${registerNames[i]} (x${i})`}</td>
                                <td>
                                    <input
                                        type="text"
                                        spellCheck={false}
                                        disabled={i == 0}
                                        value={reg}
                                        onChange={e => setLocalRegisters(localRegisters.map((r, j) => i == j ? e.target.value : r))}
                                        onBlur={() => {
                                            let newRegs: bigint[] | undefined
                                            try {
                                                newRegs = localRegisters.map(r => Bits.parse(r, registerRadix, 32).toInt())
                                            } catch {
                                                // invalid input, restore the previous values below
                                            }
                                            if (newRegs !== undefined) {
                                                onRegistersChange?.(newRegs)
                                            } else {
                                                setLocalRegisters(registersToStr(registers))
                                            }
                                        }}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

type MemoryEditorProps = {
    memory: string
    memoryRadix: Radix
    memoryWordSize: number
    onMemoryChange?: (data: string) => void
    onMemoryRadixChange?: (radix: Radix) => void
    onMemoryWordSizeChange?: (wordSize: number) => void
}

export function MemoryEditor({ memory, memoryRadix, memoryWordSize, ...props }: MemoryEditorProps) {
    const [localData, setLocalData] = useState(memory)
    useEffect(() => setLocalData(memory), [memory])

    return (
        <div className={css.editorBody}>
            <div className={css.toolbar}>
                <span>Initial data</span>
                <select value={memoryRadix} onChange={e => props.onMemoryRadixChange?.(e.target.value as Radix)}>
                    <option value="hex">Hex</option>
                    <option value="signed">Signed decimal</option>
                    <option value="unsigned">Unsigned decimal</option>
                </select>
                <select value={memoryWordSize} onChange={e => props.onMemoryWordSizeChange?.(+e.target.value)}>
                    <option value="8">Byte</option>
                    <option value="16">Half-word</option>
                    <option value="32">Word</option>
                </select>
            </div>
            <div className={css.editorBody}>
                <CodeMirror
                    style={{ height: "100%" }}
                    height="100%"
                    theme={vscodeDark}
                    value={localData}
                    placeholder="Set initial memory…"
                    basicSetup={{ lineNumbers: true, foldGutter: false }}
                    extensions={[
                        lineNumbers({ formatNumber: (l) => hexLine(l, memoryWordSize / 8) }),
                        EditorView.lineWrapping,
                    ]}
                    onChange={setLocalData}
                    onBlur={() => props.onMemoryChange?.(localData)}
                />
            </div>
        </div>
    )
}

type Props = {
    code: string
    onCodeChange?: (code: string) => void
    memory: string
    onMemoryChange?: (data: string) => void
    registerRadix: Radix
    onRegisterRadixChange?: (radix: Radix) => void
    memoryRadix: Radix
    onMemoryRadixChange?: (radix: Radix) => void
    memoryWordSize: number
    onMemoryWordSizeChange?: (wordSize: number) => void
    registers: bigint[]
    onRegistersChange?: (newRegisters: bigint[]) => void
    tab: EditorTab
    onTabChange?: (tab: EditorTab) => void
    editable: boolean
    currentLine?: number
    errorLine?: number
    errorMessage?: string
    collapsed?: boolean
    onToggleCollapse?: () => void
} & StyleProps

export default function EditorPanels({
    tab, onTabChange, editable, currentLine, errorLine, errorMessage, collapsed, onToggleCollapse, ...props
}: Props) {
    if (collapsed) {
        return (
            <aside className={css.collapsed}>
                <button title="Show the editor" onClick={onToggleCollapse}>
                    <Icon icon={faChevronRight} />
                </button>
                <span>Editor</span>
            </aside>
        )
    }

    const lines = props.code ? props.code.split("\n").length : 0

    return (
        <aside {...getStyleProps(props, { className: css.editorPanel })}>
            <header className={css.header}>
                <div>
                    <h2>Assembly</h2>
                    <span>{lines} lines · {editable ? "editable" : "read-only during execution"}</span>
                </div>
                <button className={css.collapseButton} title="Collapse the editor" onClick={onToggleCollapse}>
                    <Icon icon={faChevronLeft} />
                </button>
            </header>

            <nav className={css.tabs}>
                <button className={tab == "code" ? css.tabActive : undefined} onClick={() => onTabChange?.("code")}>
                    Code
                </button>
                <button
                    className={tab == "registers" ? css.tabActive : undefined}
                    disabled={!editable}
                    title={!editable ? "Reset the simulation to edit registers" : undefined}
                    onClick={() => onTabChange?.("registers")}
                >
                    Registers
                </button>
                <button
                    className={tab == "memory" ? css.tabActive : undefined}
                    disabled={!editable}
                    title={!editable ? "Reset the simulation to edit memory" : undefined}
                    onClick={() => onTabChange?.("memory")}
                >
                    Memory
                </button>
            </nav>

            {errorMessage && (
                <div className={css.errorBanner}>
                    <Icon icon={faTriangleExclamation} />
                    <pre>{errorMessage}</pre>
                </div>
            )}

            <div className={css.content}>
                {tab == "code" && (
                    <CodeEditor
                        code={props.code}
                        onCodeChange={props.onCodeChange}
                        editable={editable}
                        currentLine={currentLine}
                        errorLine={errorLine}
                    />
                )}
                {tab == "registers" && (
                    <RegisterEditor
                        registers={props.registers}
                        onRegistersChange={props.onRegistersChange}
                        registerRadix={props.registerRadix}
                        onRegisterRadixChange={props.onRegisterRadixChange}
                    />
                )}
                {tab == "memory" && (
                    <MemoryEditor
                        memory={props.memory}
                        onMemoryChange={props.onMemoryChange}
                        memoryRadix={props.memoryRadix}
                        onMemoryRadixChange={props.onMemoryRadixChange}
                        memoryWordSize={props.memoryWordSize}
                        onMemoryWordSizeChange={props.onMemoryWordSizeChange}
                    />
                )}
            </div>
        </aside>
    )
}
