import { Bits, bits } from "utils/bits"
import {
    ALU, ALUControl, AuipcAdder, BranchAdder, Control, DataMemory, ImmGen, InstructionMemory,
    InstructionSplitter, RegisterFile,
} from "./components"
import type { ExecutionMetrics } from "./simulator"
import type { MemoryAccess } from "./components"

export interface PipelineMetrics extends ExecutionMetrics {
    loadUseStalls: number
    dataForwardings: number
    controlHazards: number
    flushedInstructions: number
}

export interface PipelineExecutionAnalysis {
    metrics: PipelineMetrics
    completed: boolean
    memoryAccesses: MemoryAccess[]
}

interface InstructionFields {
    pc: bigint
    instruction: bigint
    rd: number
    rs1: number
    rs2: number
    usesRs1: boolean
    usesRs2: boolean
    immediate: Bits
    aluControl: Bits
    aluSrc: boolean
    writeSrc: number
    regWrite: boolean
    memRead: boolean
    memWrite: boolean
    memSigned: boolean
    memSize: Bits
    branchZero: boolean
    branchNotZero: boolean
    jump: boolean
    jalr: boolean
}

interface ExecuteMemoryRegister {
    fields: InstructionFields
    aluResult: Bits
    linkAddress: Bits
    auipcResult: Bits
    storeData: Bits
}

interface MemoryWritebackRegister {
    fields: InstructionFields
    value: Bits
}

export interface PipelineStageValue {
    pc: bigint
    instruction: bigint
}

export interface PipelineStages {
    ifId: PipelineStageValue | null
    idEx: PipelineStageValue | null
    exMem: PipelineStageValue | null
    memWb: PipelineStageValue | null
}

export interface PipelineCycleStages {
    if: PipelineStageValue | null
    id: PipelineStageValue | null
    ex: PipelineStageValue | null
    mem: PipelineStageValue | null
    wb: PipelineStageValue | null
}

const TEXT_START = 0n

function emptyMetrics(): PipelineMetrics {
    return {
        instructions: 0,
        cycles: 0,
        conditionalBranches: 0,
        branchesTaken: 0,
        branchesNotTaken: 0,
        loadUseStalls: 0,
        dataForwardings: 0,
        controlHazards: 0,
        flushedInstructions: 0,
    }
}

function stageValue(fields?: InstructionFields | null): PipelineStageValue | null {
    return fields ? { pc: fields.pc, instruction: fields.instruction } : null
}

/**
 * In-order five-stage pipeline: IF, ID, EX, MEM, and WB. Branches resolve in EX,
 * ALU results forward from EX/MEM and MEM/WB, and load-use dependencies stall once.
 */
export class PipelineSimulator {
    public readonly metrics = emptyMetrics()
    public readonly instrMem = new InstructionMemory()
    public readonly instrSplit = new InstructionSplitter()
    public readonly dataMem = new DataMemory()
    public readonly regFile = new RegisterFile()
    public readonly control = new Control()
    public readonly immGen = new ImmGen()
    public readonly aluControl = new ALUControl()
    public readonly alu = new ALU()
    public readonly auipcAdder = new AuipcAdder()
    public readonly branchAdder = new BranchAdder()
    public readonly code: bigint[]

    public pc = TEXT_START
    public stages: PipelineStages = { ifId: null, idEx: null, exMem: null, memWb: null }
    public cycleStages: PipelineCycleStages = { if: null, id: null, ex: null, mem: null, wb: null }
    public cycleEvents: string[] = []

