// Numeric layout and tuning constants. No copy, no color literals -- see
// content.js for copy and css/style.css :root for colors.

export const VERSION = '1.0.0';
export const MAX_PIXEL_RATIO = 2;
export const SEED = 20260928;

export const WORLD_BOUNDS = { minX: -240, maxX: 240, minZ: -615, maxZ: 60 };   // run 3: 160 x 225 m; now 3x per side
export const ROAD_WIDTH = 8;

// [x1, z1, x2, z2] centerline segments.
export const ROADS = [
  [0, 40, 0, -560],          // boulevard: spawn -> hackathon plaza
  [-135, -120, 135, -120],   // row 1: moe, echonomics
  [-135, -255, 135, -255],   // row 2: portfolio-agent, workflow
  [-135, -390, 135, -390],   // row 3: career, contact
  [-135, -120, -135, -390],  // west drive
  [135, -120, 135, -500],    // east drive: GitHub district
];

export const SPAWN = { x: 0, z: 14, dirX: 0, dirZ: -1 };

// drive:hold / drive:brake start here heading -z; the boulevard is straight and clear to the row-2 road edge (z -251).
export const TEST_LANE = { x: 0, z: -130 };

export const PADS = {
  about: { x: 0, z: 4 },
  moe: { x: -135, z: -120 },
  echonomics: { x: 135, z: -120 },
  'portfolio-agent': { x: -135, z: -255 },
  workflow: { x: 135, z: -255 },
  'gh-portfolio': { x: 135, z: -430 },
  'gh-influence': { x: 135, z: -450 },
  'gh-ces2026': { x: 135, z: -470 },
  'gh-echonomics': { x: 135, z: -490 },
  career: { x: -135, z: -390 },
  contact: { x: 0, z: -390 },
};

export const PAD_RADIUS = 4;
export const PAD_EXIT_RADIUS = 5;

// Keep-out rectangles: station scenery, spawn plaza, hackathon plaza. No trees or inlays inside (+2 m).
export const SCENERY_ZONES = [
  { minX: -165, maxX: -139, minZ: -132, maxZ: -108 },
  { minX: 139, maxX: 152, minZ: -130, maxZ: -110 },
  { minX: 139, maxX: 156, minZ: -268, maxZ: -242 },
  { minX: 139, maxX: 158, minZ: -500, maxZ: -420 },
  { minX: -162, maxX: -139, minZ: -402, maxZ: -378 },
  { minX: -20, maxX: 20, minZ: -12, maxZ: 40 },
  { minX: -84, maxX: 84, minZ: -600, maxZ: -526 },
];

export const LETTERS = {
  centerX: 0,
  z: -4.5,
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
  counterBrake: 7.5,          // per-wheel brake impulse (N s per step) while W/S opposes the motion: 4 x 7.5 x 60 / 150 kg = 12 m/s^2
  counterBrakeMinSpeed: 0.5,  // m/s; below this the opposite key drives instead of braking
  flipResetSeconds: 2.5,
  fallResetY: -10,
};

export const CAMERA = {
  fov: 55,
  fovPortrait: 70,
  near: 0.5,
  far: 900,
  distance: 10.5,
  height: 7,
  minHeightAboveCar: 6.5,
  lookAhead: 3,
  lookHeight: 1,
  posLambda: 4,
  lookLambda: 6,
};

export const RENDER = {
  exposure: 1.1,
  bloom: { strength: 0.12, radius: 0.3, threshold: 1.2 },
  fog: { near: 160, far: 760 },
  sunOffset: [30, 50, 40],
  sunIntensity: 2.6,
  hemiIntensity: 0.6,
  shadowExtent: 40,
  ao: { resolutionScale: 0.5, radius: 0.8, thickness: 1, scale: 1, samples: 12, blend: 0.85 },
  sky: { width: 1024, height: 512, clouds: 16, sunGlowPx: 90 },
  floorTileMeters: 8,
  maxAnisotropy: 8,
  aaMaxDpr: 2,   // SMAA runs only when devicePixelRatio is below this
};

export const QUALITY = {
  warmupMs: 3000,
  windowMs: 2000,
  slowFrameMs: 22,
  strikes: 2,
  levels: [
    { name: 'high', shadow: 2048, bloom: true, ao: true, aa: true, pixels: 2073600 },      // 1920 x 1080
    { name: 'medium', shadow: 1024, bloom: true, ao: false, aa: true, pixels: 1440000 },   // 1600 x 900
    { name: 'low', shadow: 512, bloom: false, ao: false, aa: false, pixels: 921600 },      // 1280 x 720
  ],
};

// Offsets are relative to the station's pad, in x.
export const SCENERY = {
  inlayCount: 50,
  expertGrid: { cols: 8, rows: 6, spacing: 2.2, size: 1.2, offsetX: -16, waveSpeed: 1.5 },
  ticker: { offsetX: 10, width: 12, height: 2, centerY: 3.5, speed: 2 },
  robots: { offsetX: 13, dz: [-7.5, -2.5, 2.5, 7.5] },
  repos: { offsetX: 13, size: 6, heights: [12, 16, 9, 13] },
  tower: { offsetX: -15 },
};

