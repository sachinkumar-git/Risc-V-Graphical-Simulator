import { Simulator } from "simulator/simulator"
import { Bits } from "utils/bits"
import { PropagationStage, aluControlNames, controlSignals, decodeInstruction, regName } from "../instructionInfo"

/**
 * Static description of the single-cycle RISC-V datapath used by the 3D view.
 *
 * The scene reads its state from the simulator components that actually executed the current
 * instruction (see `Simulator.tick()`), so every label, highlight and pulse below is derived from
 * the real datapath signals rather than an animation script.
 */

export type NodeKind = "fetch" | "decode" | "control" | "execute" | "memory" | "writeback" | "mux" | "adder"
export type NodeShape = "box" | "memory" | "regfile" | "control" | "alu" | "mux" | "adder"
export type WireKind = "data" | "control" | "branch" | "write"

export interface IOField {
    label: string
    value: string
}

export interface ProcessorNode {
    id: string
    label: string
    /** Compact label drawn on the 3D component. */
    short: string
    position: [number, number]
    size: [number, number]
    kind: NodeKind
    shape: NodeShape
    /** Short purpose, shown in the inspector. */
    description: string
    /** Longer explanation of how the component works. */
    howItWorks: string
    /** Whether the component participates in the current instruction. */
    active(sim: Simulator): boolean
    /** Main value rendered under the label in the 3D view. */
    value(sim: Simulator): string
    inputs(sim: Simulator): IOField[]
    outputs(sim: Simulator): IOField[]
}

export interface ProcessorWire {
    id: string
    label: string
    kind: WireKind
    /** Orthogonal wire route in the XY plane, starting at the source and ending at the destination. */
    points: [number, number][]
    description: string
    active(sim: Simulator): boolean
    /** Value carried by the wire. Displayed at the midpoint when the wire is active. */
    value(sim: Simulator): string
    /** Static label drawn next to the wire. */
    showLabel?: boolean
}

const hex = (b: Bits) => b.toString("hex")
const signs = (b: Bits) => b.toString("signed")
const bin = (b: Bits) => b.toString("bin")
const onBit = (b: Bits | 0 | 1) => typeof b == "number" ? !!b : b.toInt() != 0n
const signal = (b: Bits | 0 | 1) => onBit(b) ? "1" : "0"

/** Signals that switch the branch/jump hardware on. */
const branchHardware = (sim: Simulator) => !!(sim.control.branchZero || sim.control.branchNotZero || sim.control.jump)
/** Conditional branches (beq, bne, blt, ...), which compare registers in the ALU. */
const conditionalBranch = (sim: Simulator) => !!(sim.control.branchZero || sim.control.branchNotZero)
const memAccess = (sim: Simulator) => !!(sim.control.memRead || sim.control.memWrite)
/** True when the write-back mux selects input `src` and the register file actually writes. */
const writesBack = (sim: Simulator, src: number) => !!sim.control.regWrite && sim.control.writeSrc.toNumber() == src
/** ALU control code of the LUI operation, which only uses operand 2 (imm << 12). */
const ALU_LUI = 0b1101
const ALU_POPCNT = 0b1110

/**
 * Whether the ALU's result is consumed by this instruction: as a memory address, as a branch
 * comparison (through the zero flag), or as the value written back. For jal, jalr, auipc and
 * ecall the ALU still computes something, but nothing downstream uses it.
 */
export const aluUsed = (sim: Simulator) => memAccess(sim) || conditionalBranch(sim) || writesBack(sim, 0)
/** Whether ALU operand 1 (rs1) matters. LUI ignores it. */
const aluUsesRs1 = (sim: Simulator) => aluUsed(sim) && sim.aluControl.aluControl.toNumber() != ALU_LUI
const aluUsesOperand2 = (sim: Simulator) => aluUsed(sim) && sim.aluControl.aluControl.toNumber() != ALU_POPCNT
/** Whether the immediate generator's output is used anywhere. */
export const immediateUsed = (sim: Simulator) =>
    (!!sim.control.aluSrc && aluUsed(sim)) || branchHardware(sim) || writesBack(sim, 3)

function selectedMux(sim: Simulator, mux: { select: Bits, in: Bits[] }): IOField[] {
    const idx = mux.select.toNumber()
    return [
        { label: "Select", value: `${idx}` },
        { label: `Selected input ${idx}`, value: hex(mux.in[idx]) },
    ]
}

