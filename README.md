# RISC-V Studio — Interactive 3D Processor Simulator

A web-based laboratory for a simple 32-bit, **single-cycle RISC-V** processor. Write or load an
assembly program, then step through it and watch the real datapath state light up an interactive,
fully 3D model of the processor — PC, memories, control unit, register file, ALU, multiplexers,
adders and every wire between them.

Built for teaching and learning: the datapath closely follows the design described in
*Computer Organization and Design: RISC-V Edition* (Patterson & Hennessy), and the execution engine is
the same cycle-accurate simulator the project has always used — the 3D view only visualises it.

---

## Features

- **Custom `popcnt rd, rs1` instruction** — counts the set bits in a 32-bit register through a
  project-specific RISC-V custom-0 opcode
- **Assembly editor** with RISC-V syntax highlighting, line numbers, current-instruction and
  error-line highlighting, and a collapsible layout
- **Interactive 3D datapath** built from individual Three.js objects (no SVG or screenshot textures):
  orbit, pan and zoom; reset the camera; go fullscreen
- **Live signal flow** driven by the simulator's actual control signals, mux selections, ALU result
  and memory operations — active paths glow, inactive paths stay muted, and pulses travel along the
  wires the current instruction uses
- **Component inspection** — hover for a summary, click for purpose, how it works, live inputs,
  outputs, active control signals and its role in the current instruction
- **Step-by-step explanation** of every executed instruction, built from real values (fetch, decode,
  register reads, immediate, ALU, memory, write-back, next PC)
- **Processor inspector** with tabs for registers, memory, the decoded instruction (machine code,
  opcode and fields), every live control signal, and the selected component
- **Registers panel** — all 32 registers, with a selectable radix (hex, signed decimal, unsigned decimal)
- **Memory panel** — data memory with the same radix choices and a selectable word size (byte, half-word, word)
- **Execution bar** — play, pause, single-step, reset, speed, cycle count, current PC and progress
- **CPU implementation comparison** — run the same program on the single-cycle, multi-cycle, and
  five-stage pipeline models and compare cycles, CPI, estimated clock periods, and total execution time
- **Five-stage pipeline visualizer** — step IF/ID/EX/MEM/WB cycle by cycle, inspect forwarding and
  load-use stalls, and see taken-branch flushes
- **Data-cache analysis lab** — configure cache capacity, block size, associativity, LRU/FIFO replacement,
  hit time, and miss penalty; inspect hit rate, misses, evictions, and estimated AMAT
- **Performance analysis** — executed instruction/cycle counts, conditional-branch outcomes, and saved run comparisons
- **8 example programs** preloaded with data, runnable in one click
- **Import/export** a complete simulation setup (code, registers, memory, radices) as a JSON file
- **Help / About** dialog covering the controls, datapath and layout
- **WebGL fallback** — the simulator and panels remain usable if 3D rendering is unavailable

## Using the 3D view

| Action | Result |
|---|---|
| Drag | Orbit the processor |
| Scroll | Zoom in / out |
| Right-drag | Pan |
| Hover a component | Floating summary card with its current value |
| Click a component | Opens **Component** details in the inspector |
| Camera button | Reset the view |
| Expand button | Fullscreen the visualization |

## CPU implementation comparison

The Performance tab compares the same program and initial state on three CPU models: the existing
one-cycle-per-instruction CPU, a multi-cycle CPU, and the five-stage pipeline. It displays instruction
counts, cycles, CPI, estimated period, and estimated total time for each. Pipeline load-use stalls and
flushed instructions are included in the comparison.

The multi-cycle model advances through fetch, decode, execute, memory, and write-back phases. ALU
instructions take four cycles; loads take five; stores take four; branches and jumps take three.
Instructions with no register write, memory access, or control transfer finish during decode.

Clock periods and total execution times are **illustrative estimates**, not measured hardware values.
The timing model assumes fetch = 180 ps, decode = 120 ps, execute = 180 ps, memory = 220 ps, and
write-back = 80 ps. The single-cycle period is the sum of those stages (780 ps); the multi-cycle
and pipeline periods use the slowest stage (220 ps). Estimated total time is cycle count multiplied by
the model's clock period. These assumptions make the cycle/clock-period trade-off visible; they are not
claims about a physical implementation.

## Five-stage pipeline