// stations.js sign centres (before the ±0.3 m bob) and x offsets from the pad. about clears DANIEL MOON in ?shot=about;
// workflow floats over the robot row, above the robots' labels, in ?shot=workflow.
export const SIGNS = { y: 5.5, overrides: { about: { dx: 0, y: 6.3 }, workflow: { dx: SCENERY.robots.offsetX, y: 6.6 } } };

// Buildings are { kind, x, z, w, d, h }: centre, x-size, z-size, height, in metres.
// Each one was checked to stay at least 6 m clear of every road.
export const CAMPUS = {
  buildings: [
    { kind: 'pavilion', x: -68, z: -188, w: 70, d: 50, h: 12 },
    { kind: 'pavilion', x: 68, z: -188, w: 80, d: 56, h: 14 },
    { kind: 'tower', x: -95, z: -318, w: 32, d: 32, h: 84 },
    { kind: 'tower', x: -47, z: -318, w: 32, d: 32, h: 68 },
    { kind: 'office', x: -71, z: -358, w: 88, d: 16, h: 10 },
    { kind: 'office', x: 40, z: -300, w: 50, d: 30, h: 26 },
    { kind: 'office', x: 95, z: -345, w: 50, d: 40, h: 20 },
    { kind: 'office', x: -95, z: -45, w: 64, d: 44, h: 24 },
    { kind: 'office', x: 170, z: -70, w: 44, d: 50, h: 20 },
    { kind: 'office', x: -190, z: -70, w: 44, d: 50, h: 16 },
    { kind: 'office', x: -195, z: -200, w: 50, d: 60, h: 30 },
    { kind: 'office', x: -195, z: -300, w: 50, d: 50, h: 22 },
    { kind: 'office', x: -200, z: -470, w: 50, d: 60, h: 26 },
    { kind: 'office', x: 195, z: -200, w: 50, d: 60, h: 28 },
    { kind: 'office', x: 195, z: -330, w: 50, d: 50, h: 34 },
    { kind: 'office', x: 190, z: -560, w: 60, d: 50, h: 20 },
    { kind: 'office', x: -80, z: -465, w: 60, d: 50, h: 18 },
    { kind: 'office', x: 70, z: -465, w: 60, d: 50, h: 22 },
    { kind: 'canopy', x: -60, z: -560, w: 30, d: 20, h: 7 },
    { kind: 'canopy', x: 60, z: -560, w: 30, d: 20, h: 7 },
  ],
  lawns: [
    { minX: -127, maxX: -8, minZ: -247, maxZ: -128 }, { minX: 8, maxX: 127, minZ: -247, maxZ: -128 },
    { minX: -127, maxX: -8, minZ: -382, maxZ: -263 }, { minX: 8, maxX: 127, minZ: -382, maxZ: -263 },
    { minX: -236, maxX: -143, minZ: -596, maxZ: -140 }, { minX: 160, maxX: 236, minZ: -596, maxZ: -140 },
    { minX: -236, maxX: -24, minZ: -112, maxZ: 56 }, { minX: 24, maxX: 236, minZ: -112, maxZ: 56 },
    { minX: -127, maxX: -8, minZ: -526, maxZ: -398 }, { minX: 8, maxX: 127, minZ: -526, maxZ: -398 },
  ],
  plazas: [
    { minX: -24, maxX: 24, minZ: -14, maxZ: 44 },
    { minX: -84, maxX: 84, minZ: -598, maxZ: -530 },
  ],
  pool: { x: 65, z: -35, w: 56, d: 26 },
  lamps: { x: 7, zFrom: -20, zTo: -540, step: 26, skipNear: 8 },
  facadeCell: [3, 4],   // metres per facade texture tile (w, h)
};

export const POSTER = {
  canvas: [2048, 512],
  plane: [144, 36],     // metres; bottom edge at y = bottom
  bottom: 1.5,
  wall: { x: 0, z: -600, w: 160, h: 42, d: 4 },
};

export const MINIMAP = { carPx: 9, carPxSmall: 7, labelPx: 11, labelPxSmall: 9, smallBelowPx: 140, dotPx: 2.5, dotClearPx: 3.5, labelGapPx: 4 };

// Single swap point for later CC0 assets (see assets.js). null = procedural build.
export const ASSET_SLOTS = {
  car: { url: null },
  roadTiles: { url: null },
  buildings: { url: null },
  props: { url: null },
  poster: { url: null },
};

