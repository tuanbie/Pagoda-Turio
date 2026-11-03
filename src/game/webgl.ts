/** Kept out of Game.ts so the welcome screen can check WebGL without loading three.js. */
export function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}
