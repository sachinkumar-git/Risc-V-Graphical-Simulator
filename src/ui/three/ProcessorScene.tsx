import { MutableRefObject, memo, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome"
import { faCamera, faCompress, faExpand, faRotateRight } from "@fortawesome/free-solid-svg-icons"

import { Simulator } from "simulator/simulator"
import type { SimState } from "../SimulatorUI"
import { PROPAGATION_STAGES } from "../instructionInfo"
import {
    LAST_STAGE, NodeKind, ProcessorNode, ProcessorWire, WireKind,
    getProcessorNode, nodeStage, processorNodes, processorWires, wireStage,
} from "./processorModel"
import { aluGeometry, boxGeometry, curveLength, discGeometry, muxGeometry, wireCurve } from "./datapathGeometry"
import TextSprite from "./SceneText"
import css from "./ProcessorScene.m.css"

type Props = {
    sim: Simulator
    state: SimState
    /** Play interval in ms per instruction (0 = max speed). Used to fit the propagation animation. */
    speed: number
    selectedNode?: string
    onSelectNode?: (id: string) => void
    /** Reports the propagation stage being animated, or null once the instruction has fully settled. */
    onStageChange?: (stage: number | null) => void
}

type NodeState = { value: string, active: boolean }
type WireState = { value: string, active: boolean }

/**
 * Animation clock shared by every mesh through a ref, so the per-frame sweep never re-renders React.
 * `progress` is measured in stages: stage k is in flight while k <= progress < k + 1, and the
 * instruction has fully settled once progress reaches DONE.
 */
type Clock = { progress: number, rate: number }
const DONE = LAST_STAGE + 1

/** Duration of the propagation sweep when single-stepping. */
const STEP_SWEEP_SECONDS = 1.6
/** Below this sweep duration (fast play), the sweep is skipped and the settled state is shown. */
const MIN_SWEEP_SECONDS = 0.2

// Same values as the --sig-* tokens in css/site.css, so the 3D wires match the legend and inspector.
const WIRE_COLORS: Record<WireKind, string> = {
    data: "#4fb0d8",
    control: "#d39b52",
    branch: "#9d86d6",
    write: "#5fb47c",
}
const INACTIVE_WIRE = "#3a4049"

/** Matte component bodies: a neutral base with a slight tint per role. */
const NODE_COLORS: Record<NodeKind, string> = {
    fetch: "#2f4652",
    decode: "#2f3d52",
    control: "#4a3d2e",
    execute: "#3b3650",
    memory: "#2f463a",
    writeback: "#2f4652",
    mux: "#383d45",
    adder: "#343e4a",
}

/** Edge and value colour per role, used when the component is part of the current instruction. */
const NODE_ACCENTS: Record<NodeKind, string> = {
    fetch: "#7fb3c9",
    decode: "#8aa3c8",
    control: "#d3a56b",
    execute: "#a796d0",
    memory: "#7fbf95",
    writeback: "#7fb3c9",
    mux: "#a3abb6",
    adder: "#8aa3c8",
}

const STAGE_COLUMNS: { label: string, x: number }[] = [
    { label: "FETCH", x: -13.6 },
    { label: "DECODE & CONTROL", x: -6.4 },
    { label: "EXECUTE", x: 2.6 },
    { label: "MEMORY", x: 7.9 },
    { label: "WRITE-BACK", x: 11.9 },
]

function supportsWebGL(): boolean {
    try {
        const canvas = document.createElement("canvas")
        return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")))
    } catch {
        return false
    }
}

function makeNodeGeometry(node: ProcessorNode): THREE.BufferGeometry {
    const [w, h] = node.size
    switch (node.shape) {
        case "mux": return muxGeometry(w, h)
        case "alu": return aluGeometry(w, h)
        case "adder": return discGeometry(Math.min(w, h) * 0.47, 0.6, 16)
        case "control": return discGeometry(Math.min(w, h) * 0.54, 0.7, 6)
        default: return boxGeometry(w, h)
    }
}

/** Moves `current` toward `target`; returns true while still animating. */
function approach(current: number, target: number, k: number): [number, boolean] {
    const next = current + (target - current) * k
    return Math.abs(target - next) > 0.002 ? [next, true] : [target, false]
}

type NodeMeshProps = {
    node: ProcessorNode
    state: NodeState
    /** Whether the propagation sweep has reached this component. */
    revealed: boolean
    selected: boolean
    hovered: boolean
    clock: MutableRefObject<Clock>
    onSelect: (id: string) => void
    onFocus: (id: string) => void
    onHover: (id: string | null) => void
}

const NodeMesh = memo(function NodeMesh({ node, state, revealed, selected, hovered, clock, onSelect, onFocus, onHover }: NodeMeshProps) {
    const group = useRef<THREE.Group>(null)
    const material = useRef<THREE.MeshStandardMaterial>(null)
    const halo = useRef<THREE.MeshBasicMaterial>(null)
    const [w, h] = node.size
    const accent = selected ? "#cfe3ff" : NODE_ACCENTS[node.kind]
    const stage = nodeStage[node.id]
    const lit = state.active && revealed

    const geometry = useMemo(() => makeNodeGeometry(node), [node])
    const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 32), [geometry])
    const haloGeometry = useMemo(() => boxGeometry(w + 0.45, h + 0.45, 0.06), [w, h])
    const slots = useMemo(() => {
        if (node.shape != "regfile") return []
        return [...Array(8)].map((_, i) => ({
            y: h * 0.3 - i * h * 0.085,
            w: w * 0.72,
        }))
    }, [node.shape, w, h])

    useEffect(() => () => geometry.dispose(), [geometry])
    useEffect(() => () => edges.dispose(), [edges])
    useEffect(() => () => haloGeometry.dispose(), [haloGeometry])

    useFrame(({ invalidate }, delta) => {
        const k = Math.min(1, delta * 10)
        // the component whose stage is currently in flight glows brighter
        const inFlight = state.active && Math.floor(clock.current.progress) == stage
        const target = selected ? 0.32 : hovered ? 0.18 : inFlight ? 0.26 : lit ? 0.07 : 0
        let busy = false
        if (material.current) {
            const [v, moving] = approach(material.current.emissiveIntensity, target, k)
            material.current.emissiveIntensity = v
            busy ||= moving
        }
        if (group.current) {
            const [s, moving] = approach(group.current.scale.x, selected ? 1.045 : hovered ? 1.02 : 1, k)
            group.current.scale.setScalar(s)
            busy ||= moving
        }
        if (halo.current) {
            const [o, moving] = approach(halo.current.opacity, selected ? 0.28 : hovered ? 0.12 : 0, k)
            halo.current.opacity = o
            busy ||= moving
        }
        if (busy) invalidate()
    })

    const onOver = (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(node.id)
    }
    const onOut = (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(null)
    }
    const onClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onSelect(node.id)
    }
    const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onSelect(node.id)
        onFocus(node.id)
    }

    return (
        <group
            ref={group}
            position={[node.position[0], node.position[1], 0]}
            onPointerOver={onOver}
            onPointerOut={onOut}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
        >
            <mesh geometry={geometry}>
                <meshStandardMaterial
                    ref={material}
                    color={NODE_COLORS[node.kind]}
                    emissive={accent}
                    emissiveIntensity={0}
                    metalness={0.05}
                    roughness={0.8}
                />
            </mesh>
            <lineSegments geometry={edges}>
                <lineBasicMaterial color={lit || selected ? accent : "#4a515b"} transparent opacity={lit || selected ? 0.9 : 0.6} />
            </lineSegments>

            {/* Front-face detail for memories and the register file */}
            {node.shape == "memory" && [...Array(3)].map((_, i) => (
                <mesh key={i} position={[0, h * 0.24 - i * h * 0.16, 0.32]}>
                    <planeGeometry args={[w * 0.74, h * 0.05]} />
                    <meshBasicMaterial color={accent} transparent opacity={lit ? 0.45 : 0.18} toneMapped={false} />
                </mesh>
            ))}
            {node.shape == "regfile" && slots.map((slot, i) => (
                <mesh key={i} position={[0, slot.y, 0.32]}>
                    <planeGeometry args={[slot.w, h * 0.045]} />
                    <meshBasicMaterial color={accent} transparent opacity={lit ? 0.35 : 0.14} toneMapped={false} />
                </mesh>
            ))}

            <mesh position={[0, 0, -0.36]} geometry={haloGeometry}>
                <meshBasicMaterial ref={halo} color={accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
            </mesh>

            <TextSprite
                text={node.short}
                position={[0, state.value ? h * 0.17 : 0, 0.72]}
                height={0.4}
                maxWidth={w * 0.92}
                color={lit || selected ? "#e6e9ee" : "#aab1bb"}
                weight={600}
            />
            {state.value && (
                <TextSprite
                    text={revealed ? state.value : "…"}
                    position={[0, -h * 0.2, 0.72]}
                    height={0.34}
                    maxWidth={w * 0.95}
                    color={lit ? accent : "#7d8591"}
                    weight={500}
                    mono
                />
            )}
        </group>
    )
}, (a, b) => (
    a.node === b.node && a.selected === b.selected && a.hovered === b.hovered && a.revealed === b.revealed &&
    a.state.active === b.state.active && a.state.value === b.state.value
))

