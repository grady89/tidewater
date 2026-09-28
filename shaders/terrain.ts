// Ported from reference/tidewater-study.html (terrainVS / terrainFS). The additions are uniforms: `clipY` and
// its discard at the top of the fragment shader (the water's reflection pass); `frame` (mat4, identity for the
// island), which maps the world position and normal into a face's own frame before the study's height and slope
// bands so the World's tilted miniatures are coloured as if flat; and `fogNear`/`fogFar` in place of the fog
// literals (45, 140), with the same defaults. The biomes (docs/biomes) turned the five band colours into uniforms with the
// study's values as defaults, and added three terms after the bands: snow above `snowLine` (999 = never), a
// per-material tint read from the height texture's blue channel (0 = none), both additive. The World (docs/globe)
// added `coastLift` (0 = the island): it raises the band mapping so a miniature's beach clears its water line.
// The colour math is verbatim.
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
    uniform float clipY; // added: the reflection pass discards everything under the water plane
    uniform mat4 frame; uniform float fogNear, fogFar;
    uniform vec3 sandDeep, sand, grassLo, grassHi, rock; // the study's bands, as uniforms (biomes)
    uniform float snowLine; uniform vec3 snowColor;       // snow above the line (999 = never)
    uniform sampler2D heightTex; uniform vec3 matTints[9]; uniform float matMix[9]; // per-material tint, code in the blue channel
    uniform float tideScale;                                // the biome's tide multiplier: the bands follow the water line
    uniform float coastLift;                                // the World: lifts the bands so a miniature's sand shows (0 = the island)
    void main(){
      if (vW.y < clipY) discard;
      vec3 L = (frame * vec4(vW, 1.0)).xyz;
      vec3 LN = normalize((frame * vec4(vN, 0.0)).xyz);
      float y = (L.y - coastLift) / tideScale;
      vec3 col = mix(sandDeep, sand, smoothstep(-1.2, 0.0, y));
      col = mix(col, grassLo, smoothstep(0.55, 0.95, y));
      col = mix(col, grassHi, smoothstep(1.4, 3.2, y));
      col = mix(col, rock, smoothstep(4.2, 5.6, y));
      col = mix(col, rock, smoothstep(0.80, 0.62, LN.y) * step(0.5, y));
      // biomes: snow above the line, and the cell material's tint
      col = mix(col, snowColor, smoothstep(snowLine, snowLine + 0.8, L.y));
      float mcode = texture2D(heightTex, L.xz / 64.0 + 0.5).b * 255.0;
      for (int k = 1; k < 9; k++) col = mix(col, matTints[k], matMix[k] * step(abs(mcode - float(k)), 0.5));
      y = L.y;
      // submerged and wet sand
      col *= mix(1.0, 0.72, smoothstep(waterLevel + 0.02, waterLevel - 0.02, y));
      float wet = smoothstep(waterLevel - 0.01, waterLevel + 0.03, y) * (1.0 - smoothstep(wetLevel - 0.05, wetLevel + 0.08, y));
      col *= mix(1.0, 0.70, wet);
      // lighting
      float nd = max(dot(vN, sunDir), 0.0);
      vec3 amb = mix(groundAmb, skyAmb, LN.y*0.5+0.5);
      vec3 lit = col * (sunColor * nd * 1.05 + amb);
      float d = distance(camPos, vW);
      lit = mix(lit, fogColor, smoothstep(fogNear, fogFar, d));
      gl_FragColor = vec4(lit, 1.0);
    }
  `;
