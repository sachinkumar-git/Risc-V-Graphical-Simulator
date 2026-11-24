import { Bits } from "utils/bits"
import { opcodes, registerNames } from "simulator/constants"
import { Simulator } from "simulator/simulator"

/** Human readable names for the 4-bit ALU control signal. */
export const aluControlNames: Record<string, string> = {
    "0000": "AND",
    "0001": "OR",
    "0010": "Add",
    "0110": "Subtract",
    "0111": "Set on less than",
    "1111": "Set on less than (unsigned)",
    "1000": "Shift left logical",
    "1001": "Shift right logical",
    "1011": "Shift right arithmetic",
    "1100": "XOR",
    "1101": "Load upper immediate",
    "1110": "Population count (custom)",
}

/** Human readable names for the 3-bit ALUOp signal. */
export const aluOpNames: Record<string, string> = {
    "000": "load / store",
    "001": "branch",
    "010": "R-type",
    "011": "I-type",
    "100": "LUI",
    "101": "Custom instruction",
}

export const writeSrcNames: Record<string, string> = {
    "0": "ALU result",
    "1": "memory read data",
    "2": "PC + 4",
    "3": "PC + upper immediate (auipc)",
}

export const memSizeNames: Record<string, string> = {
    "00": "byte",
    "01": "half-word",
    "10": "word",
}

/** Returns the ABI name of a register number. */
export function regName(n: number): string {
    return `${registerNames[n]} (x${n})`
}

/** A decoded instruction, built from the instruction word and its immediate. */
export interface DecodedInstruction {
    /** e.g. "addi" (or "" if unknown) */
    mnemonic: string
    /** e.g. "addi t0, t1, 4" */
    assembly: string
    format: string
    opcode: Bits
    rd: number
    rs1: number
    rs2: number
    funct3: Bits
    funct7: Bits
    immediate: Bits
    /** true for ebreak (ecall with imm=1) */
    isBreak: boolean
    /** true for ecall */
    isEcall: boolean
}

const instructionLookup = new Map<string, string>()
const opcodeLookup = new Map<string, string>()
for (const [name, [opcode, funct3, funct7]] of Object.entries(opcodes)) {
    instructionLookup.set(`${opcode.toString()}|${funct3?.toString() ?? ""}|${funct7?.toString() ?? ""}`, name)
    // lui, auipc and jal have no funct3/funct7 fields at all
    if (!funct3) opcodeLookup.set(opcode.toString(), name)
}

function formatName(mnemonic: string): string {
    if (mnemonic == "popcnt") return "R-type (custom)"
    if (["lb", "lh", "lw", "lbu", "lhu"].includes(mnemonic)) return "I-type (load)"
    if (["sb", "sh", "sw"].includes(mnemonic)) return "S-type (store)"
    if (["beq", "bne", "blt", "bge", "bltu", "bgeu"].includes(mnemonic)) return "SB-type (branch)"
    if (mnemonic == "jal") return "UJ-type (jump and link)"
    if (mnemonic == "lui" || mnemonic == "auipc") return "U-type"
    if (["slli", "srli", "srai"].includes(mnemonic)) return "I-type (shift)"
    if (mnemonic == "ecall" || mnemonic == "ebreak") return "I-type (system)"
    if (["add", "sub", "and", "or", "xor", "sll", "srl", "sra", "slt", "sltu"].includes(mnemonic)) return "R-type"
    return "I-type"
}

