// Ported verbatim from reference/tidewater-study.html (waterVS / waterFS).
// The only substitution is ${SIZE}, which the reference also interpolated from its SIZE constant.
import { COMMON } from "./common";
import { SIZE } from "../src/config";

export const waterVS = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 world; uniform mat4 worldViewProjection; uniform float time;
    varying vec3 vW;
    void main(){
      vec4 w = world*vec4(position,1.0);
      float y = 0.045*sin(w.x*0.9 + time*1.1) + 0.035*sin((w.x*0.6 + w.z*0.8)*1.3 - time*0.9) + 0.025*sin(w.z*1.7 + time*1.6);
      w.y += y; vW = w.xyz;
      gl_Position = worldViewProjection*vec4(position.x, position.y + y, position.z, 1.0);
    }
  `;

export const waterFS = `
    #extension GL_OES_standard_derivatives : enable
  ` + COMMON + `
    varying vec3 vW;
    uniform sampler2D heightTex;
    uniform vec3 sunDir, sunColor, skyColor, fogColor, camPos;
    uniform float time, dusk;
    void main(){
      vec2 uv = vW.xz / ${SIZE}.0 + 0.5;
      vec4 t = texture2D(heightTex, uv);
      float terrainH = (t.r*255.0*256.0 + t.g*255.0)/65535.0 * 12.0 - 5.0;
      float depth = vW.y - terrainH;
      if (depth < 0.0) discard;
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      if (n.y < 0.0) n = -n;
      vec3 V = normalize(camPos - vW);
      vec3 shallow = vec3(0.58,0.86,0.82), mid = vec3(0.22,0.63,0.70), deep = vec3(0.09,0.34,0.52);
      vec3 col = mix(shallow, mid, smoothstep(0.0, 0.9, depth));
      col = mix(col, deep, smoothstep(0.8, 3.2, depth));
      col = mix(col, vec3(0.10,0.24,0.42), dusk*0.55);
      float alpha = mix(0.34, 0.92, smoothstep(0.0, 1.4, depth));
      // fresnel toward sky
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col = mix(col, skyColor, fres*0.55);
      alpha = mix(alpha, 0.97, fres*0.6);
      // foam: a crisp edge line plus broken rings drifting toward the shore
      float band = 1.0 - smoothstep(0.0, 0.32, depth);
      float nz = vnoise(uv*120.0 + vec2(time*0.09, time*0.06))*0.6 + vnoise(uv*260.0 - vec2(time*0.13, time*0.04))*0.4;
      float ph = fract(depth*4.5 + time*0.22);
      float ring = smoothstep(0.80, 0.90, ph) * (1.0 - smoothstep(0.93, 1.0, ph));
      float foam = ring * band * smoothstep(0.42, 0.62, nz);
      float edge = 1.0 - smoothstep(0.0, 0.045, depth);
      foam = max(foam, edge*0.9);
      // faint streaks on open water
      float glint = smoothstep(0.86, 0.94, vnoise(uv*vec2(260.0, 70.0) + vec2(time*0.04, -time*0.07))) * 0.05 * (1.0-band);
      col = mix(col, vec3(0.97,0.99,0.99), foam) + glint;
      alpha = mix(alpha, 0.98, foam);
      // sun
      vec3 Hh = normalize(sunDir + V);
      float spec = pow(max(dot(n, Hh), 0.0), 140.0);
      col += sunColor * spec * 1.6;
      float lambert = 0.75 + 0.25*max(dot(n, sunDir), 0.0);
      col *= lambert;
      float d = distance(camPos, vW);
      col = mix(col, fogColor, smoothstep(45.0, 140.0, d));
      gl_FragColor = vec4(col, alpha);
    }
  `;
