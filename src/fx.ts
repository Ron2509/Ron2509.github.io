import * as THREE from 'three'

// Shared post-effect impulses. Anything can kick them; Scene decays them every frame.
export const fx = {
  /** chromatic aberration pulse, 0..1 */
  aberration: 0,
  /** smoke curtain in front of the name wall, 0..1, decays on its own */
  curtain: 0,
  /** the driver's name has been revealed by a burnout */
  revealed: false,
  /** reveal the name without the engine (the silent way in) */
  requestReveal: false,
  /** wind-tunnel mode faded in, 0..1 (the rolling road and wheels run with it) */
  tunnel: 0,
  /** the car pulled apart as an exploded drawing, 0..1 (Projects corner) */
  explode: 0,
}

// The name wall stands behind the car on the hero camera's line of sight, facing it.
export const WALL = {
  // sits low enough that the whole name clears the header in the hero shot
  center: new THREE.Vector3(-4.6, 1.1, -3.9),
  facing: new THREE.Vector3(7.2, 1.1, 5.6),
  width: 6.6,
  height: 3.3,
}
export const wallRight = new THREE.Vector3()
  .subVectors(WALL.facing, WALL.center).setY(0).normalize()
  .cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(-1)
export const wallToCam = new THREE.Vector3().subVectors(WALL.facing, WALL.center).setY(0).normalize()

/**
 * The car "driving" between corners, from how fast the camera is flying (Scene's CameraRig sets it):
 * speed 0..1, accel -1..1 (negative = braking), steer -1..1, dist = metres of road rolled under the car.
 * Everything that sells the motion reads this: wheels, body pitch, studio lights, floor reflections.
 */
export const drive = { speed: 0, accel: 0, steer: 0, dist: 0 }

/** Pit stop at each corner: lift is the jack height in metres, gun spins the wheels off and on. */
export const pit = { lift: 0, gun: 0 }