/** Decode an instruction word using the same field splits as the simulator. */
export function decodeInstruction(instruction: Bits, immediate: Bits): DecodedInstruction {
    const opcode = instruction.slice(0, 7)
    const rd = instruction.slice(7, 12).toNumber()
    const funct3 = instruction.slice(12, 15)
    const rs1 = instruction.slice(15, 20).toNumber()
    const rs2 = instruction.slice(20, 25).toNumber()
    const funct7 = instruction.slice(25, 32)

    let mnemonic = instructionLookup.get(`${opcode.toString()}|${funct3.toString()}|${funct7.toString()}`)
        // jalr has a funct3 but no funct7 field
        ?? instructionLookup.get(`${opcode.toString()}|${funct3.toString()}|`)
        ?? opcodeLookup.get(opcode.toString())
        ?? ""

    let isEcall = false
    let isBreak = false
    if (mnemonic == "ecall") {
        if (immediate.toInt() == 1n) {
            mnemonic = "ebreak"
            isBreak = true
        } else {
            isEcall = true
        }
    }

    const imm = immediate.toString("signed")
    let args = ""
    if (isEcall || isBreak) {
        args = ""
    } else if (formatName(mnemonic).startsWith("I-type (load)")) {
        args = `${regName(rd)}, ${imm}(${regName(rs1)})`
    } else if (formatName(mnemonic) == "I-type (shift)") {
        args = `${regName(rd)}, ${regName(rs1)}, ${immediate.toInt().toString()}`
    } else if (["addi", "andi", "ori", "xori", "slti", "sltiu", "jalr"].includes(mnemonic)) {
        args = `${regName(rd)}, ${regName(rs1)}, ${imm}`
    } else if (formatName(mnemonic) == "S-type (store)") {
        args = `${regName(rs2)}, ${imm}(${regName(rs1)})`
    } else if (formatName(mnemonic) == "SB-type (branch)") {
        args = `${regName(rs1)}, ${regName(rs2)}, ${imm}`
    } else if (mnemonic == "jal") {
        args = `${regName(rd)}, ${imm}`
    } else if (mnemonic == "lui" || mnemonic == "auipc") {
        // the simulator's U-type immediate is the raw 20-bit field; the << 12 happens in the ALU / AUIPC adder
        args = `${regName(rd)}, 0x${(immediate.toInt() & 0xFFFFFn).toString(16).toUpperCase()}`
    } else if (mnemonic == "popcnt") {
        args = `${regName(rd)}, ${regName(rs1)}`
    } else if (formatName(mnemonic) == "R-type") {
        args = `${regName(rd)}, ${regName(rs1)}, ${regName(rs2)}`
    }

    return {
        mnemonic,
        assembly: `${mnemonic} ${args}`.trim(),
        format: mnemonic ? formatName(mnemonic) : "unknown",
        opcode, rd, rs1, rs2, funct3, funct7, immediate,
        isBreak, isEcall,
    }
}

export interface ControlSignal {
    name: string
    value: string
    meaning: string
    active: boolean
}

/** Returns the live control signals, using the same values the datapath uses. */
export function controlSignals(sim: Simulator): ControlSignal[] {
    const c = sim.control
    return [
        {
            name: "RegWrite", value: `${c.regWrite}`,
            meaning: c.regWrite ? "write the register file" : "do not write a register",
            active: !!c.regWrite,
        },
        {
            name: "ALUSrc", value: `${c.aluSrc}`,
            meaning: c.aluSrc ? "ALU operand 2 is the immediate" : "ALU operand 2 is rs2",
            active: !!c.aluSrc,
        },
        {
            name: "MemRead", value: `${c.memRead}`,
            meaning: c.memRead ? "read data memory" : "no memory read",
            active: !!c.memRead,
        },
        {
            name: "MemWrite", value: `${c.memWrite}`,
            meaning: c.memWrite ? "write data memory" : "no memory write",
            active: !!c.memWrite,
        },
        {
            name: "BranchZero", value: `${c.branchZero}`,
            meaning: c.branchZero ? "branch when the ALU result is zero (beq/bge)" : "not a zero branch",
            active: !!c.branchZero,
        },
        {
            name: "BranchNotZero", value: `${c.branchNotZero}`,
            meaning: c.branchNotZero ? "branch when the ALU result is not zero (bne/blt/bltu)" : "not a not-zero branch",
            active: !!c.branchNotZero,
        },
        {
            name: "Jump", value: `${c.jump}`,
            meaning: c.jump ? "unconditional jump (jal/jalr)" : "no jump",
            active: !!c.jump,
        },
        {
            name: "Jalr", value: `${c.jalr}`,
            meaning: c.jalr ? "jump to rs1 + immediate" : "not jalr",
            active: !!c.jalr,
        },
        {
            name: "ALUOp", value: c.aluOp.toString("bin"),
            meaning: aluOpNames[c.aluOp.toString("bin").replace("0b", "")] ?? "unknown",
            active: c.aluOp.toInt() != 0n,
        },
        {
            name: "WriteSrc", value: c.writeSrc.toString("unsigned"),
            meaning: writeSrcNames[c.writeSrc.toString("unsigned")] ?? "unknown",
            active: c.writeSrc.toInt() != 0n,
        },
        {
            name: "MemSigned", value: `${c.memSigned}`,
            meaning: c.memSigned ? "sign-extend the loaded value" : "zero-extend the loaded value",
            active: !!c.memSigned && !!c.memRead,
        },
        {
            name: "MemSize", value: c.memSize.toString("bin"),
            meaning: memSizeNames[c.memSize.toString("bin").replace("0b", "")] ?? "byte",
            active: !!(c.memRead || c.memWrite),
        },
        {
            name: "ALU control", value: sim.aluControl.aluControl.toString("bin"),
            meaning: aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "unknown",
            active: true,
        },
        {
            name: "Take branch", value: `${sim.jumpControl.takeBranch}`,
            meaning: sim.jumpControl.takeBranch ? "the next PC is the branch/jump target" : "the next PC is PC + 4",
            active: !!sim.jumpControl.takeBranch,
        },
        {
            name: "Ecall / Ebreak", value: c.ecall.toString("bin"),
            meaning: c.ecall.toInt() == 1n ? "ecall" : c.ecall.toInt() == 2n ? "ebreak" : "none",
            active: c.ecall.toInt() != 0n,
        },
    ]
}