type WireMeshProps = {
    wire: ProcessorWire
    state: WireState
    revealed: boolean
    curve: THREE.CurvePath<THREE.Vector3>
    clock: MutableRefObject<Clock>
}

const inactiveColor = new THREE.Color(INACTIVE_WIRE)

const WireMesh = memo(function WireMesh({ wire, state, revealed, curve, clock }: WireMeshProps) {
    const material = useRef<THREE.MeshBasicMaterial>(null)
    const lastFill = useRef(-1)
    const activeColor = useMemo(() => new THREE.Color(WIRE_COLORS[wire.kind]), [wire.kind])
    const stage = wireStage[wire.id]

    const geometry = useMemo(() => {
        const radius = wire.kind == "control" ? 0.026 : 0.044
        const segments = Math.max(10, Math.ceil(curveLength(curve) * 3))
        return new THREE.TubeGeometry(curve, segments, radius, 6, false)
    }, [curve, wire.kind])
    useEffect(() => () => geometry.dispose(), [geometry])

    const mid = useMemo(() => curve.getPointAt(0.55), [curve])

    // Colour fades from inactive to the wire's colour as the signal travels down it.
    useFrame(() => {
        const mat = material.current
        if (!mat) return
        const fill = state.active ? THREE.MathUtils.clamp(clock.current.progress - stage, 0, 1) : 0
        if (fill == lastFill.current) return
        lastFill.current = fill
        mat.color.copy(inactiveColor).lerp(activeColor, fill)
        mat.opacity = 0.55 + 0.45 * fill
    })
    // force a recolour when the wire's activity changes (e.g. a new instruction)
    useEffect(() => { lastFill.current = -1 }, [state.active])

    const showValue = wire.showLabel && state.active && revealed && state.value
    return (
        <group>
            <mesh geometry={geometry}>
                <meshBasicMaterial
                    ref={material}
                    color={INACTIVE_WIRE}
                    transparent
                    opacity={0.55}
                    toneMapped={false}
                    depthWrite={false}
                />
            </mesh>
            {wire.showLabel && (
                <TextSprite
                    text={wire.label}
                    position={[mid.x, mid.y + 0.34, 0.5]}
                    height={0.3}
                    color={state.active && revealed ? WIRE_COLORS[wire.kind] : "#5c636d"}
                    weight={600}
                />
            )}
            {showValue && (
                <TextSprite
                    text={state.value}
                    position={[mid.x, mid.y - 0.34, 0.5]}
                    height={0.3}
                    color={WIRE_COLORS[wire.kind]}
                    weight={500}
                    mono
                />
            )}
        </group>
    )
}, (a, b) => (
    a.wire === b.wire && a.revealed === b.revealed &&
    a.state.active === b.state.active && a.state.value === b.state.value
))

