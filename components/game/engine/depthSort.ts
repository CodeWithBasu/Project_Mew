// Orden de oclusion topologico para overlap isometrico (extraido de game.tsx en
// E1). A va antes que B (se dibuja detras) si A esta detras en ambos ejes de la
// grilla. Cada entidad lleva su "footprint" (rango de tiles que ocupa) para
// resolver bien el solape con casas grandes (evita que el personaje "asome" por
// el borde de una pared).

export type DepthBox = { minX: number; maxX: number; minY: number; maxY: number }

export function behind(a: DepthBox, b: DepthBox): boolean {
  const sepX = a.maxX <= b.minX || a.minX >= b.maxX // separados en X
  const sepY = a.maxY <= b.minY || a.minY >= b.maxY // separados en Y
  // Si comparten filas en un eje, la profundidad la decide el otro eje: en iso
  // el mas al NW (coord menor) va detras. Esto quita la ambiguedad de esquina
  // donde el personaje recortaba una pared.
  if (!sepY && sepX) return a.maxX < b.maxX // comparten Y -> comparar X
  if (!sepX && sepY) return a.maxY < b.maxY // comparten X -> comparar Y
  // Solapan en AMBOS ejes (ej: el jugador pegado a la pared/puerta, con su caja
  // invadiendo el tile de una casa 2x2). Aca NO sirve el borde frontal: la
  // esquina frontal de la casa (maxX+maxY) siempre es enorme y la dibujaria
  // encima del jugador. Decidimos por la profundidad del ancla (centro/pies):
  // el de menor (cx+cy) esta mas al NW y va detras.
  if (!sepX && !sepY) {
    const ca = (a.minX + a.maxX + a.minY + a.maxY) / 2 // = cx + cy
    const cb = (b.minX + b.maxX + b.minY + b.maxY) / 2
    return ca < cb
  }
  // separados en diagonal: heuristica del borde frontal
  return a.maxX + a.maxY < b.maxX + b.maxY
}

// Insertion sort estable in-place usando `behind`.
export function depthSort<T extends DepthBox>(ents: T[]): void {
  for (let i = 1; i < ents.length; i++) {
    const cur = ents[i]
    let j = i - 1
    while (j >= 0 && behind(cur, ents[j])) {
      ents[j + 1] = ents[j]
      j--
    }
    ents[j + 1] = cur
  }
}
