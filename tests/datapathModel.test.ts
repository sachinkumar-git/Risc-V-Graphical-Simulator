import { expect } from "chai"
import { assemble } from "assembler/assembler"
import { Simulator } from "simulator/simulator"
import { decodeInstruction, explainInstruction, nodeRole } from "ui/instructionInfo"
import { nodeStage, processorNodes, processorWires, wireStage } from "ui/three/processorModel"

/**
 * The 3D datapath highlights wires and components from the simulator's real signals.
 * These tests pin down which paths each instruction class lights up, so the visualisation
 * cannot silently drift from what the single-cycle datapath actually does.
 */

/** Runs the first instruction of `code` and returns the simulator mid-instruction. */
function execute(code: string, regs: Record<number, bigint> = {}): Simulator {
    const sim = new Simulator(assemble(code), regs)
    sim.tick()
    return sim
}

const activeWires = (sim: Simulator) => processorWires.filter(w => w.active(sim)).map(w => w.id).sort()
const activeNodes = (sim: Simulator) => new Set(processorNodes.filter(n => n.active(sim)).map(n => n.id))

// Paths every instruction uses: fetch, decode and latching the next PC.
const FETCH_DECODE = ["pc-to-instr", "pc-to-pcAdd4", "instr-to-control", "instr-to-aluControl", "instr-to-regFile", "pcMux-to-pc"]
const SEQUENTIAL = [...FETCH_DECODE, "pcAdd4-to-pcMux"]
const TAKEN = [...FETCH_DECODE, "jumpControl-to-pcMux", "branchAdder-to-pcMux"]

const writeBack = (source: string) => ["control-to-regFile", "control-to-writeSrc", "writeSrc-to-regFile", source]
const ALU_REG_REG = ["control-to-aluControl", "aluControl-to-alu", "reg1-to-alu", "reg2-to-mux", "mux-to-alu"]
const ALU_REG_IMM = ["control-to-aluControl", "aluControl-to-alu", "reg1-to-alu", "instr-to-immGen", "control-to-aluSrc", "imm-to-mux", "mux-to-alu"]
const BRANCH_TARGET = ["instr-to-immGen", "control-to-jumpControl", "jalrMux-to-branchAdder", "imm-to-branchAdder"]
const COMPARE = ["control-to-aluControl", "aluControl-to-alu", "reg1-to-alu", "reg2-to-mux", "mux-to-alu", "alu-zero-to-jumpControl"]

const sorted = (ids: string[]) => [...new Set(ids)].sort()

