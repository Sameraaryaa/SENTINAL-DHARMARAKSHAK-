import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls, Html } from '@react-three/drei'
import * as THREE from 'three'

export default function FreeControls() {
  const { camera } = useThree();
  const movement = useRef({ forward: false, backward: false, left: false, right: false, up: false, down: false });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': movement.current.forward = true; break;
        case 'KeyS': movement.current.backward = true; break;
        case 'KeyA': movement.current.left = true; break;
        case 'KeyD': movement.current.right = true; break;
        case 'Space': movement.current.up = true; break;
        case 'ShiftLeft': movement.current.down = true; break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': movement.current.forward = false; break;
        case 'KeyS': movement.current.backward = false; break;
        case 'KeyA': movement.current.left = false; break;
        case 'KeyD': movement.current.right = false; break;
        case 'Space': movement.current.up = false; break;
        case 'ShiftLeft': movement.current.down = false; break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((_, delta) => {
    const speed = 25 * delta;
    const { forward, backward, left, right, up, down } = movement.current;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Ignore Y for pure FPS forward/backward (or include for flight)
    // We will include Y so you can fly where you look
    
    if (forward) camera.position.addScaledVector(dir, speed);
    if (backward) camera.position.addScaledVector(dir, -speed);

    if (left || right) {
      const rightDir = new THREE.Vector3().copy(dir).cross(camera.up).normalize();
      if (left) camera.position.addScaledVector(rightDir, -speed);
      if (right) camera.position.addScaledVector(rightDir, speed);
    }

    if (up) camera.position.y += speed;
    if (down) camera.position.y -= speed;
  });

  return (
    <>
      <PointerLockControls makeDefault />
      <Html center position={[0, 0, 0]} style={{
        position: 'absolute', top: '40vh', left: '50%', transform: 'centerX(-50%)',
        color: 'white', background: 'rgba(0,0,0,0.5)', padding: '6px 14px', borderRadius: 6,
        pointerEvents: 'none', zIndex: 100, fontSize: 13, whiteSpace: 'nowrap'
      }}>
        Click screen to look • W A S D to walk
      </Html>
    </>
  )
}
