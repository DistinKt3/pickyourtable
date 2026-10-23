"use client";

import { type RootState, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { siteBounds } from "@/lib/venue/geometry";
import type { Venue } from "@/lib/venue/schema";
import { SHADOW_LAYER } from "./Tables";

/**
 * Soft contact shadows, baked: the furniture is rendered once from below into a
 * darkness-by-height texture, blurred, and laid on the floor. It re-renders only when
 * `version` changes (a theme switch, a table ghosting), never per frame.
 */

export const CONTACT_Y = 0.008;

interface Baker {
  rt: THREE.WebGLRenderTarget;
  rtBlur: THREE.WebGLRenderTarget;
  camera: THREE.OrthographicCamera;
  depthMaterial: THREE.MeshDepthMaterial;
  hBlur: THREE.ShaderMaterial;
  vBlur: THREE.ShaderMaterial;
  quad: THREE.Mesh;
  quadCam: THREE.OrthographicCamera;
  plane: THREE.Mesh;
  rw: number;
  rh: number;
  blur: number;
  pending: { version: string | null };
}

function createBaker(venue: Venue, resolution: number, blur: number, color: string): Baker {
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
  // Looking straight up from just above the floor; things within 1.25 m count.
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, 1.25);
  camera.position.set(cx, CONTACT_Y, cz);
  camera.up.set(0, 0, -1);
  camera.lookAt(cx, CONTACT_Y + 1, cz);
  camera.updateMatrixWorld();
  camera.layers.set(SHADOW_LAYER);
  // The surface nearest the floor wins (depth test on), so the darkest value is kept.
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.side = THREE.DoubleSide;
  depthMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "vec4( vec3( 1.0 ), clamp( ( 1.0 - fragCoordZ ) * 2.2 - 0.25, 0.0, 1.0 ) );",
    );
  };
  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  hBlur.depthTest = false;
  vBlur.depthTest = false;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.position.z = -0.5;
  quad.updateMatrixWorld();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  // Seen from below, east and west swap: mirror the texture across.
  const uv = geometry.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const plane = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, depthWrite: false, color }),
  );
  plane.position.set(cx, CONTACT_Y, cz);
  return { rt, rtBlur, camera, depthMaterial, hBlur, vBlur, quad, quadCam, plane, rw, rh, blur, pending: { version: null } };
}

function disposeBaker(b: Baker) {
  b.rt.dispose();
  b.rtBlur.dispose();
  b.depthMaterial.dispose();
  b.hBlur.dispose();
  b.vBlur.dispose();
  b.quad.geometry.dispose();
  b.plane.geometry.dispose();
  (b.plane.material as THREE.Material).dispose();
}

function bake(b: Baker, { gl, scene }: RootState) {
  const prevTarget = gl.getRenderTarget();
  const prevBackground = scene.background;
  const prevOverride = scene.overrideMaterial;
  const prevClear = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  b.plane.visible = false;
  scene.background = null;
  scene.overrideMaterial = b.depthMaterial;
  gl.setClearColor(0xffffff, 0);
  gl.setRenderTarget(b.rt);
  gl.clear();
  gl.render(scene, b.camera);
  scene.overrideMaterial = prevOverride;
  const pass = (amount: number) => {
    b.quad.material = b.hBlur;
    b.hBlur.uniforms.tDiffuse!.value = b.rt.texture;
    b.hBlur.uniforms.h!.value = amount / b.rw;
    gl.setRenderTarget(b.rtBlur);
    gl.render(b.quad, b.quadCam);
    b.quad.material = b.vBlur;
    b.vBlur.uniforms.tDiffuse!.value = b.rtBlur.texture;
    b.vBlur.uniforms.v!.value = amount / b.rh;
    gl.setRenderTarget(b.rt);
    gl.render(b.quad, b.quadCam);
  };
  pass(b.blur);
  pass(b.blur * 0.4);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevClear, prevAlpha);
  scene.background = prevBackground;
  b.plane.visible = true;
}

function bakeIfStale(b: Baker, version: string, state: RootState) {
  if (b.pending.version === version) return;
  b.pending.version = version;
  bake(b, state);
}

function setOpacity(b: Baker, opacity: number) {
  (b.plane.material as THREE.MeshBasicMaterial).opacity = opacity;
}

export interface ContactShadowsProps {
  venue: Venue;
  /** Any change re-bakes. */
  version: string;
  opacity: number;
  /** Texture size along the longer side. */
  resolution?: number;
  blur?: number;
}

export function ContactShadows({ venue, version, opacity, resolution = 2048, blur = 1.6 }: ContactShadowsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const baker = useMemo(() => createBaker(venue, resolution, blur, "#1d140c"), [venue, resolution, blur]);
  useEffect(() => () => disposeBaker(baker), [baker]);
  useEffect(() => {
    setOpacity(baker, opacity);
    invalidate();
  }, [baker, opacity, invalidate]);
  useFrame((state) => bakeIfStale(baker, version, state), -5);
  return <primitive object={baker.plane} />;
}