// ?shot=<station-id> capture mode (site/src/shot.js).
export const SHOT = {
  settleMs: 1500, minFrames: 10, maxFrames: 240,   // capture lands inside QUALITY.warmupMs (3000), so quality is still 'high'
  mime: 'image/jpeg', quality: 0.85,
  defaultFacing: [0, -1],                           // [dirX, dirZ] for placeCarAt; aims the follow camera at the scenery
  facing: { moe: [-1, 0], echonomics: [1, 0], workflow: [1, 0], 'gh-portfolio': [1, 0], 'gh-influence': [1, 0],
            'gh-ces2026': [1, 0], 'gh-echonomics': [1, 0], career: [-1, 0] },
  views: { poster: { x: 0, z: -520, facing: [0, -1] }, spawn: { x: 0, z: 14, facing: [0, -1] }, junction: { x: 0, z: -100, facing: [0, -1] }, pond: { x: -45, z: -60, facing: [0, -1] } },   // QA views, not stations
  hosts: ['localhost', '127.0.0.1', '[::1]'],   // ?shot= is honoured only on these hostnames
  sceneTime: 0,   // shot.js poses sign bob, pad rings, robots and the expert grid at this time, and the signal clock at 0
};

// Spawn subtitle (letters.js): a floor decal. The letters' front face is at z -4.2; the about pad's ring reaches z -1.175 at its largest (radius 5).
export const SUBTITLE = { canvas: [2048, 512], width: 15, depth: 2.45, z: -2.425, y: 0.08, measurePx: 100, inkW: 0.72, inkH: 0.86 };

// landscape.js; scatter uses mulberry32(SEED + seedOffset). Ponds are fixed like CAMPUS.buildings; each gets one bridge along z.
export const LANDSCAPE = {
  seedOffset: 23,
  trees: { count: 300, minSpacing: 5, attemptsPer: 40, species: [
    { name: 'round', weight: 0.5, scale: [0.85, 1.35] },
    { name: 'conifer', weight: 0.3, scale: [0.9, 1.5] },
    { name: 'blossom', weight: 0.2, scale: [0.75, 1.15] },
  ] },
  beds: { count: 40, attemptsPer: 80, r: [1.4, 2.6], aspect: [0.65, 1], gap: 3, treeGap: 1.5, flowersPerM2: 2.2,
    minFlowers: 10, moundHeight: 0.45, secondaryShare: 0.2, colors: ['flower-red', 'flower-yellow', 'flower-violet', 'white', 'orange'] },
  ponds: [{ x: -45, z: -85, rx: 12, rz: 8 }, { x: 98, z: -292, rx: 12, rz: 9 }],
  pondMargin: 3,
  rim: { segments: 32, width: 0.5, height: 0.3, colliderHeight: 0.6 },
  bridge: { width: 5, deckHeight: 0.45, thickness: 0.2, overhang: 1, rampLength: 6, railHeight: 0.9, postStep: 2, corridorHalfWidth: 10, corridorPad: 14 },
};

// traffic.js. Axis 'z' = traffic along z (the boulevard); axis 'x' = the row roads.
export const TRAFFIC = {
  junctions: [{ id: 'j1', x: 0, z: -120 }, { id: 'j2', x: 0, z: -255 }, { id: 'j3', x: 0, z: -390 }],
  phases: [
    { z: 'green', x: 'red', s: 9 }, { z: 'yellow', x: 'red', s: 2 }, { z: 'red', x: 'red', s: 1 },
    { z: 'red', x: 'green', s: 9 }, { z: 'red', x: 'yellow', s: 2 }, { z: 'red', x: 'red', s: 1 },
  ],
  crosswalk: { inner: 5.5, depth: 3, stripes: 7, stripeWidth: 0.5, pitch: 1, y: 0.065 },
  dashClear: 11,   // world.js: no centre dash closer than this to a junction centre
  pole: { offset: 6.5, height: 4.4, headY: 3.7, lampStep: 0.32, lampRadius: 0.12 },
  lampOn: 0.7, lampOffScale: 0.25,
};

// music.js. melody: [midi, steps] on an 8th-note grid, 8 bars x 8 steps; bass: roots[bar] + bassPattern on steps 0,2,4,6.
export const MUSIC = {
  bpm: 126, lookAheadS: 0.3, tickMs: 100, master: 0.28, fadeS: 0.3, storageKey: 'hynix-portfolio.music',
  lead: { peak: 0.1, lowpassHz: 2400 }, bass: { peak: 0.22 }, hat: { peak: 0.05, decayS: 0.04, highpassHz: 6000 },
  melody: [
    [64, 1], [67, 1], [72, 2], [71, 1], [67, 1], [64, 2],  [62, 1], [67, 1], [71, 2], [69, 1], [67, 1], [62, 2],
    [60, 1], [64, 1], [69, 2], [67, 1], [64, 1], [60, 2],  [57, 1], [60, 1], [65, 2], [64, 1], [62, 1], [60, 2],
    [64, 1], [67, 1], [72, 1], [76, 1], [74, 2], [72, 2],  [71, 1], [74, 1], [67, 2], [69, 1], [71, 1], [67, 2],
    [69, 1], [72, 1], [65, 2], [67, 1], [69, 1], [65, 2],  [62, 2], [67, 2], [65, 1], [62, 1], [59, 2],
  ],
  roots: [48, 43, 45, 41, 48, 43, 41, 43], bassPattern: [0, 12, 7, 12], hatSteps: [1, 3, 5, 7],
};
