import { expect } from "chai"
import { assemble } from "assembler/assembler"
import { analyzePipeline, PipelineSimulator } from "simulator/pipelineSimulator"
import { Simulator } from "simulator/simulator"

function runBoth(code: string, registers: Record<number, bigint> = {}, memory: bigint[] = []) {
    const instructions = assemble(code)
    const single = new Simulator(instructions, registers)
    single.dataMem.data.storeArray(0n, 4, memory)
    const pipeline = new PipelineSimulator(instructions, registers)
    pipeline.setMemory(memory, 4)
    expect(pipeline.run()).to.equal(true)
    single.run()
    expect(pipeline.regFile.registers).to.deep.equal(single.regFile.registers)
    expect(pipeline.dataMem.data.toString(4)).to.equal(single.dataMem.data.toString(4))
    return { single, pipeline }
}

describe("Five-stage pipeline CPU", () => {
    it("forwards dependent ALU results and retires every instruction", () => {
        const { pipeline } = runBoth(`
            addi x5, zero, 7
            add x6, x5, x5
            addi x7, x6, 3
            sub x8, x7, x5
        `)
        expect(pipeline.regFile.registers.slice(5, 9)).to.deep.equal([7n, 14n, 17n, 10n])
        expect(pipeline.metrics.instructions).to.equal(4)
        expect(pipeline.metrics.cycles).to.equal(8)
        expect(pipeline.metrics.dataForwardings).to.be.greaterThan(0)
        expect(pipeline.metrics.loadUseStalls).to.equal(0)
    })

    it("inserts one load-use bubble and forwards the loaded value", () => {
        const { pipeline } = runBoth(`
            lw x5, 0(zero)
            addi x6, x5, 1
            add x7, x6, x5
        `, {}, [41n])
        expect(pipeline.regFile.registers[6]).to.equal(42n)
        expect(pipeline.regFile.registers[7]).to.equal(83n)
        expect(pipeline.metrics.loadUseStalls).to.equal(1)
        expect(pipeline.metrics.instructions).to.equal(3)
    })

    it("forwards store data and preserves load/store behavior", () => {
        const { pipeline } = runBoth(`
            addi x5, zero, 0x7f
            sw x5, 0(zero)
            lw x6, 0(zero)
            popcnt x7, x6
        `)
        expect(pipeline.dataMem.data.loadWord(0n)).to.equal(0x7fn)
        expect(pipeline.regFile.registers[6]).to.equal(0x7fn)
        expect(pipeline.regFile.registers[7]).to.equal(7n)
    })

    it("resolves taken branches in execute and flushes wrong-path instructions", () => {
        const { pipeline } = runBoth(`
            addi x5, zero, 1
            beq x5, x5, target
            addi x6, zero, 99
            sw x6, 0(zero)
            target: addi x7, x5, 4
        `)
        expect(pipeline.regFile.registers[6]).to.equal(0n)
        expect(pipeline.regFile.registers[7]).to.equal(5n)
        expect(pipeline.dataMem.data.loadWord(0n)).to.equal(0n)
        expect(pipeline.metrics.branchesTaken).to.equal(1)
        expect(pipeline.metrics.controlHazards).to.equal(1)
        expect(pipeline.metrics.flushedInstructions).to.be.greaterThan(0)
    })

    it("handles untaken branches, jumps, LUI, AUIPC, and the custom instruction", () => {
        const { pipeline } = runBoth(`
            lui x5, 1
            auipc x6, 1
            addi x7, zero, 2
            bne x7, x7, skipped
            jal x8, target
            addi x9, zero, 99
            skipped: addi x10, zero, 99
            target: popcnt x11, x5
        `)
        expect(pipeline.regFile.registers[5]).to.equal(0x1000n)
        expect(pipeline.regFile.registers[6]).to.equal(0x1004n)
        expect(pipeline.regFile.registers[9]).to.equal(0n)
        expect(pipeline.regFile.registers[10]).to.equal(0n)
        expect(pipeline.regFile.registers[11]).to.equal(1n)
        expect(pipeline.metrics.branchesNotTaken).to.equal(1)
    })

    it("stops a non-terminating program at its retirement limit", () => {
        const pipeline = new PipelineSimulator(assemble("loop: jal zero, loop"))
        expect(pipeline.run(3)).to.equal(false)
        expect(pipeline.metrics.instructions).to.equal(3)
    })

    it("analyzes the same initial registers and memory as the other CPU models", () => {
        const analysis = analyzePipeline(
            assemble("lw x5, 0(zero)\naddi x6, x5, 1"),
            { 10: 12n },
            [41n],
            4,
            100,
        )
        expect(analysis.completed).to.equal(true)
        expect(analysis.metrics.instructions).to.equal(2)
        expect(analysis.metrics.loadUseStalls).to.equal(1)
        expect(analysis.metrics.cycles).to.equal(7)
    })
})
