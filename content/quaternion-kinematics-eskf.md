---
title: "Quaternion kinematics for the error-state Kalman filter"
summary: "A working guide to Joan Sola's quaternion kinematics for the error-state Kalman filter - the reference for fusing IMU data with external corrections in an ESKF/VIO estimator."
tags: [state-estimation, sensor-fusion, vio]
updated: 2026-07-06
---

The foundational reference for doing orientation estimation with quaternions inside a Kalman filter. Joan Solà's 2017 paper (arXiv:1711.02508) is the definitive treatment: it derives every formula from first principles, resolves the convention wars, and provides a complete ESKF recipe for fusing IMU data with external corrections (GPS, vision, etc.). If you're implementing an IMU-driven state estimator that uses quaternions, this is the paper to have open.

## Why quaternions for rotation

Rotation matrices ($3\times3$, 9 parameters) over-parameterize orientation. Euler angles (3 parameters) gimbal-lock. Quaternions are the sweet spot: 4 numbers, no singularities, and the algebra handles composition cleanly. A unit quaternion $q = [q_w, q_x, q_y, q_z]^T$ with $\|q\| = 1$ encodes a rotation of angle $\varphi$ around axis $\mathbf{u}$:

$$
q = \begin{bmatrix} \cos(\varphi/2) \\ \mathbf{u} \sin(\varphi/2) \end{bmatrix}
$$

The half-angle is not a bug — it's a feature of the double cover of SO(3), which is what makes the quaternion algebra work. $q$ and $-q$ represent the same rotation.

The rotation action on a vector $\mathbf{x} \in \mathbb{R}^3$ is the double product:

$$
\mathbf{x}' = q \otimes \mathbf{x} \otimes q^*
$$

Where $q^* = [q_w, -\mathbf{q}_v]^T$ is the conjugate (equal to the inverse for unit quaternions). This is equivalent to $\mathbf{x}' = R\mathbf{x}$ with $R$ given by the quaternion-to-rotation-matrix formula.

## Core quaternion algebra

The paper uses **Hamilton convention**: $i^2 = j^2 = k^2 = ijk = -1$, with $ij = k = -ji$. This is the right-handed convention. Other conventions exist (JPL uses left-handed, some swap real/vector order) — Section 3 of the paper disambiguates all four binary choices.

**Quaternion product** ($\otimes$): using scalar-vector notation $q = q_w + \mathbf{q}_v$:

$$
p \otimes q = \begin{bmatrix} p_w q_w - \mathbf{p}_v \cdot \mathbf{q}_v \\ p_w \mathbf{q}_v + q_w \mathbf{p}_v + \mathbf{p}_v \times \mathbf{q}_v \end{bmatrix}
$$

The cross product in the vector part makes $\otimes$ non-commutative (rotation composition is order-dependent). Product is bilinear and can be expressed as matrix-vector products using left- and right- product matrices $[q]_L$ and $[q]_R$, which will appear throughout the ESKF derivations.

**Exponential and logarithmic maps** connect the quaternion to the rotation vector (axis-angle) representation:

- $\text{Exp}(\mathbf{u}\varphi) = q\{\mathbf{u}\varphi\} = [\cos(\varphi/2), \mathbf{u}\sin(\varphi/2)]^T$ — rotation vector → quaternion
- $\text{Log}(q) = \mathbf{u}\varphi$ — quaternion → rotation vector

**Quaternion-to-rotation-matrix**:

$$
R\{q\} = (q_w^2 - \mathbf{q}_v^T\mathbf{q}_v)I + 2\mathbf{q}_v\mathbf{q}_v^T + 2q_w[\mathbf{q}_v]_\times
$$

Where $[\mathbf{a}]_\times$ is the skew-symmetric cross-product matrix.

## The four derivative types on SO(3)

Section 4 defines four Jacobian types depending on whether the function domain/codomain is vector space or SO(3). The ones that matter for ESKF:

