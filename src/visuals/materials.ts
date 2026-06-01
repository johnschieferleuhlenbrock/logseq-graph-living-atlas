import * as THREE from "three";

export function createParticleMaterial(opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: opacity },
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      attribute float particleSize;
      attribute float particleHeat;
      varying vec3 vColor;
      varying float vHeat;
      void main() {
        vColor = color;
        vHeat = particleHeat;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float pulse = 1.0 + sin(uTime * 2.1 + position.x * 0.06 + position.y * 0.04) * 0.08 * (0.25 + particleHeat);
        float perspective = clamp(145.0 / -mvPosition.z, 0.78, 1.62);
        gl_PointSize = clamp(particleSize * pulse * perspective, 1.45, 38.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vHeat;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float radius = length(uv);
        if (radius > 0.5) discard;
        float core = smoothstep(0.22, 0.0, radius);
        float halo = smoothstep(0.5, 0.05, radius) * 0.54;
        float alpha = min(0.98, (core + halo) * uOpacity * (0.62 + vHeat * 0.58));
        vec3 color = vColor * (1.08 + core * 2.18 + vHeat * 0.78);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

export function createLiveParticleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      attribute float particleSize;
      attribute float particleHeat;
      varying vec3 vColor;
      varying float vHeat;
      void main() {
        vColor = color;
        vHeat = particleHeat;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float flicker = 1.0 + sin(uTime * 2.4 + position.x * 0.11 + position.y * 0.08) * 0.05;
        float perspective = clamp(150.0 / -mvPosition.z, 0.86, 1.95);
        gl_PointSize = clamp(particleSize * flicker * perspective, 2.0, 70.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vHeat;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float radius = length(uv);
        if (radius > 0.5) discard;
        float core = smoothstep(0.18, 0.0, radius);
        float corona = smoothstep(0.5, 0.04, radius);
        float alpha = clamp(core + corona * 0.42, 0.0, 1.0) * clamp(0.24 + vHeat, 0.0, 0.78);
        vec3 color = vColor * (1.16 + core * 2.25 + vHeat * 1.1);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
}
