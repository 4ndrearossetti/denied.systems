---
title: "Rotating coordinate frames and the transport theorem"
summary: "Rotating frames and the transport theorem - the NED-frame conventions and derivative rules behind body-to-world rotation in a flight estimator."
tags: [state-estimation, kinematics]
updated: 2026-06-28
---

The identity that links inertial and body-frame derivatives —

$$
\left.\frac{d\mathbf{q}}{dt}\right|_{\text{inertial}} =
\left.\frac{d\mathbf{q}}{dt}\right|_{\text{body}} + \boldsymbol\omega \times \mathbf{q}
$$

— is called the **transport theorem**. It's a geometrical fact about rotating
coordinate systems, not a physical law. It applies to *any* vector quantity
$\mathbf{q}$: position, velocity, angular momentum, a magnetic field vector,
whatever lives in 3D space and is measured from a spinning platform.

This note traces it from the concrete picture you already know (body-frame
velocity → inertial velocity) back to the general principle.

---

## Start with what you already do in code

In your PID controller's simulation step, the thrust vector is in body
coordinates. To integrate position, you rotate it to the inertial frame
using the rotation matrix $R$. In body coordinates the quad has velocity
$[u, v, w]^T$ (from the IMU frame). In inertial coordinates the velocity
is $[\dot x, \dot y, \dot z]^T$. The mapping is:

$$
\begin{bmatrix}
\dot x \\ \dot y \\ \dot z
\end{bmatrix}
= R
\begin{bmatrix}
u \\ v \\ w
\end{bmatrix}
$$

This is a rotation matrix — a linear algebra operation. It's the clean,
easily-codeable way to do the transform. But there's another way to see
it that reveals the deeper structure.

---

## A simpler picture: the spinning room

Imagine you're standing in a room that rotates at constant rate $\omega$
about a vertical axis (a centrifuge or a merry-go-round).

**What the rotating-frame observer sees:** you're standing still at position
$\mathbf{r}$ relative to the centre. Your velocity in the rotating frame is
$\mathbf{v}_{\text{body}} = 0$.

**What an inertial observer (someone outside, watching from above) sees:**
you're not standing still — you're being carried around in a circle at
speed $\omega r$ tangent to the circle. Your inertial velocity is
$\mathbf{v}_{\text{inertial}} = \boldsymbol\omega \times \mathbf{r}$.

If you *walk* in the rotating frame at $\mathbf{v}_{\text{body}}$, the
inertial observer sees your walking velocity *plus* the carrying velocity:

$$
\mathbf{v}_{\text{inertial}} = \mathbf{v}_{\text{body}} + \boldsymbol\omega \times \mathbf{r}
$$

This is the transport theorem for $\mathbf{q} = \mathbf{r}$. The
$\boldsymbol\omega \times \mathbf{r}$ term is the **"carrying term"** —
the velocity you inherit from the frame's rotation even if you don't move
within it.

---

## Generalising: the theorem for any vector

A vector $\mathbf{q}$ expressed in a rotating basis
$\hat{\mathbf{e}}_1, \hat{\mathbf{e}}_2, \hat{\mathbf{e}}_3$:

$$
\mathbf{q} = q_1\hat{\mathbf{e}}_1 + q_2\hat{\mathbf{e}}_2 + q_3\hat{\mathbf{e}}_3
$$

Differentiate in the *inertial* frame (product rule):

$$
\left.\frac{d\mathbf{q}}{dt}\right|_{\text{inertial}} =
\underbrace{\dot q_1\hat{\mathbf{e}}_1 + \dot q_2\hat{\mathbf{e}}_2 + \dot q_3\hat{\mathbf{e}}_3}_{\text{body derivative}}
\;+\;
\underbrace{q_1\dot{\hat{\mathbf{e}}}_1 + q_2\dot{\hat{\mathbf{e}}}_2 + q_3\dot{\hat{\mathbf{e}}}_3}_{\text{frame rotation}}
$$

The first group is the body derivative — how the *components* change as
seen by someone riding in the rotating frame.

The second group is the contribution from the axes themselves spinning.
The fundamental property of angular velocity is that it tells you how
a rotating frame's basis vectors move:

$$
\dot{\hat{\mathbf{e}}}_i = \boldsymbol\omega \times \hat{\mathbf{e}}_i
$$

Substitute:

$$
q_1\dot{\hat{\mathbf{e}}}_1 + q_2\dot{\hat{\mathbf{e}}}_2 + q_3\dot{\hat{\mathbf{e}}}_3
= \boldsymbol\omega \times (q_1\hat{\mathbf{e}}_1 + q_2\hat{\mathbf{e}}_2 + q_3\hat{\mathbf{e}}_3)
= \boldsymbol\omega \times \mathbf{q}
$$

Hence:

$$
\boxed{\left.\frac{d\mathbf{q}}{dt}\right|_{\text{inertial}} =
\left.\frac{d\mathbf{q}}{dt}\right|_{\text{body}} + \boldsymbol\omega \times \mathbf{q}}
$$

That's the whole theorem. Memorise the structure:

> **Rotating-frame derivative = body derivative + omega cross the vector**

---

## The two applications you care about

### 1. Position ($\mathbf{q} = \mathbf{r}$) — velocity kinematics

