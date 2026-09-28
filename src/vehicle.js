// RaycastVehicle physics, car mesh, forces and resets.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VEHICLE } from './config.js';
import { neonMaterial, nearestRoadPoint } from './world.js';

export function createVehicle({ scene, world, palette }) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(VEHICLE.halfExtents[0], VEHICLE.halfExtents[1], VEHICLE.halfExtents[2]));
  const chassisBody = new CANNON.Body({ mass: VEHICLE.mass });
  chassisBody.addShape(chassisShape);
  chassisBody.allowSleep = false;
  chassisBody.position.set(0, VEHICLE.spawnY, 0);
  world.addBody(chassisBody);

  const vehicle = new CANNON.RaycastVehicle({ chassisBody });

  const wheelBase = {
    radius: VEHICLE.wheel.radius,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    axleLocal: new CANNON.Vec3(0, 0, 1),
    suspensionStiffness: VEHICLE.wheel.suspensionStiffness,
    suspensionRestLength: VEHICLE.wheel.suspensionRestLength,
    frictionSlip: VEHICLE.wheel.frictionSlip,
    dampingRelaxation: VEHICLE.wheel.dampingRelaxation,
    dampingCompression: VEHICLE.wheel.dampingCompression,
    maxSuspensionForce: VEHICLE.wheel.maxSuspensionForce,
    rollInfluence: VEHICLE.wheel.rollInfluence,
    maxSuspensionTravel: VEHICLE.wheel.maxSuspensionTravel,
    customSlidingRotationalSpeed: VEHICLE.wheel.customSlidingRotationalSpeed,
    useCustomSlidingRotationalSpeed: VEHICLE.wheel.useCustomSlidingRotationalSpeed,
    chassisConnectionPointLocal: new CANNON.Vec3(),
  };

  VEHICLE.wheelPositions.forEach(([x, y, z]) => {
    vehicle.addWheel({ ...wheelBase, chassisConnectionPointLocal: new CANNON.Vec3(x, y, z) });
  });
  vehicle.addToWorld(world);

  // --- Mesh -----------------------------------------------------------
  const carGroup = new THREE.Group();

  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 2), new THREE.MeshStandardMaterial({ color: palette.magenta, metalness: 0.3, roughness: 0.4 }));
  bodyMesh.castShadow = true;
  carGroup.add(bodyMesh);

  const cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 1.6), new THREE.MeshStandardMaterial({ color: palette.chip }));
  cabinMesh.position.set(0.3, 0.55, 0);
  cabinMesh.castShadow = true;
  carGroup.add(cabinMesh);

  [-0.6, 0.6].forEach((hz) => {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.4), neonMaterial(palette.cyan, 4));
    headlight.position.set(-2.02, 0, hz);
    carGroup.add(headlight);

    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.4), neonMaterial(palette.amber, 3));
    taillight.position.set(2.02, 0, hz);
    carGroup.add(taillight);
  });

  scene.add(carGroup);

  const wheelMeshes = VEHICLE.wheelPositions.map(() => {
    const geom = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
    geom.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: palette.chip }));
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });

  // --- Dynamics ---------------------------------------------------------
  let steer = 0;
  let flippedTime = 0;
  let lastForward = { x: 0, z: -1 };

  function update(input, dt) {
    const target = (input.left ? VEHICLE.maxSteer : 0) + (input.right ? -VEHICLE.maxSteer : 0);
    steer += (target - steer) * Math.min(1, VEHICLE.steerRate * dt);
    vehicle.setSteeringValue(steer, 0);
    vehicle.setSteeringValue(steer, 1);

    const worldNegX = chassisBody.quaternion.vmult(new CANNON.Vec3(-1, 0, 0));
    const forwardSpeed = chassisBody.velocity.dot(worldNegX);

    let engineForce = 0;
    if (input.forward && forwardSpeed < VEHICLE.maxSpeed) {
      engineForce = -VEHICLE.engineForce;
    } else if (input.back) {
      engineForce = VEHICLE.engineForce * VEHICLE.reverseFactor;
    }
    vehicle.applyEngineForce(engineForce, 2);
    vehicle.applyEngineForce(engineForce, 3);

    let brakeForce = 0;
    if (input.brake) {
      brakeForce = VEHICLE.brakeForce;
    } else if (!input.forward && !input.back) {
      brakeForce = VEHICLE.idleBrake;
    }
    for (let i = 0; i < 4; i++) {
      vehicle.setBrake(brakeForce, i);
    }
  }

  function sync() {
    carGroup.position.copy(chassisBody.position);
    carGroup.quaternion.copy(chassisBody.quaternion);
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
      vehicle.updateWheelTransform(i);
      const t = vehicle.wheelInfos[i].worldTransform;
      wheelMeshes[i].position.copy(t.position);
      wheelMeshes[i].quaternion.copy(t.quaternion);
    }
  }

  function placeAt(x, z, dirX, dirZ) {
    chassisBody.position.set(x, VEHICLE.spawnY, z);
    const yaw = Math.atan2(dirZ, -dirX);
    chassisBody.quaternion.setFromEuler(0, yaw, 0);
    chassisBody.velocity.setZero();
    chassisBody.angularVelocity.setZero();
    steer = 0;
    flippedTime = 0;
    chassisBody.wakeUp();
    sync();
  }

  function forward() {
    const worldNegX = chassisBody.quaternion.vmult(new CANNON.Vec3(-1, 0, 0));
    const len = Math.sqrt(worldNegX.x * worldNegX.x + worldNegX.z * worldNegX.z);
    if (len < 0.1) return { x: lastForward.x, z: lastForward.z };
    lastForward = { x: worldNegX.x / len, z: worldNegX.z / len };
    return { x: lastForward.x, z: lastForward.z };
  }

  function resetToRoad() {
    const pos = chassisBody.position;
    const np = nearestRoadPoint(pos.x, pos.z);
    if (!np) return;
    const fwd = forward();
    const dot = np.dirX * fwd.x + np.dirZ * fwd.z;
    const dirX = dot >= 0 ? np.dirX : -np.dirX;
    const dirZ = dot >= 0 ? np.dirZ : -np.dirZ;
    placeAt(np.x, np.z, dirX, dirZ);
  }

  function checkAutoReset(dt) {
    if (chassisBody.position.y < VEHICLE.fallResetY) {
      flippedTime = 0;
      resetToRoad();
      return;
    }
    const worldUp = chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    if (worldUp.y < 0.3) {
      flippedTime += dt;
      if (flippedTime >= VEHICLE.flipResetSeconds) {
        flippedTime = 0;
        resetToRoad();
      }
    } else {
      flippedTime = 0;
    }
  }

  function position() {
    return { x: chassisBody.position.x, y: chassisBody.position.y, z: chassisBody.position.z };
  }

  return { update, sync, placeAt, resetToRoad, checkAutoReset, position, forward };
}
