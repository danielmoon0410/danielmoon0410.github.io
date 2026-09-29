// RaycastVehicle physics, car mesh, forces and resets.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VEHICLE } from './config.js';
import { statusLightMaterial, nearestRoadPoint } from './world.js';
import { buildSlot } from './assets.js';

// Local (forward is -x); the parts fit x +/-2.1, y -0.35..1.0, z +/-1.0.
// Returns root, with root.userData.body (a Group) and root.userData.wheels
// (4 Groups); root stays at the origin and is never moved.
function buildCarModel(palette) {
  const root = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({ color: palette.w.orange, roughness: 0.35, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({ color: palette.w['car-glass'], metalness: 0.3, roughness: 0.08, envMapIntensity: 1.3 });
  const inkMat = new THREE.MeshStandardMaterial({ color: palette.w.ink });
  const tyreMat = new THREE.MeshStandardMaterial({ color: palette.w.tyre, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: palette.w.rim, metalness: 0.85, roughness: 0.3 });

  const body = new THREE.Group();

  const lower = new THREE.Mesh(new RoundedBoxGeometry(4.1, 0.62, 1.96, 3, 0.16), paint);
  lower.castShadow = true;
  body.add(lower);

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.56, 1.62, 3, 0.14), glassMat);
  cabin.position.set(0.25, 0.56, 0);
  cabin.castShadow = true;
  body.add(cabin);

  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.08, 1.66, 2, 0.04), paint);
  roof.position.set(0.35, 0.86, 0);
  roof.castShadow = true;
  body.add(roof);

  [-0.72, 1.2].forEach((px) => {
    [-0.78, 0.78].forEach((pz) => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.08), paint);
      pillar.position.set(px, 0.58, pz);
      pillar.castShadow = true;
      body.add(pillar);
    });
  });

  const belt = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.98), inkMat);
  belt.position.set(0, 0.12, 0);
  belt.castShadow = true;
  body.add(belt);

  [-2.08, 2.08].forEach((px) => {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 1.9), tyreMat);
    bumper.position.set(px, -0.14, 0);
    bumper.castShadow = true;
    body.add(bumper);
  });

  [-1.02, 1.02].forEach((pz) => {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.18), paint);
    mirror.position.set(-0.62, 0.42, pz);
    mirror.castShadow = true;
    body.add(mirror);
  });

  const headlightMat = statusLightMaterial(palette.w.lamp, 2);
  [-0.62, 0.62].forEach((pz) => {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.36), headlightMat);
    headlight.position.set(-2.07, 0.1, pz);
    headlight.castShadow = true;
    body.add(headlight);
  });

  const taillightMat = statusLightMaterial(palette.w['orange-deep'], 2);
  [-0.6, 0.6].forEach((pz) => {
    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.4), taillightMat);
    taillight.position.set(2.07, 0.12, pz);
    taillight.castShadow = true;
    body.add(taillight);
  });

  root.add(body);

  const wheels = VEHICLE.wheelPositions.map(() => {
    const wheel = new THREE.Group();

    const tyreGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.34, 28);
    tyreGeom.rotateX(Math.PI / 2);
    const tyreMesh = new THREE.Mesh(tyreGeom, tyreMat);
    tyreMesh.castShadow = true;
    wheel.add(tyreMesh);

    const rimGeom = new THREE.CylinderGeometry(0.33, 0.33, 0.36, 20);
    rimGeom.rotateX(Math.PI / 2);
    const rimGeoms = [rimGeom];
    for (let side = 0; side < 2; side++) {
      const sz = side === 0 ? -0.185 : 0.185;
      for (let k = 0; k < 5; k++) {
        const spoke = new THREE.BoxGeometry(0.07, 0.56, 0.03);
        spoke.rotateZ(k * ((2 * Math.PI) / 5));
        spoke.translate(0, 0, sz);
        rimGeoms.push(spoke);
      }
    }
    const rimMesh = new THREE.Mesh(mergeGeometries(rimGeoms), rimMat);
    rimMesh.castShadow = true;
    wheel.add(rimMesh);

    root.add(wheel);
    return wheel;
  });

  root.userData.body = body;
  root.userData.wheels = wheels;
  return root;
}

