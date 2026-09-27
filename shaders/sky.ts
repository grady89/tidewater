// Ported from reference/tidewater-study.html (skyVS / skyFS). One fix on the study: the horizon blend clamped
// d.y to -0.05, so pow() of a negative made a black band just below the horizon (and, once the water reflected
// the sky, dark streaks across the sea). The clamp now stops at 0; everything else is the study's.
// Additions (uniforms only, additive terms after the study's colour): a moon disc with a halo (`moonDir`,
// `moon`) and a field of stars (`night`), both zero by day.
export const skyVS = `
    precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vP;
    void main(){ vP = position; gl_Position = worldViewProjection*vec4(position,1.0); }
  `;

export const skyFS = `
    precision highp float; varying vec3 vP; uniform vec3 zenith, horizon, sunDir, sunColor, moonDir; uniform float dusk, moon, night;
    float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)))*43758.5453); }
    void main(){
      vec3 d = normalize(vP);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(horizon, zenith, pow(h, 0.4));
      float s = pow(max(dot(d, sunDir), 0.0), 220.0);
      float halo = pow(max(dot(d, sunDir), 0.0), 8.0);
      col += sunColor * (s*1.2 + halo*0.18*(0.4+dusk));
      // moon: a small bright disc and a soft halo, only when it is up and the sky is dark
      float m = pow(max(dot(d, moonDir), 0.0), 600.0);
      float mhalo = pow(max(dot(d, moonDir), 0.0), 14.0);
      col += vec3(0.86, 0.90, 1.0) * (m*1.5 + mhalo*0.12) * moon;
      // stars: one in a few hundred cells of the direction, fading out toward the horizon
      float star = smoothstep(0.9965, 1.0, hash3(floor(d*220.0))) * smoothstep(0.02, 0.25, d.y) * night;
      col += vec3(0.9, 0.94, 1.0) * star * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
