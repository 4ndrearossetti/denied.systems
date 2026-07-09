---
title: "Body rate cross-coupling and when you can ignore it"
summary: "How measured body rates couple into Euler-angle rates, and the conditions under which the cross-coupling terms can be safely ignored."
tags: [state-estimation, kinematics]
updated: 2026-06-28
---

See background: [[rotating-coordinate-frames]]
— where the $\boldsymbol\omega \times (I\boldsymbol\omega)$ term comes from.

This note documents when that approximation breaks.

Euler's equations for a rotating rigid body, diagonal inertia tensor:

$$
I \dot{\boldsymbol{\omega}} + \boldsymbol{\omega} \times (I \boldsymbol{\omega}) = \boldsymbol{\tau}
$$

Expanded:

$$
\begin{aligned}
I_{xx}\dot{p} + (I_{zz} - I_{yy}) q r &= \tau_x \\
I_{yy}\dot{q} + (I_{xx} - I_{zz}) p r &= \tau_y \\
I_{zz}\dot{r} + (I_{yy} - I_{xx}) p q &= \tau_z
\end{aligned}
$$

Rearranged for the rate derivatives:

$$
\begin{aligned}
\dot{p} &= \frac{\tau_x}{I_{xx}} + \frac{(I_{yy} - I_{zz})}{I_{xx}}\, q r \\
\dot{q} &= \frac{\tau_y}{I_{yy}} + \frac{(I_{zz} - I_{xx})}{I_{yy}}\, p r \\
\dot{r} &= \frac{\tau_z}{I_{zz}} + \frac{(I_{xx} - I_{yy})}{I_{zz}}\, p q
\end{aligned}
$$

Each axis has a "direct" term (torque / inertia) and a "cross" term from
$\boldsymbol{\omega} \times (I\boldsymbol{\omega})$ — gyroscopic coupling between axes.

## What the symmetric quad's code does

```c
p_dot = tau_roll  / Ixx;
q_dot = tau_pitch / Iyy;
r_dot = tau_yaw   / Izz;
```

The cross terms are dropped entirely.

## Which terms really drop for Ixx = Iyy

Plug in $I_{xx} = I_{yy}$:

$$
\begin{aligned}
\dot{p} &= \frac{\tau_x}{I_{xx}} + \frac{(I_{xx} - I_{zz})}{I_{xx}}\, q r \\
\dot{q} &= \frac{\tau_y}{I_{yy}} + \frac{(I_{zz} - I_{xx})}{I_{yy}}\, p r \\
\dot{r} &= \frac{\tau_z}{I_{zz}} + \frac{(0)}{I_{zz}}\, p q = \frac{\tau_z}{I_{zz}}
\end{aligned}
$$

**What's truly decoupled:** yaw ($r$). The $(I_{xx} - I_{yy})$ factor is zero, so
r_dot has no cross term from roll/pitch rates.

**What's NOT decoupled but is treated as if it were:** roll and pitch. The
$p$ and $q$ equations still have nonzero cross terms with $q r$ and
$p r$ — unless $I_{zz} = I_{xx}$ (spherical symmetry, not true for any
quadcopter).

## Why you can drop them anyway (the justification)

**Near hover — second-order small.** The cross term is a product of two
angular rates ($q \cdot r$, $p \cdot r$). When the quad is trying to stay
level, these rates are small, so their product is very small.

**Control torques dominate.** $\tau_x / I_{xx}$ is the commanded signal
from the PID. The cross term is a disturbance. For a 250-class quad at
moderate rates, the cross term is 1-2 orders of magnitude below the
commanded angular acceleration.

**Integral term eats the error.** Any unmodelled disturbance from dropping
the term gets absorbed by the I-term of the rate PID. It sees a steady
offset in the tracking error and integrates it out.

## When it breaks

**Asymmetric build.** Battery strapped off-centre, mismatched motors, an
ESC fails mid-flight. Now $I_{xx} \neq I_{yy}$. The r_dot cross term pops
back: $(I_{xx} - I_{yy})/I_{zz} \cdot p q$ means rolling the quad also
induces yaw. This is real and you'll see it as unwanted yaw drift during
roll manoeuvres.

**Aggressive aerobatics.** High roll/pitch rates make $q r$ and $p r$
large. A flip or snap roll pushes the cross term from "negligible" to
"noticeable torque disturbance." The copilot (or rate PID) has to overcome it.

**Heavy frame with large $I_{zz}$.** Longer arms or a big payload increase
the $I_{xx} - I_{zz}$ gap, scaling the cross term even at moderate rates.

**In short:** the symmetric-inertia, near-hover, low-rate assumption is
valid for a well-built quad doing normal flight. The cross terms code is
needed when the build is asymmetric, the flight is aggressive, or both.
