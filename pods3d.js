// A real 3D AirPod, built from geometry — no downloaded model, so the license is
// clean (three.js, MIT, vendored) and it works offline.
//
// mountPods(el, { count, spin }) renders into el and returns a stop() function.
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

function buildPod() {
  const pod = new THREE.Group();

  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf6f6f8, roughness: 0.16, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.12,
  });

  // Head: a sphere pulled into the bean-ish earbud body
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), white);
  head.scale.set(1.08, 0.92, 1.12);
  head.position.set(0, 1.28, 0);
  head.rotation.z = -0.35;
  pod.add(head);

  // In-ear tip, angled toward the listener
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 32), white);
  tip.scale.set(1, 0.9, 1);
  tip.position.set(0.72, 1.5, 0.55);
  pod.add(tip);

  // Speaker grille on the tip
  const grille = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 32),
    new THREE.MeshStandardMaterial({ color: 0x141417, roughness: 0.6 }),
  );
  grille.position.set(1.02, 1.6, 0.82);
  grille.lookAt(2.6, 2.0, 2.1);
  pod.add(grille);

  // Stem: capsule, slightly flattened like the real thing
  // Pro-length stem: short
  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.25, 12, 24), white);
  stem.scale.set(1, 1, 0.8);
  stem.position.set(-0.18, 0.35, 0);
  stem.rotation.z = 0.1;
  pod.add(stem);

  // Silver mic ring at the stem foot
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.33, 0.14, 24),
    new THREE.MeshStandardMaterial({ color: 0xb9b9c2, roughness: 0.35, metalness: 0.8 }),
  );
  foot.position.set(-0.25, -0.32, 0);
  foot.rotation.z = 0.1;
  pod.add(foot);

  return pod;
}

export function mountPods(el, { count = 2, spin = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer)
    .fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, el.clientWidth / el.clientHeight, 0.1, 50);
  camera.position.set(0, 0.9, 7.6);
  camera.lookAt(0, 0.75, 0);

  // warm key light so the white reads against a dark page, like the reference shots
  const key = new THREE.DirectionalLight(0xffd9c0, 1.4);
  key.position.set(4, 6, 6);
  scene.add(key, new THREE.AmbientLight(0x404048, 1.2));

  const pods = [];
  for (let i = 0; i < count; i++) {
    const p = buildPod();
    p.position.x = count === 1 ? 0 : (i ? 1.75 : -1.75);
    if (i) p.scale.x = -1;                 // the right bud is the mirror of the left
    p.rotation.y = i ? 0.5 : -0.5;
    scene.add(p);
    pods.push(p);
  }

  let raf, t = 0;
  const tick = () => {
    if (spin) { t += 0.004; pods.forEach((p, i) => { p.rotation.y = (i ? 0.5 : -0.5) + Math.sin(t + i) * 0.55; }); }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => { cancelAnimationFrame(raf); renderer.dispose(); el.removeChild(renderer.domElement); };
}
