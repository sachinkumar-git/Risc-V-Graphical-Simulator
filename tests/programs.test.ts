import { expect } from "chai";
import { assemble } from "assembler/assembler";
import { Bits, fromTwosComplement, toTwosComplement, Radix } from "utils/bits";
import { MulticycleSimulator } from "simulator/multicycleSimulator";
import { PipelineSimulator } from "simulator/pipelineSimulator";
import { Simulator } from "simulator/simulator";
import * as fs from "fs";

/**
 * Test the example programs.
 *
 * The JSON files in assets/examples are the single source of truth: the app loads
 * them into the Examples dropdown, and these tests assemble and run the same code.
 */

interface ExampleSetup {
    code: string,
    memory?: string,
    memoryRadix: Radix,
    registerRadix: Radix,
    memoryWordSize: number,
}

/** The array every example comes with (address 0, 10 words). */
const EXAMPLE_ARRAY = [7n, 3n, 1n, 5n, 9n, 2n, 8n, 4n, 6n, 0n]
const SORTED_ARRAY = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]

const EXAMPLES = ["bubbleSort", "selectionSort", "insertionSort", "linearSearch",
                  "findMaximum", "fibonacci", "sumOfArray", "reverseArray"]

const SORTS = ["bubbleSort", "selectionSort", "insertionSort"]

function loadExample(name: string): ExampleSetup {
    return JSON.parse(fs.readFileSync(`assets/examples/${name}.json`, "utf8"))
}

function exampleMemory(setup: ExampleSetup): bigint[] {
    return (setup.memory ?? "").split("\n").filter(s => s)
        .map(s => Bits.parse(s, setup.memoryRadix, setup.memoryWordSize).toInt())
}

/** Assembles an example and runs it the way SimulatorUI does. */
function runExample(name: string, memory?: bigint[]): { sim: Simulator, setup: ExampleSetup } {
    const setup = loadExample(name)
    const sim = new Simulator(assemble(setup.code), {})
    sim.dataMem.data.storeArray(0n, setup.memoryWordSize / 8, memory ?? exampleMemory(setup))

    // Bounded run so a looping program fails the test instead of hanging the suite.
    for (let i = 0; i < 100_000 && !sim.isDone(); i++) sim.tick()
    expect(sim.isDone(), `${name} should run to the end of the program`).to.be.true

    return { sim, setup }
}

const loadArray = (sim: Simulator, n = 10): bigint[] => sim.dataMem.data.loadArray(0n, 4, n)
const reg = (sim: Simulator, n: number): bigint => sim.regFile.registers[n]

describe("Example programs", () => {
    it("all examples assemble", () => {
        for (const name of EXAMPLES) {
            const setup = loadExample(name)
            expect(assemble(setup.code).length, `${name} assembles`).to.be.greaterThan(0)
        }
    })

    it("multi-cycle execution matches all bundled programs", () => {
        for (const name of EXAMPLES) {
            const { sim, setup } = runExample(name)
            const multi = new MulticycleSimulator(assemble(setup.code))
            multi.setMemory(exampleMemory(setup), setup.memoryWordSize / 8)

            expect(multi.run(100_000), `${name} completes`).to.be.true
            expect(multi.metrics.instructions, `${name} instruction count`).to.equal(sim.metrics.instructions)
            expect(multi.regFile.registers, `${name} registers`).to.deep.equal(sim.regFile.registers)
            expect(multi.dataMem.data.toString(4), `${name} memory`).to.equal(sim.dataMem.data.toString(4))
            expect(multi.dataMem.accessLog, `${name} memory-access trace`).to.deep.equal(sim.dataMem.accessLog)
        }
    })

    it("five-stage pipeline execution matches all bundled programs", () => {
        for (const name of EXAMPLES) {
            const { sim, setup } = runExample(name)
            const pipeline = new PipelineSimulator(assemble(setup.code))
            pipeline.setMemory(exampleMemory(setup), setup.memoryWordSize / 8)

            expect(pipeline.run(100_000), `${name} completes`).to.be.true
            expect(pipeline.metrics.instructions, `${name} instruction count`).to.equal(sim.metrics.instructions)
            expect(pipeline.regFile.registers, `${name} registers`).to.deep.equal(sim.regFile.registers)
            expect(pipeline.dataMem.data.toString(4), `${name} memory`).to.equal(sim.dataMem.data.toString(4))
            expect(pipeline.dataMem.accessLog, `${name} memory-access trace`).to.deep.equal(sim.dataMem.accessLog)
        }
    })

    for (const name of SORTS) {
        it(`${name} sorts the example array`, () => {
            const { sim } = runExample(name, EXAMPLE_ARRAY)
            expect(loadArray(sim)).to.eql(SORTED_ARRAY)
        })

        it(`${name} sorts random values`, () => {
            const input: bigint[] = []
            for (let i = 0; i < 10; i++)
                input.push(toTwosComplement(BigInt(Math.floor(Math.random() * (2**32 - 1))), 32))

            const { sim } = runExample(name, input)
            const output = loadArray(sim).map(e => fromTwosComplement(e, 32))

            for (let i = 1; i < output.length; i++) {
                expect(output[i - 1] <= output[i], `${output[i - 1]} <= ${output[i]}`).to.be.true
            }
        })
    }

    it("linearSearch finds the key at index 3", () => {
        const { sim } = runExample("linearSearch")
        expect(reg(sim, 13)).to.equal(3n) // a3 = index of 0x5
    })

    it("findMaximum returns the largest value", () => {
        const { sim } = runExample("findMaximum")
        expect(reg(sim, 10)).to.equal(9n) // a0 = 0x9
    })

    it("fibonacci computes fib(10)", () => {
        const { sim } = runExample("fibonacci")
        expect(reg(sim, 10)).to.equal(55n) // a0 = 0x37
    })

    it("sumOfArray sums into a2 and memory", () => {
        const { sim } = runExample("sumOfArray")
        expect(reg(sim, 12)).to.equal(45n) // a2 = 0x2D
        expect(sim.dataMem.data.load(0x28n, 4)).to.equal(45n) // stored after the array
    })

    it("reverseArray reverses the array in place", () => {
        const { sim } = runExample("reverseArray")
        expect(loadArray(sim)).to.eql([0n, 6n, 4n, 8n, 2n, 9n, 5n, 1n, 3n, 7n])
    })
})