describe("3D datapath model", () => {
    it("assigns a propagation stage to every component and wire", () => {
        for (const node of processorNodes) expect(nodeStage[node.id], node.id).to.be.a("number")
        for (const wire of processorWires) expect(wireStage[wire.id], wire.id).to.be.a("number")
    })

    it("has unique ids", () => {
        const ids = [...processorNodes, ...processorWires].map(x => x.id)
        expect(new Set(ids).size).to.equal(ids.length)
    })

    it("R-type: add", () => {
        const sim = execute("add t0, t1, t2", { 6: 5n, 7: 3n })
        expect(activeWires(sim)).to.deep.equal(sorted([...SEQUENTIAL, ...ALU_REG_REG, ...writeBack("alu-to-writeSrc")]))
        const nodes = activeNodes(sim)
        expect(nodes.has("immGen")).to.be.false
        expect(nodes.has("dataMem")).to.be.false
        expect(nodes.has("alu")).to.be.true
    })

    it("R-type: and lights ALU control (ALU control code 0000)", () => {
        const sim = execute("and t0, t1, t2", { 6: 6n, 7: 3n })
        expect(activeNodes(sim).has("aluControl")).to.be.true
    })

    it("custom popcnt decodes as unary and lights only its source-register ALU path", () => {
        const sim = execute("popcnt t0, t1", { 6: 0xF0F0_F0F0n })
        const decoded = decodeInstruction(sim.instrMem.instruction, sim.immGen.immediate)
        expect(decoded.mnemonic).to.equal("popcnt")
        expect(decoded.format).to.equal("R-type (custom)")
        expect(decoded.assembly).to.equal("popcnt t0 (x5), t1 (x6)")
        expect(sim.alu.result.toInt()).to.equal(16n)
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...SEQUENTIAL, "control-to-aluControl", "aluControl-to-alu", "reg1-to-alu",
            ...writeBack("alu-to-writeSrc"),
        ]))
        expect(activeNodes(sim).has("aluInputMux")).to.be.false
        expect(nodeRole("aluInputMux", sim)).to.include("ignores operand 2")
        const execution = explainInstruction(sim).steps.find(step => step.title == "Execute")
        expect(execution?.text).to.include("counts the set bits")
        expect(execution?.text).not.to.include("and 0")
    })

    it("I-type: addi", () => {
        const sim = execute("addi t0, t1, 4", { 6: 5n })
        expect(activeWires(sim)).to.deep.equal(sorted([...SEQUENTIAL, ...ALU_REG_IMM, ...writeBack("alu-to-writeSrc")]))
    })

    it("load: lw", () => {
        const sim = execute("lw t0, 4(t1)", { 6: 0n })
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...SEQUENTIAL, ...ALU_REG_IMM, "control-to-mem", "alu-to-dataMem", ...writeBack("dataMem-to-writeSrc"),
        ]))
        expect(activeNodes(sim).has("dataMem")).to.be.true
    })

    it("store: sw carries rs2 to data memory and writes no register", () => {
        const sim = execute("sw t2, 4(t1)", { 6: 0n, 7: 42n })
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...SEQUENTIAL, ...ALU_REG_IMM, "control-to-mem", "alu-to-dataMem", "reg2-to-dataMem",
        ]))
        expect(activeNodes(sim).has("writeSrcMux")).to.be.false
    })

    it("branch taken: beq", () => {
        const sim = execute("beq t1, t2, target\naddi x0, x0, 0\ntarget: addi x0, x0, 0", { 6: 7n, 7: 7n })
        expect(sim.jumpControl.takeBranch).to.equal(1)
        expect(activeWires(sim)).to.deep.equal(sorted([...TAKEN, ...COMPARE, ...BRANCH_TARGET, "pc-to-jalrMux"]))
    })

    it("branch not taken: bne", () => {
        const sim = execute("bne t1, t2, target\naddi x0, x0, 0\ntarget: addi x0, x0, 0", { 6: 7n, 7: 7n })
        expect(sim.jumpControl.takeBranch).to.equal(0)
        expect(activeWires(sim)).to.deep.equal(sorted([...SEQUENTIAL, ...COMPARE, ...BRANCH_TARGET, "pc-to-jalrMux"]))
    })

    it("jump: jal saves PC + 4 and does not use the ALU", () => {
        const sim = execute("jal ra, target\naddi x0, x0, 0\ntarget: addi x0, x0, 0")
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...TAKEN, ...BRANCH_TARGET, "pc-to-jalrMux", ...writeBack("pcAdd4-to-writeSrc"),
        ]))
        expect(activeNodes(sim).has("alu")).to.be.false
    })

    it("jump: jalr uses rs1 as the base", () => {
        const sim = execute("jalr ra, 8(t1)", { 6: 0n })
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...TAKEN, ...BRANCH_TARGET, "control-to-jalr", "reg1-to-jalrMux", ...writeBack("pcAdd4-to-writeSrc"),
        ]))
    })

    it("lui: the ALU uses only the immediate", () => {
        const sim = execute("lui t0, 0x12345")
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...SEQUENTIAL, "control-to-aluControl", "aluControl-to-alu", "instr-to-immGen", "control-to-aluSrc",
            "imm-to-mux", "mux-to-alu", ...writeBack("alu-to-writeSrc"),
        ]))
    })

    it("auipc: uses the AUIPC adder, not the ALU", () => {
        const sim = execute("auipc t0, 0x1")
        expect(activeWires(sim)).to.deep.equal(sorted([
            ...SEQUENTIAL, "instr-to-immGen", "pc-to-auipcAdder", "imm-to-auipcAdder", ...writeBack("auipc-to-writeSrc"),
        ]))
        expect(activeNodes(sim).has("alu")).to.be.false
    })

    it("ecall: only fetch and decode", () => {
        const sim = execute("ecall")
        expect(activeWires(sim)).to.deep.equal(sorted(SEQUENTIAL))
    })
})