const MAX_PULSES = 180

type PulseProps = {
    activeWires: ProcessorWire[]
    curves: Map<string, THREE.CurvePath<THREE.Vector3>>
    playing: boolean
    clock: MutableRefObject<Clock>
}

/**
 * Moving lights on the wires the current instruction uses.
 * While an instruction propagates, one "signal head" travels along each active wire during its
 * stage. Once settled, and only while the simulation is playing, gentle looping pulses continue.
 */
function SignalPulses({ activeWires, curves, playing, clock }: PulseProps) {
    const meshRef = useRef<THREE.InstancedMesh>(null)
    const phase = useRef(0)
    const dummy = useMemo(() => new THREE.Object3D(), [])
    const hidden = useMemo(() => {
        const o = new THREE.Object3D()
        o.position.set(0, 0, -999)
        o.scale.setScalar(0)
        o.updateMatrix()
        return o.matrix.clone()
    }, [])

    type Pulse = { curve: THREE.CurvePath<THREE.Vector3>, color: string, offset: number, stage: number, head: boolean }
    const pulses = useMemo(() => {
        const list: Pulse[] = []
        for (const wire of activeWires) {
            const curve = curves.get(wire.id)
            if (!curve) continue
            const stage = wireStage[wire.id]
            list.push({ curve, color: WIRE_COLORS[wire.kind], offset: 0, stage, head: true })
            const count = Math.min(4, Math.max(1, Math.round(curveLength(curve) / 8)))
            for (let i = 0; i < count && list.length < MAX_PULSES; i++) {
                list.push({ curve, color: WIRE_COLORS[wire.kind], offset: i / count, stage, head: false })
            }
        }
        return list
    }, [activeWires, curves])

    useEffect(() => {
        const mesh = meshRef.current
        if (!mesh) return
        const color = new THREE.Color()
        pulses.forEach((pulse, i) => mesh.setColorAt(i, color.set(pulse.color)))
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }, [pulses])

    useFrame(({ invalidate }, delta) => {
        const mesh = meshRef.current
        if (!mesh) return
        const progress = clock.current.progress
        const sweeping = progress < DONE
        if (playing && !sweeping) phase.current = (phase.current + delta * 0.32) % 1

        for (let i = 0; i < MAX_PULSES; i++) {
            const pulse = pulses[i]
            let t = -1
            let scale = 1
            if (pulse && pulse.head && sweeping) {
                const local = progress - pulse.stage
                if (local > 0 && local < 1) {
                    t = local
                    scale = 1.5
                }
            } else if (pulse && !pulse.head && !sweeping && playing) {
                t = (phase.current + pulse.offset) % 1
            }
            if (t < 0) {
                mesh.setMatrixAt(i, hidden)
                continue
            }
            const point = pulse.curve.getPointAt(t)
            dummy.position.set(point.x, point.y, 0.55)
            dummy.scale.setScalar(scale)
            dummy.updateMatrix()
            mesh.setMatrixAt(i, dummy.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        if (sweeping || playing) invalidate()
    })

    return (
        <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, MAX_PULSES]} frustumCulled={false}>
            <sphereGeometry args={[0.105, 10, 8]} />
            <meshBasicMaterial
                color="#ffffff"
                transparent
                opacity={0.95}
                toneMapped={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </instancedMesh>
    )
}

function Backdrop() {
    return (
        <group>
            {STAGE_COLUMNS.map(stage => (
                <TextSprite
                    key={stage.label}
                    text={stage.label}
                    position={[stage.x, 13.1, -0.8]}
                    height={0.38}
                    color="#4f5661"
                    weight={600}
                />
            ))}
        </group>
    )
}

/** A camera fly-to request: the point to look at, plus a token so repeated requests re-trigger. */
type FocusRequest = { x: number, y: number, token: number }
type CameraGoal = { target: THREE.Vector3, position: THREE.Vector3 }

const HOME_TARGET = new THREE.Vector3(-2.25, 4.4, 0)
/** Camera distance when focusing a single component: close enough to read its values. */
const FOCUS_DISTANCE = 19

type CameraRigProps = { resetToken: number, focus: FocusRequest | null }

function CameraRig({ resetToken, focus }: CameraRigProps) {
    const goal = useRef<CameraGoal | null>(null)
    const { camera, gl, size, invalidate } = useThree()
    const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])

    const distance = useMemo(() => {
        const aspect = Math.max(0.35, size.width / Math.max(1, size.height))
        const vFov = ((camera as THREE.PerspectiveCamera).fov ?? 40) * Math.PI / 180
        const forHeight = 18.6 / (2 * Math.tan(vFov / 2))
        const forWidth = 33.5 / (2 * Math.tan(vFov / 2) * aspect)
        return Math.max(forHeight, forWidth) * 1.04
    }, [camera, size.width, size.height])

    useEffect(() => {
        controls.enableDamping = true
        controls.dampingFactor = 0.09
        controls.minDistance = 9
        controls.maxDistance = 70
        controls.minPolarAngle = Math.PI * 0.1
        controls.maxPolarAngle = Math.PI * 0.49
        controls.enablePan = true
        controls.screenSpacePanning = true
        // render on demand: only redraw while the camera is actually moving
        const onChange = () => invalidate()
        // the user grabbing the camera cancels any fly-to in progress
        const onStart = () => { goal.current = null }
        controls.addEventListener("change", onChange)
        controls.addEventListener("start", onStart)
        return () => {
            controls.removeEventListener("change", onChange)
            controls.removeEventListener("start", onStart)
            controls.dispose()
        }
    }, [controls, invalidate])

    const homePosition = useMemo(() => new THREE.Vector3(HOME_TARGET.x, HOME_TARGET.y + 0.8, distance), [distance])

    // initial placement and panel resizes snap to the overview
    useEffect(() => {
        goal.current = null
        camera.position.copy(homePosition)
        controls.target.copy(HOME_TARGET)
        controls.update()
        invalidate()
    }, [camera, controls, homePosition, invalidate])

    // "Reset camera" flies back to the overview
    useEffect(() => {
        if (resetToken == 0) return
        goal.current = { target: HOME_TARGET.clone(), position: homePosition.clone() }
        invalidate()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetToken])

    // fly to a component, keeping the current viewing angle
    useEffect(() => {
        if (!focus) return
        const target = new THREE.Vector3(focus.x, focus.y, 0)
        const direction = camera.position.clone().sub(controls.target).normalize()
        goal.current = { target, position: target.clone().addScaledVector(direction, FOCUS_DISTANCE) }
        invalidate()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus])

    useFrame((_, delta) => {
        const g = goal.current
        if (g) {
            const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6)
            controls.target.lerp(g.target, k)
            camera.position.lerp(g.position, k)
            if (camera.position.distanceTo(g.position) < 0.02 && controls.target.distanceTo(g.target) < 0.02) {
                goal.current = null
            }
            invalidate()
        }
        // update() returns true while damping is still settling
        if (controls.update()) invalidate()
    })
    return null
}

