// Ported from reference/tidewater-study.html (waterVS / waterFS). The fragment shader is verbatim; the vertex
// shader keeps the study's wave math and adds uniforms only: `waveAmp` scales the swell (storms), and
// `waveDir/waveFront/waveHeight/waveWidth` add a travelling crest (the tsunami). With waveAmp = 1 and
// waveHeight = 0 the displacement is exactly the study's.
// Backlog 1 adds a planar reflection: the vertex shader passes its clip position (`vClip`), and the fragment
// shader mixes `reflectTex` (a MirrorTexture sampled at the fragment's own screen position, nudged by the facet
// normal) into the sky it already reflects, by `reflectMix`. With reflectMix = 0 the colour is exactly the study's.
// Backlog 2 adds caustics: two drifting noise layers sharpened into a web, added to the colour in the shallow
// band only, scaled by the `caustics` uniform (0 = nothing added). Additive; nothing else in the fragment moved.
// The World (docs/globe) adds three uniforms: `frame` (mat4, identity for the island) maps the fragment's world
// position and facet normal into a face's own frame before the study's height/depth/uv math, so a tilted face of
// the globe is shaded as if it lay flat; `fogNear`/`fogFar` replace the study's fog literals (45, 140) with the
// same defaults. With identity and the defaults every line computes what it did.
// The only substitution is ${SIZE}, which the reference also interpolated from its SIZE constant.
import { COMMON } from "./common";
import { SIZE } from "../src/config";

export const waterVS = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 world; uniform mat4 worldViewProjection; uniform float time;
    uniform float waveAmp; uniform vec2 waveDir; uniform float waveFront; uniform float waveHeight; uniform float waveWidth;
    varying vec3 vW; varying vec4 vClip;
    void main(){
      vec4 w = world*vec4(position,1.0);
      float y = 0.045*sin(w.x*0.9 + time*1.1) + 0.035*sin((w.x*0.6 + w.z*0.8)*1.3 - time*0.9) + 0.025*sin(w.z*1.7 + time*1.6);
      y *= waveAmp;
      float crest = (dot(w.xz, waveDir) - waveFront) / max(waveWidth, 0.001);
      y += waveHeight * exp(-crest*crest);
      w.y += y; vW = w.xyz;
      gl_Position = worldViewProjection*vec4(position.x, position.y + y, position.z, 1.0);
      vClip = gl_Position;
    }
  `;

export const waterFS = `
    #extension GL_OES_standard_derivatives : enable
  ` + COMMON + `
    varying vec3 vW; varying vec4 vClip;
    uniform sampler2D heightTex; uniform sampler2D reflectTex;
    uniform vec3 sunDir, sunColor, skyColor, fogColor, camPos;
    uniform float time, dusk, reflectMix, caustics;
    uniform mat4 frame; uniform float fogNear, fogFar;
    void main(){
      vec3 L = (frame * vec4(vW, 1.0)).xyz;
      vec2 uv = L.xz / ${SIZE}.0 + 0.5;
      vec4 t = texture2D(heightTex, uv);
      float terrainH = (t.r*255.0*256.0 + t.g*255.0)/65535.0 * 12.0 - 5.0;
      float depth = L.y - terrainH;
      if (depth < 0.0) discard;
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      if ((frame * vec4(n, 0.0)).y < 0.0) n = -n;
      vec3 V = normalize(camPos - vW);
      vec3 shallow = vec3(0.58,0.86,0.82), mid = vec3(0.22,0.63,0.70), deep = vec3(0.09,0.34,0.52);
      vec3 col = mix(shallow, mid, smoothstep(0.0, 0.9, depth));
      col = mix(col, deep, smoothstep(0.8, 3.2, depth));
      col = mix(col, vec3(0.10,0.24,0.42), dusk*0.55);
      float alpha = mix(0.34, 0.92, smoothstep(0.0, 1.4, depth));
      // fresnel toward sky
      float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      vec2 ruv = vClip.xy / vClip.w * 0.5 + 0.5 + n.xz * 0.03;
      vec3 skyRef = mix(skyColor, texture2D(reflectTex, ruv).rgb, reflectMix);
      col = mix(col, skyRef, fres*mix(0.55, 0.7, reflectMix));
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
      // caustics: a bright web in the shallows, gone at the shoreline and by ~1.2 deep
      float cw = vnoise(L.xz*2.6 + vec2(time*0.35, time*0.2))*0.5 + vnoise(L.xz*4.3 - vec2(time*0.28, -time*0.33))*0.5;
      cw = pow(smoothstep(0.5, 0.85, cw), 2.0);
      float cmask = smoothstep(0.03, 0.2, depth) * (1.0 - smoothstep(0.6, 1.6, depth));
      col += vec3(0.85, 0.95, 0.9) * cw * cmask * caustics * 1.1;
      // sun
      vec3 Hh = normalize(sunDir + V);
      float spec = pow(max(dot(n, Hh), 0.0), 140.0);
      col += sunColor * spec * 1.6;
      float lambert = 0.75 + 0.25*max(dot(n, sunDir), 0.0);
      col *= lambert;
      float d = distance(camPos, vW);
      col = mix(col, fogColor, smoothstep(fogNear, fogFar, d));
      gl_FragColor = vec4(col, alpha);
    }
  `;
