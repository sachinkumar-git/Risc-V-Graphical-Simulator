import { expect } from "chai"
import { assemble } from "assembler/assembler"
import { MulticycleSimulator, MULTICYCLE_CLOCK_PERIOD_PS, SINGLE_CYCLE_CLOCK_PERIOD_PS } from "simulator/multicycleSimulator"
import { Simulator } from "simulator/simulator"

function runBoth(code: string) {
    const instructions = assemble(code)
    const single = new Simulator(instructions)
    const multi = new MulticycleSimulator(instructions)
    single.run()
    expect(multi.run()).to.equal(true)
    expect(multi.regFile.registers).to.deep.equal(single.regFile.registers)
    return { single, multi }
}

describe("Multi-cycle CPU", () => {
    it("uses four cycles for ALU instructions, while preserving architectural results", () => {
        const { single, multi } = runBoth("addi x5, zero, 7\nadd x6, x5, x5")
        expect(single.metrics.cycles).to.equal(2)
        expect(multi.metrics.instructions).to.equal(2)
        expect(multi.metrics.cycles).to.equal(8)
        expect(multi.regFile.registers[6]).to.equal(14n)
    })

    it("runs the custom popcnt operation through the multi-cycle ALU path", () => {
        const multi = new MulticycleSimulator(assemble("popcnt x5, x6"), { 6: 0xFFFF_FFFFn })
        expect(multi.run()).to.equal(true)
        expect(multi.metrics.cycles).to.equal(4)
        expect(multi.regFile.registers[5]).to.equal(32n)
    })

    it("models load/store and branch phases and matches their results", () => {
        const code = `
            addi x5, zero, 1
            beq x5, x5, target
            addi x6, zero, 99
            target: sw x5, 0(zero)
            lw x7, 0(zero)
            popcnt x8, x7
        `
        const { single, multi } = runBoth(code)
        expect(multi.metrics.instructions).to.equal(5)
        expect(multi.metrics.cycles).to.equal(20)
        expect(multi.metrics.branchesTaken).to.equal(1)
        expect(multi.metrics.branchesNotTaken).to.equal(0)
        expect(multi.regFile.registers[6]).to.equal(0n)
        expect(multi.regFile.registers[8]).to.equal(1n)
        expect(multi.dataMem.data.loadWord(0n)).to.equal(1n)
        expect(multi.dataMem.data.toString(4)).to.equal(single.dataMem.data.toString(4))
    })

    it("handles untaken branches and both jump forms", () => {
        const branch = runBoth("bne zero, zero, skip\naddi x5, zero, 1\nskip: addi x6, zero, 2")
        expect(branch.multi.metrics.cycles).to.equal(11)
        expect(branch.multi.metrics.branchesNotTaken).to.equal(1)

        const jal = runBoth("jal x5, target\naddi x6, zero, 99\ntarget: addi x7, x5, 0")
        expect(jal.multi.metrics.cycles).to.equal(7)
        expect(jal.multi.regFile.registers[5]).to.equal(4n)
        expect(jal.multi.regFile.registers[7]).to.equal(4n)

        const jalr = runBoth("addi x5, zero, 12\njalr x6, 0(x5)\naddi x7, zero, 99\naddi x7, x6, 0")
        expect(jalr.multi.metrics.cycles).to.equal(11)
        expect(jalr.multi.regFile.registers[6]).to.equal(8n)
        expect(jalr.multi.regFile.registers[7]).to.equal(8n)
    })

    it("writes LUI and AUIPC results in the write-back phase", () => {
        const { multi } = runBoth("lui x5, 0x12345\nauipc x6, 1")
        expect(multi.metrics.cycles).to.equal(8)
        expect(multi.regFile.registers[5]).to.equal(0x12345000n)
        expect(multi.regFile.registers[6]).to.equal(0x1004n)
    })

    it("bounds non-terminating programs by retired instructions", () => {
        const multi = new MulticycleSimulator(assemble("loop: jal zero, loop"))
        expect(multi.run(3)).to.equal(false)
        expect(multi.metrics.instructions).to.equal(3)
        expect(multi.metrics.cycles).to.equal(9)
    })

    it("uses the slowest stage for the multicycle period and the full path for single-cycle", () => {
        expect(SINGLE_CYCLE_CLOCK_PERIOD_PS).to.equal(780)
        expect(MULTICYCLE_CLOCK_PERIOD_PS).to.equal(220)
        expect(MULTICYCLE_CLOCK_PERIOD_PS).to.be.lessThan(SINGLE_CYCLE_CLOCK_PERIOD_PS)
    })
})