- **Right Jacobian of SO(3)**: Used for mapping perturbations in the tangent space (rotation vectors) to the manifold (quaternions/rotation matrices):

$$
J_r(\boldsymbol{\theta}) = I - \frac{1 - \cos\|\boldsymbol{\theta}\|}{\|\boldsymbol{\theta}\|^2}[\boldsymbol{\theta}]_\times + \frac{\|\boldsymbol{\theta}\| - \sin\|\boldsymbol{\theta}\|}{\|\boldsymbol{\theta}\|^3}[\boldsymbol{\theta}]_\times^2
$$

- For small angles: $J_r(\boldsymbol{\theta}) \approx I - \frac{1}{2}[\boldsymbol{\theta}]_\times$

## Time integration of rotation rates

Given gyroscope readings $\boldsymbol{\omega}$, the quaternion kinematics are:

$$
\dot{q} = \frac{1}{2} q \otimes \boldsymbol{\omega}
$$

**Zeroth-order integrator** (constant $\boldsymbol{\omega}$ over $\Delta t$):

$$
q_{n+1} = q_n \otimes q\{\boldsymbol{\omega}\Delta t\}
$$

This is what most implementations use. It preserves unit norm by construction (product of two unit quaternions).

**First-order integrator** (accounts for $\dot{\boldsymbol{\omega}}$ via midpoint samples):

$$
q_{n+1} \approx q_n \otimes q\{\boldsymbol{\omega}\Delta t\} + \frac{\Delta t^2}{24} \begin{bmatrix} 0 \\ \boldsymbol{\omega}_n \times \boldsymbol{\omega}_{n+1} \end{bmatrix}
$$

The correction term is second-order small ($\sim 10^{-6} \|\boldsymbol{\omega}\|^2$ at 100 Hz) and only matters when the rotation axis changes significantly between samples. For constant rotation axis, the zeroth-order integrator is exact: $q_{n+1} = q_n \otimes q\{\mathbf{u}\Delta\theta\}$ where $\Delta\theta = \int \omega(t)dt$.

## The ESKF architecture

The error-state Kalman filter decomposes the state into three layers:

| Concept | Meaning | Size |
|---------|---------|------|
| **True state** $x_t$ | The actual physical state (unknown) | 18: $p, v, q, a_b, \omega_b, g$ |
| **Nominal state** $x$ | Large-signal integration of IMU, no noise model | Same 18 |
| **Error state** $\delta x$ | Small-signal difference: $x_t = x \oplus \delta x$ | 18: $\delta p, \delta v, \delta\theta, \delta a_b, \delta\omega_b, \delta g$ |

The composition $\oplus$ is linear addition for vectors ($p_t = p + \delta p$), quaternion product for orientation ($q_t = q \otimes \delta q$, with $\delta q = e^{\delta\theta/2}$), and addition for biases.

### Why this decomposition works

1. **Minimal orientation error**: $\delta\theta \in \mathbb{R}^3$ (3 parameters, no redundancy), avoiding singular covariance matrices from over-parameterized constraints.
2. **Always near origin**: The error state is reset to zero after every correction → linearization always valid.
3. **Second-order products negligible**: $\|\delta\theta\|$ is small → Jacobians simplify enormously.
4. **Slow error dynamics**: Large-signal motion lives in the nominal state. Error state only changes slowly → corrections can run at lower rate than predictions.

## Nominal-state kinematics (continuous time)

These are the noise-free integration equations you'd run at IMU rate (e.g., 200 Hz):

$$
\begin{aligned}
\dot{p} &= v \\
\dot{v} &= R(a_m - a_b) + g \\
\dot{q} &= \frac{1}{2} q \otimes (\omega_m - \omega_b) \\
\dot{a}_b &= 0 \\
\dot{\omega}_b &= 0 \\
\dot{g} &= 0
\end{aligned}
$$

