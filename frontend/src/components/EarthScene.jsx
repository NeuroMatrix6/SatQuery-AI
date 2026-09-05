import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Stars, useGLTF, Environment } from "@react-three/drei";
import * as THREE from "three";
import { useMemo, useRef } from "react";


/* =========================================================
   EARTH
========================================================= */

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
        <sphereGeometry args={[4.5, 128, 128]} />

        <meshStandardMaterial
          map={earthTexture}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>


      {/* ATMOSPHERE */}
      <mesh scale={1.045}>

        <sphereGeometry args={[4.5, 128, 128]} />

        <meshBasicMaterial
          color="#168cff"
          transparent
          opacity={0.14}
          side={THREE.BackSide}
        />

      </mesh>

    </group>
  );
}


/* =========================================================
   ORBIT
========================================================= */

function Orbit() {

  const orbitGroupRef = useRef();

  const earthPosition = new THREE.Vector3(
    0,
    -3.3,
    -3
  );

  const radiusX = 7.2;
  const radiusZ = 4.8;

  const points = [];

  /*
    Create a smooth 3D elliptical orbit.
  */

  for (let i = 0; i <= 240; i++) {

    const angle =
      (i / 240) * Math.PI * 2;

    const x =
      Math.cos(angle) * radiusX;

    const z =
      Math.sin(angle) * radiusZ;

    const localPoint =
      new THREE.Vector3(
        x,
        0,
        z
      );

    /*
      Tilt orbit so it looks
      like a real 3D orbital path.
    */

    localPoint.applyEuler(
      new THREE.Euler(
        0.55,
        0.0,
        -0.32
      )
    );

    localPoint.add(earthPosition);

    points.push(localPoint);
  }

  const geometry =
    new THREE.BufferGeometry().setFromPoints(points);


  return (
    <line
      geometry={geometry}
      ref={orbitGroupRef}
    >
      <lineBasicMaterial
        color="#148bff"
        transparent
        opacity={0.55}
      />
    </line>
  );
}


/* =========================================================
   SATELLITE
========================================================= */

function Satellite() {

  const satelliteRef = useRef();

  const { scene } =
    useGLTF("/models/satellite.glb");


  /*
    Clone GLB so the original
    model remains untouched.
  */

  const satellite = useMemo(() => {

    const model =
      scene.clone(true);

    /*
      Calculate actual model size.
    */

    const box =
      new THREE.Box3()
        .setFromObject(model);

    const size =
      new THREE.Vector3();

    box.getSize(size);


    const largestDimension =
      Math.max(
        size.x,
        size.y,
        size.z
      );


    /*
      Satellite stays smaller
      than the Earth.
    */

    const desiredSize = 1.10;

    const scale =
      desiredSize /
      largestDimension;

    model.scale.setScalar(scale);

    return model;

  }, [scene]);


  /* =======================================================
     FULL 360° ORBIT
  ======================================================= */

  useFrame(({ clock }) => {

    const t =
      clock.getElapsedTime();

    const earthX = 0;
    const earthY = -3.3;
    const earthZ = -3;

    const radiusX = 7.2;
    const radiusZ = 4.8;

    const speed = 0.34;

    const angle =
      t * speed;


    /*
      Base elliptical position.
    */

    const position =
      new THREE.Vector3(
        Math.cos(angle) * radiusX,
        0,
        Math.sin(angle) * radiusZ
      );


    /*
      Same 3D tilt as orbit.
    */

    position.applyEuler(
      new THREE.Euler(
        0.55,
        0.0,
        -0.32
      )
    );


    /*
      Move around Earth's center.
    */

    position.x += earthX;
    position.y += earthY;
    position.z += earthZ;


    if (satelliteRef.current) {

      satelliteRef.current.position.copy(
        position
      );


      /*
        Rotate satellite around
        its own axis.
      */

      satelliteRef.current.rotation.y += 0.008;


      /*
        Slight floating / orientation
        effect for a more natural look.
      */

      satelliteRef.current.rotation.x =
        Math.sin(t * 0.7) * 0.08;

    }

  });


  return (
    <group ref={satelliteRef}>

      <primitive
        object={satellite}
        rotation={[
          0,
          Math.PI / 2,
          0
        ]}
      />

    </group>
  );
}


/* =========================================================
   PRELOAD
========================================================= */

useGLTF.preload(
  "/models/satellite.glb"
);


/* =========================================================
   LIGHTING
========================================================= */

function SceneLights() {

  return (
    <>

      <ambientLight
        intensity={0.40}
      />

      <directionalLight
        position={[6, 8, 6]}
        intensity={2.4}
      />

      <pointLight
        position={[-6, 3, 5]}
        intensity={1.4}
        color="#4da6ff"
      />

    </>
  );
}


/* =========================================================
   SCENE
========================================================= */

function Scene() {

  return (
    <>

      {/* SPACE BACKGROUND */}

      <color
        attach="background"
        args={["#000000"]}
      />


      {/* LIGHTING */}

      <SceneLights />


      {/* =====================================================
          STARS
      ====================================================== */}

      <Stars
        radius={130}
        depth={100}
        count={10000}
        factor={3.2}
        saturation={0}
        fade={false}
        speed={0.12}
      />


      {/* =====================================================
          EARTH
      ====================================================== */}

      <Earth />


      {/* =====================================================
          ORBIT
      ====================================================== */}

      <Orbit />


      {/* =====================================================
          SATELLITE
      ====================================================== */}

      <Satellite />


      {/* ENVIRONMENT */}

      <Environment
        preset="night"
      />

    </>
  );
}


/* =========================================================
   EARTH SCENE
========================================================= */

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
            13.5
          ],
          fov: 44,
        }}

        dpr={[1, 1.5]}
      >

        <Scene />

      </Canvas>

    </div>
  );
}