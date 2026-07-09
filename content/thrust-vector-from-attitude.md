---
title: "Thrust vector from attitude angles"
summary: "Mapping attitude angles to a body thrust vector in the NED frame - how a desired orientation becomes the direction the rotors push."
tags: [guidance-control, kinematics]
updated: 2026-06-28
---

Given total thrust magnitude $T$ and attitude (roll $\phi$, pitch $\theta$, yaw $\psi$),
how do you find the inertial-frame components of the force vector perpendicular
to the quadcopter's plane?

## The setup

The quadcopter's "plane" is the body-fixed xy-plane — the arms form an X or + in
this plane. The vector perpendicular to it is the body-fixed z-axis, pointing up
through the centre of mass (by convention).

All four rotors spin to produce thrust along this axis. In body coordinates:

$$
\mathbf{F}_B = \begin{bmatrix} 0 \\ 0 \\ T \end{bmatrix}
$$

Total thrust $T$ is purely along body-z. There is no body-x or body-y thrust
component — those come from *tilting* this vector via attitude.

To find the components in the world/inertial frame, we need to rotate $\mathbf{F}_B$
by the quadcopter's current orientation. That orientation is described by the
Euler angles $(\phi, \theta, \psi)$ and the rotation matrix that maps body→world.

## The rotation matri·x (derived)

The world frame is NED (north-east-down) or ENU (east-north-up) depending on
your convention — the math is the same either way, the axes just swap labels.

We build the rotation matrix from body to world as a sequence of three intrinsic
rotations, applied in ZYX order (yaw → pitch → roll). This is the standard
aeronautical convention.

**Step 1 — Yaw $\psi$ about body z-axis:**

$$
R_z(\psi) = \begin{bmatrix}
c_\psi & -s_\psi & 0 \\
s_\psi &  c_\psi & 0 \\
0      &  0      & 1
\end{bmatrix}
$$

This rotates the body's x-y plane around the vertical axis — pointing the nose
north/south/east/west.

**Step 2 — Pitch $\theta$ about the (now-rotated) body y-axis:**

$$
R_y(\theta) = \begin{bmatrix}
c_\theta & 0 & s_\theta \\
0        & 1 & 0        \\
-s_\theta & 0 & c_\theta
\end{bmatrix}
$$

Tilts the nose up or down.

**Step 3 — Roll $\phi$ about the (now-rotated) body x-axis:**

$$
R_x(\phi) = \begin{bmatrix}
1 & 0       & 0      \\
0 & c_\phi  & -s_\phi \\
0 & s_\phi  &  c_\phi
\end{bmatrix}
$$

Banks left or right.

The full rotation is the product of these three matrices, applied right to left
(the first rotation is rightmost):

$$
R_{BW} = R_z(\psi) \, R_y(\theta) \, R_x(\phi)
$$

Which expands to:

$$
R_{BW} =
\begin{bmatrix}
c_\theta c_\psi & s_\phi s_\theta c_\psi - c_\phi s_\psi & c_\phi s_\theta c_\psi + s_\phi s_\psi \\
c_\theta s_\psi & s_\phi s_\theta s_\psi + c_\phi c_\psi & c_\phi s_\theta s_\psi - s_\phi c_\psi \\
-s_\theta       & s_\phi c_\theta                        & c_\phi c_\theta
\end{bmatrix}
$$

## Applying to the thrust vector

$$
\mathbf{F}_W = R_{BW} \cdot \mathbf{F}_B
            = R_{BW} \cdot \begin{bmatrix}0\\0\\T\end{bmatrix}
$$

Since only the third column of $R_{BW}$ multiplies against the non-zero entry
of $\mathbf{F}_B$, we get:

$$
\boxed{
\begin{aligned}
F_x &= T \cdot (c_\phi s_\theta c_\psi + s_\phi s_\psi) \\
F_y &= T \cdot (c_\phi s_\theta s_\psi - s_\phi c_\psi) \\
F_z &= T \cdot (c_\phi c_\theta)
\end{aligned}}
$$

These are equations (15)–(17) from the quadcopter PID tuning paper in the vault.

## Why derive the full matrix?

The third column is all you need **right now** — you only care about one
body-axis vector (body-z → world). But the full matrix will reappear when you
need to:

*The rotation matrix $R_{BW}$ is how you implement the coordinate transform
that [[rotating-coordinate-frames]] describes for any
vector measured from a rotating platform. The $R_{BW} \cdot [0,0,T]^T$
operation is the discrete version of the carrying term $\boldsymbol\omega
\times \mathbf{q}$ applied to the body-z thrust vector — same geometry, matrix
form.*

- **Go the other way** (world → body): invert the rotation (which for a
  rotation matrix is just the transpose $R_{WB} = R_{BW}^T$). You need this
  when taking a world-frame target direction (e.g. "fly north-east") and
  decomposing it into body-relative pitch/roll commands.
- **Convert angular velocities** ($p, q, r$) to Euler angle rates
  ($\dot{\phi}, \dot{\theta}, \dot{\psi}$) for your attitude estimator —
  that uses a different matrix but comes from the same rotation sequence.
  The body-rate cross-coupling — when the gyroscopic term
  $\boldsymbol\omega \times (I\boldsymbol\omega)$ matters and when it
  doesn't — is covered in
  [[euler-body-rate-cross-coupling]].
- **Rotate arbitrary vectors**, like wind, magnetic field, or GPS velocity
  into body frame for sensor fusion.

So yes, deriving it once and keeping it in a reference note is worthwhile.
You'll use different columns/rows of it as the quadcopter code grows.

## In code

```c
void thrust_body_to_world(float T, float phi, float theta, float psi,
                          float *fx, float *fy, float *fz) {
    float c_phi = cosf(phi), s_phi = sinf(phi);
    float c_th  = cosf(theta), s_th = sinf(theta);
    float c_psi = cosf(psi), s_psi = sinf(psi);

    *fx = T * (c_phi * s_th * c_psi + s_phi * s_psi);
    *fy = T * (c_phi * s_th * s_psi - s_phi * c_psi);
    *fz = T * (c_phi * c_th);
}
```

Feed $\phi, \theta, \psi$ from your complementary filter (MPU-6050 → quaternion
→ Euler angles, or direct Madgwick/Mahony output) and $T$ from your control
law. The resulting $(f_x, f_y, f_z)$ goes into your position controller or
state estimator as the applied force in world coordinates.

## Common pitfalls

- **Euler angle convention matters.** ZYX (yaw → pitch → roll) is standard for
  aerospace. If your code uses XYZ or some other order, the matrix changes.
  Verify against a known test case (e.g. $\phi=0, \theta=30^\circ, \psi=0$ →
  thrust should tilt forward, giving positive $F_x$ and reduced $F_z$).
- **Gimbal lock at $\theta = \pm 90^\circ$.** Euler angles become degenerate.
  If your quadcopter ever pitches straight vertical (unlikely in normal flight
  but possible in a crash), switch to quaternions in the estimator and extract
  the third column directly from the rotation matrix without going through
  Euler angles.
- **Sign conventions.** Make sure your attitude estimator and your controller
  use the same sign convention for roll/pitch. Inconsistent sign flips will
  cause the quad to fly in the wrong direction and likely crash.