/**
 * Signal-propagation stages of one single-cycle instruction. Everything happens within a single
 * clock cycle in hardware; the stages describe the order in which signals settle along the
 * datapath and are used to sequence the 3D animation and the explanation panel together.
 */
export const PROPAGATION_STAGES = ["Fetch", "Decode", "Operands", "Execute", "Memory / Branch", "Write-back", "Next PC"] as const
export type PropagationStage = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ExplanationStep {
    title: string
    text: string
    /** Index into PROPAGATION_STAGES this step belongs to. */
    stage: PropagationStage
}

export interface InstructionExplanation {
    decoded: DecodedInstruction
    steps: ExplanationStep[]
    /** one-line summary, e.g. "add t0, t1, t2" */
    headline: string
}

const hex = (b: Bits) => b.toString("hex")
const signed = (b: Bits) => b.toString("signed")

/** Builds a step-by-step explanation of the instruction that just executed. */
export function explainInstruction(sim: Simulator): InstructionExplanation {
    const decoded = decodeInstruction(sim.instrMem.instruction, sim.immGen.immediate)
    const c = sim.control
    const steps: ExplanationStep[] = []

    steps.push({
        title: "Fetch", stage: 0,
        text: `PC ${hex(sim.pc.out)} reads instruction ${hex(sim.instrMem.instruction)} from instruction memory.`,
    })

    steps.push({
        title: "Decode", stage: 1,
        text: decoded.mnemonic
            ? `Opcode ${decoded.opcode.toString("bin")} identifies "${decoded.mnemonic}" (${decoded.format}). ` +
              `The control unit asserts ${activeSignalNames(sim).join(", ") || "no control signals"}.`
            : `The control unit cannot identify opcode ${decoded.opcode.toString("bin")}.`,
    })

    const readsRegisters = !["lui", "auipc", "jal", "ecall", "ebreak"].includes(decoded.mnemonic)
    if (readsRegisters) {
        const reads = [`${regName(decoded.rs1)} = ${signed(sim.regFile.readData1)}`]
        if (!["addi", "andi", "ori", "xori", "slti", "sltiu", "slli", "srli", "srai", "lb", "lh", "lw", "lbu", "lhu", "jalr", "popcnt"].includes(decoded.mnemonic)) {
            reads.push(`${regName(decoded.rs2)} = ${signed(sim.regFile.readData2)}`)
        }
        steps.push({
            title: "Read registers", stage: 2,
            text: `The register file reads ${reads.join(" and ")}.`,
        })
    }

    const usesImmediate = c.aluSrc || c.branchZero || c.branchNotZero || c.jump || ["lui", "auipc"].includes(decoded.mnemonic)
    if (usesImmediate && !decoded.isEcall && !decoded.isBreak) {
        const role = c.branchZero || c.branchNotZero ? " — the branch offset"
            : c.jump ? " — the jump offset"
            : c.memRead || c.memWrite ? " — the address offset"
            : ""
        steps.push({
            title: "Immediate", stage: 2,
            text: `The immediate generator ${immediateSource(decoded.format)} giving ${signed(sim.immGen.immediate)} (${hex(sim.immGen.immediate)})${role}.`,
        })
    }

    if (!["ecall", "ebreak"].includes(decoded.mnemonic)) {
        const aluOp = aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "operation"
        const a = signed(sim.alu.in1)
        const bb = signed(sim.alu.in2)
        steps.push({
            title: "Execute", stage: 3,
            text: decoded.mnemonic == "popcnt"
                ? `The custom popcnt operation counts the set bits in ${regName(decoded.rs1)} (${hex(sim.alu.in1)}), producing ${sim.alu.result.toInt()}.`
                : `The ALU performs ${aluOp} on ${a} and ${bb}, producing ${signed(sim.alu.result)} (${hex(sim.alu.result)}). ` +
                  `The zero flag is ${sim.alu.zero}.`,
        })
    }

    if (c.memRead) {
        steps.push({
            title: "Read memory", stage: 4,
            text: `Data memory loads a ${memSizeNames[c.memSize.toString("bin").replace("0b", "")] ?? "word"} from address ${hex(sim.dataMem.address)}: ` +
                  `${hex(sim.dataMem.readData)} (${signed(sim.dataMem.readData)}).`,
        })
    } else if (c.memWrite) {
        steps.push({
            title: "Write memory", stage: 4,
            text: `Data memory stores ${hex(sim.dataMem.writeData)} (${signed(sim.dataMem.writeData)}) at address ` +
                  `${hex(sim.dataMem.address)} as a ${memSizeNames[c.memSize.toString("bin").replace("0b", "")] ?? "word"}.`,
        })
    }

    if (c.regWrite) {
        steps.push({
            title: "Write back", stage: 5,
            text: `${hex(sim.writeSrcMux.out)} (${signed(sim.writeSrcMux.out)}) is written to ${regName(decoded.rd)} from the ` +
                  `${writeSrcNames[c.writeSrc.toString("unsigned")] ?? "result"}. It appears in the register panel on the next clock edge.`,
        })
    } else {
        steps.push({ title: "Write back", stage: 5, text: "This instruction does not write a register." })
    }

    if (sim.jumpControl.takeBranch) {
        steps.push({
            title: "Next PC", stage: 6,
            text: `The branch/jump is taken, so the next PC is ${hex(sim.pcMux.out)}.`,
        })
    } else {
        steps.push({
            title: "Next PC", stage: 6,
            text: `The branch is not taken (or this is not a branch), so the next PC is PC + 4 = ${hex(sim.pcAdd4.result)}.`,
        })
    }

    return { decoded, steps, headline: decoded.assembly }
}