export function createVehicle({ scene, world, palette }) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(VEHICLE.halfExtents[0], VEHICLE.halfExtents[1], VEHICLE.halfExtents[2]));
  const chassisBody = new CANNON.Body({ mass: VEHICLE.mass });
  chassisBody.angularFactor.set(0, 1, 0);   // yaw only: the body never pitches or rolls
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

  // RaycastVehicle applies its wheel impulses with applyImpulse, which ignores angularFactor. The pitch/roll
  // rates it adds never turn the body, but they would skew the next step's suspension and friction maths,
  // so clear them after every physics step.
  world.addEventListener('postStep', () => {
    chassisBody.angularVelocity.x = 0;
    chassisBody.angularVelocity.z = 0;
  });

  // --- Mesh -----------------------------------------------------------
  const car = buildSlot('car', () => buildCarModel(palette));
  scene.add(car);
  const carGroup = car.userData.body;
  const wheelMeshes = car.userData.wheels;

  // --- Dynamics ---------------------------------------------------------
  let steer = 0;
  let flippedTime = 0;
  let lastForward = { x: 0, z: -1 };
  let throttle = 0; // -1..1
  let coastTime = VEHICLE.idleBrakeRamp;

  function forwardAxis() {
    return chassisBody.quaternion.vmult(new CANNON.Vec3(-1, 0, 0));
  }

  function speedAlongForward() {
    return chassisBody.velocity.dot(forwardAxis());
  }

  function pitchDeg() {
    const clamped = Math.max(-1, Math.min(1, forwardAxis().y));
    return Math.asin(clamped) * (180 / Math.PI);
  }

  function tiltDeg() {
    const fwd = new THREE.Vector3(-1, 0, 0).applyQuaternion(carGroup.quaternion);
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(carGroup.quaternion);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * (180 / Math.PI);
    const roll = Math.asin(Math.max(-1, Math.min(1, side.y))) * (180 / Math.PI);
    return { pitch, roll };
  }

  function taper(s, cap) {
    return Math.max(0, 1 - Math.pow(Math.max(0, s) / cap, VEHICLE.speedTaperPower));
  }

  function update(input, dt) {
    const target = (input.left ? VEHICLE.maxSteer : 0) + (input.right ? -VEHICLE.maxSteer : 0);
    steer += (target - steer) * Math.min(1, VEHICLE.steerRate * dt);
    vehicle.setSteeringValue(steer, 0);
    vehicle.setSteeringValue(steer, 1);

    const v = speedAlongForward();
    const throttleTarget = input.forward ? 1 : input.back ? -1 : 0;
    // Counter-brake: the pressed direction opposes the motion (S/down rolling forward, W/up rolling backward).
    const counterBraking = throttleTarget * v < -VEHICLE.counterBrakeMinSpeed;
    const rampTarget = counterBraking ? 0 : throttleTarget;
    const rampRate = (rampTarget !== 0 && rampTarget * throttle >= 0) ? VEHICLE.throttleRise : VEHICLE.throttleFall;
    const maxDelta = rampRate * dt;
    if (throttle < rampTarget) {
      throttle = Math.min(rampTarget, throttle + maxDelta);
    } else if (throttle > rampTarget) {
      throttle = Math.max(rampTarget, throttle - maxDelta);
    }

    let engineForce = 0;
    // No drive while counter-braking, or while the throttle still points against the pressed direction.
    if (!counterBraking && throttle * throttleTarget >= 0) {
      if (throttle > 0) {
        engineForce = -VEHICLE.engineForce * throttle * taper(v, VEHICLE.maxSpeed);
      } else if (throttle < 0) {
        engineForce = VEHICLE.engineForce * VEHICLE.reverseFactor * -throttle * taper(-v, VEHICLE.maxReverseSpeed);
      }
    }
    vehicle.applyEngineForce(engineForce, 2);
    vehicle.applyEngineForce(engineForce, 3);

    coastTime = throttleTarget === 0 ? Math.min(VEHICLE.idleBrakeRamp, coastTime + dt) : 0;
    const brakeForce = input.brake
      ? VEHICLE.brakeForce
      : counterBraking
        ? VEHICLE.counterBrake
        : (throttleTarget === 0 ? (VEHICLE.idleBrake * coastTime) / VEHICLE.idleBrakeRamp : 0);
    for (let i = 0; i < 4; i++) {
      vehicle.setBrake(brakeForce, i);
    }
  }

  function setVisible(on) {
    car.visible = on;
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
    throttle = 0;
    coastTime = VEHICLE.idleBrakeRamp;
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

  return {
    update,
    sync,
    placeAt,
    resetToRoad,
    checkAutoReset,
    position,
    forward,
    forwardSpeed: speedAlongForward,
    throttleValue: () => throttle,
    pitchDeg,
    setVisible,
    tiltDeg,
  };
}
