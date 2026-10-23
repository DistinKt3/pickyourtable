"use client";

import { BrightnessContrast, EffectComposer, FXAA, HueSaturation, N8AO, ToneMapping } from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import { BlendFunction, Effect, ToneMappingMode } from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * Post: N8AO ambient occlusion, AgX tone mapping, then the backdrop pass, which lays
 * the image over the page color using the coverage the ground wrote into alpha, so
 * the diorama fades into exactly the page background.
 */

const BACKDROP_FRAG = `
uniform vec3 uBackdrop;
float pytDither(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = mix(uBackdrop, inputColor.rgb, clamp(inputColor.a, 0.0, 1.0));
  c += pytDither(gl_FragCoord.xy) * (1.0 / 420.0);
  outputColor = vec4(c, 1.0);
}`;

export class BackdropEffect extends Effect {
  constructor() {
    super("BackdropEffect", BACKDROP_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([["uBackdrop", new THREE.Uniform(new THREE.Color())]]),
    });
  }
  setBackdrop(hex: string) {
    // Mixed in linear space; the final pass encodes to sRGB, landing exactly on the token.
    (this.uniforms.get("uBackdrop")!.value as THREE.Color).set(hex);
  }
}

export type Quality = 0 | 1 | 2;

export interface EffectsProps {
  background: string;
  look: { contrast: number; saturation: number };
  quality: Quality;
  aoIntensity: number;
  aoColor: string;
  /** Seat renders: the most AO samples and full resolution. */
  render?: boolean;
}

export function Effects({ background, look, quality, aoIntensity, aoColor, render = false }: EffectsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const backdrop = useMemo(() => new BackdropEffect(), []);
  useEffect(() => {
    backdrop.setBackdrop(background);
    invalidate();
  }, [backdrop, background, invalidate]);
  useEffect(() => () => backdrop.dispose(), [backdrop]);

  const ao = render || quality > 0;
  return (
    <EffectComposer multisampling={render ? 8 : quality === 2 ? 4 : 0} enableNormalPass={false}>
      {ao ? (
        <N8AO
          aoRadius={render ? 0.7 : 0.6}
          distanceFalloff={0.5}
          intensity={aoIntensity}
          color={aoColor}
          quality={render ? "ultra" : quality === 2 ? "medium" : "low"}
          halfRes={!render && quality < 2}
          depthAwareUpsampling
          screenSpaceRadius={false}
        />
      ) : (
        <></>
      )}
      <ToneMapping mode={ToneMappingMode.AGX} />
      {/* AgX is gentle at the top end; a touch of contrast and color keeps the clay crisp. */}
      <BrightnessContrast brightness={0.02} contrast={look.contrast} />
      <HueSaturation saturation={look.saturation} />
      <primitive object={backdrop} />
      {/* Without multisampling, FXAA: far lighter to ship than SMAA and its lookup images. */}
      {!render && quality < 2 ? <FXAA /> : <></>}
    </EffectComposer>
  );
}
