import { Simulator } from "simulator/simulator"

export interface FrontPanelState {
    pc: bigint
    instruction: bigint
    aluResult: bigint
    registerIndex: number
    registerValue: bigint
    leds: {
        registerWrite: boolean
        memoryRead: boolean
        memoryWrite: boolean
        branchTaken: boolean
        aluZero: boolean
    }
}

export function formatFrontPanelHex(value: bigint): string {
    return (value & 0xFFFF_FFFFn).toString(16).toUpperCase().padStart(8, "0")
}

export function readFrontPanelState(sim: Simulator, registerIndex: number): FrontPanelState {
    if (!Number.isInteger(registerIndex) || registerIndex < 0 || registerIndex >= sim.regFile.registers.length) {
        throw new RangeError(`Register index must be an integer from 0 to ${sim.regFile.registers.length - 1}`)
    }

    return {
        pc: sim.pc.out.toInt(),
        instruction: sim.instrMem.instruction.toInt(),
        aluResult: sim.alu.result.toInt(),
        registerIndex,
        registerValue: sim.regFile.registers[registerIndex],
        leds: {
            registerWrite: !!sim.control.regWrite,
            memoryRead: !!sim.control.memRead,
            memoryWrite: !!sim.control.memWrite,
            branchTaken: !!sim.jumpControl.takeBranch,
            aluZero: !!sim.alu.zero,
        },
    }
}
