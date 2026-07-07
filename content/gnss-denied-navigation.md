---
title: "GNSS-Denied Navigation"
summary: "How an autonomous aircraft keeps a usable state estimate when satellite navigation is jammed, spoofed, or simply absent."
tags: [navigation, sensor-fusion]
updated: 2026-07-07
---

## The problem

<!-- Placeholder prose — the owner replaces this with real technical writing. -->

Satellite navigation is the first thing to disappear over contested ground.
Jamming raises the noise floor until the receiver loses lock; spoofing is
worse, feeding the estimator a confident, wrong position. A platform that
treats GNSS as ground truth inherits both failure modes at once. The design
goal is therefore not "better GPS" but a navigation stack that degrades
gracefully to zero satellites, fusing whatever sensors remain — inertial,
visual, terrain, radio — into one coherent estimate.

## Drift is the budget

Without an absolute fix, everything reduces to dead reckoning, and dead
reckoning drifts. Integrating a noisy accelerometer twice makes the position
uncertainty grow roughly as

$$
\sigma_p(t) \approx \sigma_{p_0} + \sigma_v\, t + \tfrac{1}{2}\, \sigma_a\, t^2
$$

so the mission plan is really a drift budget: how long can the vehicle fly
before its position uncertainty exceeds what the task tolerates? Aiding
sensors exist to reset or slow that growth. The workhorse aiding source on
small airframes is [[visual-inertial-odometry]], which trades satellite
dependence for compute and lighting constraints.

## Fusing what remains

A minimal fusion loop propagates the inertial state at high rate and folds in
slower aiding measurements as they arrive. The complementary-filter sketch
below shows the shape of the idea, stripped of the covariance bookkeeping a
real estimator needs:

```c
/* propagate attitude from gyro, correct slowly from accel gravity vector */
float fuse_pitch(float pitch, float gyro_q, float ax, float az, float dt)
{
    const float k = 0.02f;               /* aiding gain: trust gyro short-term */
    float gyro_pitch  = pitch + gyro_q * dt;
    float accel_pitch = atan2f(-ax, az); /* gravity-referenced, noisy, unbiased */
    return (1.0f - k) * gyro_pitch + k * accel_pitch;
}
```

The same structure scales up: an EKF or factor graph propagates with the IMU
and corrects from whichever aiding source is currently trustworthy, such as
the [[visual-inertial-odometry|VIO front end]] when texture and light allow.

## What to read next

The map-of-the-terrain view lives on the landing page; the estimator that
carries most of the load here is covered in [[visual-inertial-odometry]].
A future page on spoofing detection will link from this one — for now that
edge is intentionally broken: [[spoofing-detection]].