export const processorNodes: ProcessorNode[] = [
    {
        id: "pc",
        label: "Program Counter",
        short: "PC",
        position: [-12.7, 8.4], size: [2.6, 2.0],
        kind: "fetch", shape: "box",
        description: "Stores the address of the current instruction.",
        howItWorks: "The PC is an edge-triggered 32-bit register. Every cycle it latches the next address chosen by the PC multiplexer, and its output addresses instruction memory.",
        active: sim => true,
        value: sim => hex(sim.pc.out),
        inputs: sim => [{ label: "Next PC (from PC mux)", value: hex(sim.pc.in) }],
        outputs: sim => [{ label: "PC", value: hex(sim.pc.out) }],
    }, {
        id: "pcAdd4",
        label: "PC + 4 Adder",
        short: "+4",
        position: [-16.4, 5.6], size: [2.4, 1.6],
        kind: "adder", shape: "adder",
        description: "Computes the address of the following instruction.",
        howItWorks: "This adder always adds 4 (one 32-bit instruction) to the current PC. Its result is both the default next PC and the return address saved by jal/jalr.",
        active: sim => true,
        value: sim => hex(sim.pcAdd4.result),
        inputs: sim => [
            { label: "PC", value: hex(sim.pcAdd4.in1) },
            { label: "Constant", value: "4" },
        ],
        outputs: sim => [{ label: "PC + 4", value: hex(sim.pcAdd4.result) }],
    }, {
        id: "pcMux",
        label: "PC Mux",
        short: "PC Mux",
        position: [-16.4, 8.4], size: [1.9, 1.9],
        kind: "mux", shape: "mux",
        description: "Chooses PC + 4 or a branch/jump target as the next PC.",
        howItWorks: "A 2-to-1 multiplexer. When the branch control unit says a branch is taken the target address is selected; otherwise execution continues sequentially at PC + 4.",
        active: sim => true,
        value: sim => hex(sim.pcMux.out),
        inputs: sim => [
            { label: "PC + 4", value: hex(sim.pcMux.in[0]) },
            { label: "Branch target", value: hex(sim.pcMux.in[1]) },
            ...selectedMux(sim, sim.pcMux),
        ],
        outputs: sim => [{ label: "Next PC", value: hex(sim.pcMux.out) }],
    }, {
        id: "instrMem",
        label: "Instruction Memory",
        short: "Instr Memory",
        position: [-8.7, 8.4], size: [3.2, 2.4],
        kind: "fetch", shape: "memory",
        description: "Stores the machine code of the program.",
        howItWorks: "The instruction memory is addressed by the PC and returns the 32-bit instruction word. The simulator stores one word per 4-byte address, starting at address 0.",
        active: sim => true,
        value: sim => hex(sim.instrMem.instruction),
        inputs: sim => [{ label: "Address (PC)", value: hex(sim.instrMem.address) }],
        outputs: sim => [{ label: "Instruction", value: hex(sim.instrMem.instruction) }],
    }, {
        id: "control",
        label: "Control Unit",
        short: "Control",
        position: [-4.2, 9.7], size: [3.6, 2.6],
        kind: "control", shape: "control",
        description: "Decodes the opcode and sets every control signal.",
        howItWorks: "The control unit maps the 7-bit opcode (and funct3 for loads and branches) to the write, ALU source, memory, branch and jump signals used by the rest of the datapath.",
        active: sim => true,
        value: sim => decodeInstruction(sim.instrMem.instruction, sim.immGen.immediate).mnemonic || "—",
        inputs: sim => [
            { label: "Opcode", value: bin(sim.control.opCode) },
            { label: "Funct3", value: bin(sim.control.funct3) },
        ],
        outputs: sim => controlSignals(sim)
            .filter(s => !["ALU control", "Take branch", "MemSigned", "MemSize"].includes(s.name))
            .map(s => ({ label: s.name, value: s.value })),
    }, {
        id: "aluControl",
        label: "ALU Control",
        short: "ALU Control",
        position: [-0.2, 9.7], size: [3.2, 2.2],
        kind: "control", shape: "box",
        description: "Turns ALUOp and the funct fields into an ALU operation.",
        howItWorks: "ALUOp says which family of instruction is executing; funct3 and funct7 choose the exact operation inside that family (add, sub, and, or, xor, shifts, comparisons, and custom popcnt).",
        active: sim => aluUsed(sim),
        value: sim => aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "—",
        inputs: sim => [
            { label: "ALUOp", value: bin(sim.aluControl.aluOp) },
            { label: "Funct3", value: bin(sim.aluControl.funct3) },
            { label: "Funct7", value: bin(sim.aluControl.funct7) },
        ],
        outputs: sim => [{ label: "ALU control", value: `${bin(sim.aluControl.aluControl)} (${aluControlNames[sim.aluControl.aluControl.toString("bin").replace("0b", "")] ?? "?"})` }],
    }, {
        id: "regFile",
        label: "Register File",
        short: "Registers",
        position: [-4.2, 5.4], size: [3.6, 3.6],
        kind: "decode", shape: "regfile",
        description: "Holds the 32 general-purpose registers.",
        howItWorks: "Two read ports supply rs1 and rs2 combinationally. The write port latches the write data into rd on the clock edge when RegWrite is asserted; x0 is hard-wired to zero.",
        active: sim => true,
        value: sim => `x${sim.regFile.readReg1.toNumber()} / x${sim.regFile.readReg2.toNumber()}`,
        inputs: sim => [
            { label: "Read register 1", value: regName(sim.regFile.readReg1.toNumber()) },
            { label: "Read register 2", value: regName(sim.regFile.readReg2.toNumber()) },
            { label: "Write register", value: regName(sim.regFile.writeReg.toNumber()) },
            { label: "Write data", value: hex(sim.regFile.writeData) },
            { label: "RegWrite", value: signal(sim.regFile.regWrite) },
        ],
        outputs: sim => [
            { label: "Read data 1", value: `${hex(sim.regFile.readData1)} (${signs(sim.regFile.readData1)})` },
            { label: "Read data 2", value: `${hex(sim.regFile.readData2)} (${signs(sim.regFile.readData2)})` },
        ],
    }, {
        id: "immGen",
        label: "Immediate Generator",
        short: "Imm Gen",
        position: [-8.7, 1.2], size: [3.0, 2.2],
        kind: "decode", shape: "box",
        description: "Extracts and sign-extends the instruction's immediate.",
        howItWorks: "The immediate is scattered across the instruction word differently for I, S, B, U and J formats. This unit gathers the bits and sign-extends them to 32 bits.",
        active: sim => immediateUsed(sim),
        value: sim => signs(sim.immGen.immediate),
        inputs: sim => [{ label: "Instruction", value: hex(sim.immGen.instruction) }],
        outputs: sim => [{ label: "Immediate", value: `${hex(sim.immGen.immediate)} (${signs(sim.immGen.immediate)})` }],
    }, {
        id: "jalrMux",
        label: "JALR Mux",
        short: "JALR Mux",
        position: [-12.7, 5.6], size: [1.9, 1.9],
        kind: "mux", shape: "mux",
        description: "Chooses the PC or rs1 as the base of a jump.",
        howItWorks: "For jalr the target is rs1 + immediate; for every other branch or jump the base is the PC. This multiplexer selects between the two.",
        active: sim => branchHardware(sim),
        value: sim => hex(sim.jalrMux.out),
        inputs: sim => [
            { label: "PC", value: hex(sim.jalrMux.in[0]) },
            { label: "rs1", value: hex(sim.jalrMux.in[1]) },
            ...selectedMux(sim, sim.jalrMux),
        ],
        outputs: sim => [{ label: "Base address", value: hex(sim.jalrMux.out) }],
    }, {
        id: "branchAdder",
        label: "Branch Adder",
        short: "Branch +",
        position: [-8.7, 5.6], size: [3.2, 1.8],
        kind: "adder", shape: "adder",
        description: "Computes a branch or jump target address.",
        howItWorks: "The branch adder adds the sign-extended immediate (the offset) to the PC — or to rs1 for jalr — and clears the lowest bit so the target is 2-byte aligned.",
        active: sim => branchHardware(sim),
        value: sim => hex(sim.branchAdder.result),
        inputs: sim => [
            { label: "Base", value: hex(sim.branchAdder.in1) },
            { label: "Offset", value: `${hex(sim.branchAdder.in2)} (${signs(sim.branchAdder.in2)})` },
        ],
        outputs: sim => [{ label: "Branch target", value: hex(sim.branchAdder.result) }],
    }, {
        id: "jumpControl",
        label: "Jump / Branch Control",
        short: "Branch Ctrl",
        position: [3.8, 1.4], size: [2.8, 1.8],
        kind: "control", shape: "box",
        description: "Decides whether a branch or jump is actually taken.",
        howItWorks: "It combines the branch type from the control unit with the ALU zero flag: beq/bge take the branch when zero is 1, bne/blt/bltu when zero is 0, and jal/jalr always jump.",
        active: sim => branchHardware(sim),
        value: sim => sim.jumpControl.takeBranch ? "taken" : "not taken",
        inputs: sim => [
            { label: "Branch on zero", value: signal(sim.jumpControl.branchZero) },
            { label: "Branch on not zero", value: signal(sim.jumpControl.branchNotZero) },
            { label: "Jump", value: signal(sim.jumpControl.jump) },
            { label: "ALU zero", value: signal(sim.jumpControl.zero) },
        ],
        outputs: sim => [{ label: "Take branch", value: signal(sim.jumpControl.takeBranch) }],
    }, {
        id: "aluInputMux",
        label: "ALU Input Mux",
        short: "ALUSrc",
        position: [-0.2, 1.4], size: [1.9, 2.2],
        kind: "mux", shape: "mux",
        description: "Feeds the ALU either rs2 or the immediate.",
        howItWorks: "Arithmetic and branches operate on two registers, but immediate and load/store instructions use the immediate. ALUSrc selects which value reaches the ALU's second input.",
        active: sim => aluUsesOperand2(sim),
        value: sim => signs(sim.aluInputMux.out),
        inputs: sim => [
            { label: "Register data 2", value: `${hex(sim.aluInputMux.in[0])} (${signs(sim.aluInputMux.in[0])})` },
            { label: "Immediate", value: `${hex(sim.aluInputMux.in[1])} (${signs(sim.aluInputMux.in[1])})` },
            ...selectedMux(sim, sim.aluInputMux),
        ],
        outputs: sim => [{ label: "ALU operand 2", value: `${hex(sim.aluInputMux.out)} (${signs(sim.aluInputMux.out)})` }],
    }, {
        id: "alu",
        label: "Arithmetic Logic Unit",
        short: "ALU",
        position: [3.8, 5.4], size: [3.4, 2.8],
        kind: "execute", shape: "alu",
        description: "Performs the arithmetic and logic operation.",
        howItWorks: "The ALU performs the operation chosen by ALU Control and produces the zero flag. The custom popcnt operation counts set bits in operand 1 and ignores operand 2.",
        active: sim => aluUsed(sim),
        value: sim => hex(sim.alu.result),
        inputs: sim => [
            { label: "Operand 1", value: `${hex(sim.alu.in1)} (${signs(sim.alu.in1)})` },
            ...(sim.aluControl.aluControl.toNumber() == ALU_POPCNT ? [] : [
                { label: "Operand 2", value: `${hex(sim.alu.in2)} (${signs(sim.alu.in2)})` },
            ]),
            { label: "ALU control", value: `${bin(sim.alu.aluControl)} (${aluControlNames[sim.alu.aluControl.toString("bin").replace("0b", "")] ?? "?"})` },
        ],
        outputs: sim => [
            { label: "Result", value: `${hex(sim.alu.result)} (${signs(sim.alu.result)})` },
            { label: "Zero", value: signal(sim.alu.zero) },
        ],
    }, {
        id: "dataMem",
        label: "Data Memory",
        short: "Data Memory",
        position: [7.9, 5.4], size: [3.2, 2.8],
        kind: "memory", shape: "memory",
        description: "Stores the data the program works with.",
        howItWorks: "The ALU result is the address. On a load (MemRead) the addressed byte, half-word or word is returned and sign/zero extended; on a store (MemWrite) rs2 is written at that address.",
        active: sim => !!(sim.control.memRead || sim.control.memWrite),
        value: sim => sim.control.memRead ? hex(sim.dataMem.readData) : sim.control.memWrite ? "write" : "—",
        inputs: sim => [
            { label: "Address", value: hex(sim.dataMem.address) },
            { label: "Write data", value: hex(sim.dataMem.writeData) },
            { label: "MemRead / MemWrite", value: `${signal(sim.dataMem.memRead)} / ${signal(sim.dataMem.memWrite)}` },
            { label: "Size / Signed", value: `${bin(sim.dataMem.size)} / ${signal(sim.dataMem.signed)}` },
        ],
        outputs: sim => [{ label: "Read data", value: `${hex(sim.dataMem.readData)} (${signs(sim.dataMem.readData)})` }],
    }, {
        id: "writeSrcMux",
        label: "Write-back Mux",
        short: "WB Mux",
        position: [11.9, 5.4], size: [1.9, 2.6],
        kind: "mux", shape: "mux",
        description: "Chooses the value written back to the register file.",
        howItWorks: "Four sources can be written to a register: the ALU result (arithmetic/logic/lui), memory read data (loads), PC + 4 (jal/jalr return address) and the AUIPC adder result.",
        active: sim => !!sim.control.regWrite,
        value: sim => hex(sim.writeSrcMux.out),
        inputs: sim => [
            { label: "ALU result", value: hex(sim.writeSrcMux.in[0]) },
            { label: "Memory data", value: hex(sim.writeSrcMux.in[1]) },
            { label: "PC + 4", value: hex(sim.writeSrcMux.in[2]) },
            { label: "AUIPC result", value: hex(sim.writeSrcMux.in[3]) },
            ...selectedMux(sim, sim.writeSrcMux),
        ],
        outputs: sim => [{ label: "Write data", value: `${hex(sim.writeSrcMux.out)} (${signs(sim.writeSrcMux.out)})` }],
    }, {
        id: "auipcAdder",
        label: "AUIPC Adder",
        short: "AUIPC +",
        position: [-0.2, -2.8], size: [3.0, 1.6],
        kind: "adder", shape: "adder",
        description: "Computes PC + (immediate << 12) for auipc.",
        howItWorks: "auipc builds a PC-relative address by adding the upper immediate (shifted left by 12) to the current PC. It shares no state with the main PC adder.",
        active: sim => writesBack(sim, 3),
        value: sim => hex(sim.auipcAdder.result),
        inputs: sim => [
            { label: "PC", value: hex(sim.auipcAdder.pc) },
            { label: "Upper immediate", value: `${signs(sim.immGen.immediate)} << 12` },
        ],
        outputs: sim => [{ label: "PC + upper imm", value: hex(sim.auipcAdder.result) }],
    },
]

