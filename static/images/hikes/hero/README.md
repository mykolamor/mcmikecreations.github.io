# Hikes hero: parallax layers and derived maps

Source photo: own photo (iPhone 14 Pro, 24 mm equiv.) by David Bilan, Breitenstein summit (1622 m) looking towards
Wendelstein (1838 m), 2025-05-18. Layers are cut from it at 1/6 scale (1008×1344); parts hidden behind
closer layers were filled by hand from other photos.

## Files

| File | Content |
|---|---|
| `hike_poster_{0,1,2,3,4}.png` | Parallax layers, front (0) to back (4), RGBA |
| `hike_poster_4_bg_2.png` | Opaque background layer |
| `*_depth.webp` + `hike_poster_depth.json` | 8-bit log depth: `v = R` (0..255); `v == 0` → no depth; else `depth_m = exp(ln(min) + (v-1)/254 · (ln(max) - ln(min)))`, per-layer `min`/`max` in the JSON |
| `*_depth.exr` | Float16 metric depth in meters along the camera axis; `+inf` → no depth |
| `*_albedo.png` | Lighting-reduced color (shading removed, fine detail kept) |
| `*_deshadow.png` | Shadow-removed color (lighter, slightly hazy) |

All depth maps share one metric scale across layers. All derived files use the
layer's alpha.

## Steps

**Alpha refinement.** Hand-drawn (in GIMP) alphas were refined with **ViTMatte**
on the full-resolution source photo, using a trimap of +-8 px around the
original edge. Edges hidden behind closer layers kept the original alpha
(opaque). Edge colors were re-estimated with multilevel foreground estimation
(pymatting).

**Depth.** **MoGe-3** (ViT-G) was run on the full photo with the true camera
FOV (56.8° horizontal, from EXIF). The far field was stretched so that the
Wendelstein summit matches its real line-of-sight distance of 2683.7 m.
That distance is the WGS84 geodesic of 2675.1 m with a 213.9 m height
difference, computed with `geographiclib`. Hidden parts of each layer use that
layer's own MoGe-3 depth, log-fitted to the scene depth. Near range (< ~10 m)
and the anchor are reliable. Mid-range distances (~100 m to 2 km) follow an
assumed curve and are likely too short.

**Albedo.** **Marigold-IID-Lighting** (v1.1) gave an albedo estimate. Only its
large-scale lighting was used: `albedo = original / L`, where
`L = guided_filter(original) / guided_filter(marigold_albedo)` is gray
(luminance only) with a 32 px radius. This keeps the original's fine detail and
color.

**Shadow removal.** **PhaSR** with the ISTD+ checkpoint, with MoGe-3 depth as
the geometry prior. Transparent areas were filled by push-pull before inference.

The processing scripts are kept outside this project.

## Models and attribution

- **MoGe-3**: Microsoft Research. Code and weights (`Ruicheng/moge-3-vitg`) are MIT.
  *MoGe-3: Fine-Detail Monocular Geometry Estimation with Self-Guided Sparse Volumetric Refinement*, 2026.
  https://github.com/microsoft/MoGe
- **Marigold-IID-Lighting v1.1**: PRS-ETH Zurich, weights `prs-eth/marigold-iid-lighting-v1-1` under the
  CreativeML **OpenRAIL++-M** license (use-based restrictions apply). Ke et al., *Marigold: Affordable Adaptation of
  Diffusion-Based Image Generators for Image Analysis*, 2025. https://github.com/prs-eth/Marigold
- **PhaSR**: Lee, Lin, Hsiao, Jiang, Liu, Hsu, *PhaSR: Generalized Image Shadow Removal with Physically Aligned
  Priors*, CVPR 2026 (arXiv:2601.17470). MIT. https://github.com/ming053l/PhaSR. It uses **DINOv2** (Meta AI,
  Apache-2.0) features internally.
- **ViTMatte**: Yao et al., *ViTMatte: Boosting Image Matting with Pretrained Plain Vision Transformers*,
  Information Fusion 2024 (arXiv:2305.15272). Weights `hustvl/vitmatte-base-composition-1k`, Apache-2.0.
  https://github.com/hustvl/ViTMatte
- Tools: PyTorch, Hugging Face `transformers` / `diffusers`, OpenCV, pymatting (MIT), geographiclib (MIT).