type SceneProps = {
    sim: Simulator
    live: boolean
    playing: boolean
    speed: number
    stage: number | null
    replayToken: number
    selected?: string
    hovered: string | null
    resetToken: number
    focus: FocusRequest | null
    onSelect: (id: string) => void
    onFocus: (id: string) => void
    onHover: (id: string | null) => void
    onStage: (stage: number | null) => void
}

function Scene({
    sim, live, playing, speed, stage, replayToken, selected, hovered, resetToken, focus, onSelect, onFocus, onHover, onStage,
}: SceneProps) {
    const { invalidate } = useThree()
    const curves = useMemo(() => new Map(processorWires.map(wire => [wire.id, wireCurve(wire.points, 0)])), [])
    const clock = useRef<Clock>({ progress: DONE, rate: DONE / STEP_SWEEP_SECONDS })
    const reported = useRef<number | null>(null)

    const nodeStates = useMemo(() => {
        const map = new Map<string, NodeState>()
        for (const node of processorNodes) {
            map.set(node.id, {
                value: live ? node.value(sim) : "",
                active: live && node.active(sim),
            })
        }
        return map
    }, [sim, live])

    const wireStates = useMemo(() => {
        const map = new Map<string, WireState>()
        for (const wire of processorWires) {
            map.set(wire.id, {
                value: live ? wire.value(sim) : "",
                active: live && wire.active(sim),
            })
        }
        return map
    }, [sim, live])

    const activeWires = useMemo(
        () => processorWires.filter(wire => wireStates.get(wire.id)?.active),
        [wireStates],
    )

    // Restart the propagation sweep whenever a new instruction executes (the simulator proxy
    // changes identity on every tick) or the user asks for a replay.
    useEffect(() => {
        const seconds = playing ? (speed * 0.85) / 1000 : STEP_SWEEP_SECONDS
        if (!live || seconds < MIN_SWEEP_SECONDS) {
            clock.current.progress = DONE
        } else {
            clock.current.progress = 0
            clock.current.rate = DONE / Math.min(seconds, STEP_SWEEP_SECONDS)
        }
        const current = clock.current.progress < DONE ? 0 : null
        reported.current = current
        onStage(current)
        invalidate()
        // `playing`/`speed` deliberately excluded: changing them must not restart the sweep
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sim, live, replayToken])

    useFrame((_, delta) => {
        const c = clock.current
        // With on-demand rendering the first frame after an idle period reports the whole idle
        // time as its delta; clamp it so a sweep never skips ahead.
        const dt = Math.min(delta, 1 / 20)
        if (c.progress < DONE) c.progress = Math.min(DONE, c.progress + dt * c.rate)
        const current = c.progress < DONE ? Math.floor(c.progress) : null
        if (current !== reported.current) {
            reported.current = current
            onStage(current)
        }
    })

    const isRevealed = (s: number) => stage === null || stage >= s

    return (
        <>
            <ambientLight intensity={1.1} />
            <directionalLight position={[10, 18, 22]} intensity={1.6} />
            <directionalLight position={[-14, -6, 10]} intensity={0.35} />
            <Backdrop />
            {processorNodes.map(node => (
                <NodeMesh
                    key={node.id}
                    node={node}
                    state={nodeStates.get(node.id)!}
                    revealed={isRevealed(nodeStage[node.id])}
                    selected={selected === node.id}
                    hovered={hovered === node.id}
                    clock={clock}
                    onSelect={onSelect}
                    onFocus={onFocus}
                    onHover={onHover}
                />
            ))}
            {processorWires.map(wire => (
                <WireMesh
                    key={wire.id}
                    wire={wire}
                    state={wireStates.get(wire.id)!}
                    revealed={isRevealed(wireStage[wire.id])}
                    curve={curves.get(wire.id)!}
                    clock={clock}
                />
            ))}
            <SignalPulses activeWires={activeWires} curves={curves} playing={playing} clock={clock} />
            <CameraRig resetToken={resetToken} focus={focus} />
        </>
    )
}