Open the **Pipeline** inspector tab and select **Start / reset**, then use **Step cycle**, **Play**,
or **Run to end** to inspect a separate five-stage pipeline model without changing the single-cycle
datapath view. The Performance tab compares that model with the single-cycle and multi-cycle CPUs.
The cycle timeline shows the instruction word and PC in each stage for the latest 20
cycles. The panel reports retired instructions, cycles, simulated CPI, load-use stalls, forwarded
operands, conditional-branch outcomes, and flushed instructions.

The model forwards ALU results from later stages, inserts a one-cycle bubble for a load-use
dependency, and resolves branches and jumps in EX, flushing younger work when a transfer is taken.
Execution is bounded at 20,000 retired instructions. This is a functional teaching model, not a
timing-accurate physical CPU; its CPI and cycle counts describe the simulated pipeline behavior.

## Data-cache analysis

Run a program, then open the **Cache** inspector tab to replay its actual data-memory access trace.
Configure cache capacity, block size, associativity, LRU or FIFO replacement, hit time, and miss
penalty. The panel reports reads and writes, cache-block lookups, hits, misses, evictions, hit/miss
rates, estimated AMAT, and total estimated access cycles. It analyzes the same dynamic memory access
stream for all CPU models; instruction fetches are excluded.

The cache model is set-associative, write-through, and write-allocate. AMAT is estimated as
`hit time + miss rate × miss penalty`; the miss penalty is additional backing-memory delay. These
are configurable teaching assumptions, not measured hardware timings or a simulation of cache
contents affecting program execution. Write-through store traffic is assumed buffered and is not
charged separately in the timing estimate.

**Signal colours** are consistent everywhere:

| Colour | Meaning |
|---|---|
| Cyan | Data pathways (32-bit values) |
| Orange | Control signals |
| Purple | Branch, jump and zero-flag paths |
| Green | Register write-back |
| Muted grey | Connection not used by the current instruction |

Pulses only run while the simulation is playing, so single-stepping leaves a readable snapshot of the
paths used by the instruction that just executed. Where practical, the values travelling on the key
connections (PC, rs1/rs2 data, immediate, ALU result, memory read data, write data) are drawn next to
the wire.

## Example programs

All examples live in [`assets/examples/`](assets/examples) and appear in the **Examples** menu.
They share one dataset so results are easy to compare:

```
address  0x00  0x04  0x08  0x0C  0x10  0x14  0x18  0x1C  0x20  0x24
value     0x7   0x3   0x1   0x5   0x9   0x2   0x8   0x4   0x6   0x0
```

| Example | What it demonstrates | Result |
|---|---|---|
| **Bubble Sort** | nested loops, adjacent compares and swaps | memory → `0,1,2,3,4,5,6,7,8,9` |
| **Selection Sort** | finding the minimum, swapping into place | memory → `0,1,2,3,4,5,6,7,8,9` |
| **Insertion Sort** | shifting elements, textbook `while` loop | memory → `0,1,2,3,4,5,6,7,8,9` |
| **Linear Search** | scanning for a key | `a3 = 3` (index of `0x5`) |
| **Find Maximum** | single pass with a running maximum | `a0 = 9` (`0x9`) |
| **Fibonacci** | iterative `fib(n)`, no array needed | `a0 = 55` (`0x37`) |
| **Sum of Array** | accumulate and store a result | `a2 = 45` (`0x2D`), also written to `0x28` |
| **Reverse Array** | two-pointer in-place swap | memory → `0,6,4,8,2,9,5,1,3,7` |

Every example is self-contained: it sets up its own base address and length (`li a0, 0x0`, `li a1, 0xA`)
and uses hex literals, so the source can be read — or copied into an exam answer — as-is.

## Getting started

### Requirements

