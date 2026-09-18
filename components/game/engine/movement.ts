// Movimiento del personaje (E4a). Reemplaza el modelo accel/friction anterior
// (constante de tiempo larga -> arranque/freno blandos y "patinaje") por un
// suavizado exponencial corto sobre una simulacion de PASO FIJO. Resultado:
// arranca casi instantaneo, frena casi en seco, y se siente identico a
// cualquier refresh rate porque el sim corre a 60Hz fijo y el dibujo interpola.

import type { Dir } from './projection'

export const WALK_SPEED = 0.105 // tiles por frame (60Hz)
export const RUN_SPEED = 0.185
export const MAX_SPEED = RUN_SPEED

export const FIXED_DT = 1000 / 60 // ms por sub-paso de simulacion

// Constante de tiempo del suavizado de velocidad, en sub-pasos (1 = 16.67ms).
// Mas chico = mas instantaneo. Frenar es un pelin mas rapido que acelerar para
// que el control se sienta firme y sin deslizamiento.
const TURN_TAU = 2.2
const STOP_TAU = 1.5

export type Mover = {
  x: number
  y: number
  vx: number
  vy: number
  dir: Dir
  speed: number
  gait: number
  walking: boolean
}

export type MoveInput = { ix: number; iy: number; running: boolean }

// Un sub-paso de simulacion de tamano fijo (dt = 1 frame). Integra la velocidad
// con suavizado exponencial hacia la objetivo y avanza la posicion con colision
// por eje. Muta `m`.
export function stepMover(
  m: Mover,
  input: MoveInput,
  blocked: (x: number, y: number) => boolean,
) {
  const hasInput = input.ix !== 0 || input.iy !== 0
  const target = input.running ? RUN_SPEED : WALK_SPEED
  let tvx = 0
  let tvy = 0
  if (hasInput) {
    const len = Math.hypot(input.ix, input.iy)
    tvx = (input.ix / len) * target
    tvy = (input.iy / len) * target
  }

  // alpha = 1 - e^(-dt/tau) con dt = 1 sub-paso. Independiente del framerate
  // porque el sub-paso es siempre 16.67ms.
  const tau = hasInput ? TURN_TAU : STOP_TAU
  const a = 1 - Math.exp(-1 / tau)
  m.vx += (tvx - m.vx) * a
  m.vy += (tvy - m.vy) * a
  // corta velocidades minimas para que pare del todo (sin micro-deriva)
  if (!hasInput && Math.hypot(m.vx, m.vy) < 0.002) {
    m.vx = 0
    m.vy = 0
  }

  const speed = Math.hypot(m.vx, m.vy)
  m.speed = speed
  const moving = speed > 0.004
  m.walking = moving

  if (moving) {
    // orientacion segun el input (si lo hay) o la velocidad real
    const ox = hasInput ? tvx : m.vx
    const oy = hasInput ? tvy : m.vy
    if (Math.abs(ox + oy) > Math.abs(ox - oy)) m.dir = ox + oy > 0 ? 'down' : 'up'
    else m.dir = ox - oy > 0 ? 'right' : 'left'
    // avance con colision por eje (dt = 1 frame)
    if (!blocked(m.x + m.vx, m.y)) m.x += m.vx
    else m.vx = 0
    if (!blocked(m.x, m.y + m.vy)) m.y += m.vy
    else m.vy = 0
    // fase del ciclo de paso proporcional a la velocidad
    m.gait += speed * 9
  } else {
    // mantiene la fase cerca del reposo para que las piernas asienten juntas
    m.gait += 0.05
  }
}
