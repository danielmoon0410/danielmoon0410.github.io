// Numeric layout and tuning constants. No copy, no color literals -- see
// content.js for copy and css/style.css :root for colors.

export const VERSION = '1.0.0';
export const MAX_PIXEL_RATIO = 2;
export const SEED = 20260928;

export const WORLD_BOUNDS = { minX: -80, maxX: 80, minZ: -195, maxZ: 30 };
export const ROAD_WIDTH = 6;

// [x1, z1, x2, z2] centerline segments.
export const ROADS = [
  [0, 20, 0, -130],
  [-45, -40, 45, -40],
  [-45, -85, 45, -85],
  [-45, -130, 45, -130],
  [-45, -40, -45, -130],
  [45, -40, 45, -182],
];

export const SPAWN = { x: 0, z: 14, dirX: 0, dirZ: -1 };

export const PADS = {
  about: { x: 0, z: 4 },
  moe: { x: -45, z: -40 },
  echonomics: { x: 45, z: -40 },
  'portfolio-agent': { x: -45, z: -85 },
  workflow: { x: 45, z: -85 },
  'gh-portfolio': { x: 45, z: -142 },
  'gh-influence': { x: 45, z: -154 },
  'gh-ces2026': { x: 45, z: -166 },
  'gh-echonomics': { x: 45, z: -178 },
  career: { x: -45, z: -130 },
  contact: { x: 0, z: -130 },
};

export const PAD_RADIUS = 4;
export const PAD_EXIT_RADIUS = 5;

export const SCENERY_ZONES = [
  { minX: -71, maxX: -51, minZ: -48, maxZ: -32 },
  { minX: 53, maxX: 58, minZ: -47, maxZ: -33 },
  { minX: 56, maxX: 60, minZ: -95, maxZ: -75 },
  { minX: 54, maxX: 62, minZ: -182, maxZ: -138 },
  { minX: -66, maxX: -54, minZ: -136, maxZ: -124 },
  { minX: -18, maxX: 18, minZ: -10, maxZ: 24 },
];

export const LETTERS = {
  centerX: 0,
  z: -4,
  pixel: 0.5,
  depth: 0.6,
  advance: 6,
  spaceAdvance: 3,
  massPerPixel: 2,
};

export const VEHICLE = {
  halfExtents: [2, 0.5, 1],
  mass: 150,
  spawnY: 1.5,
  wheelPositions: [
    [-1, 0, 1],
    [-1, 0, -1],
    [1, 0, 1],
    [1, 0, -1],
  ],
  wheel: {
    radius: 0.5,
    suspensionStiffness: 30,
    suspensionRestLength: 0.3,
    frictionSlip: 1.4,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  },
  engineForce: 500,
  reverseFactor: 0.6,
  maxSpeed: 22,
  maxReverseSpeed: 10,        // m/s; reverse force tapers to 0 here
  speedTaperPower: 8,         // engine force x max(0, 1 - (v / cap) ** power); no on/off cut
  throttleRise: 3,            // throttle units/s away from 0 (0 -> 1 in 0.33 s)
  throttleFall: 4,            // throttle units/s toward or through 0 (1 -> 0 in 0.25 s)
  idleBrakeRamp: 1,           // s for the idle brake to ramp 0 -> idleBrake after W/S input stops
  keyReleaseDebounceMs: 100,  // a driving key's keyup counts only if no keydown for that code follows within this
  maxSteer: 0.5,
  steerRate: 8,
  brakeForce: 1000000,
  idleBrake: 5,
  flipResetSeconds: 2.5,
  fallResetY: -10,
};

export const CAMERA = {
  fov: 55,
  fovPortrait: 70,
  near: 0.1,
  far: 400,
  distance: 10.5,
  height: 7,
  minHeightAboveCar: 6.5,
  lookAhead: 3,
  lookHeight: 1,
  posLambda: 4,
  lookLambda: 6,
};

export const RENDER = {
  bloom: { strength: 0.9, radius: 0.5, threshold: 0.8 },
  fog: { near: 45, far: 170 },
  exposure: 1,
  sunOffset: [20, 40, 15],
  shadowExtent: 35,
};

export const QUALITY = {
  warmupMs: 3000,
  windowMs: 2000,
  slowFrameMs: 22,
  strikes: 2,
  levels: [
    { name: 'high', shadow: 2048, bloom: true },
    { name: 'medium', shadow: 1024, bloom: true },
    { name: 'low', shadow: 512, bloom: false },
  ],
};

export const SCENERY = {
  chipCount: 16,
  traceCount: 50,
  expertGrid: { cols: 8, rows: 6, spacing: 2.2, size: 1.2, centerX: -61, centerZ: -40, waveSpeed: 1.5 },
  ticker: { x: 55, z: -40, width: 12, height: 2, centerY: 3.5, speed: 2 },
  robots: { x: 58, zs: [-92.5, -87.5, -82.5, -77.5] },
  repos: { x: 58, size: 6, heights: [12, 16, 9, 13] },
  tower: { x: -60, z: -130 },
};

// ?shot=<station-id> capture mode (site/src/shot.js).
export const SHOT = {
  settleMs: 1500, minFrames: 10, maxFrames: 240,   // capture lands inside QUALITY.warmupMs (3000), so quality is still 'high'
  mime: 'image/jpeg', quality: 0.85,
  defaultFacing: [0, -1],                           // [dirX, dirZ] for placeCarAt; aims the follow camera at the scenery
  facing: { moe: [-1, 0], echonomics: [1, 0], workflow: [1, 0], 'gh-portfolio': [1, 0], 'gh-influence': [1, 0],
            'gh-ces2026': [1, 0], 'gh-echonomics': [1, 0], career: [-1, 0] },
  hosts: ['localhost', '127.0.0.1', '[::1]'],   // ?shot= is honoured only on these hostnames
};