| Term | Meaning | In your code |
|------|---------|-------------|
| $\left.\frac{d\mathbf{r}}{dt}\right|_{\text{inertial}}$ | inertial velocity $\mathbf{v}_I$ | $[\dot x, \dot y, \dot z]$ after rotation |
| $\left.\frac{d\mathbf{r}}{dt}\right|_{\text{body}}$ | body-frame velocity $\mathbf{v}_B$ | $[u, v, w]$ from IMU |
| $\boldsymbol\omega \times \mathbf{r}$ | carrying velocity from rotation | what $R$ handles in one shot |

If the IMU were at position $\mathbf{r}$ relative to the quad's centre of
rotation (it is), and the quad is rotating (it is), then the IMU sees a
velocity contribution from rotation alone — even if the centre isn't
moving. This is why the rotation matrix is applied *after* computing
body-frame motion.

In practice you use the rotation matrix $R$ rather than the cross product
for the position case, because $R$ handles all three axes at once and is
easier to code. But conceptually it's the same $\boldsymbol\omega \times \mathbf{r}$.

### 2. Angular momentum ($\mathbf{q} = \mathbf{L} = I\boldsymbol\omega$) — Euler's equations

| Term                                  | Meaning                                         | Equation                   |                                  |
| ------------------------------------- | ----------------------------------------------- | -------------------------- | -------------------------------- |
| $\left.\frac{d\mathbf{L}}{dt}\right.$ | $_{\text{inertial}}$                            | torque $\boldsymbol\tau$   | Newton's second law for rotation |
| $\left.\frac{d\mathbf{L}}{dt}\right.$ | $_{\text{body}}$                                | $I\dot{\boldsymbol\omega}$ | change in spin, body-frame       |
| $\boldsymbol\omega \times \mathbf{L}$ | $\boldsymbol\omega \times (I\boldsymbol\omega)$ | gyroscopic cross-coupling  |                                  |

So:

$$
\boldsymbol\tau = I\dot{\boldsymbol\omega} + \boldsymbol\omega \times (I\boldsymbol\omega)
$$

This is [[euler-body-rate-cross-coupling]]. The cross
term is the same physical effect as the carrying term in the position
case — the angular momentum vector is being "carried around" by the
body's rotation.

---

## Why the cross term feels different for position vs. angular momentum

Same mathematical structure, but:

- **Position case:** $\boldsymbol\omega \times \mathbf{r}$ vanishes when
  $\mathbf{r} = 0$ (origin). At the centre of rotation, no carrying
  velocity. For your quad, the IMU is off-centre, so there *is* a
  contribution, but you absorb it into the rotation matrix.

- **Angular momentum case:** $\boldsymbol\omega \times (I\boldsymbol\omega)$
  *does not vanish* even at the centre of rotation, because $\mathbf{L}$
  is non-zero whenever the body is spinning. The gyroscopic term is
  a **self-interaction** — the body's own angular momentum interacts
  with its own rotation, producing torques that affect other axes.

This self-interaction is precession. Hold a spinning bicycle wheel by
its axle and try to tilt it — the wheel fights you by turning in a
perpendicular direction. That resistance is $\boldsymbol\omega \times (I\boldsymbol\omega)$
manifesting in your hands as a real torque.

---

## Applied to your quadcopter simulation

Your current PID code likely does:

```c
// Body torques from motor mixing
float tau_x, tau_y, tau_z;

// Angular acceleration (simplified)
float p_dot = tau_x / Ixx;
float q_dot = tau_y / Iyy;
float r_dot = tau_z / Izz;

// Integrate
p += p_dot * dt;
q += q_dot * dt;
r += r_dot * dt;
```

The transport theorem says this is missing the term
$\boldsymbol\omega \times (I\boldsymbol\omega)$. For a near-hover quad
with small $p, q, r$, the missing term is small. For aggressive
manoeuvres it's not. The full integration is:

```c
float p_dot = tau_x / Ixx + (Iyy - Izz) / Ixx * q * r;
float q_dot = tau_y / Iyy + (Izz - Ixx) / Ixx * p * r;
float r_dot = tau_z / Izz + (Ixx - Iyy) / Izz * p * q;
```

Those extra terms are the transport theorem at work on the angular
momentum vector. Nothing more.

This C code belongs in the physics model of a flight simulator
— one that currently drops these
terms, and this note is the reference for adding them when the flight regime
demands it.

---

## Summary

- **The transport theorem** is a coordinate system identity, not physics.
  It says: inertial derivative = body derivative + ω × vector.

- **The ω × term exists** because the body-frame basis vectors are
  spinning. If $\boldsymbol\omega = 0$ (no rotation), the term vanishes.

- **Same formula, different vectors:**
  - Applied to $\mathbf{r}$ → velocity kinematics (you use the rotation matrix)
  - Applied to $I\boldsymbol\omega$ → Euler's equations (you usually drop the term)

- **In your quad:** the cross term in Euler's equations is the same
  mechanism as the carrying velocity in the position kinematics —
  a geometric consequence of measuring rates from a spinning platform.

---

See also: [[euler-body-rate-cross-coupling]]
— when you can drop the cross term and when it bites you.
