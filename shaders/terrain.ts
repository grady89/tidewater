// Ported verbatim from reference/tidewater-study.html (terrainVS / terrainFS).
import { COMMON } from "./common";

export const terrainVS = `
    precision highp float;
    attribute vec3 position; attribute vec3 normal;
    uniform mat4 world; uniform mat4 worldViewProjection;
    varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = world*vec4(position,1.0); vW = w.xyz; vN = normalize((world*vec4(normal,0.0)).xyz); gl_Position = worldViewProjection*vec4(position,1.0); }
  `;

export const terrainFS = COMMON + `
    varying vec3 vW; varying vec3 vN;
    uniform vec3 sunDir, sunColor, skyAmb, groundAmb, fogColor, camPos;
    uniform float waterLevel, wetLevel;
    void main(){
      float y = vW.y;
      vec3 sandDeep = vec3(0.62,0.55,0.40);
      vec3 sand     = vec3(0.90,0.83,0.63);
      vec3 grassLo  = vec3(0.66,0.78,0.47);
      vec3 grassHi  = vec3(0.45,0.66,0.36);
      vec3 rock     = vec3(0.56,0.54,0.51);
      vec3 col = mix(sandDeep, sand, smoothstep(-1.2, 0.0, y));
      col = mix(col, grassLo, smoothstep(0.55, 0.95, y));
      col = mix(col, grassHi, smoothstep(1.4, 3.2, y));
      col = mix(col, rock, smoothstep(4.2, 5.6, y));
      col = mix(col, rock, smoothstep(0.80, 0.62, vN.y) * step(0.5, y));
      // submerged and wet sand
      col *= mix(1.0, 0.72, smoothstep(waterLevel + 0.02, waterLevel - 0.02, y));
      float wet = smoothstep(waterLevel - 0.01, waterLevel + 0.03, y) * (1.0 - smoothstep(wetLevel - 0.05, wetLevel + 0.08, y));
      col *= mix(1.0, 0.70, wet);
      // lighting
      float nd = max(dot(vN, sunDir), 0.0);
      vec3 amb = mix(groundAmb, skyAmb, vN.y*0.5+0.5);
      vec3 lit = col * (sunColor * nd * 1.05 + amb);
      float d = distance(camPos, vW);
      lit = mix(lit, fogColor, smoothstep(45.0, 140.0, d));
      gl_FragColor = vec4(lit, 1.0);
    }
  `;