/** How the immediate generator assembles the immediate for each instruction format. */
function immediateSource(format: string): string {
    if (format.startsWith("S-type")) return "joins bits [31:25] and [11:7] and sign-extends them,"
    if (format.startsWith("SB-type")) return "gathers bits [31], [7], [30:25] and [11:8], appends a 0 bit and sign-extends them,"
    if (format.startsWith("UJ-type")) return "gathers bits [31], [19:12], [20] and [30:21], appends a 0 bit and sign-extends them,"
    if (format.startsWith("U-type")) return "takes the 20-bit upper immediate from bits [31:12] (it is shifted left by 12 further along the datapath),"
    if (format == "I-type (shift)") return "takes the shift amount from bits [24:20],"
    return "sign-extends bits [31:20] of the instruction,"
}

function activeSignalNames(sim: Simulator): string[] {
    return controlSignals(sim).filter(s => s.active && s.value != "0" && !s.name.includes("ALU")).map(s => s.name)
}

/** Describes what one 3D component is doing for the current instruction. */
export function nodeRole(nodeId: string, sim: Simulator): string {
    const d = decodeInstruction(sim.instrMem.instruction, sim.immGen.immediate)
    const c = sim.control
    switch (nodeId) {
        case "pc":
            return `Holds ${hex(sim.pc.out)} for "${d.assembly || "unknown instruction"}". The next value is ${hex(sim.pc.in)}.`
        case "instrMem":
            return `Supplies instruction ${hex(sim.instrMem.instruction)} (${d.mnemonic || "unknown"}) to the decoder.`
        case "control":
            return `Decodes ${d.mnemonic || "the opcode"} and asserts ${activeSignalNames(sim).join(", ") || "no signals"}.`
        case "regFile":
            if (d.mnemonic == "popcnt") {
                return c.regWrite
                    ? `Reads ${regName(d.rs1)}=${signed(sim.regFile.readData1)} and latches ${hex(sim.regFile.writeData)} into ${regName(sim.regFile.writeReg.toNumber())}.`
                    : `Reads ${regName(d.rs1)}=${signed(sim.regFile.readData1)}. No write this cycle.`
            }
            return c.regWrite
                ? `Reads ${regName(d.rs1)}=${signed(sim.regFile.readData1)} and ${regName(d.rs2)}=${signed(sim.regFile.readData2)}, and latches ${hex(sim.regFile.writeData)} into ${regName(sim.regFile.writeReg.toNumber())}.`
                : `Reads ${regName(d.rs1)}=${signed(sim.regFile.readData1)} and ${regName(d.rs2)}=${signed(sim.regFile.readData2)}. No write this cycle.`
        case "immGen":
            return `Extracts ${signed(sim.immGen.immediate)} (${hex(sim.immGen.immediate)}) from the instruction.`
        case "aluControl":
            return `Translates ALUOp ${c.aluOp.toString("bin")} + funct3 ${d.funct3.toString("bin")} into ${aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "an ALU operation"}.`
        case "aluInputMux":
            if (d.mnemonic == "popcnt") return "The mux output is not used; the custom popcnt operation ignores operand 2."
            return `Selects ${sim.aluInputMux.select.toNumber() == 1 ? "the immediate" : "rs2"} because ALUSrc = ${c.aluSrc}, forwarding ${signed(sim.aluInputMux.out)} to the ALU.`
        case "alu":
            if (d.mnemonic == "popcnt") {
                return `Counts the set bits in ${regName(d.rs1)} (${hex(sim.alu.in1)}), producing ${sim.alu.result.toInt()}.`
            }
            return `Computes ${aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "an operation"}: ${signed(sim.alu.in1)} and ${signed(sim.alu.in2)} give ${signed(sim.alu.result)} (${hex(sim.alu.result)}).`
        case "dataMem":
            if (c.memRead) return `Reads ${hex(sim.dataMem.readData)} from address ${hex(sim.dataMem.address)}.`
            if (c.memWrite) return `Writes ${hex(sim.dataMem.writeData)} to address ${hex(sim.dataMem.address)}.`
            return "No memory access this cycle, but the ALU result is still presented as the address."
        case "pcAdd4":
            return `Adds 4 to the PC: ${hex(sim.pc.out)} + 4 = ${hex(sim.pcAdd4.result)}.`
        case "jalrMux":
            return `Selects ${sim.jalrMux.select.toNumber() == 1 ? `${regName(d.rs1)} (jalr)` : "the PC"}, giving ${hex(sim.jalrMux.out)}.`
        case "branchAdder":
            return `Adds the immediate to ${hex(sim.jalrMux.out)} to get the target ${hex(sim.branchAdder.result)}.`
        case "jumpControl":
            return `With ALU zero = ${sim.alu.zero}, BranchZero = ${c.branchZero}, BranchNotZero = ${c.branchNotZero} and Jump = ${c.jump}, ` +
                   `the branch is ${sim.jumpControl.takeBranch ? "taken" : "not taken"}.`
        case "pcMux":
            return `Selects ${sim.pcMux.select.toNumber() == 1 ? "the branch target" : "PC + 4"}, so the next PC is ${hex(sim.pcMux.out)}.`
        case "writeSrcMux":
            return `Selects the ${writeSrcNames[c.writeSrc.toString("unsigned")] ?? "ALU result"}, forwarding ${hex(sim.writeSrcMux.out)} to the register file.`
        case "auipcAdder":
            return `Adds the PC and the upper immediate: ${hex(sim.pc.out)} + (${signed(sim.immGen.immediate)} << 12) = ${hex(sim.auipcAdder.result)}.`
        default:
            return d.assembly
    }
}
