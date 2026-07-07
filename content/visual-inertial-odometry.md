---
title: "Visual-Inertial Odometry"
summary: "Fusing camera tracking with inertial propagation to hold a drift-bounded pose estimate without any external positioning."
tags: [sensor-fusion, perception]
updated: 2026-07-07
---

## Why cameras plus IMUs

<!-- Placeholder prose — the owner replaces this with real technical writing. -->

A camera and an IMU fail in opposite ways, which is exactly why they pair
well. The IMU is always available and fast but drifts without bound; the
camera drifts slowly but drops out in low light, motion blur, or over
featureless terrain. Visual-inertial odometry (VIO) fuses the two into a
single pose estimate that is smooth at IMU rate and drift-bounded at camera
rate — the standard aiding source for [[gnss-denied-navigation]] on small,
compute-constrained airframes.

## The measurement that anchors everything

The visual half of the estimator minimizes reprojection error: a landmark at
world position $\mathbf{p}_w$, observed at pixel $\mathbf{z}_{ij}$, should
land where the current pose estimate says it should. Each observation
contributes a residual

$$
\mathbf{e}_{ij} \;=\; \mathbf{z}_{ij} \;-\; \pi\!\left( \mathbf{T}_{cw}\, \mathbf{p}_w \right)
$$

where $\mathbf{T}_{cw}$ is the world-to-camera transform and $\pi(\cdot)$ the
camera projection. Between camera frames, IMU preintegration summarizes the
high-rate inertial samples into a single relative-motion constraint, keeping
the optimization small enough for embedded compute.

## A front end in miniature

The front end just has to keep enough well-spread features alive from frame
to frame. The sketch below shows the loop shape, minus the real detector,
tracker, and outlier rejection:

```python
def track_frame(prev_features, frame, min_features=80):
    """Track features into the new frame; replenish when the set thins out."""
    tracked = [f for f in optical_flow(prev_features, frame) if f.inlier]
    if len(tracked) < min_features:
        # Re-detect in cells that went empty so features stay well-spread.
        tracked += detect_corners(frame, mask=occupied_cells(tracked))
    return tracked
```

Everything downstream — preintegration, marginalization, the sliding-window
solver — exists to turn these tracks into the aiding measurement that the
[[gnss-denied-navigation|GNSS-denied navigation stack]] consumes.

## Failure modes to design for

Texture-poor scenes, repetitive structure, and aggressive yaw-only motion all
starve the estimator of parallax. A robust integration treats VIO as one
aiding source among several, weighted by its own health metrics, never as
ground truth — the same discipline [[gnss-denied-navigation]] applies to
satellites.
