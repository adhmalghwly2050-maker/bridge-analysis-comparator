import React, { useState, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { BuildingModel } from './buildingModel';

interface Building3DViewerProps {
  building: BuildingModel;
  visibleFloors: string[];
  showGrid: boolean;
  showLabels: boolean;
  cutSection: 'none' | 'x' | 'y';
  cutPosition: number;
}

// =================== 3D COLUMN ===================
function Column3D({
  x, y, baseZ, topZ, b, h, color = '#e69500'
}: {
  x: number; y: number; baseZ: number; topZ: number;
  b: number; h: number; color?: string;
}) {
  const height = topZ - baseZ;
  const bM = b / 1000;
  const hM = h / 1000;

  return (
    <mesh position={[x, baseZ + height / 2, y]}>
      <boxGeometry args={[bM, height, hM]} />
      <meshStandardMaterial color={color} transparent opacity={0.85} />
    </mesh>
  );
}

// =================== 3D BEAM ===================
function Beam3D({
  x1, y1, x2, y2, z, b, h, color = '#0ba360'
}: {
  x1: number; y1: number; x2: number; y2: number;
  z: number; b: number; h: number; color?: string;
}) {
  const bM = b / 1000;
  const hM = h / 1000;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  return (
    <mesh position={[midX, z - hM / 2, midY]} rotation={[0, -angle, 0]}>
      <boxGeometry args={[length, hM, bM]} />
      <meshStandardMaterial color={color} transparent opacity={0.7} />
    </mesh>
  );
}

// =================== 3D SLAB ===================
function Slab3D({
  x1, y1, x2, y2, z, thickness, color = '#6b7280'
}: {
  x1: number; y1: number; x2: number; y2: number;
  z: number; thickness: number; color?: string;
}) {
  const thM = thickness / 1000;
  const w = x2 - x1;
  const d = y2 - y1;

  return (
    <mesh position={[(x1 + x2) / 2, z - thM / 2, (y1 + y2) / 2]}>
      <boxGeometry args={[w, thM, d]} />
      <meshStandardMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
    </mesh>
  );
}

// =================== GRID LINES ===================
function GridLines3D({ building }: { building: BuildingModel }) {
  const slabs = building.config.typicalSlabs;
  const xPositions = [...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b);
  const yPositions = [...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b);

  return (
    <group>
      {xPositions.map((x, i) => (
        <Line
          key={`gx-${i}`}
          points={[[x, -0.5, yPositions[0] - 1], [x, -0.5, yPositions[yPositions.length - 1] + 1]]}
          color="#888888"
          lineWidth={0.5}
          dashed
          dashSize={0.3}
          gapSize={0.2}
        />
      ))}
      {yPositions.map((y, i) => (
        <Line
          key={`gy-${i}`}
          points={[[xPositions[0] - 1, -0.5, y], [xPositions[xPositions.length - 1] + 1, -0.5, y]]}
          color="#888888"
          lineWidth={0.5}
          dashed
          dashSize={0.3}
          gapSize={0.2}
        />
      ))}
    </group>
  );
}

// =================== FLOOR LABELS ===================
function FloorLabels3D({ building }: { building: BuildingModel }) {
  const minX = Math.min(...building.config.typicalSlabs.map(s => s.x1));

  return (
    <group>
      {building.floors.map(floor => (
        <Text
          key={`label-${floor.id}`}
          position={[minX - 2, floor.elevation + floor.height, 0]}
          fontSize={0.4}
          color="#666666"
          anchorX="right"
        >
          {floor.label}
        </Text>
      ))}
    </group>
  );
}

// =================== BUILDING SCENE ===================
function BuildingScene({ building, visibleFloors, showGrid, showLabels, cutSection, cutPosition }: Building3DViewerProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 10, -5]} intensity={0.3} />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[5, -0.01, 5]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#e5e7eb" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {showGrid && <GridLines3D building={building} />}
      {showLabels && <FloorLabels3D building={building} />}

      {/* Render floors */}
      {building.floors.map(floor => {
        if (!visibleFloors.includes(floor.id)) return null;

        const floorElevation = floor.elevation + floor.height;

        // Apply cut section
        const shouldCut = (x: number, y: number) => {
          if (cutSection === 'x') return x <= cutPosition;
          if (cutSection === 'y') return y <= cutPosition;
          return true;
        };

        return (
          <group key={floor.id}>
            {/* Slabs */}
            {floor.slabs.map(slab => (
              shouldCut((slab.x1 + slab.x2) / 2, (slab.y1 + slab.y2) / 2) && (
                <Slab3D
                  key={`slab-${floor.id}-${slab.id}`}
                  x1={slab.x1} y1={slab.y1} x2={slab.x2} y2={slab.y2}
                  z={floorElevation}
                  thickness={building.config.slabProps.thickness}
                />
              )
            ))}

            {/* Beams along slab edges */}
            {floor.slabs.map(slab => {
              const edges = [
                { x1: slab.x1, y1: slab.y1, x2: slab.x2, y2: slab.y1 },
                { x1: slab.x2, y1: slab.y1, x2: slab.x2, y2: slab.y2 },
                { x1: slab.x1, y1: slab.y2, x2: slab.x2, y2: slab.y2 },
                { x1: slab.x1, y1: slab.y1, x2: slab.x1, y2: slab.y2 },
              ];
              return edges.map((edge, ei) => (
                shouldCut((edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2) && (
                  <Beam3D
                    key={`beam-${floor.id}-${slab.id}-${ei}`}
                    x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                    z={floorElevation}
                    b={building.config.beamB} h={building.config.beamH}
                  />
                )
              ));
            })}
          </group>
        );
      })}

      {/* Column stacks */}
      {building.columnStacks.map(stack => (
        <group key={stack.id}>
          {stack.floors.map(col => {
            if (!visibleFloors.includes(col.floorId)) return null;
            const midX = stack.x;
            const midY = stack.y;

            if (cutSection === 'x' && midX > cutPosition) return null;
            if (cutSection === 'y' && midY > cutPosition) return null;

            return (
              <Column3D
                key={`col-${stack.id}-${col.floorId}`}
                x={midX} y={midY}
                baseZ={col.baseElevation}
                topZ={col.topElevation}
                b={col.b} h={col.h}
              />
            );
          })}
        </group>
      ))}
    </>
  );
}

// =================== MAIN COMPONENT ===================
export default function Building3DViewer(props: Building3DViewerProps) {
  const { building } = props;
  const maxDim = Math.max(
    Math.max(...building.config.typicalSlabs.map(s => s.x2)),
    Math.max(...building.config.typicalSlabs.map(s => s.y2)),
    building.totalHeight
  );

  return (
    <div className="w-full h-full min-h-[400px] bg-card rounded border border-border">
      <Canvas shadows>
        <PerspectiveCamera
          makeDefault
          position={[maxDim * 1.5, maxDim * 1.2, maxDim * 1.5]}
          fov={50}
        />
        <OrbitControls
          target={[
            Math.max(...building.config.typicalSlabs.map(s => s.x2)) / 2,
            building.totalHeight / 2,
            Math.max(...building.config.typicalSlabs.map(s => s.y2)) / 2,
          ]}
          enableDamping
          dampingFactor={0.1}
        />
        <BuildingScene {...props} />
      </Canvas>
    </div>
  );
}
