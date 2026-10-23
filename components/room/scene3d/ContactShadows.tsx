"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { siteBounds } from "@/lib/venue/geometry";
import type { Venue } from "@/lib/venue/schema";
import { SHADOW_LAYER } from "./Tables";

/**
 * Soft contact shadows, baked: the furniture is rendered once from below into a
 * depth-darkness texture, blurred, and laid on the floor. It re-renders only when
 * `version` changes (a theme switch, a table ghosting), never per frame.
 */

export interface ContactShadowsProps {
  venue: Venue;
  version: number;
  opacity: number;
  /** Texture size along the longer side. */
  resolution?: number;
  blur?: number;
}

export const CONTACT_Y = 0.008;

export function ContactShadows({ venue, version, opacity, resolution = 1024, blur = 2.2 }: ContactShadowsProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const plane = useRef<THREE.Mesh>(null);

  const setup = useMemo(() => {
    const b = siteBounds(venue);
    const pad = 1;
    const width = b.maxX - b.minX + pad * 2;
    const depth = b.maxZ - b.minZ + pad * 2;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const rw = width >= depth ? resolution : Math.round((resolution * width) / depth);
    const rh = width >= depth ? Math.round((resolution * depth) / width) : resolution;
    const rt = new THREE.WebGLRenderTarget(rw, rh);
    const rtBlur = new THREE.WebGLRenderTarget(rw, rh);
    rt.texture.generateMipmaps = false;
    rtBlur.texture.generateMipmaps = false;
    const far = 1.25;
    // Looking straight up from the floor.
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, far);
    camera.position.set(cx, CONTACT_Y, cz);
    camera.up.set(0, 0, -1);
    camera.lookAt(cx, CONTACT_Y + 1, cz);
    camera.updateMatrixWorld();
    camera.layers.set(SHADOW_LAYER);
    // The surface nearest the floor wins, so the darkest value is kept.
    const depthMaterial = new THREE.MeshDepthMaterial();
    depthMaterial.side = THREE.DoubleSide;
    depthMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "vec4( vec3( 1.0 ), pow( 1.0 - fragCoordZ, 1.6 ) );",
      );
    };
    const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    hBlur.depthTest = vBlur.depthTest = false;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    // Seen from below, east and west swap: mirror the texture across.
    const uv = geometry.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    return { rt, rtBlur, camera, depthMaterial, hBlur, vBlur, quad, quadCam, geometry, cx, cz, rw, rh };
  }, [venue, resolution]);

  useEffect(
    () => () => {
      setup.rt.dispose();
      setup.rtBlur.dispose();
      setup.depthMaterial.dispose();
      setup.hBlur.dispose();
      setup.vBlur.dispose();
      setup.quad.geometry.dispose();
      setup.geometry.dispose();
    },
    [setup],
  );

  const pending = useRef(true);
  useEffect(() => {
    pending.current = true;
    invalidate();
  }, [version, setup, invalidate]);

  useFrame(() => {
    if (!pending.current) return;
    pending.current = false;
    const s = setup;
    const prevTarget = gl.getRenderTarget();
    const prevBackground = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevClear = gl.getClearColor(new THREE.Color());
    const prevAlpha = gl.getClearAlpha();
    if (plane.current) plane.current.visible = false;
    scene.background = null;
    scene.overrideMaterial = s.depthMaterial;
    gl.setClearColor(0xffffff, 0);
    gl.setRenderTarget(s.rt);
    gl.clear();
    gl.render(scene, s.camera);
    scene.overrideMaterial = prevOverride;
    const pass = (amount: number) => {
      s.quad.material = s.hBlur;
      s.hBlur.uniforms.tDiffuse!.value = s.rt.texture;
      s.hBlur.uniforms.h!.value = amount / s.rw;
      gl.setRenderTarget(s.rtBlur);
      gl.render(s.quad, s.quadCam);
      s.quad.material = s.vBlur;
      s.vBlur.uniforms.tDiffuse!.value = s.rtBlur.texture;
      s.vBlur.uniforms.v!.value = amount / s.rh;
      gl.setRenderTarget(s.rt);
      gl.render(s.quad, s.quadCam);
    };
    pass(blur);
    pass(blur * 0.5);
    pass(blur * 0.25);
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);
    scene.background = prevBackground;
    if (plane.current) plane.current.visible = true;
  }, -5);

  return (
    <mesh ref={plane} geometry={setup.geometry} position={[setup.cx, CONTACT_Y, setup.cz]} renderOrder={0}>
      <meshBasicMaterial map={setup.rt.texture} transparent opacity={opacity} depthWrite={false} color="#1d140c" />
    </mesh>
  );
}