Where $a_m, \omega_m$ are IMU readings, $a_b, \omega_b$ are estimated biases, and $R = R\{q\}$. The gravity vector $g$ is also estimated — this decouples initial orientation uncertainty from gravity uncertainty (Lupton & Sukkarieh, 2009).

Discrete-time integration (Euler form):

$$
\begin{aligned}
p &\leftarrow p + v\Delta t + \frac{1}{2}(R(a_m - a_b) + g)\Delta t^2 \\
v &\leftarrow v + (R(a_m - a_b) + g)\Delta t \\
q &\leftarrow q \otimes q\{(\omega_m - \omega_b)\Delta t\} \\
a_b &\leftarrow a_b,\quad \omega_b \leftarrow \omega_b,\quad g \leftarrow g
\end{aligned}
$$

## Error-state kinematics — the three key equations

### 1. Continuous-time error dynamics

The linearized error state evolves as:

$$
\begin{aligned}
\delta\dot{p} &= \delta v \\
\delta\dot{v} &= -R[a_m - a_b]_\times \delta\theta - R\delta a_b + \delta g - R a_n \\
\delta\dot{\theta} &= -[\omega_m - \omega_b]_\times \delta\theta - \delta\omega_b - \omega_n \\
\delta\dot{a}_b &= a_w,\quad \delta\dot{\omega}_b = \omega_w,\quad \delta\dot{g} = 0
\end{aligned}
$$

The velocity error equation is the critical one — it couples orientation errors $\delta\theta$ into position drift. The term $-R[a_m - a_b]_\times \delta\theta$ says: an orientation error $\delta\theta$ causes the acceleration vector to be projected slightly wrong, and the resulting position error grows quadratically with time.

### 2. Discrete-time error Jacobian $F_x$

The prediction step propagates the error covariance via $\delta\hat{x} \leftarrow F_x \delta\hat{x}$ and $P \leftarrow F_x P F_x^T + F_i Q_i F_i^T$:

$$
F_x = \begin{bmatrix}
I & I\Delta t & 0 & 0 & 0 & 0 \\
0 & I & -R[a_m - a_b]_\times \Delta t & -R\Delta t & 0 & I\Delta t \\
0 & 0 & R^T\{(\omega_m - \omega_b)\Delta t\} & 0 & -I\Delta t & 0 \\
0 & 0 & 0 & I & 0 & 0 \\
0 & 0 & 0 & 0 & I & 0 \\
0 & 0 & 0 & 0 & 0 & I
\end{bmatrix}
$$

Notable: the orientation error block uses $R^T\{(\omega_m - \omega_b)\Delta t\}$ (a rotation matrix, not a quaternion) — this is the discrete-time equivalent of $\exp(-[\omega]_\times \Delta t)$.

Since $\delta\hat{x}$ is initialized to zero and the prediction equation (268) always returns zero, **you skip the mean prediction in code**. But the covariance prediction (269) is essential — $F_i Q_i F_i^T$ injects process noise and makes $P$ grow continuously.

### 3. The correction step and injection

When external measurements arrive (GPS position, visual odometry, etc.):

**Kalman update:**
$$
\begin{aligned}
K &= P H^T (H P H^T + V)^{-1} \\
\delta\hat{x} &\leftarrow K(y - h(x_t)) \\
P &\leftarrow (I - KH)P
\end{aligned}
$$

**Observation Jacobian chain rule:**
$$
H = \frac{\partial h}{\partial \delta x} = \frac{\partial h}{\partial x_t} \cdot \frac{\partial x_t}{\partial \delta x} = H_x \cdot X_{\delta x}
$$

$H_x$ is sensor-specific. $X_{\delta x}$ is the ESKF-specific mapping from error state to true state, which is identity except for the quaternion block:

