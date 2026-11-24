import * as THREE from "three"

/** Builds a centred, rounded 2D rectangle. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
    const rad = Math.min(r, w / 2, h / 2)
    const x = -w / 2
    const y = -h / 2
    const shape = new THREE.Shape()
    shape.moveTo(x + rad, y)
    shape.lineTo(x + w - rad, y)
    shape.quadraticCurveTo(x + w, y, x + w, y + rad)
    shape.lineTo(x + w, y + h - rad)
    shape.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
    shape.lineTo(x + rad, y + h)
    shape.quadraticCurveTo(x, y + h, x, y + h - rad)
    shape.lineTo(x, y + rad)
    shape.quadraticCurveTo(x, y, x + rad, y)
    return shape
}

function extrude(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 2,
        curveSegments: 6,
    })
    geo.translate(0, 0, -depth / 2)
    return geo
}

/** Rounded processor component body. */
export function boxGeometry(w: number, h: number, depth = 0.55): THREE.ExtrudeGeometry {
    return extrude(roundedRect(w, h, Math.min(0.18, h / 4)), depth)
}

/** Multiplexer: a trapezoid with the wide side on the left (inputs). */
export function muxGeometry(w: number, h: number, depth = 0.55): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, -h / 2)
    shape.lineTo(w / 2, -h * 0.26)
    shape.lineTo(w / 2, h * 0.26)
    shape.lineTo(-w / 2, h / 2)
    shape.closePath()
    return extrude(shape, depth)
}

/** ALU: a chevron-like pentagon, visually distinct from the mux trapezoids. */
export function aluGeometry(w: number, h: number, depth = 0.65): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, -h / 2)
    shape.lineTo(w * 0.26, -h / 2)
    shape.lineTo(w / 2, 0)
    shape.lineTo(w * 0.26, h / 2)
    shape.lineTo(-w / 2, h / 2)
    shape.closePath()
    return extrude(shape, depth)
}

/** Disc-like geometry for adders and the control unit (facing +Z). */
export function discGeometry(radius: number, depth = 0.55, segments = 12): THREE.CylinderGeometry {
    const geo = new THREE.CylinderGeometry(radius, radius, depth, segments)
    geo.rotateX(Math.PI / 2)
    return geo
}

/**
 * Rounded orthogonal wire route. Straight segments are joined with small quadratic arcs so the
 * wires read cleanly in 3D without overshooting their endpoints.
 */
export function wireCurve(points: [number, number][], z = 0, corner = 0.24): THREE.CurvePath<THREE.Vector3> {
    const path = new THREE.CurvePath<THREE.Vector3>()
    const pts = points.map(([x, y]) => new THREE.Vector3(x, y, z))
    if (pts.length < 2) return path

    let cursor = pts[0].clone()
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1]
        const cornerPoint = pts[i]
        const next = pts[i + 1]

        const inDir = cornerPoint.clone().sub(prev)
        const outDir = next.clone().sub(cornerPoint)
        const inLen = inDir.length()
        const outLen = outDir.length()
        if (inLen < 1e-4 || outLen < 1e-4) continue

        const r = Math.min(corner, inLen / 2, outLen / 2)
        const inEnd = cornerPoint.clone().addScaledVector(inDir.clone().normalize(), -r)
        const outStart = cornerPoint.clone().addScaledVector(outDir.clone().normalize(), r)

        if (cursor.distanceTo(inEnd) > 1e-4) path.add(new THREE.LineCurve3(cursor, inEnd))
        path.add(new THREE.QuadraticBezierCurve3(inEnd, cornerPoint, outStart))
        cursor = outStart
    }
    path.add(new THREE.LineCurve3(cursor, pts[pts.length - 1]))
    return path
}

/** Length of a wire route. */
export function curveLength(path: THREE.CurvePath<THREE.Vector3>): number {
    return path.curves.reduce((sum, curve) => sum + curve.getLength(), 0)
}