/**
 * Wires are routed orthogonally. `data` wires carry 32-bit values, `control` wires carry the
 * control signals, `branch` wires carry branch/jump decisions and `write` wires feed the
 * register file.
 */
export const processorWires: ProcessorWire[] = [
    {
        id: "pc-to-instr",
        label: "PC",
        kind: "data",
        points: [[-11.4, 8.4], [-10.3, 8.4]],
        description: "The PC addresses instruction memory.",
        active: () => true,
        value: sim => hex(sim.pc.out),
        showLabel: true,
    }, {
        id: "pc-to-pcAdd4",
        label: "",
        kind: "data",
        points: [[-14.0, 8.0], [-14.6, 8.0], [-14.6, 6.0], [-15.2, 6.0]],
        description: "The current PC is incremented by 4.",
        active: () => true,
        value: sim => hex(sim.pc.out),
    }, {
        id: "pcAdd4-to-pcMux",
        label: "PC + 4",
        kind: "data",
        points: [[-16.4, 6.4], [-16.4, 7.45]],
        description: "PC + 4 is the default next instruction address.",
        active: sim => sim.pcMux.select.toNumber() == 0,
        value: sim => hex(sim.pcAdd4.result),
        showLabel: true,
    }, {
        id: "branchAdder-to-pcMux",
        label: "",
        kind: "branch",
        points: [[-10.3, 5.6], [-10.75, 5.6], [-10.75, 10.35], [-15.1, 10.35], [-15.1, 8.9], [-15.45, 8.9]],
        description: "The branch adder's target reaches the PC multiplexer.",
        active: sim => sim.pcMux.select.toNumber() == 1,
        value: sim => hex(sim.branchAdder.result),
    }, {
        id: "pcMux-to-pc",
        label: "next PC",
        kind: "data",
        points: [[-15.45, 8.4], [-14.0, 8.4]],
        description: "The selected next PC is latched into the program counter.",
        active: () => true,
        value: sim => hex(sim.pcMux.out),
        showLabel: true,
    }, {
        id: "instr-to-control",
        label: "opcode",
        kind: "data",
        points: [[-7.1, 9.0], [-6.7, 9.0], [-6.7, 9.9], [-6.0, 9.9]],
        description: "The opcode field is decoded by the control unit.",
        active: () => true,
        value: sim => bin(sim.instrSplit.opCode),
    }, {
        id: "instr-to-aluControl",
        label: "funct3 / funct7",
        kind: "data",
        points: [[-9.0, 9.6], [-9.0, 11.4], [-0.2, 11.4], [-0.2, 10.8]],
        description: "The funct fields select the exact ALU operation.",
        active: () => true,
        value: sim => `${bin(sim.instrSplit.funct3)} ${bin(sim.instrSplit.funct7)}`,
    }, {
        id: "instr-to-regFile",
        label: "rs1 / rs2 / rd",
        kind: "data",
        points: [[-7.1, 8.2], [-6.7, 8.2], [-6.7, 7.7], [-5.4, 7.7], [-5.4, 7.2]],
        description: "The register fields address the register file.",
        active: () => true,
        value: sim => `x${sim.instrSplit.rs1.toNumber()} x${sim.instrSplit.rs2.toNumber()} x${sim.instrSplit.rd.toNumber()}`,
    }, {
        id: "instr-to-immGen",
        label: "instruction",
        kind: "data",
        points: [[-10.3, 8.0], [-11.1, 8.0], [-11.1, 1.2], [-10.2, 1.2]],
        description: "The immediate generator reads the whole instruction word.",
        active: sim => immediateUsed(sim),
        value: sim => hex(sim.instrMem.instruction),
    }, {
        id: "control-to-aluControl",
        label: "ALUOp",
        kind: "control",
        points: [[-2.4, 9.7], [-1.8, 9.7]],
        description: "ALUOp tells ALU Control which instruction family is executing.",
        active: sim => aluUsed(sim),
        value: sim => bin(sim.control.aluOp),
    }, {
        id: "control-to-regFile",
        label: "RegWrite",
        kind: "control",
        points: [[-5.0, 8.4], [-5.0, 7.2]],
        description: "RegWrite enables the register file write port.",
        active: sim => !!sim.control.regWrite,
        value: sim => signal(sim.control.regWrite),
        showLabel: true,
    }, {
        id: "control-to-aluSrc",
        label: "ALUSrc",
        kind: "control",
        points: [[-2.4, 8.8], [-1.9, 8.8], [-1.9, 2.9], [-0.5, 2.9], [-0.5, 2.5]],
        description: "ALUSrc selects rs2 or the immediate at the ALU input multiplexer.",
        active: sim => !!sim.control.aluSrc,
        value: sim => signal(sim.control.aluSrc),
    }, {
        id: "control-to-jalr",
        label: "Jalr",
        kind: "control",
        points: [[-6.0, 10.5], [-6.55, 10.5], [-6.55, 6.95], [-13.2, 6.95], [-13.2, 6.55]],
        description: "Jalr makes the jump base rs1 instead of the PC.",
        active: sim => !!sim.control.jalr,
        value: sim => signal(sim.control.jalr),
    }, {
        id: "control-to-jumpControl",
        label: "branch / jump",
        kind: "control",
        points: [[-6.0, 9.2], [-6.65, 9.2], [-6.65, -1.6], [3.4, -1.6], [3.4, 0.5]],
        description: "The branch type and jump flags reach the branch decision logic.",
        active: sim => branchHardware(sim),
        value: sim => `${signal(sim.control.branchZero)}${signal(sim.control.branchNotZero)}${signal(sim.control.jump)}`,
    }, {
        id: "control-to-mem",
        label: "MemRead / MemWrite",
        kind: "control",
        points: [[-3.0, 11.0], [-3.0, 11.6], [7.9, 11.6], [7.9, 6.8]],
        description: "MemRead and MemWrite tell data memory to load or store.",
        active: sim => !!(sim.control.memRead || sim.control.memWrite),
        value: sim => `${signal(sim.control.memRead)}${signal(sim.control.memWrite)}`,
    }, {
        id: "control-to-writeSrc",
        label: "WriteSrc",
        kind: "control",
        points: [[-3.4, 8.4], [-3.4, 8.05], [-2.1, 8.05], [11.45, 8.05], [11.45, 6.65]],
        description: "WriteSrc selects the value written back to the register file.",
        active: sim => !!sim.control.regWrite,
        value: sim => sim.control.writeSrc.toString("unsigned"),
    }, {
        id: "aluControl-to-alu",
        label: "ALU control",
        kind: "control",
        points: [[0.0, 8.6], [0.0, 7.7], [3.3, 7.7], [3.3, 6.8]],
        description: "The 4-bit ALU control code selects the ALU operation.",
        active: sim => aluUsed(sim),
        value: sim => bin(sim.aluControl.aluControl),
    }, {
        id: "reg1-to-alu",
        label: "rs1 data",
        kind: "data",
        points: [[-2.4, 6.5], [1.8, 6.5], [1.8, 6.15], [2.1, 6.15]],
        description: "The first register value feeds ALU operand 1.",
        active: sim => aluUsesRs1(sim),
        value: sim => hex(sim.regFile.readData1),
        showLabel: true,
    }, {
        id: "reg2-to-mux",
        label: "rs2 data",
        kind: "data",
        points: [[-3.2, 3.6], [-3.2, 1.95], [-1.15, 1.95]],
        description: "The second register value is one input of the ALU source multiplexer.",
        active: sim => !sim.control.aluSrc && aluUsesOperand2(sim),
        value: sim => hex(sim.regFile.readData2),
        showLabel: true,
    }, {
        id: "reg2-to-dataMem",
        label: "store data",
        kind: "data",
        points: [[-2.8, 3.6], [-2.8, 2.75], [7.3, 2.75], [7.3, 4.0]],
        description: "For stores, the second register value is the data written to memory.",
        active: sim => !!sim.control.memWrite,
        value: sim => hex(sim.regFile.readData2),
        showLabel: true,
    }, {
        id: "imm-to-mux",
        label: "immediate",
        kind: "data",
        points: [[-7.2, 1.0], [-1.15, 1.0]],
        description: "The immediate is the other input of the ALU source multiplexer.",
        active: sim => !!sim.control.aluSrc && aluUsed(sim),
        value: sim => hex(sim.immGen.immediate),
        showLabel: true,
    }, {
        id: "mux-to-alu",
        label: "",
        kind: "data",
        points: [[0.75, 1.4], [1.5, 1.4], [1.5, 4.6], [2.1, 4.6]],
        description: "The selected ALU operand 2 reaches the ALU.",
        active: sim => aluUsesOperand2(sim),
        value: sim => hex(sim.aluInputMux.out),
    }, {
        id: "reg1-to-jalrMux",
        label: "rs1",
        kind: "data",
        points: [[-6.0, 6.9], [-12.45, 6.9], [-12.45, 6.55]],
        description: "For jalr, the target base is rs1 rather than the PC.",
        active: sim => !!sim.control.jalr,
        value: sim => hex(sim.regFile.readData1),
    }, {
        id: "pc-to-jalrMux",
        label: "PC",
        kind: "data",
        points: [[-12.9, 7.4], [-12.9, 6.55]],
        description: "The PC is the base address for branches and jal.",
        active: sim => branchHardware(sim) && !sim.control.jalr,
        value: sim => hex(sim.pc.out),
    }, {
        id: "jalrMux-to-branchAdder",
        label: "",
        kind: "data",
        points: [[-11.75, 5.6], [-10.3, 5.6]],
        description: "The selected base is added to the branch immediate.",
        active: sim => branchHardware(sim),
        value: sim => hex(sim.jalrMux.out),
    }, {
        id: "imm-to-branchAdder",
        label: "offset",
        kind: "data",
        points: [[-9.4, 2.3], [-9.4, 4.7]],
        description: "The branch offset is added to the base address.",
        active: sim => branchHardware(sim),
        value: sim => hex(sim.immGen.immediate),
    }, {
        id: "alu-to-dataMem",
        label: "address",
        kind: "data",
        points: [[5.5, 5.4], [6.3, 5.4]],
        description: "The ALU result is the data memory address.",
        active: sim => memAccess(sim),
        value: sim => hex(sim.alu.result),
        showLabel: true,
    }, {
        id: "alu-zero-to-jumpControl",
        label: "zero",
        kind: "branch",
        points: [[2.4, 4.0], [2.4, 3.0], [2.9, 3.0], [2.9, 2.3]],
        description: "The ALU zero flag is used by the branch decision logic.",
        active: sim => conditionalBranch(sim),
        value: sim => signal(sim.alu.zero),
    }, {
        id: "jumpControl-to-pcMux",
        label: "take branch",
        kind: "branch",
        points: [[2.4, 0.9], [1.95, 0.9], [1.95, -1.25], [-15.0, -1.25], [-15.0, 9.2], [-15.45, 9.2]],
        description: "The take-branch signal selects the branch target at the PC multiplexer.",
        active: sim => !!sim.jumpControl.takeBranch,
        value: sim => signal(sim.jumpControl.takeBranch),
        showLabel: true,
    }, {
        id: "alu-to-writeSrc",
        label: "ALU result",
        kind: "data",
        points: [[5.5, 4.6], [6.0, 4.6], [6.0, 3.4], [11.45, 3.4], [11.45, 4.15]],
        description: "The ALU result can be written back to the register file.",
        active: sim => writesBack(sim, 0),
        value: sim => hex(sim.alu.result),
        showLabel: true,
    }, {
        id: "dataMem-to-writeSrc",
        label: "read data",
        kind: "data",
        points: [[9.5, 6.4], [10.2, 6.4], [10.2, 5.7], [11.0, 5.7]],
        description: "Loaded data is written back to the register file.",
        active: sim => writesBack(sim, 1),
        value: sim => hex(sim.dataMem.readData),
        showLabel: true,
    }, {
        id: "pcAdd4-to-writeSrc",
        label: "PC + 4",
        kind: "write",
        points: [[-16.4, 4.8], [-16.4, -4.4], [12.3, -4.4], [12.3, 4.15]],
        description: "jal and jalr save PC + 4 as the return address.",
        active: sim => writesBack(sim, 2),
        value: sim => hex(sim.pcAdd4.result),
    }, {
        id: "auipc-to-writeSrc",
        label: "AUIPC",
        kind: "write",
        points: [[1.3, -2.8], [11.4, -2.8], [11.4, 4.15]],
        description: "auipc writes PC + upper immediate into the register file.",
        active: sim => writesBack(sim, 3),
        value: sim => hex(sim.auipcAdder.result),
    }, {
        id: "pc-to-auipcAdder",
        label: "",
        kind: "data",
        points: [[-13.9, 7.4], [-14.3, 7.4], [-14.3, -3.0], [-1.7, -3.0]],
        description: "auipc adds the PC to the shifted immediate.",
        active: sim => writesBack(sim, 3),
        value: sim => hex(sim.pc.out),
    }, {
        id: "imm-to-auipcAdder",
        label: "",
        kind: "data",
        points: [[-9.8, 0.1], [-9.8, -2.4], [-1.7, -2.4]],
        description: "The immediate generator supplies the upper immediate for auipc.",
        active: sim => writesBack(sim, 3),
        value: sim => hex(sim.immGen.immediate),
    }, {
        id: "writeSrc-to-regFile",
        label: "write data",
        kind: "write",
        points: [[11.9, 6.65], [11.9, 12.35], [-2.2, 12.35], [-2.2, 5.0], [-2.45, 5.0]],
        description: "The selected write-back value returns to the register file.",
        active: sim => !!sim.control.regWrite,
        value: sim => hex(sim.writeSrcMux.out),
        showLabel: true,
    },
]