$$
Q_{\delta\theta} = \frac{\partial(q \otimes \delta q)}{\partial \delta\theta} = \frac{1}{2} \begin{bmatrix}
-q_x & -q_y & -q_z \\
q_w & -q_z & q_y \\
q_z & q_w & -q_x \\
-q_y & q_x & q_w
\end{bmatrix}
$$

**Error injection into nominal state:**
$$
\begin{aligned}
p &\leftarrow p + \delta\hat{p} \\
v &\leftarrow v + \delta\hat{v} \\
q &\leftarrow q \otimes q\{\delta\hat{\theta}\} \\
a_b &\leftarrow a_b + \delta\hat{a}_b \\
\omega_b &\leftarrow \omega_b + \delta\hat{\omega}_b \\
g &\leftarrow g + \delta\hat{g}
\end{aligned}
$$

**ESKF reset:** After injection, $\delta\hat{x} \leftarrow 0$ and the covariance is transformed:

$$
P \leftarrow G P G^T
$$

Where $G$ is identity except for the orientation block: $\frac{\partial \delta\theta^+}{\partial \delta\theta} = I - \frac{1}{2}[\delta\hat{\theta}]_\times$. In practice, most implementations neglect this reset Jacobian ($G = I$) since $\|\delta\hat{\theta}\|$ is tiny. The full expression is provided for high-precision odometry.

## Global vs. local angular errors (Section 7)

The classical ESKF defines the orientation error **locally**: $\delta\theta$ is expressed relative to the nominal orientation $q$. An alternative is to define it **globally**: $\delta\theta$ is the rotation vector from the nominal to true orientation, expressed in a fixed inertial frame. Li & Mourikis (2012) showed the global formulation has better observability properties. Section 7 derives the full ESKF for global angular errors — the kinematics change but the architecture is identical.

## Practical implementation notes

- **Mean prediction is a no-op.** The error mean starts at zero and the linear equation keeps it there. Skip line (268) but keep the covariance prediction.
- **Quaternion normalization.** The zeroth-order integrator preserves unit norm. If using first-order integration, re-normalize: $q \leftarrow q / \|q\|$.
- **Covariance numerical stability.** The standard $P \leftarrow (I-KH)P$ form can lose symmetry/positive-definiteness. The Joseph form $P \leftarrow (I-KH)P(I-KH)^T + K V K^T$ is preferred.
- **IMU noise parameters.** $\sigma_{a_n}, \sigma_{\omega_n}$ (measurement noise) come from the IMU datasheet. $\sigma_{a_w}, \sigma_{\omega_w}$ (bias random walk) require experimental calibration. These determine $V_i, \Theta_i, A_i, \Omega_i$ — the process noise covariances that drive $P$ growth.
- **Earth rotation.** $\omega_E = 15^\circ/\text{h} \approx 7.3 \times 10^{-5}$ rad/s. Negligible for consumer IMUs but measurable with high-end sensors — if your gyro bias stability approaches this, include $\omega_E$ in the measurement model.

## Where the ESKF fits relative to the complementary filter

The [[complementary-filter]] is a fixed-gain fusion: one $\alpha$ parameter, no covariance, no bias estimation, no position. It gives you roll/pitch at $\sim$200 Hz from a 6-DOF IMU. The ESKF is the full probabilistic version: it estimates position, velocity, orientation, and IMU biases, maintains a full $18\times18$ covariance, and fuses external corrections optimally via the Kalman gain. For a drone that needs drift-free navigation in GPS-denied environments, the ESKF is the target state estimator — the complementary filter is a debugging scaffold on the way there.

See also: [[rotating-coordinate-frames]] for the frame convention (NED) that feeds the $R$ matrices, [[euler-body-rate-cross-coupling]] for the gyroscopic terms that the ESKF's dynamics must account for in aggressive flight, [[accel-roll-pitch-derivation]] for the accelerometer angle formulas used in the simpler complementary filter, and [[drone-pid-hardware-path]] for how state estimation fits into the broader flight autonomy stack.
