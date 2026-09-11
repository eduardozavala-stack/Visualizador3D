import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import type { WarehouseLocation } from '../types'

const COLORS: Record<string, string> = {
  LIBRE: '#22c55e',
  OCUPADA: '#ef4444',
  PARCIAL: '#f59e0b',
  BLOQUEADA: '#64748b',
  NO_DISPONIBLE: '#1f2937',
}

type Props = {
  locations: WarehouseLocation[]
  selectedCode: string | null
  onSelect: (location: WarehouseLocation | null) => void
  cameraMode: 'ISO' | 'TOP' | 'FRONT' | 'SIDE'
}

function CameraRig({ mode, locations }: { mode: Props['cameraMode']; locations: WarehouseLocation[] }) {
  const { camera } = useThree()
  const bounds = useMemo(() => {
    if (!locations.length) return { cx: 0, cy: 0, cz: 0, span: 100 }
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
    for (const l of locations) {
      minX=Math.min(minX,l.x); maxX=Math.max(maxX,l.x)
      minY=Math.min(minY,l.y); maxY=Math.max(maxY,l.y)
      minZ=Math.min(minZ,l.z); maxZ=Math.max(maxZ,l.z)
    }
    return { cx:(minX+maxX)/2, cy:(minY+maxY)/2, cz:(minZ+maxZ)/2, span:Math.max(maxX-minX,maxZ-minZ,60) }
  }, [locations])

  useEffect(() => {
    const {cx,cy,cz,span}=bounds
    if (mode === 'TOP') camera.position.set(cx, cy + span*1.35, cz + 0.01)
    else if (mode === 'FRONT') camera.position.set(cx, cy + span*0.15, cz + span*1.15)
    else if (mode === 'SIDE') camera.position.set(cx + span*1.15, cy + span*0.15, cz)
    else camera.position.set(cx + span*0.75, cy + span*0.48, cz + span*0.75)
    camera.lookAt(cx, cy, cz)
    camera.updateProjectionMatrix()
  }, [camera, mode, bounds])
  return null
}

function StatusInstances({ status, locations, selectedCode, onSelect }: { status: string; locations: WarehouseLocation[]; selectedCode: string | null; onSelect: Props['onSelect'] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: COLORS[status] || '#94a3b8', roughness: 0.78, metalness: 0.02 }), [status])
  const geometry = useMemo(() => new THREE.BoxGeometry(1.65, 1.05, 0.85), [])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    locations.forEach((l, i) => {
      matrix.makeTranslation(l.x, l.y, l.z)
      mesh.setMatrixAt(i, matrix)
      const selected = l.code === selectedCode
      const color = new THREE.Color(selected ? '#3b82f6' : COLORS[status] || '#94a3b8')
      mesh.setColorAt(i, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [locations, selectedCode, status])

  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const idx = event.instanceId
    if (idx === undefined) return
    onSelect(locations[idx] || null)
  }

  return <instancedMesh ref={ref} args={[geometry, material, locations.length]} onClick={click} castShadow={false} receiveShadow={false} />
}

function Scene({ locations, selectedCode, onSelect, cameraMode }: Props) {
  const groups = useMemo(() => {
    const out: Record<string, WarehouseLocation[]> = {}
    for (const l of locations) (out[l.status] ||= []).push(l)
    return out
  }, [locations])

  const aisleLabels = useMemo(() => {
    const map = new Map<number, WarehouseLocation[]>()
    for (const loc of locations) {
      const arr = map.get(loc.aisle) || []
      arr.push(loc); map.set(loc.aisle, arr)
    }
    return Array.from(map.entries()).sort((a,b)=>a[0]-b[0]).map(([aisle, list]) => {
      let minX=Infinity,maxX=-Infinity,maxY=-Infinity,z=0
      for (const l of list) { minX=Math.min(minX,l.x); maxX=Math.max(maxX,l.x); maxY=Math.max(maxY,l.y); z += l.z }
      return { key:String(aisle), label:`PASILLO ${String(aisle).padStart(2,'0')}`, x:(minX+maxX)/2, y:maxY+4.0, z:z/list.length }
    })
  }, [locations])

  return (
    <>
      <color attach="background" args={['#f8fafc']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[80, 100, 60]} intensity={1.6} />
      <gridHelper args={[420, 84, '#cbd5e1', '#e2e8f0']} position={[45,-0.58,65]} />
      {(Object.entries(groups) as [string, WarehouseLocation[]][]).map(([status, items]) => <StatusInstances key={status} status={status} locations={items} selectedCode={selectedCode} onSelect={onSelect} />)}
      {aisleLabels.map(label => (
        <Html key={label.key} position={[label.x,label.y,label.z]} center distanceFactor={30} zIndexRange={[10,0]}>
          <span className="aisle-number-label">{label.label}</span>
        </Html>
      ))}
      <CameraRig mode={cameraMode} locations={locations} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI/2.02} />
    </>
  )
}

export default function WarehouseScene(props: Props) {
  return (
    <Canvas camera={{ fov: 46, near: 0.1, far: 2000 }} dpr={[1, 1.5]} onPointerMissed={() => props.onSelect(null)}>
      <Scene {...props} />
    </Canvas>
  )
}
