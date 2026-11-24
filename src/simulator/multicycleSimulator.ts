import { Bits, b, bits } from "utils/bits"
import {
    ALU, ALUControl, AuipcAdder, BranchAdder, Control, DataMemory, ImmGen, InstructionMemory,
    InstructionSplitter, JumpControl, RegisterFile,
} from "./components"
import type { ExecutionMetrics } from "./simulator"
import type { PipelineExecutionAnalysis } from "./pipelineSimulator"
import type { MemoryAccess } from "./components"

export interface ExecutionAnalysis {
    metrics: ExecutionMetrics
    completed: boolean
    memoryAccesses: MemoryAccess[]
}

export interface ImplementationComparison {
    singleCycle: ExecutionAnalysis
    multiCycle: ExecutionAnalysis
    pipeline: PipelineExecutionAnalysis
}

export const STAGE_DELAYS_PS = {
    fetch: 180,
    decode: 120,
    execute: 180,
    memory: 220,
    writeback: 80,
} as const

export const SINGLE_CYCLE_CLOCK_PERIOD_PS =
    STAGE_DELAYS_PS.fetch + STAGE_DELAYS_PS.decode + STAGE_DELAYS_PS.execute +
    STAGE_DELAYS_PS.memory + STAGE_DELAYS_PS.writeback
export const MULTICYCLE_CLOCK_PERIOD_PS = Math.max(...Object.values(STAGE_DELAYS_PS))
export const PIPELINE_CLOCK_PERIOD_PS = MULTICYCLE_CLOCK_PERIOD_PS

type Phase = "fetch" | "decode" | "execute" | "memory" | "writeback" | "done"

const TEXT_START = 0n

function emptyMetrics(): ExecutionMetrics {
    return {
        instructions: 0,
        cycles: 0,
        conditionalBranches: 0,
        branchesTaken: 0,
        branchesNotTaken: 0,
    }
}

/** A five-phase multi-cycle CPU model. Each tick advances exactly one clock cycle. */
export class MulticycleSimulator {
    public readonly metrics = emptyMetrics()
    public readonly instrMem = new InstructionMemory()
    public readonly instrSplit = new InstructionSplitter()
    public readonly dataMem = new DataMemory()
    public readonly regFile = new RegisterFile()
    public readonly control = new Control()
    public readonly immGen = new ImmGen()
    public readonly aluControl = new ALUControl()
    public readonly alu = new ALU()
    public readonly pcAdd4 = new ALU()
    public readonly branchAdder = new BranchAdder()
    public readonly jumpControl = new JumpControl()
    public readonly auipcAdder = new AuipcAdder()
    public readonly code: bigint[]

    public pc = TEXT_START

    private phase: Phase = "fetch"
    private instructionPC = TEXT_START
    private pcPlus4 = bits(0n, 32)
    private branchTarget = bits(0n, 32)
    private operand2 = bits(0n, 32)
    private aluResult = bits(0n, 32)
    private loadResult = bits(0n, 32)
    private effectiveAddress = bits(0n, 32)
    private auipcResult = bits(0n, 32)

    constructor(code: bigint[] = [], regs: Record<number, bigint> = {}) {
        this.code = [...code]
        this.instrMem.data.storeArray(TEXT_START, 4, this.code)
        this.regFile.registers[2] = 0xBFFFFFF0n
        this.regFile.registers[3] = 0x10008000n
        this.setRegisters(regs)
        this.regFile.regWrite = 0
    }

    setRegisters(regs: Record<number, bigint>) {
        for (const [reg, value] of Object.entries(regs)) {
            if (value < 0n) throw Error("setRegisters() expects unsigned integers.")
            if (reg == "0" && value != 0n) throw Error("Can't set zero register.")
            this.regFile.registers[+reg] = value
        }
    }

    setMemory(values: bigint[], wordBytes: number) {
        this.dataMem.data.storeArray(0n, wordBytes, values)
    }

    isDone(): boolean {
        return this.phase == "done" ||
            (this.phase == "fetch" && (this.pc - TEXT_START) / 4n >= BigInt(this.code.length))
    }

    /** Advances one multi-cycle clock. Returns false when no further cycle is required. */
    tick(): boolean {
        if (this.isDone()) {
            this.phase = "done"
            return false
        }

        switch (this.phase) {
            case "fetch":
                this.fetch()
                break
            case "decode":
                this.decode()
                break
            case "execute":
                this.execute()
                break
            case "memory":
                this.accessMemory()
                break
            case "writeback":
                this.writeBack(this.getWritebackValue())
                this.completeInstruction()
                break
        }

        this.metrics.cycles++
        return true
    }

    /** Runs up to `instructionLimit` completed instructions; returns whether the program finished. */
    run(instructionLimit = 20_000): boolean {
        while (!this.isDone() && this.metrics.instructions < instructionLimit) this.tick()
        return this.isDone()
    }