    private ifId: { pc: bigint, instruction: bigint } | null = null
    private idEx: InstructionFields | null = null
    private exMem: ExecuteMemoryRegister | null = null
    private memWb: MemoryWritebackRegister | null = null

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
        return (this.pc - TEXT_START) / 4n >= BigInt(this.code.length) &&
            this.ifId === null && this.idEx === null && this.exMem === null && this.memWb === null
    }

    /** Advances one clock cycle. Returns false only after the pipeline has drained. */
    tick(): boolean {
        if (this.isDone()) return false

        const oldIfId = this.ifId
        const oldIdEx = this.idEx
        const oldExMem = this.exMem
        const oldMemWb = this.memWb
        const forwardingCountBefore = this.metrics.dataForwardings

        if (oldMemWb?.fields.regWrite) {
            this.writeRegister(oldMemWb.fields.rd, oldMemWb.value)
            this.metrics.instructions++
        } else if (oldMemWb) {
            this.metrics.instructions++
        }

        let nextMemWb: MemoryWritebackRegister | null = null
        if (oldExMem) {
            const { fields } = oldExMem
            let value = this.writebackValue(oldExMem)
            if (fields.memRead || fields.memWrite) {
                this.dataMem.address = oldExMem.aluResult
                this.dataMem.writeData = oldExMem.storeData
                this.dataMem.memRead = Number(fields.memRead) as 0 | 1
                this.dataMem.memWrite = Number(fields.memWrite) as 0 | 1
                this.dataMem.signed = Number(fields.memSigned) as 0 | 1
                this.dataMem.size = fields.memSize
                this.dataMem.tick()
                if (fields.memRead) value = this.dataMem.readData
            }
            nextMemWb = { fields, value }
        }

        let nextExMem: ExecuteMemoryRegister | null = null
        let redirectPC: bigint | null = null
        if (oldIdEx) {
            const rs1Value = oldIdEx.usesRs1
                ? this.forward(oldIdEx.rs1, oldIdEx, oldExMem, oldMemWb, 1)
                : bits(0n, 32)
            const rs2Value = oldIdEx.usesRs2
                ? this.forward(oldIdEx.rs2, oldIdEx, oldExMem, oldMemWb, 2)
                : bits(0n, 32)
            const aluInput2 = oldIdEx.aluSrc ? oldIdEx.immediate : rs2Value

            this.alu.in1 = rs1Value
            this.alu.in2 = aluInput2
            this.alu.aluControl = oldIdEx.aluControl
            this.alu.tick()

            this.auipcAdder.pc = bits(oldIdEx.pc, 32)
            this.auipcAdder.imm = oldIdEx.immediate
            this.auipcAdder.tick()

            let branchTargetBase = oldIdEx.pc
            if (oldIdEx.jalr) branchTargetBase = rs1Value.toInt()
            this.branchAdder.in1 = bits(branchTargetBase, 32)
            this.branchAdder.in2 = oldIdEx.immediate
            this.branchAdder.tick()

            const isConditionalBranch = oldIdEx.branchZero || oldIdEx.branchNotZero
            const taken = oldIdEx.jump || (oldIdEx.branchZero && this.alu.zero) ||
                (oldIdEx.branchNotZero && !this.alu.zero)
            if (isConditionalBranch) {
                this.metrics.conditionalBranches++
                if (taken) this.metrics.branchesTaken++
                else this.metrics.branchesNotTaken++
            }
            if (taken) {
                redirectPC = this.branchAdder.result.toInt()
                this.metrics.controlHazards++
            }

            const linkAddress = bits(oldIdEx.pc + 4n, 32)
            const auipcResult = this.auipcAdder.result
            const result = oldIdEx.writeSrc == 3 ? auipcResult : this.alu.result
            nextExMem = {
                fields: oldIdEx,
                aluResult: result,
                linkAddress,
                auipcResult,
                storeData: rs2Value,
            }
        }

        const loadUseHazard = !!(oldIdEx?.memRead && oldIfId &&
            oldIdEx.rd != 0 && this.usesRegister(oldIfId.instruction, oldIdEx.rd))

        let nextIdEx: InstructionFields | null = null
        if (!redirectPC && !loadUseHazard && oldIfId) {
            nextIdEx = this.decode(oldIfId)
        }

        let nextIfId: { pc: bigint, instruction: bigint } | null = null
        let fetched: { pc: bigint, instruction: bigint } | null = null
        if (redirectPC !== null) {
            this.metrics.flushedInstructions += Number(!!oldIfId) + Number(this.hasInstructionAt(this.pc))
            this.pc = redirectPC
        } else if (loadUseHazard) {
            this.metrics.loadUseStalls++
            nextIfId = oldIfId
        } else {
            fetched = this.fetch()
            nextIfId = fetched
        }

        this.ifId = nextIfId
        this.idEx = nextIdEx
        this.exMem = nextExMem
        this.memWb = nextMemWb
        this.stages = {
            ifId: nextIfId ? { pc: nextIfId.pc, instruction: nextIfId.instruction } : null,
            idEx: stageValue(nextIdEx),
            exMem: nextExMem ? { pc: nextExMem.fields.pc, instruction: nextExMem.fields.instruction } : null,
            memWb: nextMemWb ? { pc: nextMemWb.fields.pc, instruction: nextMemWb.fields.instruction } : null,
        }
        this.cycleStages = {
            if: fetched,
            id: oldIfId,
            ex: stageValue(oldIdEx),
            mem: oldExMem ? { pc: oldExMem.fields.pc, instruction: oldExMem.fields.instruction } : null,
            wb: oldMemWb ? { pc: oldMemWb.fields.pc, instruction: oldMemWb.fields.instruction } : null,
        }
        this.cycleEvents = []
        if (loadUseHazard) this.cycleEvents.push("Load-use stall")
        if (redirectPC !== null) this.cycleEvents.push("Taken branch/jump; younger instruction(s) flushed")
        if (this.metrics.dataForwardings > forwardingCountBefore) this.cycleEvents.push("Data forwarded")
        this.metrics.cycles++
        return true
    }

    /** Runs until the pipeline drains or the requested number of instructions retires. */
    run(instructionLimit = 20_000): boolean {
        while (!this.isDone() && this.metrics.instructions < instructionLimit) this.tick()
        return this.isDone()
    }

    private fetch(): { pc: bigint, instruction: bigint } | null {
        if (!this.hasInstructionAt(this.pc)) return null
        const pc = this.pc
        this.instrMem.address = bits(pc, 32)
        this.instrMem.tick()
        const instruction = this.instrMem.instruction.toInt()
        this.pc = bits(pc + 4n, 32).toInt()
        return { pc, instruction }
    }

    private hasInstructionAt(pc: bigint): boolean {
        return pc >= TEXT_START && (pc - TEXT_START) / 4n < BigInt(this.code.length)
    }

    private decode(input: { pc: bigint, instruction: bigint }): InstructionFields {
        const instruction = bits(input.instruction, 32)
        this.instrSplit.instruction = instruction
        this.instrSplit.tick()

        this.control.opCode = this.instrSplit.opCode
        this.control.funct3 = this.instrSplit.funct3
        this.control.instruction = instruction
        this.control.tick()

        this.aluControl.aluOp = this.control.aluOp
        this.aluControl.funct3 = this.instrSplit.funct3
        this.aluControl.funct7 = this.instrSplit.funct7
        this.aluControl.tick()

        this.immGen.instruction = instruction
        this.immGen.tick()

        this.regFile.readReg1 = this.instrSplit.rs1
        this.regFile.readReg2 = this.instrSplit.rs2
        this.regFile.tick()

        return {
            pc: input.pc,
            instruction: input.instruction,
            rd: this.instrSplit.rd.toNumber(),
            rs1: this.instrSplit.rs1.toNumber(),
            rs2: this.instrSplit.rs2.toNumber(),
            usesRs1: this.usesRegister(input.instruction, this.instrSplit.rs1.toNumber()),
            usesRs2: this.usesRegisterAsSecondSource(input.instruction),
            immediate: this.immGen.immediate,
            aluControl: this.aluControl.aluControl,
            aluSrc: !!this.control.aluSrc,
            writeSrc: this.control.writeSrc.toNumber(),
            regWrite: !!this.control.regWrite,
            memRead: !!this.control.memRead,
            memWrite: !!this.control.memWrite,
            memSigned: !!this.control.memSigned,
            memSize: this.control.memSize,
            branchZero: !!this.control.branchZero,
            branchNotZero: !!this.control.branchNotZero,
            jump: !!this.control.jump,
            jalr: !!this.control.jalr,
        }
    }

    private usesRegister(instruction: bigint, register: number): boolean {
        const bitsValue = bits(instruction, 32)
        const opcode = bitsValue.slice(0, 7).toNumber()
        const rs1 = bitsValue.slice(15, 20).toNumber()
        const rs2 = bitsValue.slice(20, 25).toNumber()
        const usesRs1 = opcode == 0b0110011 || opcode == 0b0010011 || opcode == 0b0000011 ||
            opcode == 0b0100011 || opcode == 0b1100011 || opcode == 0b1100111 || opcode == 0b0001011
        const usesRs2 = this.usesRegisterAsSecondSource(instruction)
        return (usesRs1 && rs1 == register) || (usesRs2 && rs2 == register)
    }

    private usesRegisterAsSecondSource(instruction: bigint): boolean {
        const opcode = bits(instruction, 32).slice(0, 7).toNumber()
        return opcode == 0b0110011 || opcode == 0b0100011 || opcode == 0b1100011
    }

    private forward(
        register: number,
        consumer: InstructionFields,
        exMem: ExecuteMemoryRegister | null,
        memWb: MemoryWritebackRegister | null,
        operand: 1 | 2,
    ): Bits {
        if (register == 0) return bits(0n, 32)
        if (exMem?.fields.regWrite && !exMem.fields.memRead && exMem.fields.rd == register) {
            this.metrics.dataForwardings++
            return this.writebackValue(exMem)
        }
        if (memWb?.fields.regWrite && memWb.fields.rd == register) {
            this.metrics.dataForwardings++
            return memWb.value
        }
        const value = operand == 1
            ? this.regFile.registers[consumer.rs1]
            : this.regFile.registers[consumer.rs2]
        return bits(value, 32)
    }

    private writebackValue(register: ExecuteMemoryRegister): Bits {
        switch (register.fields.writeSrc) {
            case 1:
                return this.dataMem.readData
            case 2:
                return register.linkAddress
            case 3:
                return register.auipcResult
            default:
                return register.aluResult
        }
    }

    private writeRegister(register: number, value: Bits) {
        this.regFile.regWrite = 1
        this.regFile.writeReg = bits(BigInt(register), 5)
        this.regFile.writeData = value
        this.regFile.tick()
        this.regFile.regWrite = 0
    }
}

export function analyzePipeline(
    code: bigint[],
    regs: Record<number, bigint>,
    memory: bigint[],
    memoryWordBytes: number,
    instructionLimit: number,
): PipelineExecutionAnalysis {
    const sim = new PipelineSimulator(code, regs)
    sim.setMemory(memory, memoryWordBytes)
    return {
        completed: sim.run(instructionLimit),
        metrics: { ...sim.metrics },
        memoryAccesses: [...sim.dataMem.accessLog],
    }
}