export function getProcessorNode(id: string): ProcessorNode | undefined {
    return processorNodes.find(n => n.id === id)
}

/**
 * Propagation stage (see PROPAGATION_STAGES) at which each component's inputs have settled.
 * Used to sequence the step animation in the order signals flow through the datapath.
 */
export const nodeStage: Record<string, PropagationStage> = {
    pc: 0, instrMem: 0, pcAdd4: 0,
    control: 1, aluControl: 1, immGen: 1,
    regFile: 2, aluInputMux: 2, jalrMux: 2,
    alu: 3, branchAdder: 3, auipcAdder: 3,
    dataMem: 4, jumpControl: 4,
    writeSrcMux: 5,
    pcMux: 6,
}

/** Propagation stage during which each wire carries its signal to its destination. */
export const wireStage: Record<string, PropagationStage> = {
    "pc-to-instr": 0, "pc-to-pcAdd4": 0,

    "instr-to-control": 1, "instr-to-aluControl": 1, "instr-to-regFile": 1, "instr-to-immGen": 1,
    "control-to-aluControl": 1, "control-to-regFile": 1, "control-to-aluSrc": 1, "control-to-jalr": 1,
    "control-to-jumpControl": 1, "control-to-mem": 1, "control-to-writeSrc": 1,

    "reg1-to-alu": 2, "reg2-to-mux": 2, "reg2-to-dataMem": 2, "imm-to-mux": 2, "reg1-to-jalrMux": 2, "pc-to-jalrMux": 2,
    "imm-to-branchAdder": 2, "pc-to-auipcAdder": 2, "imm-to-auipcAdder": 2, "aluControl-to-alu": 2,

    "mux-to-alu": 3, "jalrMux-to-branchAdder": 3,

    "alu-to-dataMem": 4, "alu-zero-to-jumpControl": 4,

    "alu-to-writeSrc": 5, "dataMem-to-writeSrc": 5, "pcAdd4-to-writeSrc": 5, "auipc-to-writeSrc": 5,
    "writeSrc-to-regFile": 5,

    "pcAdd4-to-pcMux": 6, "branchAdder-to-pcMux": 6, "jumpControl-to-pcMux": 6, "pcMux-to-pc": 6,
}

export const LAST_STAGE: PropagationStage = 6
