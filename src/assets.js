// Single loader point for swappable visuals. Every slot is procedural today;
// a later approved asset phase adds a GLTFLoader branch inside buildSlot for
// the relevant slot name only (see .pipeline/spec.md's "later asset phase").
import * as THREE from 'three';
import { ASSET_SLOTS, POSTER } from './config.js';
import { logError } from './errors.js';

export const SLOT_NAMES = Object.freeze(Object.keys(ASSET_SLOTS));

// Builds slot `name`. Today every slot is procedural; a later approved asset phase adds its file loader here only.
export function buildSlot(name, buildProcedural) {
  const slot = ASSET_SLOTS[name];
  if (!slot) throw new Error(`unknown asset slot: ${name}`);
  if (slot.url !== null && name !== 'poster') throw new Error(`asset slot ${name}: file assets are not enabled in this build`);
  const object = buildProcedural();
  object.userData.assetSlot = name;
  return object;
}

// Poster slot only: if ASSET_SLOTS.poster.url is set, load that image into the poster mesh (contain-fit in POSTER.plane).
export function applyPosterSlot(mesh, info) {
  const url = ASSET_SLOTS.poster.url;
  if (url === null) return;

  new THREE.TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const image = tex.image;
      const a = image.width / image.height;
      const [pw, ph] = POSTER.plane;
      if (a >= pw / ph) {
        mesh.scale.set(pw, pw / a, 1);
      } else {
        mesh.scale.set(ph * a, ph, 1);
      }
      mesh.position.y = POSTER.bottom + mesh.scale.y / 2;
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
      info.source = 'url';
    },
    undefined,
    (err) => logError(err, 'poster')
  );
}
