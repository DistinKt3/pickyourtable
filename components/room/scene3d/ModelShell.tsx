"use client";

import { useLoader, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { ClayMaterial } from "./materials";
import { SHADOW_LAYER } from "./Tables";

/** Where the Basis Universal transcoder for KTX2 textures is served (public/vendor/basis). */
export const BASIS_PATH = "/vendor/basis/";

let ktx2: KTX2Loader | null = null;

/**
 * A venue model (PRD D-2): meshopt geometry and KTX2 textures are supported. Meshes
 * exported from this builder keep their clay attributes (`_pbr`, `_rise`, `_pattern`)
 * and get the live clay material back, so walls still rise for seat views.
 */
export default function ModelShell({ url, clay, glass }: { url: string; clay: ClayMaterial; glass: THREE.Material }) {
  const gl = useThree((s) => s.gl);
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl);
    loader.setKTX2Loader(ktx2);
  }) as GLTF;
  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      for (const [from, to] of [
        ["_pbr", "pbr"],
        ["_rise", "rise"],
        ["_pattern", "pattern"],
      ] as const) {
        const attr = g.getAttribute(from);
        if (attr) {
          g.setAttribute(to, attr);
          g.deleteAttribute(from);
        }
      }
      const n = g.attributes.position!.count;
      if (o.name.startsWith("glass")) {
        if (!g.getAttribute("rise")) g.setAttribute("rise", new THREE.BufferAttribute(new Float32Array(n), 1));
        o.material = glass;
        o.renderOrder = 3;
        return;
      }
      if (g.getAttribute("pbr") && g.getAttribute("color")) {
        if (!g.getAttribute("rise")) g.setAttribute("rise", new THREE.BufferAttribute(new Float32Array(n), 1));
        if (!g.getAttribute("pattern")) g.setAttribute("pattern", new THREE.BufferAttribute(new Float32Array(n), 1));
        o.material = clay;
      }
      o.castShadow = true;
      o.receiveShadow = true;
      o.layers.enable(SHADOW_LAYER);
    });
    return root;
  }, [gltf, clay, glass]);
  return <primitive object={scene} />;
}
