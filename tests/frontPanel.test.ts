import { expect } from "chai"
import { assemble } from "assembler/assembler"
import { Simulator } from "simulator/simulator"
import { formatFrontPanelHex, readFrontPanelState } from "ui/frontPanelState"

describe("Front panel state", () => {
    it("formats values as eight hexadecimal digits", () => {
        expect(formatFrontPanelHex(0n)).to.equal("00000000")
        expect(formatFrontPanelHex(0xABCDEF12n)).to.equal("ABCDEF12")
        expect(formatFrontPanelHex(-1n)).to.equal("FFFFFFFF")
    })

    it("reads current datapath values and register selection", () => {
        const sim = new Simulator(assemble("addi x5, x6, 3"), { 6: 0xA5n })
        sim.tick()

        const state = readFrontPanelState(sim, 6)

        expect(state.pc).to.equal(0n)
        expect(state.instruction).to.equal(sim.instrMem.instruction.toInt())
        expect(state.aluResult).to.equal(0xA8n)
        expect(state.registerIndex).to.equal(6)
        expect(state.registerValue).to.equal(0xA5n)
        expect(state.leds).to.deep.equal({
            registerWrite: true,
            memoryRead: false,
            memoryWrite: false,
            branchTaken: false,
            aluZero: false,
        })
    })

    it("reports branch and zero LEDs from the branch decision", () => {
        const sim = new Simulator(assemble("beq x5, x6, target\ntarget: addi x0, x0, 0"), { 5: 7n, 6: 7n })
        sim.tick()

        const state = readFrontPanelState(sim, 0)

        expect(state.leds.branchTaken).to.equal(true)
        expect(state.leds.aluZero).to.equal(true)
        expect(state.leds.registerWrite).to.equal(false)
    })

    it("reports memory and not-taken branch LEDs from their control signals", () => {
        const loadSim = new Simulator(assemble("lw x5, 0(x6)"), { 6: 0n })
        loadSim.tick()
        expect(readFrontPanelState(loadSim, 5).leds).to.deep.equal({
            registerWrite: true,
            memoryRead: true,
            memoryWrite: false,
            branchTaken: false,
            aluZero: true,
        })

        const storeSim = new Simulator(assemble("sw x5, 0(x6)"), { 5: 1n, 6: 0n })
        storeSim.tick()
        expect(readFrontPanelState(storeSim, 5).leds).to.deep.equal({
            registerWrite: false,
            memoryRead: false,
            memoryWrite: true,
            branchTaken: false,
            aluZero: true,
        })

        const branchSim = new Simulator(assemble("beq x5, x6, target\ntarget: addi x0, x0, 0"), { 5: 1n, 6: 2n })
        branchSim.tick()
        expect(readFrontPanelState(branchSim, 5).leds).to.deep.equal({
            registerWrite: false,
            memoryRead: false,
            memoryWrite: false,
            branchTaken: false,
            aluZero: false,
        })
    })

    it("rejects invalid register selections", () => {
        const sim = new Simulator()

        for (const index of [-1, 32, 1.5, NaN]) {
            expect(() => readFrontPanelState(sim, index)).to.throw(RangeError)
        }
    })
})
