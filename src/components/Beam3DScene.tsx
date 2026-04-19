import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';

export interface Beam3DSceneProps {
  b: number; h: number; span: number;
  topBarsLeft: number; topBarsRight: number; topDia: number;
  botBarsTotal: number; continuousBot: number; bentBars: number;
  botDia: number; stirrupSpacing: number; stirrupDia: number;
  cover: number; hasBentBars: boolean; bentUpAngle: number;
}

function RebarCage({ b, h, span, topBarsLeft, topBarsRight, topDia,
  botBarsTotal, continuousBot, bentBars, botDia, stirrupSpacing, stirrupDia,
  cover, hasBentBars, bentUpAngle }: Beam3DSceneProps) {
  
  const spanMm = span * 1000;
  const sc = 1 / 100;
  const L = spanMm * sc;
  const W = b * sc;
  const H = h * sc;
  const cov = cover * sc;
  const stDia = stirrupDia * sc * 0.5;

  const innerLeft = cov + stDia;
  const innerRight = W - cov - stDia;
  const innerBot = cov + stDia;
  const innerTop = H - cov - stDia;

  const getBarPositions = (count: number) => {
    if (count <= 1) return [W / 2];
    return Array.from({ length: count }, (_, i) => innerLeft + i * (innerRight - innerLeft) / (count - 1));
  };

  const topBarYs = getBarPositions(Math.max(topBarsLeft, topBarsRight));
  const contBotYs = getBarPositions(continuousBot);
  const allBotYs = getBarPositions(botBarsTotal);
  const topBarR = topDia * sc * 0.4;
  const botBarR = botDia * sc * 0.4;

  const numStirrups = Math.min(Math.floor(spanMm / stirrupSpacing), 50);
  const stirrupStep = L / (numStirrups + 1);

  const bentZone = L / 4;

  return (
    <group position={[-L / 2, 0, -W / 2]}>
      {/* Beam outline */}
      <mesh position={[L / 2, H / 2, W / 2]}>
        <boxGeometry args={[L, H, W]} />
        <meshStandardMaterial color="#d4d4d8" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments position={[L / 2, H / 2, W / 2]}>
        <edgesGeometry args={[new THREE.BoxGeometry(L, H, W)]} />
        <lineBasicMaterial color="#71717a" />
      </lineSegments>

      {/* Top bars */}
      {topBarYs.map((z, i) => (
        <mesh key={`top-${i}`} position={[L / 2, innerTop, z]}>
          <cylinderGeometry args={[topBarR, topBarR, L, 8]} />
          <meshStandardMaterial color="#ef4444" />
        </mesh>
      ))}

      {/* Bottom continuous bars */}
      {contBotYs.map((z, i) => (
        <mesh key={`bot-${i}`} position={[L / 2, innerBot, z]}>
          <cylinderGeometry args={[botBarR, botBarR, L, 8]} />
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      ))}

      {/* Bent bars */}
      {hasBentBars && allBotYs.slice(continuousBot).map((z, i) => {
        const bentAngleRad = (bentUpAngle * Math.PI) / 180;
        const riseHeight = innerTop - innerBot;
        const horizRun = riseHeight / Math.tan(bentAngleRad);
        
        const leftPts: [number, number, number][] = [
          [0, innerBot, z],
          [bentZone - horizRun, innerBot, z],
          [bentZone, innerTop, z],
          [L / 2, innerTop, z],
        ];
        const rightPts: [number, number, number][] = [
          [L, innerBot, z],
          [L - bentZone + horizRun, innerBot, z],
          [L - bentZone, innerTop, z],
          [L / 2, innerTop, z],
        ];
        return (
          <group key={`bent-${i}`}>
            <Line points={leftPts} color="#f59e0b" lineWidth={3} />
            <Line points={rightPts} color="#f59e0b" lineWidth={3} />
          </group>
        );
      })}

      {/* Stirrups */}
      {Array.from({ length: numStirrups }, (_, i) => {
        const xPos = stirrupStep * (i + 1);
        const pts: [number, number, number][] = [
          [xPos, innerBot - stDia, innerLeft - stDia],
          [xPos, innerTop + stDia, innerLeft - stDia],
          [xPos, innerTop + stDia, innerRight + stDia],
          [xPos, innerBot - stDia, innerRight + stDia],
          [xPos, innerBot - stDia, innerLeft - stDia],
        ];
        return <Line key={`st-${i}`} points={pts} color="#10b981" lineWidth={1.5} />;
      })}
    </group>
  );
}

export default function Beam3DScene(props: Beam3DSceneProps) {
  return (
    <div className="w-full border border-border rounded bg-card relative" style={{ height: 450 }}>
      <Canvas camera={{ position: [8, 6, 8], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <RebarCage {...props} />
        <OrbitControls enablePan enableZoom enableRotate />
        <gridHelper args={[20, 20, '#888888', '#444444']} position={[0, -props.h / 200, 0]} />
      </Canvas>
      <div className="absolute bottom-2 left-2 bg-card/80 rounded p-2 text-[10px] space-y-1 pointer-events-none">
        <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block"></span> حديد علوي</div>
        <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span> حديد سفلي</div>
        <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block"></span> كانات</div>
        {props.hasBentBars && <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block"></span> حديد مكسح</div>}
      </div>
    </div>
  );
}
