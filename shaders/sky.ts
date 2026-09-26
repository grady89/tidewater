// Ported verbatim from reference/tidewater-study.html (skyVS / skyFS).
export const skyVS = `
    precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vP;
    void main(){ vP = position; gl_Position = worldViewProjection*vec4(position,1.0); }
  `;

export const skyFS = `
    precision highp float; varying vec3 vP; uniform vec3 zenith, horizon, sunDir, sunColor; uniform float dusk;
    void main(){
      vec3 d = normalize(vP);
      float h = clamp(d.y, -0.05, 1.0);
      vec3 col = mix(horizon, zenith, pow(h, 0.4));
      float s = pow(max(dot(d, sunDir), 0.0), 220.0);
      float halo = pow(max(dot(d, sunDir), 0.0), 8.0);
      col += sunColor * (s*1.2 + halo*0.18*(0.4+dusk));
      gl_FragColor = vec4(col, 1.0);
    }
  `;
