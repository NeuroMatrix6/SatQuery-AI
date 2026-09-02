import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import {
  Stars,
  useGLTF,
  Environment,
} from "@react-three/drei";
import * as THREE from "three";
import { useMemo, useRef } from "react";

/* =========================
   EARTH
========================= */

function Earth() {
  const earthRef = useRef();

  const earthTexture = useLoader(
    THREE.TextureLoader,
    "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg"
  );

  useFrame(() => {
    if (earthRef.current) {
      earthRef.current.rotation.y += 0.0008;
    }
  });

  return (
    <group
      ref={earthRef}
      position={[0, -3.3, -3]}
    >
      {/* EARTH */}
      <mesh>
        <sphereGeometry args={[3.5, 128, 128]} />

        <meshStandardMaterial
          map={earthTexture}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>

      {/* ATMOSPHERE */}
      <mesh scale={1.045}>
        <sphereGeometry args={[3.5, 128, 128]} />

        <meshBasicMaterial
          color="#168cff"
          transparent
          opacity={0.10}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}


/* =========================
   ORBIT
========================= */

function Orbit() {
  const points = [];

  const radiusX = 6.2;
  const radiusZ = 3.4;

  const centerY = -1.3;

  for (let i = 0; i <= 160; i++) {

    const angle =
      (i / 160) * Math.PI * 2;

    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radiusX,
        centerY,
        Math.sin(angle) * radiusZ - 3
      )
    );
  }

  const geometry =
    new THREE.BufferGeometry().setFromPoints(points);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial
        color="#148bff"
        transparent
        opacity={0.45}
      />
    </line>
  );
}


/* =========================
   SATELLITE
========================= */

function Satellite() {

  const satelliteRef = useRef();

  const { scene } =
    useGLTF("/models/satellite.glb");


  /*
    Clone the model so we can
    safely modify its scale.
  */

  const satellite = useMemo(() => {

    const model =
      scene.clone(true);

    /*
      Find actual GLB dimensions
    */

    const box =
      new THREE.Box3()
        .setFromObject(model);

    const size =
      new THREE.Vector3();

    box.getSize(size);


    /*
      Find largest dimension
    */

    const largestDimension =
      Math.max(
        size.x,
        size.y,
        size.z
      );


    /*
      Earth diameter = 5.3

      Satellite desired size
      = approximately 0.65

      So satellite is clearly
      smaller than Earth.
    */

    const desiredSize = 1.10;


    const scale =
      desiredSize /
      largestDimension;


    model.scale.setScalar(scale);


    return model;

  }, [scene]);


  /* =========================
     SATELLITE MOVEMENT
  ========================= */

  useFrame(({ clock }) => {

    const t =
      clock.getElapsedTime();


    const radiusX = 6.2;
    const radiusZ = 3.4;

    const centerY = -1.3;

    const speed = 0.30;

    const angle =
      t * speed;


    if (satelliteRef.current) {

      /*
        Move around Earth
      */

      satelliteRef.current.position.x =
        Math.cos(angle) * radiusX;


      satelliteRef.current.position.z =
        Math.sin(angle) * radiusZ - 3;


      satelliteRef.current.position.y =
        centerY;


      /*
        Satellite rotation
      */

      satelliteRef.current.rotation.y += 0.008;

    }

  });


  return (
    <group ref={satelliteRef}>

      <primitive
        object={satellite}
        rotation={[
          0,
          Math.PI / 2,
          0,
        ]}
      />

    </group>
  );
}


/* =========================
   PRELOAD
========================= */

useGLTF.preload(
  "/models/satellite.glb"
);


/* =========================
   LIGHTING
========================= */

function SceneLights() {

  return (
    <>

      <ambientLight
        intensity={0.35}
      />

      <directionalLight
        position={[5, 6, 5]}
        intensity={2.2}
      />

      <pointLight
        position={[-5, 2, 4]}
        intensity={1.2}
        color="#4da6ff"
      />

    </>
  );
}


/* =========================
   SCENE
========================= */

function Scene() {

  return (
    <>

      {/* SPACE */}

      <color
        attach="background"
        args={["#000000"]}
      />


      {/* LIGHTS */}

      <SceneLights />


      {/* STARS */}

      <Stars
        radius={100}
        depth={60}
        count={6000}
        factor={2.5}
        saturation={0}
        fade
        speed={0.25}
      />


      {/* EARTH */}

      <Earth />


      {/* ORBIT */}

      <Orbit />


      {/* SATELLITE */}

      <Satellite />


      {/* ENVIRONMENT */}

      <Environment
        preset="night"
      />

    </>
  );
}


/* =========================
   EARTH SCENE
========================= */

export default function EarthScene() {

  return (

    <div
      className="
        absolute
        inset-0
        z-0
        pointer-events-none
      "
    >

      <Canvas
        camera={{
          position: [
            0,
            0.8,
            12
          ],
          fov: 42,
        }}

        dpr={[1, 1.5]}
      >

        <Scene />

      </Canvas>


      {/* DARK OVERLAY */}

      <div
        className="
          absolute
          inset-0
          bg-black/20
        "
      />

    </div>
  );
}