// Run 6 (shared with run 5b): low-poly people drawn with four InstancedMeshes (torso, head, legs, arms), so a whole crowd
// costs four draw calls. Limbs hang from their pivots; a positive pitch swings a limb forward. No physics.
// Yaw 0 faces +z and a person's left is +x, so forward = (sin yaw, cos yaw).
import * as THREE from 'three';
import { PERSON } from './config.js';

export function createCrowd({ palette, count, castShadow = true }) {
  const P = PERSON;
  const material = () => new THREE.MeshStandardMaterial({ color: palette.w.white, roughness: 0.8 });
  // A limb box whose top (the pivot) is at the origin.
  const limb = (w, len, d) => new THREE.BoxGeometry(w, len, d).translate(0, -len / 2, 0);

  const torso = new THREE.InstancedMesh(new THREE.BoxGeometry(P.torso[0], P.torso[1], P.torso[2]), material(), count);
  const head = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(P.headR, 1), material(), count);
  const leg = new THREE.InstancedMesh(limb(P.leg[0], P.legLen, P.leg[1]), material(), 2 * count);
  const arm = new THREE.InstancedMesh(limb(P.arm[0], P.armLen, P.arm[1]), material(), 2 * count);
  const meshes = { torso, head, leg, arm };

  const group = new THREE.Group();
  for (const mesh of Object.values(meshes)) {
    mesh.castShadow = castShadow;
    mesh.frustumCulled = false;
    group.add(mesh);
    // Colours exist from the start, so the shader variant with instance colours is the one that gets compiled.
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, palette.w.white);
  }

  const root = new THREE.Matrix4();
  const part = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let colorsDirty = true;

  // One part: the root transform, then the pivot position, then the pitch about the pivot.
  function place(mesh, index, x, y, pitch) {
    part.makeTranslation(x, y, 0);
    if (pitch) part.multiply(spin.makeRotationX(-pitch));
    part.premultiply(root);
    mesh.setMatrixAt(index, part);
  }

  // Each value is a THREE.Color.
  function setLook(i, { shirt, pants, skin }) {
    torso.setColorAt(i, shirt);
    arm.setColorAt(2 * i, shirt);
    arm.setColorAt(2 * i + 1, shirt);
    leg.setColorAt(2 * i, pants);
    leg.setColorAt(2 * i + 1, pants);
    head.setColorAt(i, skin);
    colorsDirty = true;
  }

  // y is the height of the feet of a standing person; a seated caller passes seatY - PERSON.hipY.
  function setPose(i, { x, y, z, yaw, legL, legR, armL, armR }) {
    root.makeRotationY(yaw).setPosition(x, y, z);
    place(torso, i, 0, P.hipY + P.torso[1] / 2, 0);
    place(head, i, 0, P.headY, 0);
    place(leg, 2 * i, P.legX, P.hipY, legL);
    place(leg, 2 * i + 1, -P.legX, P.hipY, legR);
    place(arm, 2 * i, P.armX, P.shoulderY, armL);
    place(arm, 2 * i + 1, -P.armX, P.shoulderY, armR);
  }

  function hide(i) {
    torso.setMatrixAt(i, zero);
    head.setMatrixAt(i, zero);
    leg.setMatrixAt(2 * i, zero);
    leg.setMatrixAt(2 * i + 1, zero);
    arm.setMatrixAt(2 * i, zero);
    arm.setMatrixAt(2 * i + 1, zero);
  }

  // Flags the matrices (and, after a setLook, the colours) for upload.
  function commit() {
    for (const mesh of Object.values(meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (colorsDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    colorsDirty = false;
  }

  for (let i = 0; i < count; i++) hide(i);
  commit();

  return { group, meshes, setLook, setPose, hide, commit };
}