export default function ProcessorScene({ sim, state, speed, selectedNode, onSelectNode, onStageChange }: Props) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const [hovered, setHovered] = useState<string | null>(null)
    const [resetToken, setResetToken] = useState(0)
    const [replayToken, setReplayToken] = useState(0)
    const [focus, setFocus] = useState<FocusRequest | null>(null)
    const handleFocus = useMemo(() => (id: string) => {
        const node = getProcessorNode(id)
        if (node) setFocus(f => ({ x: node.position[0], y: node.position[1], token: (f?.token ?? 0) + 1 }))
    }, [])
    const [fullscreen, setFullscreen] = useState(false)
    const [stage, setStage] = useState<number | null>(null)
    const [webgl] = useState(supportsWebGL)

    // keep the latest callbacks without re-creating the scene's frame handlers
    const stageCallback = useRef(onStageChange)
    stageCallback.current = onStageChange
    const handleStage = useMemo(() => (s: number | null) => {
        setStage(s)
        stageCallback.current?.(s)
    }, [])
    const selectCallback = useRef(onSelectNode)
    selectCallback.current = onSelectNode
    const handleSelect = useMemo(() => (id: string) => selectCallback.current?.(id), [])

    useEffect(() => {
        const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current)
        document.addEventListener("fullscreenchange", onChange)
        return () => document.removeEventListener("fullscreenchange", onChange)
    }, [])

    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => undefined)
        } else {
            wrapRef.current?.requestFullscreen().catch(() => undefined)
        }
    }

    const hoveredNode = hovered ? getProcessorNode(hovered) : undefined
    const live = state != "unstarted"
    const playing = state == "playing"

    if (!webgl) {
        return (
            <div className={css.fallback}>
                <h3>3D view unavailable</h3>
                <p>
                    This browser doesn&rsquo;t provide WebGL, so the datapath can&rsquo;t be drawn. Turn on hardware
                    acceleration or use a current version of Chrome, Edge or Firefox. The simulator, editor and
                    inspector still work.
                </p>
            </div>
        )
    }

    return (
        <div ref={wrapRef} className={css.scene}>
            <header className={css.sceneHeader}>
                <span className={css.sceneTitle}>Datapath</span>
                <span className={css.sceneHint}>
                    Drag to orbit, scroll to zoom, click to inspect, double-click to focus
                </span>
                <div className={css.viewButtons}>
                    <button
                        title="Replay signal propagation for this instruction"
                        disabled={!live || playing}
                        onClick={() => setReplayToken(t => t + 1)}
                    >
                        <Icon icon={faRotateRight} />
                    </button>
                    <button title="Reset camera" onClick={() => setResetToken(t => t + 1)}>
                        <Icon icon={faCamera} />
                    </button>
                    <button title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
                        <Icon icon={fullscreen ? faCompress : faExpand} />
                    </button>
                </div>
            </header>

            <ol className={css.stageStrip} aria-label="Signal propagation stages">
                {PROPAGATION_STAGES.map((name, i) => (
                    <li
                        key={name}
                        data-stage={!live ? "idle" : stage === null || i < stage ? "done" : i == stage ? "current" : "pending"}
                    >
                        {name}
                    </li>
                ))}
            </ol>

            <div className={css.viewport} data-hovering={hovered ? "true" : undefined}>
                <Canvas
                    frameloop="demand"
                    camera={{ position: [-2, 5.4, 34], fov: 40, near: 0.1, far: 300 }}
                    dpr={[1, 2]}
                    gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                >
                    <Scene
                        sim={sim}
                        live={live}
                        playing={playing}
                        speed={speed}
                        stage={stage}
                        replayToken={replayToken}
                        selected={selectedNode}
                        hovered={hovered}
                        resetToken={resetToken}
                        focus={focus}
                        onSelect={handleSelect}
                        onFocus={handleFocus}
                        onHover={setHovered}
                        onStage={handleStage}
                    />
                </Canvas>

                {hoveredNode && (
                    <div className={css.hoverCard}>
                        <strong>{hoveredNode.label}</strong>
                        <span className={css.hoverValue}>{live ? hoveredNode.value(sim) : "Not running"}</span>
                        <p>{hoveredNode.description}</p>
                    </div>
                )}
            </div>

            <footer className={css.legend}>
                <span><i style={{ background: WIRE_COLORS.data }} /> Data</span>
                <span><i style={{ background: WIRE_COLORS.control }} /> Control</span>
                <span><i style={{ background: WIRE_COLORS.branch }} /> Branch / jump</span>
                <span><i style={{ background: WIRE_COLORS.write }} /> Write-back</span>
                <span><i style={{ background: INACTIVE_WIRE }} /> Unused this cycle</span>
            </footer>
        </div>
    )
}