- [Node.js](https://nodejs.org) and npm (verified with Node 22 / npm 11)
- A browser with WebGL for the 3D view (Chrome, Edge, Firefox, Safari)

### Install and run

```bash
npm install
npm run serve
```

Then open **http://localhost:8080**. The dev server rebuilds on every change.

### Scripts

| Command | Description |
|---|---|
| `npm run serve` | Dev server with hot reload at `http://localhost:8080` |
| `npm run build` | Development bundle (unminified, inline source maps) → `dist/` |
| `npm run build-prod` | Production bundle (minified + external source maps) → `dist/` |
| `npm run watch` | Rebuild the bundle whenever files change |
| `npm test` | Run the test suite |

## Writing your own program

The assembler is a small custom dialect implemented with [nearley](https://nearley.js.org) and
[moo](https://github.com/no-context/moo) (`src/assembler/assembler.ne`), so it accepts **less than GNU as**:

| | |
|---|---|
| ✅ Instructions | See [`docs/SupportedInstructions.md`](docs/SupportedInstructions.md) — arithmetic, branches, loads/stores, `popcnt`, `lui`, `auipc`, `ecall`, `ebreak` |
| ✅ Pseudo-instructions | `j label`, `mv rd, rs`, `li rd, imm`, `jal label` |
| ✅ Registers | ABI names (`a0`, `t0`, `sp`, `ra`, `zero`, …) **or** `x0`–`x31` |
| ✅ Numbers | decimal (`42`), hex (`0x2A`), binary (`0b101010`) |
| ✅ Line endings | LF and CRLF are both accepted |
| ❌ Missing | `ret`, `nop`, `la`, `call`, `beqz`/`bnez`/`bgt`/`ble`, and all `mul`/`div`/`rem` instructions |
| ❌ Directives | `.text`, `.data`, `.globl`, `.word` — anything starting with `.` is a syntax error |
| ❌ Comments | `#` only (`//` and `;` are not supported) |

Two practical consequences:

- `li` only accepts **signed 12-bit** immediates (−2048 to 2047); larger constants (including 2048–4095) are rejected with an error, so use `lui` first.
- Since there is no `.data` section, load your array through the **Memory** editor and set registers through
  the **Registers** editor before pressing play — exactly what the bundled examples do via their JSON setup.

## Example setup files

Each example is a single JSON file:

```jsonc
{
    "name": "Insertion Sort",
    "description": "Sorts the array in place",
    "code": "# Insertion Sort (RISC-V assembly)\n...",   // the program itself
    "memory": "0x7\n0x3\n...",                           // one value per line, at address 0
    "memoryRadix": "hex",
    "registerRadix": "hex",
    "memoryWordSize": 32
}
```

These files are the **single source of truth**: the app loads them into the Examples menu, and the
test suite (`tests/programs.test.ts`) assembles and runs the very same code — so an example can never
drift out of sync with its test. To add one, drop a JSON file in `assets/examples/` and register it in
[`src/ui/examples.ts`](src/ui/examples.ts).

## Project structure

```
assets/            example programs (JSON)
css/               global dark theme and shared styles
docs/              supported-instruction reference
src/
  assembler/       grammar (assembler.ne) and instruction encoding (assembler.ts)
  simulator/       CPU models, cache analysis, datapath components and memories
  ui/              React app: layout, editor, inspector, execution bar
    three/         3D scene, datapath model, geometry and canvas labels
  utils/           bit manipulation (Bits)
tests/             Mocha + Chai test suites
webpack.config.js  bundler configuration (dev / prod / test)
tsconfig.json      TypeScript configuration
```

The 3D view is split so that rendering and simulation stay separate:

- `src/ui/three/processorModel.ts` — the static description of every component and wire: position,
  geometry, labels, descriptions, and the functions that read live values and activity from the
  simulator.
- `src/ui/three/ProcessorScene.tsx` — React Three Fiber canvas, camera controls, hover/selection,
  animated signal pulses and the WebGL fallback.
- `src/ui/instructionInfo.ts` — instruction decoding, control-signal descriptions and the generated
  per-instruction explanation.

No simulator or assembler behaviour is duplicated in the UI; the scene reads the same component
objects (`sim.alu`, `sim.control`, `sim.regFile`, …) that execute the program.

## Testing

Tests use [Mocha](https://mochajs.org) and [Chai](https://www.chaijs.org), bundled by
[mochapack](https://github.com/sysgears/mochapack):

```bash
npm test
```

The suite covers the bit utilities, the assembler, the truth tables, memory and datapath components,
cache analysis, and the simulators — including running every example program on the single-cycle,
multi-cycle, and pipeline models and checking its result. Currently **232 tests**.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the production bundle and publishes
`dist/` to the `gh-pages` branch on every push to `main`, ready for GitHub Pages.

## References

- Patterson & Hennessy, *Computer Organization and Design: RISC-V Edition* — the datapath design
- [The RISC-V Instruction Set Manual](https://riscv.org/technical/specifications/)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) and [Three.js](https://threejs.org)
- Selection sort routine adapted from [cgyurgyik/riscv-assembly](https://github.com/cgyurgyik/riscv-assembly)

## License

[ISC](https://opensource.org/licenses/ISC) (see [`package.json`](package.json)).
