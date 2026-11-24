import { useEffect, useMemo, useState } from "react"
import * as THREE from "three"

const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif'
const MONO = '"JetBrains Mono", Consolas, "Courier New", monospace'

/**
 * Canvas sizes. The text is drawn at FONT_PX and the sprite is cropped (via texture repeat/offset)
 * to the measured text width, so `height` in world units is the real line height and the aspect
 * ratio always matches the text. Values reuse a fixed canvas, so per-cycle updates never
 * reallocate GPU textures.
 */
const LABEL_CANVAS = { w: 1024, h: 128 }
const VALUE_CANVAS = { w: 768, h: 128 }
const FONT_PX = 96
const PAD_PX = 12

function draw(canvas: HTMLCanvasElement, text: string, color: string, weight: number, mono: boolean): number {
    const ctx = canvas.getContext("2d")
    if (!ctx) return 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let size = FONT_PX
    const family = mono ? MONO : FONT
    ctx.font = `${weight} ${size}px ${family}`
    while (ctx.measureText(text).width > canvas.width - PAD_PX * 2 && size > 24) {
        size -= 4
        ctx.font = `${weight} ${size}px ${family}`
    }
    ctx.fillStyle = color
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
    const used = Math.min(canvas.width, ctx.measureText(text).width + PAD_PX * 2)
    return Math.max(used / canvas.width, 0.02)
}

type Props = {
    text: string
    position: [number, number, number]
    /** Line height in world units. */
    height?: number
    /** Optional maximum width in world units; the text shrinks to fit. */
    maxWidth?: number
    color?: string
    weight?: number
    mono?: boolean
    opacity?: number
    renderOrder?: number
}

/**
 * A text label rendered to a canvas texture and drawn as a camera-facing sprite.
 *
 * The same canvas/texture is reused when only the text changes, so per-cycle value updates
 * (e.g. the PC or ALU result) do not allocate GPU textures every tick.
 */
export default function TextSprite({
    text, position, height = 0.4, maxWidth, color = "#e6f0ff", weight = 500,
    mono = false, opacity = 1, renderOrder = 30,
}: Props) {
    const canvas = useMemo(() => {
        const c = document.createElement("canvas")
        const size = mono ? VALUE_CANVAS : LABEL_CANVAS
        c.width = size.w
        c.height = size.h
        return c
    }, [mono])

    const texture = useMemo(() => {
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false
        tex.anisotropy = 4
        return tex
    }, [canvas])

    const [fraction, setFraction] = useState(1)

    useEffect(() => {
        const f = draw(canvas, text, color, weight, mono)
        texture.repeat.set(f, 1)
        texture.offset.set((1 - f) / 2, 0)
        texture.needsUpdate = true
        setFraction(f)
    }, [canvas, texture, text, color, weight, mono])

    useEffect(() => () => texture.dispose(), [texture])

    // world size: the canvas line box is canvas.h tall; scale so glyphs are `height` tall
    const lineScale = height * (canvas.height / FONT_PX)
    let w = lineScale * (canvas.width * fraction) / canvas.height
    let h = lineScale
    if (maxWidth && w > maxWidth) {
        h *= maxWidth / w
        w = maxWidth
    }

    return (
        <sprite position={position} scale={[w, h, 1]} renderOrder={renderOrder}>
            <spriteMaterial
                map={texture}
                transparent
                opacity={opacity}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
            />
        </sprite>
    )
}