    private fetch() {
        this.instructionPC = bits(this.pc, 32).toInt()
        this.instrMem.address = bits(this.instructionPC, 32)
        this.instrMem.tick()
        this.instrSplit.instruction = this.instrMem.instruction
        this.instrSplit.tick()

        this.pcAdd4.aluControl = b`0010`
        this.pcAdd4.in1 = bits(this.instructionPC, 32)
        this.pcAdd4.in2 = bits(4n, 32)
        this.pcAdd4.tick()
        this.pcPlus4 = this.pcAdd4.result
        this.phase = "decode"
    }

    private decode() {
        this.control.opCode = this.instrSplit.opCode
        this.control.funct3 = this.instrSplit.funct3
        this.control.instruction = this.instrMem.instruction
        this.control.tick()

        this.regFile.regWrite = 0
        this.regFile.readReg1 = this.instrSplit.rs1
        this.regFile.readReg2 = this.instrSplit.rs2
        this.regFile.tick()

        this.immGen.instruction = this.instrMem.instruction
        this.immGen.tick()

        this.aluControl.aluOp = this.control.aluOp
        this.aluControl.funct3 = this.instrSplit.funct3
        this.aluControl.funct7 = this.instrSplit.funct7
        this.aluControl.tick()

        const hasExecuteWork = this.control.regWrite || this.control.memRead || this.control.memWrite ||
            this.control.branchZero || this.control.branchNotZero || this.control.jump
        if (hasExecuteWork) {
            this.phase = "execute"
        } else {
            this.completeInstruction()
        }
    }

    private execute() {
        this.alu.in1 = this.regFile.readData1
        this.alu.in2 = this.control.aluSrc ? this.immGen.immediate : this.regFile.readData2
        this.alu.aluControl = this.aluControl.aluControl
        this.alu.tick()
        this.aluResult = this.alu.result

        this.auipcAdder.pc = bits(this.instructionPC, 32)
        this.auipcAdder.imm = this.immGen.immediate
        this.auipcAdder.tick()
        this.auipcResult = this.auipcAdder.result

        this.branchAdder.in1 = this.control.jalr ? this.regFile.readData1 : bits(this.instructionPC, 32)
        this.branchAdder.in2 = this.immGen.immediate
        this.branchAdder.tick()
        this.branchTarget = this.branchAdder.result

        if (this.control.branchZero || this.control.branchNotZero) {
            this.jumpControl.branchZero = this.control.branchZero
            this.jumpControl.branchNotZero = this.control.branchNotZero
            this.jumpControl.jump = 0
            this.jumpControl.zero = this.alu.zero
            this.jumpControl.tick()
            this.metrics.conditionalBranches++
            if (this.jumpControl.takeBranch) this.metrics.branchesTaken++
            else this.metrics.branchesNotTaken++
            this.completeInstruction(this.jumpControl.takeBranch ? this.branchTarget : this.pcPlus4)
        } else if (this.control.jump) {
            if (this.control.regWrite) this.writeBack(this.pcPlus4)
            this.completeInstruction(this.branchTarget)
        } else if (this.control.memRead || this.control.memWrite) {
            this.effectiveAddress = this.aluResult
            this.operand2 = this.regFile.readData2
            this.phase = "memory"
        } else if (this.control.regWrite) {
            this.phase = "writeback"
        } else {
            this.completeInstruction()
        }
    }

    private accessMemory() {
        this.dataMem.address = this.effectiveAddress
        this.dataMem.writeData = this.operand2
        this.dataMem.memRead = this.control.memRead
        this.dataMem.memWrite = this.control.memWrite
        this.dataMem.signed = this.control.memSigned
        this.dataMem.size = this.control.memSize
        this.dataMem.tick()

        if (this.control.memRead) {
            this.loadResult = this.dataMem.readData
            this.phase = "writeback"
        } else {
            this.completeInstruction()
        }
    }

    private writeBack(value: Bits) {
        this.regFile.regWrite = 1
        this.regFile.writeReg = this.instrSplit.rd
        this.regFile.writeData = value
        this.regFile.tick()
        this.regFile.regWrite = 0
    }

    private getWritebackValue(): Bits {
        switch (this.control.writeSrc.toNumber()) {
            case 1: return this.loadResult
            case 2: return this.pcPlus4
            case 3: return this.auipcResult
            default: return this.aluResult
        }
    }

    private completeInstruction(nextPC = this.pcPlus4) {
        this.pc = nextPC.toInt()
        this.metrics.instructions++
        this.phase = "fetch"
    }
}

export function analyzeMulticycle(
    code: bigint[],
    regs: Record<number, bigint>,
    memory: bigint[],
    memoryWordBytes: number,
    instructionLimit: number,
): ExecutionAnalysis {
    const sim = new MulticycleSimulator(code, regs)
    sim.setMemory(memory, memoryWordBytes)
    return {
        completed: sim.run(instructionLimit),
        metrics: { ...sim.metrics },
        memoryAccesses: [...sim.dataMem.accessLog],
    }
}
